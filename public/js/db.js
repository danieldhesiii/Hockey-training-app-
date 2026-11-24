/* IndexedDB is the local source of truth. Entity writes and their outbox records
 * commit in one transaction. No remote response can overwrite a newer local edit. */
export const TABLES = Object.freeze(['users','plan','phases','weeks','sessions','session_exercises','exercises','set_logs','skill_logs','test_results','wellness_logs','personal_records','sync_queue']);
export const SYNC_TABLES = Object.freeze(TABLES.filter(name => name !== 'sync_queue'));
export const DB_NAME = 'shift-hockey-v1';
const META = '_meta';
const SAFE_META = ['preferences','settings','testProtocols','sources'];
const SEED_TABLES = ['plan','phases','weeks','sessions','session_exercises','exercises'];
const SEED_HISTORY_TABLES = ['set_logs','skill_logs','test_results','personal_records'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let opening;
const request = req => new Promise((resolve,reject) => { req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error || new Error('Database request failed.')); });
const completion = tx => new Promise((resolve,reject) => { tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error || new Error('Database transaction failed.')); tx.onabort=()=>reject(tx.error || new Error('Database transaction was cancelled.')); });
function emit(source,table) { if(typeof window!=='undefined') window.dispatchEvent(new CustomEvent('shift-data-change',{detail:{source,table}})); }
function tableName(name) { if(!TABLES.includes(name)) throw new Error('Unknown data table: '+name); return name; }
function randomId() { return crypto.randomUUID(); }
function plain(value) { return value && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value)); }

export async function openDB() {
  if(!globalThis.indexedDB) throw new Error('This browser cannot open IndexedDB. Use a supported normal browser window.');
  if(!opening) opening=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{ for(const name of [...TABLES,META]) if(!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name,{keyPath:name===META?'key':'id'}); };
    req.onerror=()=>{opening=null;reject(req.error || new Error('Local storage could not be opened.'));};
    req.onblocked=()=>{opening=null;reject(new Error('Close other SHIFT tabs so local storage can be updated.'));};
    req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
  });
  return opening;
}

// A programme row is a baseline only until the athlete touches its session.
// Protect the entire family: generated prescription IDs can change when a new
// exercise is inserted, so protecting only the logged row's own ID is not enough.
// Tombstoned logs remain evidence of history and must not permit resurrection or
// reinterpretation on the next programme update.
export function planSeedRefresh(incoming,existing,previousIds={}) {
  const rows=table=>existing[table] || [];
  const prescriptions=new Map(rows('session_exercises').map(row=>[row.id,row]));
  const protectedSessions=new Set();
  const protectedExercises=new Set();
  const collectExerciseReferences=value=>{
    if(!value || typeof value!=='object')return;
    if(Array.isArray(value)){for(const entry of value)collectExerciseReferences(entry);return;}
    for(const [key,child] of Object.entries(value)){
      if(/^(exerciseId|originalExerciseId|referenceExerciseId|testReferenceExerciseId)$/.test(key)&&typeof child==='string')protectedExercises.add(child);
      else if(child && typeof child==='object')collectExerciseReferences(child);
    }
  };
  for(const session of rows('sessions')){
    if(session.changeId || session.deleted || session.startedAt || session.completedAt ||
       (session.status && session.status!=='planned') || session.actualDurationMin!=null || session.sessionRpe!=null ||
       session.warmupDone || session.cooldownDone)protectedSessions.add(session.id);
  }
  for(const prescription of prescriptions.values()){
    if(prescription.changeId || prescription.deleted)protectedSessions.add(prescription.sessionId);
  }
  for(const table of SEED_HISTORY_TABLES)for(const log of rows(table)){
    if(log.sessionId)protectedSessions.add(log.sessionId);
    const parent=prescriptions.get(log.sessionExerciseId);
    if(parent?.sessionId)protectedSessions.add(parent.sessionId);
    collectExerciseReferences(log);
  }
  for(const session of rows('sessions'))if(protectedSessions.has(session.id))collectExerciseReferences(session);
  for(const prescription of prescriptions.values())if(protectedSessions.has(prescription.sessionId))collectExerciseReferences(prescription);
  const isProtected=(table,row)=>table==='sessions'?protectedSessions.has(row.id):
    table==='session_exercises'?protectedSessions.has(row.sessionId):
    table==='exercises'?protectedExercises.has(row.id):false;
  const puts={},deletes={};
  for(const table of SEED_TABLES){
    puts[table]=[];deletes[table]=[];
    const current=new Map(rows(table).map(row=>[row.id,row]));
    const incomingRows=incoming[table] || [],retained=new Set(incomingRows.map(row=>row.id));
    for(const row of incomingRows){
      const old=current.get(row.id);
      if(isProtected(table,row) || (old&&isProtected(table,old)))continue;
      if(!old || (!old.changeId&&!old.deleted))puts[table].push(row);
    }
    for(const id of Array.isArray(previousIds[table])?previousIds[table]:[]){
      const old=current.get(id);
      if(!retained.has(id)&&old&&!old.changeId&&!old.deleted&&!isProtected(table,old))deletes[table].push(id);
    }
  }
  return {puts,deletes};
}

