import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {TABLES,SYNC_TABLES,validateRecord,validateBackup,toCSV,fromCSV,compareVersions,planSeedRefresh} from '../public/js/db.js';

const stamp='2026-11-24T00:00:00.000Z';
const record=(extra={})=>({id:randomUUID(),createdAt:stamp,updatedAt:stamp,deleted:false,changeId:randomUUID(),...extra});
const backup=()=>({schemaVersion:1,tables:Object.fromEntries(TABLES.map(t=>[t,[]])),metadata:{}});
const seedRecord=(extra={})=>{const row=record(extra);delete row.changeId;return row;};
const applySeedChanges=(current,incoming,previousIds)=>{
  const result=structuredClone(current),changes=planSeedRefresh(incoming,current,previousIds);
  for(const table of Object.keys(changes.puts)){
    const rows=new Map((result[table]||[]).map(row=>[row.id,row]));
    for(const id of changes.deletes[table])rows.delete(id);
    for(const row of changes.puts[table])rows.set(row.id,structuredClone(row));
    result[table]=[...rows.values()];
  }
  return result;
};

test('programme refresh preserves a logged session family when exercise order and IDs change',()=>{
  const historical=seedRecord({status:'planned',title:'Original session'}),future=seedRecord({status:'planned',title:'Next session'});
  const oldExercise=seedRecord({name:'Original lift',loadConvention:'Combined external kg'}),newExercise=seedRecord({name:'New lift'});
  const oldRow=seedRecord({sessionId:historical.id,exerciseId:oldExercise.id,order:1,targetSets:[{reps:5}]}),oldFuture=seedRecord({sessionId:future.id,exerciseId:oldExercise.id,order:1,targetSets:[{reps:5}]});
  const addedHistory=seedRecord({sessionId:historical.id,exerciseId:newExercise.id,order:1,targetSets:[{reps:3}]}),addedFuture=seedRecord({sessionId:future.id,exerciseId:newExercise.id,order:1,targetSets:[{reps:3}]});
  const log=record({sessionId:historical.id,sessionExerciseId:oldRow.id,exerciseId:oldExercise.id,reps:5,loadKg:20});
  const current={sessions:[historical,future],session_exercises:[oldRow,oldFuture],exercises:[oldExercise],set_logs:[log]},before=structuredClone(current);
  const incoming={sessions:[{...historical,title:'Updated session'},{...future,title:'Updated future'}],session_exercises:[addedHistory,addedFuture],exercises:[{...oldExercise,loadConvention:'Per implement kg'},newExercise]};
  const result=applySeedChanges(current,incoming,{sessions:[historical.id,future.id],session_exercises:[oldRow.id,oldFuture.id],exercises:[oldExercise.id]});
  assert.deepEqual(result.sessions.find(row=>row.id===historical.id),historical);
  assert.deepEqual(result.session_exercises.filter(row=>row.sessionId===historical.id),[oldRow]);
  assert.deepEqual(result.exercises.find(row=>row.id===oldExercise.id),oldExercise);
  assert.equal(result.sessions.find(row=>row.id===future.id).title,'Updated future');
  assert.deepEqual(result.session_exercises.filter(row=>row.sessionId===future.id),[addedFuture]);
  assert.deepEqual(result.set_logs,[log]);assert.deepEqual(current,before);
});

