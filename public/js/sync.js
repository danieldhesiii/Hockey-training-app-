import {getMeta,setMeta,readPending,acknowledgeChanges,applyRemote,SYNC_TABLES,all} from './db.js';

// Optional cloud transport. IndexedDB remains usable without configuration,
// authentication or a network connection. Secrets never enter app exports.
const CONFIG='sync:config',SESSION='sync:session',ACCOUNT='sync:account',LAST='sync:lastSynced';
const listeners=new Set(),requests=new Set();
let config=null,session=null,started=false,loading=null,inflight=null,refreshing=null,timer=null,poll=null,generation=0;
let state={status:'local',lastSynced:null,error:null,email:null,pending:0,configured:false};
const online=()=>typeof navigator==='undefined'||navigator.onLine!==false;
const visible=()=>typeof document==='undefined'||document.visibilityState!=='hidden';
function publish(patch={}) {state={...state,...patch};for(const fn of listeners){try{fn({...state});}catch(error){console.error('Sync subscriber failed:',error);}}return getSyncState();}
export function getSyncState(){return {...state};}
export function subscribeSync(fn){listeners.add(fn);fn(getSyncState());return()=>listeners.delete(fn);}
function currentStatus(){return !config?'local':!session?'signed-out':!online()?'offline':'synced';}
function abortRequests(){generation++;for(const controller of requests)controller.abort();requests.clear();}
function assertGeneration(expected){if(expected!==generation)throw new Error('Sync stopped because the local account or connection changed.');}
async function exclusive(name,fn){return globalThis.navigator?.locks?.request?navigator.locks.request(name,fn):fn();}
async function pendingCount(){const count=(await all('sync_queue')).length;publish({pending:count});return count;}

function decodePayload(token){try{return JSON.parse(atob(token.split('.')[1].replaceAll('-','+').replaceAll('_','/')));}catch{return null;}}
function validateConfiguration(input){
  if(!input||typeof input.url!=='string'||typeof input.key!=='string')throw new Error('Enter the Supabase project URL and publishable key.');
  let url;try{url=new URL(input.url.trim());}catch{throw new Error('Enter a valid Supabase project URL.');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(local&&url.protocol==='http:'))||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('Use the HTTPS project origin, with no API path, query or credentials.');
  const key=input.key.trim();
  if(key.startsWith('sb_secret_')||decodePayload(key)?.role==='service_role')throw new Error('A service-role or secret key must never be placed in this browser. Use the publishable key.');
  if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&decodePayload(key)?.role!=='anon')throw new Error('Use a Supabase publishable key, or a legacy anon key.');
  return {url:url.origin,key};
}
async function load(){
  if(!loading)loading=(async()=>{config=await getMeta(CONFIG);session=await getMeta(SESSION);const bound=await getMeta(ACCOUNT);const lastSynced=await getMeta(LAST);if(config)config=validateConfiguration(config);if(session&&(!bound||bound.userId!==session.user?.id||bound.projectUrl!==config?.url)){session=null;await setMeta(SESSION,null);}await pendingCount();publish({configured:!!config,email:session?.user?.email||null,lastSynced,status:currentStatus()});})();
  try{await loading;}catch(error){loading=null;publish({status:'error',error:error.message});throw error;}
}
export async function configureSync(input){
  await load();const next=validateConfiguration(input),bound=await getMeta(ACCOUNT);
  if(bound&&bound.projectUrl!==next.url)throw new Error('This device is bound to a different Supabase project. Export your data, then clear this device before changing projects.');
  abortRequests();if(config?.url!==next.url){session=null;await setMeta(SESSION,null);}config=next;await setMeta(CONFIG,next);
  publish({configured:true,error:null,status:currentStatus()});if(session)schedule();return getSyncState();
}