export async function initDB(programme) {
  const db=await openDB();
  if(!programme) return db;
  // Digest and validation finish before an IndexedDB transaction begins. Awaiting
  // unrelated asynchronous work inside a transaction can let it auto-commit.
  if(!globalThis.crypto?.subtle)throw new Error('Open SHIFT over HTTPS or localhost so programme updates can be verified.');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(programme)));
  const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const incoming={},nextIds={};
  for(const table of SEED_TABLES){
    const rows=programme[table] || [];if(!Array.isArray(rows))throw new Error('Invalid programme table: '+table);
    const ids=new Set();for(const row of rows){validateRecord(table,row);if(ids.has(row.id))throw new Error('Duplicate programme UUID in '+table);ids.add(row.id);}
    incoming[table]=rows;nextIds[table]=[...ids];
  }
  validateTree(programme.testProtocols || []);validateTree(programme.sources || []);
  const readTables=[...SEED_TABLES,...SEED_HISTORY_TABLES];
  const tx=db.transaction([...readTables,META],'readwrite'); const done=completion(tx);let refreshed=false;
  try {
    const meta=tx.objectStore(META);
    const [savedFingerprint,savedIds]=await Promise.all([request(meta.get('seedFingerprint')),request(meta.get('seedIds'))]);
    if(savedFingerprint?.value!==fingerprint) {
      const previousIds=plain(savedIds?.value)?savedIds.value:{};
      const snapshots=await Promise.all(readTables.map(table=>request(tx.objectStore(table).getAll())));
      const existing=Object.fromEntries(readTables.map((table,index)=>[table,snapshots[index]]));
      const changes=planSeedRefresh(incoming,existing,previousIds);
      for(const table of SEED_TABLES){
        const store=tx.objectStore(table);
        for(const row of changes.puts[table])store.put(row);
        for(const id of changes.deletes[table])store.delete(id);
      }
      // The baseline manifest never enters a portable backup. Imported records
      // get change IDs, so subsequent app builds preserve those personal edits.
      // Legacy databases without a manifest cannot identify removed old seed
      // rows safely; leave those unknown rows until explicitly removed.
      meta.put({key:'testProtocols',value:programme.testProtocols || []});
      meta.put({key:'sources',value:programme.sources || []});
      meta.put({key:'seeded',value:true});
      meta.put({key:'seedFingerprint',value:fingerprint});
      meta.put({key:'seedIds',value:nextIds});refreshed=true;
    }
    await done;if(refreshed)emit('seed');return db;
  } catch(error) { try{tx.abort();}catch{} await done.catch(()=>{}); throw error; }
}

export async function all(table,{includeDeleted=false}={}) {
  tableName(table);const db=await openDB();const rows=await request(db.transaction(table,'readonly').objectStore(table).getAll());
  return includeDeleted?rows:rows.filter(row=>!row.deleted);
}
export async function get(table,id) { tableName(table); const db=await openDB(); return request(db.transaction(table,'readonly').objectStore(table).get(id)); }
export async function getMeta(key,fallback=null) { const db=await openDB();const row=await request(db.transaction(META,'readonly').objectStore(META).get(key));return row?row.value:fallback; }
export async function setMeta(key,value) { const db=await openDB();const tx=db.transaction(META,'readwrite');const done=completion(tx);tx.objectStore(META).put({key,value});await done;return value; }