test('started, completed, edited and tombstoned sessions retain their complete original prescriptions',()=>{
  for(const activity of [{startedAt:stamp},{completedAt:stamp},{status:'completed'},{status:'skipped'},{changeId:randomUUID()},{deleted:true},{actualDurationMin:0},{sessionRpe:0},{warmupDone:true},{cooldownDone:true}]){
    const session=seedRecord({status:'planned',...activity});if(activity.changeId)session.changeId=activity.changeId;
    const child=seedRecord({sessionId:session.id,order:1,targetSets:[{reps:8}]}),newChild=seedRecord({sessionId:session.id,order:1,targetSets:[{reps:2}]});
    const result=applySeedChanges({sessions:[session],session_exercises:[child]},{sessions:[{...session,title:'New baseline'}],session_exercises:[newChild]},{sessions:[session.id],session_exercises:[child.id]});
    assert.deepEqual(result.sessions,[session],JSON.stringify(activity));
    assert.deepEqual(result.session_exercises,[child],JSON.stringify(activity));
  }
  const session=seedRecord({status:'planned'}),child=record({sessionId:session.id,targetSets:[{reps:7}]}),other=seedRecord({sessionId:session.id});
  const result=applySeedChanges({sessions:[session],session_exercises:[child,other]},{sessions:[{...session,title:'Changed'}],session_exercises:[]},{sessions:[session.id],session_exercises:[child.id,other.id]});
  assert.deepEqual(result.session_exercises,[child,other]);assert.deepEqual(result.sessions,[session]);
});

test('soft-deleted skill and test history protect parent sessions and referenced exercise definitions',()=>{
  for(const table of ['set_logs','skill_logs','test_results']){
    const session=seedRecord({status:'planned'}),exercise=seedRecord({name:'Historical exercise'}),child=seedRecord({sessionId:session.id,exerciseId:exercise.id});
    // A legacy log may have only the prescription relation. It still protects
    // its family, even after a user soft-deletes that log.
    const log=record({sessionExerciseId:child.id,exerciseId:exercise.id,deleted:true});
    const result=applySeedChanges({sessions:[session],session_exercises:[child],exercises:[exercise],[table]:[log]},{sessions:[],session_exercises:[],exercises:[]},{sessions:[session.id],session_exercises:[child.id],exercises:[exercise.id]});
    assert.deepEqual(result.sessions,[session]);assert.deepEqual(result.session_exercises,[child]);assert.deepEqual(result.exercises,[exercise]);assert.deepEqual(result[table],[log]);
  }
});

test('baseline refresh updates untouched rows while preserving unrelated personal edits and legacy records',()=>{
  const old=seedRecord({name:'Old baseline'}),fresh=seedRecord({name:'New exercise'}),unused=seedRecord({name:'Obsolete baseline'}),personal=record({name:'Personal exercise'}),deleted=record({deleted:true,name:'Removed exercise'}),legacy=seedRecord({name:'Untracked legacy row'});
  const current={exercises:[old,unused,personal,deleted,legacy]};
  const result=applySeedChanges(current,{exercises:[{...old,name:'Updated baseline'},fresh,{...personal,name:'Wrong overwrite'},{...deleted,deleted:false}]},{exercises:[old.id,unused.id,personal.id,deleted.id]});
  assert.equal(result.exercises.find(row=>row.id===old.id).name,'Updated baseline');
  assert.deepEqual(result.exercises.find(row=>row.id===fresh.id),fresh);assert.ok(!result.exercises.some(row=>row.id===unused.id));
  assert.deepEqual(result.exercises.find(row=>row.id===personal.id),personal);assert.deepEqual(result.exercises.find(row=>row.id===deleted.id),deleted);assert.deepEqual(result.exercises.find(row=>row.id===legacy.id),legacy);
});

test('whole generated seed and test metadata meet the storage schema',async()=>{
  const data=JSON.parse(await readFile(new URL('../public/data/programme.json',import.meta.url),'utf8'));
  const checked=validateBackup(data);let n=0;
  for(const t of SYNC_TABLES)for(const row of checked.tables[t]||[]){validateRecord(t,row);n++;}
  assert.ok(n>2000);assert.equal(checked.metadata.testProtocols.length,13);
});

