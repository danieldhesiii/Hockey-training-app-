import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exerciseChoices, customTargets, targetMetrics, applyAlternative} from '../public/js/alternatives.js';
import {applyEquipmentChoice} from '../public/js/equipment.js';

const seed = JSON.parse(readFileSync(new URL('../public/data/programme.json', import.meta.url)));
const exercise = code => seed.exercises.find(e => e.code === code);
const deadbug = seed.session_exercises.find(row => row.exerciseId === exercise('CO01').id);

test('dead bug offers the full core library and can search across exercise categories', () => {
  const before = JSON.stringify(seed);
  const choices = exerciseChoices(deadbug, seed.exercises, seed.session_exercises);
  for (const code of ['CO02', 'CO03', 'CO04', 'CO05', 'CO06', 'CO07', 'ST05']) assert.ok(choices.has(exercise(code).id), code);
  assert.ok(!choices.has(deadbug.exerciseId));
  for (const code of ['SK09','SK10']) assert.ok(!choices.has(exercise(code).id), 'locked drill stays unavailable');
  assert.ok([...choices.keys()].every(id => !['sport', 'test'].includes(seed.exercises.find(e => e.id === id).category)));
  assert.equal(JSON.stringify(seed), before, 'the complete programme is untouched');
});

test('planks never inherit dead-bug repetitions; unscheduled exercises ask for targets', () => {
  const choices = exerciseChoices(deadbug, seed.exercises, seed.session_exercises);
  const side = choices.get(exercise('CO02').id);
  assert.ok(side.targetSets[0].seconds > 0);
  assert.equal(side.targetSets[0].reps, undefined);
  assert.deepEqual(choices.get(exercise('CO05').id).targetSets, []);
  assert.deepEqual(choices.get(exercise('CO03').id).targetSets, []);
  assert.ok(side.targetSets.every(t => t.rpe <= deadbug.targetSets[0].rpe));
});

test('personal alternatives change only the selected prescription and keep its identity', () => {
  const before = structuredClone(deadbug);
  const replacement = exercise('CO03');
  const targets = customTargets(replacement, {metric:'reps', amount:8, sets:2, sides:1, restSec:30, rpe:4});
  const updated = applyEquipmentChoice(deadbug, {targetSets:targets, role:'core'}, replacement, 'standard');
  assert.equal(updated.id, deadbug.id);
  assert.equal(updated.sessionId, deadbug.sessionId);
  assert.equal(updated.originalExerciseId, deadbug.exerciseId);
  assert.equal(updated.exerciseId, replacement.id);
  assert.equal(updated.targetSets[0].reps, 8);
  assert.equal(updated.targetSets[1].restSec, 0);
  assert.deepEqual(deadbug, before);
});

test('explicit machine alternatives keep their own dose and setup requirements', () => {
  // Exercise identity and units also apply to custom machine targets.
  const machine = seed.exercises.find(e => e.loggingMode === 'machineSpeed');
  assert.ok(machine);
  assert.deepEqual(targetMetrics(machine), ['seconds']);
  assert.throws(() => customTargets(machine, {metric:'reps', amount:5, sets:2, sides:1, restSec:90, rpe:6}));
  const explicit = {exerciseId:machine.id, targetSets:[{seconds:5,restSec:90}], notes:'Check the model'};
  const choices = exerciseChoices({...deadbug,equipmentOptions:[explicit]}, seed.exercises, seed.session_exercises);
  assert.deepEqual(choices.get(machine.id).targetSets, explicit.targetSets);
  assert.equal(choices.get(machine.id).suggested, true);
});

test('custom dose rejects missing amounts, invalid sets and incorrect logging units', () => {
  const values = {metric:'reps', amount:8, sets:2, sides:1, restSec:30, rpe:4};
  for (const invalid of [{amount:null},{amount:0},{amount:NaN},{sets:0},{sets:1.5},{sides:3},{restSec:-1},{rpe:11}]) assert.throws(() => customTargets(exercise('CO03'), {...values,...invalid}));
  const throwExercise = seed.exercises.find(e => e.powerMetric === 'throw');
  assert.throws(() => customTargets(throwExercise, {...values,metric:'contacts'}));
});

test('replacement clears obsolete metadata even when persistence merges the old record', () => {
  const old = {...deadbug, testProtocolId:'old-test', linkedTestProtocolIds:['old-test'], indoorSwap:{exerciseId:'old-swap'}, equipmentSwap:{exerciseId:'old-machine'}, symptomGate:'old-gate', preWorkRestSec:180, repRange:[6,8]};
  const option = {targetSets:[{seconds:20,rpe:4}],role:'core'};
  const result = {...old,...applyAlternative(old,option,exercise('CO05'),'standard',false)};
  assert.equal(result.testProtocolId,null);
  assert.deepEqual(result.linkedTestProtocolIds,[]);
  assert.equal(result.indoorSwap,null);
  assert.equal(result.equipmentSwap,null);
  assert.equal(result.symptomGate,null);
  assert.equal(result.repRange,null);
  assert.equal(result.preWorkRestSec,0);
  assert.equal(old.preWorkRestSec,180);
});