// Lexicographic UUID tie-breaking makes simultaneous millisecond edits converge.
export function compareVersions(a,b) {
  if(!b) return 1;if(!a) return -1;
  const time=Date.parse(a.updatedAt)-Date.parse(b.updatedAt);
  if(time) return time>0?1:-1;
  const ac=String(a.changeId || '').toLowerCase(),bc=String(b.changeId || '').toLowerCase();
  return ac===bc?0:ac>bc?1:-1;
}
function prepare(row,old) {
  const stamp=new Date(Math.max(Date.now(),Date.parse(old?.updatedAt || '')+1 || 0)).toISOString();
  return {...old,...row,id:row.id || old?.id || randomId(),createdAt:old?.createdAt || row.createdAt || stamp,updatedAt:stamp,deleted:row.deleted ?? old?.deleted ?? false,changeId:randomId()};
}
function enqueue(store,table,row) { store.put({id:randomId(),createdAt:row.updatedAt,updatedAt:row.updatedAt,deleted:false,changeId:row.changeId,table,recordId:row.id,record:row,attempts:0}); }
export async function save(table,row) { return (await saveMany(table,[row]))[0]; }
export async function saveMany(table,rows) {
  tableName(table);if(table==='sync_queue') throw new Error('Outbox records are managed automatically.');
  if(!Array.isArray(rows)) throw new Error('Records must be an array.');
  const db=await openDB();const tx=db.transaction([table,'sync_queue'],'readwrite');const done=completion(tx);const saved=[];
  try {
    const store=tx.objectStore(table),queue=tx.objectStore('sync_queue');
    for(const input of rows) {
      if(!plain(input)) throw new Error('Record must be an object.');
      const old=input.id?await request(store.get(input.id)):null;
      const row=prepare(input,old);validateRecord(table,row);store.put(row);enqueue(queue,table,row);saved.push(row);
    }
    await done;emit('local',table);return saved;
  } catch(error) {try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
}
export async function remove(table,id) { const row=await get(table,id);if(!row) return null;return save(table,{id,deleted:true}); }

export async function readPending(limit=100) { return (await all('sync_queue')).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(0,limit); }
export async function acknowledgeChanges(ids) {
  const db=await openDB();const tx=db.transaction('sync_queue','readwrite');const done=completion(tx);
  for(const id of ids) tx.objectStore('sync_queue').delete(id);
  await done;emit('queue','sync_queue');
}
export async function applyRemote(changes) {
  if(!Array.isArray(changes)) throw new Error('Invalid sync response.');
  for(const change of changes) {if(!SYNC_TABLES.includes(change.table))throw new Error('Unknown remote table.');validateRecord(change.table,change.record);}
  if(!changes.length) return 0;
  const db=await openDB();const tx=db.transaction([...new Set(changes.map(c=>c.table))],'readwrite');const done=completion(tx);let merged=0;
  try {
    for(const {table,record:row} of changes) {const store=tx.objectStore(table),old=await request(store.get(row.id));if(compareVersions(row,old)>0){store.put(row);merged++;}}
    await done;if(merged)emit('remote');return merged;
  }catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
}

const numericBounds={loadKg:[0,1500],reps:[0,10000],rpe:[0,10],rir:[0,30],durationMin:[0,1440],restSec:[0,86400],workSec:[0,86400],recoverySec:[0,86400],seconds:[0,604800],sleepHours:[0,24],sleepQuality:[0,10],soreness:[0,10],wristPain:[0,10],pain:[0,10],energy:[0,10],mood:[0,10],readiness:[0,100],readinessScore:[0,100],bodyweight:[20,400],bodyweightKg:[20,400],heartRate:[20,250],hr:[20,250],accuracy:[0,100],accuracyPercent:[0,100],eyesUpPercent:[0,100],shots:[0,10000],touches:[0,100000],errors:[0,100000],contacts:[0,10000],distanceM:[0,100000],timeSec:[0,604800],shotSpeedKmh:[0,250]};
function validateTree(value,depth=0,key='') {
  if(depth>16) throw new Error('Record nesting is too deep.');
  if(value===null || typeof value==='boolean') return;
  if(typeof value==='number') {if(!Number.isFinite(value))throw new Error('Non-finite number in '+key);const bounds=numericBounds[key];if(bounds&&(value<bounds[0]||value>bounds[1]))throw new Error('Out-of-range '+key);return;}
  if(typeof value==='string') {if(value.length>50000)throw new Error('Text field is too long.');return;}
  if(Array.isArray(value)){if(value.length>50000)throw new Error('Array is too large.');for(const x of value)validateTree(x,depth+1,key);return;}
  if(!plain(value))throw new Error('Only JSON objects are supported.');
  const entries=Object.entries(value);if(entries.length>1000)throw new Error('Object has too many fields.');
  for(const [k,v] of entries){if(['__proto__','constructor','prototype','access_token','refresh_token','password','service_role','supabaseKey','apiKey'].includes(k))throw new Error('Unsupported or secret field: '+k);validateTree(v,depth+1,k);}
}
export function validateRecord(table,row) {
  tableName(table);if(!plain(row))throw new Error('Invalid '+table+' record.');validateTree(row);
  const numericShape=value=>{for(const key of Object.keys(numericBounds))if(value[key]!==undefined&&value[key]!==null&&typeof value[key]!=='number')throw new Error(key+' must be a number or null.');};
  numericShape(row);
  for(const collection of ['targetSets','warmup','cooldown'])if(row[collection]!==undefined){if(!Array.isArray(row[collection]))throw new Error(collection+' must be an array.');for(const item of row[collection]){if(!plain(item))throw new Error('Invalid '+collection+' entry.');numericShape(item);}}
  if(!UUID.test(row.id || ''))throw new Error('Every record needs a canonical lowercase UUID.');
  for(const k of ['createdAt','updatedAt'])if(typeof row[k]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(row[k])||!Number.isFinite(Date.parse(row[k])))throw new Error('Invalid '+k+'.');
  if(Date.parse(row.updatedAt)<Date.parse(row.createdAt))throw new Error('updatedAt cannot be earlier than createdAt.');
  if(typeof row.deleted!=='boolean')throw new Error('Every record needs a deleted flag.');
  if(row.changeId!==undefined&&!UUID.test(row.changeId))throw new Error('Invalid changeId.');
  if(new TextEncoder().encode(JSON.stringify(row)).length>250000)throw new Error('Record exceeds 250 KB.');
  if(row.date!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||new Date(row.date+'T12:00:00Z').toISOString().slice(0,10)!==row.date))throw new Error('Invalid calendar date.');
  for(const key of ['sessionId','exerciseId','weekId','phaseId'])if(row[key]!==undefined&&row[key]!==null&&!UUID.test(row[key]))throw new Error('Invalid '+key+'.');
  return row;
}