test('lossless CSV preserves all tables, tombstones, Unicode, notes and safe metadata',()=>{
  const data=backup();for(const table of TABLES)data.tables[table]=[record({note:'=SUM(A1:A2), "quoted"\nPuck 🏒',deleted:table==='sessions'})];
  data.metadata={preferences:{theme:'dark'},testProtocols:[{name:'Personal baseline',value:null}]};
  const csv=toCSV(data),parsed=fromCSV(csv);
  assert.deepEqual(parsed.tables,data.tables);assert.deepEqual(parsed.metadata,data.metadata);
  assert.ok(csv.startsWith('\uFEFF"table","recordJSON"'));
  assert.ok(csv.includes('"{')); // The record cell begins with JSON, not a formula marker.
});

test('bad numbers, non-JSON values, secrets and unsupported backup tables are rejected',()=>{
  const valid=record({loadKg:null,reps:0,rpe:null,heartRate:null,wristPain:0});validateRecord('set_logs',valid);
  for(const changes of [{loadKg:1501},{reps:'5'},{rpe:11},{sleepHours:25},{heartRate:Infinity},{wristPain:-1},{createdAt:'2026'},{id:'bad'},{deleted:'false'},{refresh_token:'secret'}])assert.throws(()=>validateRecord('set_logs',{...valid,...changes}));
  assert.throws(()=>validateRecord('set_logs',{...valid,nested:JSON.parse('{"__proto__":{}}')}));
  const bad=backup();bad.tables.auth=[];assert.throws(()=>validateBackup(bad),/Unknown/);
  const secret=backup();secret.metadata={'sync:session':{access_token:'secret'}};assert.throws(()=>validateBackup(secret),/metadata/);
  const hidden=backup();hidden.metadata.preferences={password:'secret'};assert.throws(()=>validateBackup(hidden),/secret/);
  assert.throws(()=>fromCSV('table,recordJSON\nset_logs,"{bad}"'),/JSON/);
});

test('LWW timestamp and UUID tie ordering are deterministic',()=>{
  const a=record({changeId:'ab4213af-9102-4aa5-853a-55690d9e6393'}),b={...a,changeId:'bb4213af-9102-4aa5-853a-55690d9e6393'};
  assert.equal(compareVersions(a,b),-1);assert.equal(compareVersions(b,a),1);assert.equal(compareVersions(a,a),0);
  assert.equal(compareVersions({...a,updatedAt:'2026-11-24T00:00:00.001Z'},b),1);
});