async function api(path,{method='POST',body,token,project=config}={}){
  if(!project)throw new Error('Configure Supabase in Settings first.');
  const controller=new AbortController();requests.add(controller);const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const headers={apikey:project.key,'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;
    const response=await fetch(project.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,credentials:'omit',cache:'no-store'});
    const raw=await response.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch{if(response.ok)throw new Error('Supabase returned an unreadable response.');}
    if(!response.ok){const error=new Error(data?.msg||data?.message||data?.error_description||data?.error||'Supabase request failed ('+response.status+').');error.status=response.status;throw error;}
    return data;
  }catch(error){if(error.name==='AbortError')throw new Error('The request timed out or sync was stopped. Your local changes are still saved.');throw error;}
  finally{clearTimeout(timeout);requests.delete(controller);}
}
function credentials(email,password){const e=String(email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw new Error('Enter a valid email address.');if(typeof password!=='string'||password.length<8)throw new Error('Use a password with at least 8 characters.');return {email:e,password};}
function normalizedSession(data,user){if(typeof data?.access_token!=='string'||typeof data?.refresh_token!=='string'||!user?.id)throw new Error('Supabase did not return a valid session.');return {access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Number(data.expires_at)||(Math.floor(Date.now()/1000)+(Number(data.expires_in)||3600)),user:{id:user.id,email:user.email||''}};}
async function acceptSession(data,expected){
  const user=await api('/auth/v1/user',{method:'GET',token:data.access_token});assertGeneration(expected);
  const bound=await getMeta(ACCOUNT);assertGeneration(expected);
  if(bound&&(bound.userId!==user.id||bound.projectUrl!==config.url)){
    try{await api('/auth/v1/logout?scope=local',{token:data.access_token});}catch{}
    throw new Error('This device contains data bound to another account. Export it, sign out and clear this device before using a different account.');
  }
  const next=normalizedSession(data,user);
  await setMeta(ACCOUNT,{userId:user.id,email:user.email||'',projectUrl:config.url});assertGeneration(expected);
  await setMeta(SESSION,next);assertGeneration(expected);session=next;publish({email:user.email||'',error:null,status:currentStatus()});return user;
}
export async function signIn(email,password){
  await load();const body=credentials(email,password);if(!config)throw new Error('Configure Supabase in Settings first.');
  const user=await exclusive('shift-hockey-auth',async()=>{const expected=generation;const data=await api('/auth/v1/token?grant_type=password',{body});assertGeneration(expected);return acceptSession(data,expected);});
  await syncNow();return {user,...getSyncState()};
}
export async function signUp(email,password){
  await load();const body=credentials(email,password);if(!config)throw new Error('Configure Supabase in Settings first.');
  const bound=await getMeta(ACCOUNT);if(bound&&bound.email.toLowerCase()!==body.email.toLowerCase())throw new Error('Export and clear this account-bound device before creating a different account.');
  const result=await exclusive('shift-hockey-auth',async()=>{const expected=generation;const data=await api('/auth/v1/signup',{body});assertGeneration(expected);if(!data?.access_token)return {requiresEmailConfirmation:true,user:data?.user||data};return {requiresEmailConfirmation:false,user:await acceptSession(data,expected)};});
  if(!result.requiresEmailConfirmation)await syncNow();return result;
}
export async function signOut(){
  await load();const previous=session;abortRequests();session=null;await setMeta(SESSION,null);publish({email:null,status:config?'signed-out':'local',error:null});
  if(previous?.access_token){try{await api('/auth/v1/logout?scope=local',{token:previous.access_token});}catch(error){if(![401,403,404].includes(error.status)){publish({error:'Signed out on this device. Server logout could not be confirmed: '+error.message});return getSyncState();}}}
  return getSyncState();
}
export async function disconnectSync(){await signOut();abortRequests();config=null;await setMeta(CONFIG,null);publish({configured:false,status:'local'});return getSyncState();}

async function accessToken(force=false){
  if(refreshing)return refreshing;
  refreshing=exclusive('shift-hockey-auth',async()=>{
    const expected=generation;const saved=await getMeta(SESSION);assertGeneration(expected);session=saved;
    if(!session)throw new Error('Sign in again to sync. Local data is unchanged.');
    const bound=await getMeta(ACCOUNT);assertGeneration(expected);
    if(bound?.userId!==session.user.id||bound?.projectUrl!==config?.url)throw new Error('Local account binding does not match this session. Export and clear before changing accounts.');
    if(!force&&session.expires_at>Date.now()/1000+60)return session.access_token;
    try{
      const data=await api('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:session.refresh_token}});assertGeneration(expected);
      const next=normalizedSession(data,data.user||session.user);if(next.user.id!==bound.userId)throw new Error('Refreshed session belongs to another account.');
      await setMeta(SESSION,next);assertGeneration(expected);session=next;return next.access_token;
    }catch(error){if([400,401,403].includes(error.status)){session=null;await setMeta(SESSION,null);publish({email:null,status:'signed-out'});}throw error;}
  });
  try{return await refreshing;}finally{refreshing=null;}
}
async function rpc(name,body){let token=await accessToken();try{return await api('/rest/v1/rpc/'+name,{body,token});}catch(error){if(error.status!==401)throw error;token=await accessToken(true);return api('/rest/v1/rpc/'+name,{body,token});}}
function checkPushResponse(response,batch){if(!Array.isArray(response)||response.length!==batch.length)throw new Error('Incomplete server acknowledgement. The outbox was retained.');for(let i=0;i<batch.length;i++)if(response[i]?.table!==batch[i].table||response[i]?.record?.id!==batch[i].recordId)throw new Error('Unexpected server acknowledgement. The outbox was retained.');}

async function synchronize(){
  await load();config=await getMeta(CONFIG);session=await getMeta(SESSION);const expected=generation;await pendingCount();
  if(!config){publish({status:'local',configured:false,email:null});return getSyncState();}
  if(!session){publish({status:'signed-out',configured:true,email:null});return getSyncState();}
  if(!online()){publish({status:'offline',error:null});return getSyncState();}
  publish({status:'syncing',error:null,email:session.user.email});
  try{
    let rounds=0;
    while(true){const batch=await readPending(100);assertGeneration(expected);if(!batch.length)break;if(++rounds>2000)throw new Error('Large sync paused. Run sync again to continue the saved outbox.');
      const changes=batch.map(item=>({table:item.table,record:item.record}));const response=await rpc('shift_push',{p_changes:changes});assertGeneration(expected);checkPushResponse(response,batch);
      await applyRemote(response);assertGeneration(expected);await acknowledgeChanges(batch.map(item=>item.id));await pendingCount();
    }
    let afterTable=null,afterId=null,pages=0;
    while(true){const response=await rpc('shift_pull',{p_after_table:afterTable,p_after_id:afterId,p_limit:250});assertGeneration(expected);
      if(!Array.isArray(response)||response.length>250)throw new Error('Invalid server page. Local data was retained.');if(!response.length)break;
      for(const entry of response){if(!SYNC_TABLES.includes(entry.table)||typeof entry.record?.id!=='string'||(afterTable!==null&&(entry.table<afterTable||(entry.table===afterTable&&entry.record.id<=afterId))))throw new Error('Unordered server page. Sync stopped safely.');afterTable=entry.table;afterId=entry.record.id;}
      await applyRemote(response);assertGeneration(expected);if(++pages>2000)throw new Error('Too many server pages. Check the configured project.');if(response.length<250)break;
    }
    const stamp=new Date().toISOString();await setMeta(LAST,stamp);assertGeneration(expected);const pending=await pendingCount();publish({status:'synced',lastSynced:stamp,error:null,pending});if(pending)schedule();return getSyncState();
  }catch(error){if(expected===generation)publish({status:online()?'error':'offline',error:error.message});await pendingCount().catch(()=>{});return getSyncState();}
}
export async function syncNow(){if(inflight)return inflight;inflight=exclusive('shift-hockey-sync',synchronize);try{return await inflight;}finally{inflight=null;}}
function schedule(){clearTimeout(timer);if(!started||!config||!session||!online()||!visible())return;timer=setTimeout(()=>syncNow().catch(error=>publish({status:'error',error:error.message})),800);}

async function consumeEmailCallback(){
  if(typeof location==='undefined'||!location.hash.includes('access_token='))return;
  const params=new URLSearchParams(location.hash.slice(1)),data={access_token:params.get('access_token'),refresh_token:params.get('refresh_token'),expires_in:Number(params.get('expires_in'))};
  history.replaceState(null,'',location.pathname+location.search+'#settings');
  if(!config){publish({error:'Email confirmed. Configure this device, then sign in with your email and password.'});return;}
  if(!data.refresh_token){publish({error:'Email confirmation did not include a session. Sign in with your password.'});return;}
  try{await exclusive('shift-hockey-auth',()=>acceptSession(data,generation));}catch(error){publish({error:error.message,status:'error'});}
}
export async function startSync(){
  await load();if(started)return getSyncState();started=true;
  if(typeof window!=='undefined'){
    window.addEventListener('online',schedule);window.addEventListener('focus',schedule);
    window.addEventListener('offline',()=>{if(config&&session)publish({status:'offline'});});
    window.addEventListener('shift-data-change',event=>{pendingCount().catch(error=>publish({status:'error',error:error.message}));if(['local','import'].includes(event.detail?.source))schedule();});
    window.addEventListener('shift-database-cleared',()=>{abortRequests();clearTimeout(timer);config=null;session=null;loading=null;publish({status:'local',lastSynced:null,error:null,email:null,pending:0,configured:false});});
    document.addEventListener('visibilitychange',()=>{if(visible())schedule();});
  }
  poll=setInterval(()=>{if(visible())schedule();},60000);if(poll.unref)poll.unref();await consumeEmailCallback();schedule();return getSyncState();
}