export async function exportData() {
  const db=await openDB();const tx=db.transaction([...TABLES,META],'readonly');const done=completion(tx);
  const rowRequests=TABLES.map(t=>request(tx.objectStore(t).getAll()));
  const metaRequests=SAFE_META.map(k=>request(tx.objectStore(META).get(k)));
  const [results,metadataResults]=await Promise.all([Promise.all(rowRequests),Promise.all(metaRequests)]);
  await done;const metadata={};metadataResults.forEach((r,i)=>{if(r){validateTree(r.value);metadata[SAFE_META[i]]=r.value;}});
  return {app:'SHIFT Hockey',schemaVersion:1,exportedAt:new Date().toISOString(),tables:Object.fromEntries(TABLES.map((t,i)=>[t,results[i]])),metadata};
}
export function validateBackup(input) {
  if(!plain(input)||input.schemaVersion!==1)throw new Error('Unsupported backup schema. Expected schemaVersion 1.');
  const tables=plain(input.tables)?input.tables:input;
  if(input.tables!==undefined){if(!plain(input.tables))throw new Error('Backup tables must be an object.');for(const name of Object.keys(tables))tableName(name);}
  if(input.metadata!==undefined){if(!plain(input.metadata))throw new Error('Backup metadata must be an object.');for(const key of Object.keys(input.metadata))if(!SAFE_META.includes(key))throw new Error('Unsupported backup metadata: '+key);}
  if(!SYNC_TABLES.some(t=>Array.isArray(tables[t])))throw new Error('No supported data tables found.');
  let count=0;
  for(const table of TABLES){if(tables[table]===undefined)continue;if(!Array.isArray(tables[table]))throw new Error(table+' must be an array.');if(table==='sync_queue')continue;for(const row of tables[table]){validateRecord(table,row);if(++count>150000)throw new Error('Backup has too many records.');}}
  const metadata={};for(const key of SAFE_META){const value=input.metadata?.[key]??(key==='testProtocols'?input.testProtocols: key==='sources'?input.sources:undefined);if(value!==undefined){validateTree(value);metadata[key]=value;}}
  return {tables,metadata};
}
export async function importData(input) {
  const {tables,metadata}=validateBackup(input);const db=await openDB();const tx=db.transaction([...TABLES,META],'readwrite');const done=completion(tx);
  const counts={imported:0,skipped:0,queued:0,byTable:{},ignoredOutbox:(tables.sync_queue || []).length};
  try {
    for(const table of SYNC_TABLES){counts.byTable[table]=0;const store=tx.objectStore(table);
      for(const original of tables[table] || []){const old=await request(store.get(original.id));
        if(compareVersions(original,old)<=0){counts.skipped++;continue;}
        const row={...original,changeId:original.changeId || randomId()};store.put(row);enqueue(tx.objectStore('sync_queue'),table,row);counts.imported++;counts.queued++;counts.byTable[table]++;
      }
    }
    for(const [key,value] of Object.entries(metadata))tx.objectStore(META).put({key,value});
    await done;emit('import');return counts;
  }catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
}

