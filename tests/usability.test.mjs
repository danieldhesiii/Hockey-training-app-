import test from 'node:test';
import assert from 'node:assert/strict';
import {replacementRecords,reopenSession,sessionProgress} from '../public/js/session-editing.js';
import {historySessions} from '../public/js/training-history.js';
import {editedEntry} from '../public/js/entry-editor.js';

const original={id:'old-block',sessionId:'workout',exerciseId:'dead-bug',order:3,role:'core',targetSets:[{reps:6,rpe:4}],notes:'Original',createdAt:'stamp',changeId:'version'};
const session={id:'workout',status:'planned',date:'2026-11-26'};
const exercise={id:'reverse-crunch',name:'Reverse crunch',category:'core',environment:'INDOOR',wristSensitive:false,loadConvention:'Bodyweight'};
const option={role:'core',targetSets:[{reps:8,rpe:4}],notes:'Replacement'};

test('an unlogged block can be changed directly without changing its session or ID',()=>{
  const before=structuredClone(original),rows=replacementRecords(session,original,option,exercise,'standard',false,[],'new-id');
  assert.equal(rows.length,1);assert.equal(rows[0].id,original.id);assert.equal(rows[0].exerciseId,exercise.id);assert.equal(rows[0].sessionId,session.id);assert.deepEqual(original,before);
});
test('changing a recorded exercise retains its original block and uses a fresh block for new work',()=>{
  for(const deleted of [false,true]){
    const log={id:'actual',sessionExerciseId:original.id,exerciseId:original.exerciseId,sessionId:session.id,deleted};
    const before=structuredClone(log),rows=replacementRecords(session,original,option,exercise,'standard',false,[log],'new-id');
    assert.equal(rows[0].id,original.id);assert.deepEqual(rows[0].targetSets,original.targetSets);assert.equal(rows[0].exerciseId,original.exerciseId);assert.equal(rows[0].skipped,true);
    assert.equal(rows[1].id,'new-id');assert.equal(rows[1].exerciseId,exercise.id);assert.equal(rows[1].createdAt,undefined);assert.ok(rows[1].order>original.order&&rows[1].order<4);assert.deepEqual(log,before);
  }
});
test('completed sessions must be reopened before a replacement, without deleting actual sets',()=>{
  const completed={...session,status:'completed',actualDurationMin:20,sessionRpe:6,completedAt:'stamp',completionNotes:'Diary'};
  assert.throws(()=>replacementRecords(completed,original,option,exercise,'standard',false,[],'new'));
  const reopened=reopenSession(completed);assert.equal(reopened.status,'planned');assert.equal(reopened.actualDurationMin,null);assert.equal(reopened.completionNotes,'Diary');assert.equal(completed.status,'completed');
});
test('workout progress counts logged and skipped blocks honestly, not as completed sets',()=>{
  const result=sessionProgress([original,{...original,id:'b',skipped:true}],[{sessionExerciseId:original.id},{sessionExerciseId:'b',deleted:true}]);
  assert.deepEqual(result,{total:2,logged:1,skipped:1});
});
test('session history includes in-progress personal workouts and can find their exercises',()=>{
  const data={sessions:[session,{id:'done',date:'2026-11-25',status:'completed'},{id:'future',date:'2026-12-01',status:'planned'}],exercises:[{id:original.exerciseId,name:'Dead bug'}],session_exercises:[original],set_logs:[{sessionId:'workout',exerciseId:original.exerciseId}],skill_logs:[],test_results:[]};
  assert.deepEqual(historySessions(data).map(s=>s.id),['workout','done']);
  assert.equal(historySessions(data,{query:'dead bug'})[0].id,'workout');assert.equal(historySessions(data,{status:'completed'})[0].id,'done');
});
test('editing a logged throw recalculates contacts and keeps the original identity',()=>{
  const entry={id:'actual',kind:'power',powerMetric:'throw',reps:3,sides:2,loadKg:2,contacts:0};
  const row=editedEntry(entry,{reps:4,loadKg:3,notes:'Corrected'}, {powerMetric:'throw'});
  assert.equal(row.id,entry.id);assert.equal(row.throwCount,8);assert.equal(row.contacts,0);assert.equal(entry.reps,3);
});
test('recorded entry edits reject invalid values and impossible shooting accuracy',()=>{
  assert.throws(()=>editedEntry({kind:'strength',reps:3,loadKg:2,rpe:4},{reps:-1},{}));
  const entry={kind:'shooting',shots:5,hitsByZone:{topLeft:1,topRight:0,bottomLeft:0,bottomRight:0,fiveHole:0}};
  assert.throws(()=>editedEntry(entry,{topLeft:10},{}));
});
