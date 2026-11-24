import test from 'node:test';
import assert from 'node:assert/strict';
import {powerRecord,machineRecord,compatibleDose,applyEquipmentChoice} from '../public/js/equipment.js';
import {nextTarget,strengthVolume,dailyPrescription} from '../public/js/coaching.js';

test('medicine-ball repetitions never become landing contacts, including an older library definition',()=>{
  const row=powerRecord({code:'PW05'},{reps:3,sides:2,loadKg:3,contacts:12});
  assert.equal(row.kind,'power'); assert.equal(row.throwCount,6); assert.equal(row.contacts,0); assert.equal(row.loadKg,3);
});
test('trap-bar jump logs include total external mass and two foot contacts per jump',()=>{
  const row=powerRecord({code:'PW06'},{reps:2,loadKg:25});
  assert.equal(row.contacts,4); assert.equal(row.loadKg,25); assert.equal(row.kind,'power');
  assert.throws(()=>powerRecord({code:'PW06'},{reps:2,loadKg:null}));
});
test('stationary runner settings do not create track distance, kilograms or a strength estimate',()=>{
  const row=machineRecord({loggingMode:'machineSpeed'},{seconds:5,resistanceSetting:'8',resistanceUnit:'level',distanceM:10,loadKg:8,restSec:90});
  assert.equal(row.seconds,5); assert.equal(row.distanceM,undefined); assert.equal(row.loadKg,null); assert.equal(row.kind,'machineSpeed');
  assert.throws(()=>machineRecord({loggingMode:'machineSpeed'},{seconds:5,resistanceSetting:'8'}));
});
test('machine squat settings remain excluded from kg progression and strength-volume totals',()=>{
  const exercise={id:'machine',category:'strength',loggingMode:'machineStrength'};
  const row=machineRecord(exercise,{reps:6,resistanceSetting:'40',resistanceUnit:'psi',loadKg:40});
  const data={sessions:[{id:'s',date:'2026-12-01',status:'completed'}],exercises:[exercise],set_logs:[{...row,sessionId:'s',exerciseId:'machine'}]};
  assert.deepEqual(strengthVolume(data,'2026-12-01','2026-12-01'),{});
  assert.equal(nextTarget(exercise,{targetSets:[{reps:6,loadRule:'lower-main'}]},data).loadKg,null);
});
test('explicit runner alternatives replace distance targets and clear an old indoor swap',()=>{
  const original={exerciseId:'track',role:'speed',targetSets:[{distanceM:10,loadKg:null}],indoorSwap:{exerciseId:'sled'}};
  const option={exerciseId:'runner',targetSets:[{seconds:5,restSec:90,loadKg:null}],rampUpSets:[],notes:'Model checked'};
  const row=applyEquipmentChoice(original,option,{id:'runner',loggingMode:'machineSpeed'},'Gym runner model A',true);
  assert.equal(row.targetSets[0].distanceM,undefined); assert.equal(row.targetSets[0].seconds,5); assert.equal(row.indoorSwap,undefined); assert.equal(row.equipmentConfirmed,true);
  assert.equal(original.targetSets[0].distanceM,10);
  assert.equal(compatibleDose({category:'power',movementPattern:'rotation',code:'PW05'},{category:'power',movementPattern:'rotation',code:'PW06'}),false);
});

test('loaded jumps and throws are held on reduced or taper days despite a low effort target',()=>{
  for(const powerMetric of ['loadedJump','throw']){
    const row={role:'power',powerMetric,targetSets:[{reps:2,rpe:6},{reps:2,rpe:6}]};
    assert.equal(dailyPrescription(row,{reduce:true},{applyReduction:true}).hold,true);
    assert.equal(dailyPrescription(row,{reduce:false},{tryoutTaper:true}).hold,true);
    assert.equal(dailyPrescription(row,{reduce:false},{gameWithin48h:true}).hold,true);
    assert.equal(dailyPrescription(row,{reduce:false}).hold,undefined);
  }
});
