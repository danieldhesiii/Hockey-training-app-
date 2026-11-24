import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness, epley, nextTarget, dailyPrescription, weeklyLoads, loadComparison, strengthVolume } from '../public/js/coaching.js';
import { addDays, daysBetween, weekStart, today, fmt } from '../public/js/utils.js';

function fixture({ rule = 'lower-main', count = 3, reps = 5, repRange } = {}) {
  const exercise = { id: 'exercise', movementPattern: 'squat', loadMultiplier: 1 };
  const current = { id: 'current', date: '2027-02-09', templateId: 'main-lower', weekId: 'week-current', status: 'planned', deleted: false };
  const prescription = { id: 'prescription-current', sessionId: current.id, exerciseId: exercise.id, role: 'main', targetSets: Array.from({ length: count }, (_, index) => ({ index: index + 1, reps, rpe: 8, rir: 2, loadRule: rule, loadKg: null, restSec: 120 })), ...(repRange ? { repRange } : {}) };
  const data = { sessions: [current], weeks: [{ id: current.weekId, deload: false }], set_logs: [], exercises: [exercise] };
  function history(id, options = {}) {
    const session = { id, date: options.date || '2027-02-02', completedAt: (options.date || '2027-02-02') + 'T19:00:00.000Z', templateId: options.templateId || current.templateId, status: options.status || 'completed', deleted: false };
    data.sessions.push(session);
    const sets = Array.from({ length: options.count ?? count }, (_, index) => ({ id: id + '-set-' + index, sessionId: id, exerciseId: exercise.id, kind: 'strength', setIndex: index + 1, loadKg: options.loadKg ?? 100, reps: options.reps ?? reps, rpe: options.rpe === undefined ? 7 : options.rpe, targetReps: options.targetReps ?? reps, targetRpe: 8, expectedSets: options.expectedSets ?? count, loadRule: options.rule || rule, variant: options.variant || 'standard', reduced: options.reduced || false, deload: options.deload || false, deleted: false, ...(repRange ? { repRangeMax: repRange[1] } : {}) }));
    data.set_logs.push(...sets);
    return { session, sets };
  }
  const result = prefs => nextTarget(exercise, prescription, data, prefs);
  return { exercise, current, prescription, data, history, result };
}

test('no recorded load or a zero load keeps calibration blank', () => {
  const f = fixture();
  assert.equal(f.result().loadKg, null);
  f.history('zero', { loadKg: 0 });
  assert.equal(f.result().loadKg, null);
  assert.equal(f.result().state, 'calibrate');
});

test('all prescribed sets within the effort cap earn the configured increment', () => {
  const f = fixture();
  f.history('complete');
  assert.equal(f.result().loadKg, 102.5);
  assert.equal(f.result().state, 'progress');
  assert.equal(f.result({ exerciseIncrements: { exercise: 1.25 } }).loadKg, 101.25);
  const upper = fixture({ rule: 'upper-main' });
  upper.history('upper');
  assert.equal(upper.result().loadKg, 101);
});

test('missing sets and incomplete sessions do not earn load progression', () => {
  const f = fixture();
  f.history('short', { count: 2 });
  assert.equal(f.result().loadKg, 100);
  assert.notEqual(f.result().state, 'progress');
  const unfinished = fixture();
  unfinished.history('unfinished', { status: 'planned' });
  assert.equal(unfinished.result().loadKg, null);
});

test('missing effort observations are not treated as easy successful sets', () => {
  for (const missing of [null, undefined]) {
    const f = fixture();
    const h = f.history('unknown-effort');
    h.sets[1].rpe = missing;
    assert.equal(f.result().loadKg, 100);
    assert.notEqual(f.result().state, 'progress');
  }
});

test('a deleted set cannot complete the planned set count', () => {
  const f = fixture();
  f.history('deleted').sets[1].deleted = true;
  assert.equal(f.result().loadKg, 100);
  assert.notEqual(f.result().state, 'progress');
});

test('duplicate set numbers cannot substitute for a missing prescribed set', () => {
  const f = fixture();
  const { sets } = f.history('duplicate');
  sets[2].setIndex = 2;
  assert.notEqual(f.result().state, 'progress');
});

