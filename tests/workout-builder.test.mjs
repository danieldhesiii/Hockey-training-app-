import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {makeExercise,makeBlock,workoutRecords,copyBlocks,blockHasHistory,validateWorkoutEdit} from '../public/js/workout-builder.js';
import {validateRecord,planSeedRefresh} from '../public/js/db.js';
import {exerciseChoices} from '../public/js/alternatives.js';

const seed=JSON.parse(readFileSync(new URL('../public/data/programme.json',import.meta.url)));
const values={name:'Cable crunch',type:'strength',equipment:'Cable machine, Rope',muscles:'Abdominals',cues:'Keep control\nExhale',wristSensitive:true};
const targets={metric:'reps',amount:8,sets:2,sides:1,restSec:30,rpe:6};
const workout={title:'My core workout',date:'2026-11-27',kind:'strength',durationMin:30,intensityRpe:6};
const stamp=row=>({...row,createdAt:'2026-11-26T12:00:00.000Z',updatedAt:'2026-11-26T12:00:00.000Z',deleted:false,changeId:randomUUID()});

test('a personal exercise has the complete library shape and survives seed refresh',()=>{
  const exercise=stamp(makeExercise(values,randomUUID()));
  validateRecord('exercises',exercise);
  assert.deepEqual(exercise.equipment,['Cable machine','Rope']);
  assert.deepEqual(exercise.cues,['Keep control','Exhale']);
  assert.equal(exercise.wristSensitive,true);
  const changes=planSeedRefresh(seed,{exercises:[exercise]},{});
  assert.ok(!changes.puts.exercises.some(row=>row.id===exercise.id));
  const choices=exerciseChoices(seed.session_exercises[0],[...seed.exercises,exercise],seed.session_exercises);
  assert.ok(choices.has(exercise.id),'custom exercise is also available as an alternative');
});

test('custom logging types preserve machine, throw and loaded-jump units',()=>{
  for(const [type,metric] of [['machineSpeed','seconds'],['machineStrength','reps'],['throw','reps'],['loadedJump','reps'],['jump','contacts']]){
    const exercise=makeExercise({...values,type},randomUUID());
    const block=makeBlock(exercise,{...targets,metric},randomUUID());
    assert.equal(block.targetSets[0][metric],8);
    assert.equal(block.targetSets[0].loadKg,null);
    assert.equal(block.equipmentConfirmed,false);
    if(type.startsWith('machine'))assert.equal(exercise.equipmentConfirmationRequired,true);
  }
});

test('creating a workout only adds new identities and leaves the full programme intact',()=>{
  const before=JSON.stringify(seed),exercise=makeExercise(values,randomUUID());
  const block=makeBlock(exercise,targets,randomUUID());
  const records=workoutRecords(workout,[block],seed.weeks,randomUUID());
  validateRecord('sessions',stamp(records.session));
  validateRecord('session_exercises',stamp(records.prescriptions[0]));
  assert.equal(records.prescriptions[0].sessionId,records.session.id);
  assert.equal(records.prescriptions[0].order,1);
  assert.equal(records.session.optional,true);
  assert.equal(records.session.status,'planned');
  assert.equal(records.session.startedAt,undefined);
  const repeat=workoutRecords({...workout,workoutTemplateId:records.session.templateId},copyBlocks(records.prescriptions,randomUUID),seed.weeks,randomUUID());
  assert.equal(repeat.session.templateId,records.session.templateId);
  assert.notEqual(repeat.session.id,records.session.id);
  assert.equal(JSON.stringify(seed),before);
});

test('copying a workout resets identities and setup without copying actual results',()=>{
  const source=seed.session_exercises.slice(0,3).map(row=>({...row,equipmentConfirmed:true}));
  const copy=copyBlocks(source,randomUUID);
  assert.ok(copy.every((row,i)=>row.id!==source[i].id&&!row.sessionId&&!row.changeId&&!row.equipmentConfirmed));
  assert.deepEqual(copy[0].targetSets,source[0].targetSets);
  copy[0].targetSets[0].reps=999;
  assert.notEqual(source[0].targetSets[0].reps,999);
});

test('workout validation preserves Monday, Thursday and total time constraints',()=>{
  const exercise=makeExercise(values,randomUUID()),block=makeBlock(exercise,targets,randomUUID());
  for(const invalid of [{date:'2026-11-30'},{date:'2026-11-26',durationMin:30},{durationMin:61},{durationMin:5},{date:'2028-01-01'},{title:''},{intensityRpe:0}])assert.throws(()=>workoutRecords({...workout,...invalid},[block],seed.weeks,randomUUID()));
  assert.throws(()=>workoutRecords(workout,[],seed.weeks,randomUUID()));
  assert.throws(()=>workoutRecords(workout,[block],seed.weeks,randomUUID(),seed.sessions[0]));
});

test('logged and soft-deleted history blocks exercise removal or target edits',()=>{
  const block={...seed.session_exercises[0]},session={id:block.sessionId,status:'planned',date:workout.date,kind:workout.kind};
  const logs=[{sessionExerciseId:block.id,sessionId:session.id,deleted:true}];
  assert.equal(blockHasHistory(block,logs),true);
  assert.throws(()=>validateWorkoutEdit(session,[block],[],logs,workout));
  assert.throws(()=>validateWorkoutEdit(session,[block],[{...block,targetSets:[{reps:100}]}],logs,workout));
  assert.throws(()=>validateWorkoutEdit(session,[block],[block],logs,{...workout,date:'2026-11-28'}));
  assert.doesNotThrow(()=>validateWorkoutEdit(session,[block],[{...block,order:5}],logs,workout));
  assert.throws(()=>validateWorkoutEdit({...session,status:'completed'},[block],[block],logs,workout));
});

test('exercise creation rejects invalid names and video schemes without changing supplied records',()=>{
  assert.throws(()=>makeExercise({...values,name:' '},randomUUID()));
  assert.throws(()=>makeExercise({...values,videoUrl:'javascript:alert(1)'},randomUUID()));
  assert.throws(()=>makeExercise({...values,type:'unknown'},randomUUID()));
  const old=makeExercise(values,randomUUID()),before=structuredClone(old);
  const updated=makeExercise({...values,name:'My cable crunch'},old.id,old);
  assert.equal(updated.id,old.id);assert.equal(updated.name,'My cable crunch');assert.deepEqual(old,before);
});