// Lossless CSV: each row contains a table and a JSON record. JSON starts with '{',
// preventing a note beginning '=...' from becoming a spreadsheet formula cell.
function csvCell(value){const s=String(value);return '"'+s.replaceAll('"','""')+'"';}
export function toCSV(backup) {
  const {tables,metadata}=validateBackup(backup);const rows=[['table','recordJSON']];
  for(const table of TABLES)for(const row of tables[table] || [])rows.push([table,JSON.stringify(row)]);
  for(const [key,value] of Object.entries(metadata))rows.push(['_safe_meta',JSON.stringify({key,value})]);
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function fromCSV(text) {
  if(typeof text!=='string'||text.length>100000000)throw new Error('Invalid or oversized CSV.');
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"'&&field===''){quoted=true;}else if(c===','){row.push(field);field='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw new Error('Unclosed quoted CSV field.');if(field||row.length){row.push(field);rows.push(row);}
  if(rows[0]?.length!==2||rows[0]?.[0]!=='table'||rows[0]?.[1]!=='recordJSON')throw new Error('Use the SHIFT round-trip CSV format: table,recordJSON.');
  const backup={app:'SHIFT Hockey',schemaVersion:1,exportedAt:new Date().toISOString(),tables:Object.fromEntries(TABLES.map(t=>[t,[]])),metadata:{}};
  for(const [table,json,...extra] of rows.slice(1)){if(extra.length)throw new Error('Unexpected CSV columns.');let value;try{value=JSON.parse(json);}catch{throw new Error('Invalid record JSON in CSV.');}if(table==='_safe_meta'){if(!plain(value)||!SAFE_META.includes(value.key))throw new Error('Unsupported CSV metadata.');backup.metadata[value.key]=value.value;}else{tableName(table);backup.tables[table].push(value);}}
  validateBackup(backup);return backup;
}
export async function clearDatabase() {
  const db=await openDB();db.close();opening=null;
  await new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase(DB_NAME);req.onsuccess=resolve;req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Close other SHIFT tabs before clearing this device.'));});
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('shift-database-cleared'));
  emit('clear');
}