test('two actual misses suggest a reset without silently changing the saved reference', () => {
  const f = fixture();
  f.history('earlier-miss', { date: '2027-01-26', reps: 4 });
  f.history('latest-miss', { reps: 4 });
  const result = f.result();
  assert.equal(result.state, 'reset');
  assert.equal(result.loadKg, 100);
  assert.ok(result.resetLoadKg >= 90 && result.resetLoadKg <= 95);
  assert.ok(f.data.set_logs.every(row => row.loadKg === 100));
});

test('uncompleted attempts and missing RPE do not count as repeated target misses', () => {
  const f = fixture();
  f.history('one-miss', { date: '2027-01-26', reps: 4 });
  f.history('not-finished', { status: 'planned', reps: 1 });
  assert.notEqual(f.result().state, 'reset');
  const missing = fixture();
  missing.history('missing-one', { date: '2027-01-26', rpe: null });
  missing.history('missing-two', { rpe: null });
  assert.notEqual(missing.result().state, 'reset');
  assert.notEqual(missing.result().state, 'progress');
});

test('a recent success breaks a prior run of missed targets', () => {
  const f = fixture();
  f.history('older-miss', { date: '2027-01-19', reps: 4 });
  f.history('old-miss', { date: '2027-01-26', reps: 4 });
  f.history('success');
  assert.equal(f.result().state, 'progress');
});

test('a more recent light template does not replace the same-slot strength reference', () => {
  const f = fixture();
  f.history('main');
  f.history('light', { date: '2027-02-07', templateId: 'light-lower', loadKg: 60 });
  assert.equal(f.result().loadKg, 102.5);
});

test('a different template may supply a reference but cannot earn this slot an increase', () => {
  const f = fixture();
  f.history('other-slot', { templateId: 'light-lower', loadKg: 60 });
  const result = f.result();
  assert.notEqual(result.state, 'progress');
  assert.ok(result.loadKg === null || result.loadKg <= 60);
});

test('different machine or equipment variants require a separate load reference', () => {
  const f = fixture();
  f.history('machine-a', { variant: 'machine-a', loadKg: 100 });
  f.prescription.variant = 'machine-b';
  assert.equal(f.result().loadKg, null);
  f.prescription.variant = 'machine-a';
  assert.equal(f.result().loadKg, 102.5);
});

test('future records and the currently displayed session cannot change its own target', () => {
  const f = fixture();
  f.history('earlier', { loadKg: 100 });
  f.history('future', { date: '2027-02-16', loadKg: 150 });
  assert.equal(f.result().loadKg, 102.5);
  const own = fixture();
  own.history('earlier', { loadKg: 100 });
  own.current.status = 'completed';
  own.current.completedAt = '2027-02-09T19:00:00.000Z';
  own.data.set_logs.push(...own.data.set_logs.map(row => ({ ...row, id: row.id + '-current', sessionId: own.current.id, loadKg: 150 })));
  assert.equal(own.result().loadKg, 102.5);
});

test('accessories reach the upper repetition range before adding load', () => {
  const lowerEnd = fixture({ rule: 'accessory', reps: 8, count: 2, repRange: [8, 10] });
  lowerEnd.history('eight', { reps: 8 });
  assert.equal(lowerEnd.result().loadKg, 100);
  assert.notEqual(lowerEnd.result().state, 'progress');
  const topEnd = fixture({ rule: 'accessory', reps: 8, count: 2, repRange: [8, 10] });
  topEnd.history('ten', { reps: 10 });
  assert.equal(topEnd.result().loadKg, 101);
});

test('current deload, current reduction and previous reduced work never earn an increase', () => {
  const deload = fixture();
  deload.history('good');
  deload.data.weeks[0].deload = true;
  assert.ok(deload.result().loadKg < 100);
  assert.notEqual(deload.result().state, 'progress');
  const reduced = fixture();
  reduced.history('good');
  reduced.prescription.reduced = true;
  assert.ok(reduced.result().loadKg <= 100);
  assert.notEqual(reduced.result().state, 'progress');
  for (const flag of ['reduced', 'deload']) {
    const prior = fixture();
    prior.history('easy', { [flag]: true });
    assert.equal(prior.result().loadKg, 100);
    assert.notEqual(prior.result().state, 'progress');
  }
});