test('REST sync preserves an in-flight edit, retries errors, paginates and blocks another account',async()=>{
  // This transport harness tests sync logic. It does not claim to emulate native
  // IndexedDB transactions or a real Postgres/RLS deployment.
  const metadata=new Map(),local=new Map(),cloud=new Map();let queue=[],duringPush=null,failPush=false,pullPages=0;
  const userA={id:'00000000-0000-4000-8000-000000000001',email:'a@example.test'},userB={id:'00000000-0000-4000-8000-000000000002',email:'b@example.test'};
  const copy=value=>structuredClone(value);
  const localEdit=row=>{local.set(row.id,copy(row));queue.push({id:randomUUID(),table:'set_logs',recordId:row.id,record:copy(row)});};
  const mock={SYNC_TABLES,getMeta:async(k,f=null)=>copy(metadata.has(k)?metadata.get(k):f),setMeta:async(k,v)=>{metadata.set(k,copy(v));return v;},all:async()=>copy(queue),readPending:async(limit)=>copy(queue.slice(0,limit)),acknowledgeChanges:async(ids)=>{queue=queue.filter(x=>!ids.includes(x.id));},applyRemote:async(changes)=>{for(const {table,record:row} of changes){validateRecord(table,row);if(compareVersions(row,local.get(row.id))>0)local.set(row.id,copy(row));}}};
  const oldFetch=globalThis.fetch;globalThis.__SHIFT_SYNC_TEST_DB=mock;
  for(let i=0;i<501;i++){const row=record({id:'10000000-0000-4000-8000-'+i.toString(16).padStart(12,'0')});cloud.set(row.id,row);}
  globalThis.fetch=async(url,options)=>{
    const path=new URL(url),body=options.body?JSON.parse(options.body):{},token=options.headers.Authorization;
    const respond=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(path.pathname.endsWith('/token')){const user=body.email===userB.email?userB:userA;return respond({access_token:user.id,refresh_token:'refresh-'+user.id,expires_in:3600,user});}
    if(path.pathname.endsWith('/user'))return respond(token==='Bearer '+userB.id?userB:userA);
    if(path.pathname.endsWith('/logout'))return respond(null,204);
    if(path.pathname.endsWith('/shift_push')){
      if(failPush)return respond({message:'Temporary test outage'},503);
      if(duringPush){const hook=duringPush;duringPush=null;hook();}
      const response=[];for(const change of body.p_changes){const row=change.record;if(compareVersions(row,cloud.get(row.id))>0)cloud.set(row.id,copy(row));response.push({table:change.table,record:copy(cloud.get(row.id))});}return respond(response);
    }
    if(path.pathname.endsWith('/shift_pull')){pullPages++;const rows=[...cloud.values()].sort((a,b)=>a.id.localeCompare(b.id)).filter(r=>!body.p_after_id||r.id>body.p_after_id).slice(0,body.p_limit);return respond(rows.map(row=>({table:'set_logs',record:row})));}
    throw new Error('Unexpected test endpoint: '+path.pathname);
  };
  try{
    const source=(await readFile(new URL('../public/js/sync.js',import.meta.url),'utf8')).replace(/^import .*from '\.\/db\.js';/m,'const {getMeta,setMeta,readPending,acknowledgeChanges,applyRemote,SYNC_TABLES,all}=globalThis.__SHIFT_SYNC_TEST_DB;');
    const sync=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    await sync.configureSync({url:'https://project.supabase.co',key:'sb_publishable_test'});
    await assert.rejects(()=>sync.configureSync({url:'https://project.supabase.co',key:'sb_secret_forbidden'}),/secret/);
    await sync.signIn(userA.email,'password123');assert.ok(pullPages>=3);assert.equal(local.size,501);
    const first=record({reps:5,updatedAt:'2026-11-24T00:00:01.000Z'});localEdit(first);
    duringPush=()=>localEdit({...first,reps:9,updatedAt:'2026-11-24T00:00:02.000Z',changeId:randomUUID()});
    await sync.syncNow();assert.equal(queue.length,0);assert.equal(local.get(first.id).reps,9);assert.equal(cloud.get(first.id).reps,9);
    const retry=record({reps:3});localEdit(retry);failPush=true;await sync.syncNow();assert.equal(sync.getSyncState().status,'error');assert.equal(queue.length,1);
    failPush=false;await sync.syncNow();assert.equal(sync.getSyncState().status,'synced');assert.equal(queue.length,0);
    await sync.signOut();await assert.rejects(()=>sync.signIn(userB.email,'password123'),/another account/);
    assert.equal(metadata.get('sync:account').userId,userA.id);assert.equal(metadata.get('sync:session'),null);
    await assert.rejects(()=>sync.configureSync({url:'https://other.supabase.co',key:'sb_publishable_test'}),/different Supabase project/);
  }finally{globalThis.fetch=oldFetch;delete globalThis.__SHIFT_SYNC_TEST_DB;}
});

test('SQL uses allowlisted owner-scoped RPCs and refuses unrelated existing tables',async()=>{
  const sql=await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8');
  assert.match(sql,/primary key \(user_id,id\)/i);assert.match(sql,/security invoker/gi);assert.doesNotMatch(sql,/security definer/i);
  assert.match(sql,/not a SHIFT table/);assert.match(sql,/with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql,/excluded\.updated_at,excluded\.change_id\) > \(existing\.updated_at,existing\.change_id/);
  assert.match(sql,/table_name collate "C",id\) > \(\$2::text collate "C",\$3::uuid\)/);
  assert.match(sql,/revoke all on function public\.shift_push/);assert.doesNotMatch(sql,/grant delete/i);
});