test('a new higher repetition prescription recalibrates instead of blindly adding load', () => {
  const f = fixture({ reps: 8 });
  f.history('five-rep-reference', { reps: 5, targetReps: 5 });
  assert.ok(f.result().loadKg <= 100);
  assert.notEqual(f.result().state, 'progress');
});

test('readiness preserves missing data and recognises a true zero', () => {
  assert.equal(readiness(null).score, null);
  assert.equal(readiness({}).score, null);
  const onlyEnergy = readiness({ energy: 5, sleepHours: null, soreness: null, mood: null, sleepQuality: null });
  assert.equal(onlyEnergy.score, 100);
  assert.equal(onlyEnergy.reduce, false);
  assert.ok(!onlyEnergy.reasons.some(reason => reason.includes('Under 6')));
  assert.equal(readiness({ sleepHours: 0 }).score, 0);
  assert.equal(readiness({ sleepHours: 0 }).reduce, true);
  const full = readiness({ sleepHours: 8, energy: 5, soreness: 0, sleepQuality: 5, mood: 5 });
  assert.equal(full.score, 100);
  assert.equal(full.reduce, false);
});

test('symptom and illness flags remain visible even with an otherwise high readiness score', () => {
  const result = readiness({ sleepHours: 8, energy: 5, wristWorse: true });
  assert.equal(result.score, 100);
  assert.equal(result.wristHold, true);
  assert.equal(readiness({ illness: true }).reduce, true);
});

test('set reductions retain at least one set, do not mutate the seed, and distinguish taper volume', () => {
  const base = fixture({ count: 4 }).prescription;
  const ready = { reduce: true, wristHold: false, illness: false };
  const reduced = dailyPrescription(base, ready, { applyReduction: true });
  assert.equal(reduced.targetSets.length, 3);
  assert.ok(reduced.targetSets.every(row => row.rpe <= 7 && row.rir >= 3));
  assert.equal(base.targetSets.length, 4);
  assert.equal(base.targetSets[0].rpe, 8);
  assert.equal(dailyPrescription(base, ready, { tryoutTaper: true }).targetSets.length, 2);
  assert.equal(dailyPrescription(fixture({ count: 1 }).prescription, ready, { applyReduction: true }).targetSets.length, 1);
});

test('a lighter day holds high-intensity tests and intervals using the original effort target', () => {
  for (const role of ['test', 'speed', 'power', 'conditioning']) {
    const prescription = { role, targetSets: [{ index: 1, rpe: 9, restSec: 90, reps: 3 }] };
    const result = dailyPrescription(prescription, { reduce: true }, { applyReduction: true });
    assert.equal(result.hold, true, `${role} at RPE 9 should be held`);
  }
  assert.equal(dailyPrescription({ role: 'skill', targetSets: [{ seconds: 30 }] }, { wristHold: true }).hold, true);
  assert.equal(dailyPrescription({ role: 'main', targetSets: [{ reps: 5 }] }, { illness: true }).hold, true);
});

test('weekly load uses only completed actual data, retains zero, and leaves missing data unknown', () => {
  const rows = [
    { id: 'actual', date: '2027-02-01', status: 'completed', actualDurationMin: 60, sessionRpe: 5 },
    { id: 'zero', date: '2027-02-02', status: 'completed', actualDurationMin: 30, sessionRpe: 0 },
    { id: 'missing', date: '2027-02-03', status: 'completed', actualDurationMin: 60, sessionRpe: null },
    { id: 'planned', date: '2027-02-04', status: 'planned', durationMin: 60, intensityRpe: 8 },
    { id: 'deleted', date: '2027-02-05', status: 'completed', actualDurationMin: 60, sessionRpe: 10, deleted: true }
  ];
  const result = weeklyLoads(rows, '2027-02-07', 2);
  assert.equal(result[0].load, null);
  assert.equal(result[1].load, 300);
  assert.equal(result[1].count, 2);
  assert.equal(result[1].incomplete, 1);
  assert.equal(weeklyLoads([rows[1]], '2027-02-07', 1)[0].load, 0);
});

test('future completed records do not inflate the current partial week', () => {
  const rows = [
    { date: '2027-02-08', status: 'completed', actualDurationMin: 60, sessionRpe: 5 },
    { date: '2027-02-12', status: 'completed', actualDurationMin: 60, sessionRpe: 10 }
  ];
  const result = weeklyLoads(rows, '2027-02-09', 1)[0];
  assert.equal(result.load, 300);
  assert.equal(result.completed, 1);
});

test('workload comparisons need four prior known weeks with no known unmeasured sessions', () => {
  const measured = [100, 200, 300, 400, 100].map(load => ({ load, incomplete: 0 }));
  assert.deepEqual({ ratio: loadComparison(measured).ratio, chronic: loadComparison(measured).chronic }, { ratio: 0.4, chronic: 250 });
  assert.equal(loadComparison(measured.slice(1)).ratio, null);
  for (const index of [0, 4]) {
    const incomplete = structuredClone(measured);
    incomplete[index].incomplete = 1;
    assert.equal(loadComparison(incomplete).ratio, null);
  }
  const missing = structuredClone(measured);
  missing[1].load = null;
  assert.equal(loadComparison(missing).ratio, null);
  const zero = [0, 0, 0, 0, 100].map(load => ({ load, incomplete: 0 }));
  assert.equal(loadComparison(zero).chronic, 0);
  assert.equal(loadComparison(zero).ratio, null);
});

test('Epley is a labelled mathematical estimate only for finite positive loads and 1-10 reps', () => {
  assert.ok(Math.abs(epley(100, 5) - 116.6666666667) < 1e-8);
  for (const [kg, reps] of [[0, 5], [100, 0], [100, 11], [null, 5], [100, null], [Infinity, 5], [100, NaN]]) assert.equal(epley(kg, reps), null);
});

test('strength volume uses the exercise load convention and excludes unfinished or deleted records', () => {
  const data = { exercises: [{ id: 'db', movementPattern: 'push', loadMultiplier: 2 }], sessions: [{ id: 'complete', date: '2027-02-01', status: 'completed' }, { id: 'unfinished', date: '2027-02-02', status: 'planned' }], set_logs: [
    { sessionId: 'complete', exerciseId: 'db', kind: 'strength', loadKg: 20, reps: 10 },
    { sessionId: 'complete', exerciseId: 'db', kind: 'strength', loadKg: 30, reps: 10, deleted: true },
    { sessionId: 'unfinished', exerciseId: 'db', kind: 'strength', loadKg: 50, reps: 10 }
  ] };
  assert.deepEqual(strengthVolume(data, '2027-02-01', '2027-02-07'), { push: 400 });
});

test('calendar arithmetic stays on the intended UK day through both DST changes', () => {
  assert.equal(addDays('2027-03-27', 1), '2027-03-28');
  assert.equal(addDays('2027-03-28', 1), '2027-03-29');
  assert.equal(daysBetween('2027-03-27', '2027-03-29'), 2);
  assert.equal(weekStart('2027-03-28'), '2027-03-22');
  assert.equal(addDays('2027-10-30', 1), '2027-10-31');
  assert.equal(addDays('2027-10-31', 1), '2027-11-01');
  assert.equal(daysBetween('2027-10-30', '2027-11-01'), 2);
  assert.equal(weekStart('2027-10-31'), '2027-10-25');
});

test('today follows Europe/London rather than the UTC date near a summer midnight', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-06-01T23:30:00Z') });
  assert.equal(today(), '2027-06-02');
  t.mock.timers.setTime(new Date('2027-12-01T23:30:00Z').getTime());
  assert.equal(today(), '2027-12-01');
});

test('missing display metrics never masquerade as a recorded zero', () => {
  for (const missing of [null, undefined, '']) assert.equal(fmt(missing), 'Not logged');
  assert.equal(fmt(0), '0');
  assert.equal(fmt(1.25, 2), '1.25');
});
