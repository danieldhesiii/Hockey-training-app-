import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const programme = JSON.parse(readFileSync(new URL('../public/data/programme.json', import.meta.url), 'utf8'));
const plan = programme.plan[0];
const exercises = new Map(programme.exercises.map(row => [row.id, row]));
const weeks = new Map(programme.weeks.map(row => [row.id, row]));
const phases = new Map(programme.phases.map(row => [row.id, row]));
const sessions = new Map(programme.sessions.map(row => [row.id, row]));
const protocols = new Set(programme.testProtocols.map(row => row.id));
const exerciseRows = new Map(programme.sessions.map(row => [row.id, programme.session_exercises.filter(item => item.sessionId === row.id)]));
const total = values => values.reduce((a, b) => a + b, 0);
const addDays = (day, count) => new Date(Date.parse(day + 'T12:00:00Z') + count * 86400000).toISOString().slice(0, 10);
const weekday = day => new Date(day + 'T12:00:00Z').getUTCDay();
const close = (actual, expected, message, tolerance = 0.02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} versus ${expected}`);
const numericDose = target => ['reps', 'seconds', 'distanceM', 'rounds'].some(key => Number.isFinite(target[key]) && target[key] > 0);

test('the 52 weeks cover every calendar day once, with the correct actionable start', () => {
  assert.equal(plan.startDate, '2026-11-24');
  assert.equal(plan.calendarStartDate, '2026-11-23');
  assert.equal(plan.endDate, '2027-11-21');
  assert.equal(plan.totalWeeks, 52);
  assert.equal(programme.weeks.length, 52);
  for (const [index, week] of programme.weeks.entries()) {
    assert.equal(week.number, index + 1);
    assert.equal(week.startDate, addDays(plan.calendarStartDate, index * 7));
    assert.equal(week.endDate, addDays(week.startDate, 6));
    assert.equal(weekday(week.startDate), 1);
    assert.ok(phases.has(week.phaseId));
    const phase = phases.get(week.phaseId);
    assert.ok(week.number >= phase.startWeek && week.number <= phase.endWeek);
  }
  assert.equal(programme.weeks.at(-1).endDate, plan.endDate);
  assert.ok(programme.sessions.every(row => row.date >= plan.startDate && row.date <= plan.endDate));
});

test('all records and nested exercise references resolve without duplicate IDs', () => {
  const identifiers = new Set();
  for (const table of ['plan', 'phases', 'weeks', 'sessions', 'session_exercises', 'exercises', 'testProtocols']) {
    for (const row of programme[table]) {
      assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.ok(!identifiers.has(row.id), `Duplicate ${table} ID ${row.id}`);
      identifiers.add(row.id);
      assert.equal(row.deleted, false);
      assert.ok(Number.isFinite(Date.parse(row.createdAt)));
      assert.ok(Date.parse(row.updatedAt) >= Date.parse(row.createdAt));
    }
  }
  for (const session of programme.sessions) {
    const week = weeks.get(session.weekId);
    assert.ok(week, `Missing week for ${session.title}`);
    assert.ok(session.date >= week.startDate && session.date <= week.endDate);
    assert.equal(session.phaseId, week.phaseId);
    for (const block of [...session.warmup, ...session.cooldown]) assert.ok(exercises.has(block.exerciseId));
    const rows = exerciseRows.get(session.id);
    assert.ok(rows.length > 0, `Empty session: ${session.title}`);
    assert.equal(new Set(rows.map(row => row.order)).size, rows.length);
  }
  for (const row of programme.session_exercises) {
    assert.ok(sessions.has(row.sessionId));
    assert.ok(exercises.has(row.exerciseId));
    if (row.testProtocolId) assert.ok(protocols.has(row.testProtocolId));
    for (const id of row.linkedTestProtocolIds || []) assert.ok(protocols.has(id));
    if (row.testReferenceExerciseId) assert.ok(exercises.has(row.testReferenceExerciseId));
    if (row.indoorSwap) assert.ok(exercises.has(row.indoorSwap.exerciseId));
    for (const alternative of row.equipmentOptions || []) assert.ok(exercises.has(alternative.exerciseId));
  }
});

test('holiday and return day contain no mandatory activity; Monday has no gym', () => {
  assert.deepEqual(plan.holidayRanges, [{ startDate: '2026-12-05', endDate: '2026-12-19' }]);
  assert.equal(plan.returnToTrainingDate, '2026-12-21');
  const holiday = programme.sessions.filter(row => row.date >= '2026-12-05' && row.date <= '2026-12-20');
  assert.ok(holiday.every(row => row.optional), 'Holiday/return activity must remain optional');
  const monday = programme.sessions.filter(row => weekday(row.date) === 1);
  assert.ok(monday.length > 0);
  assert.ok(monday.every(row => !['strength', 'testing', 'conditioning'].includes(row.kind)));
  for (const session of programme.sessions.filter(row => weekday(row.date) === 4 && row.kind !== 'roller')) {
    assert.equal(session.optional, true);
    assert.ok(session.durationMin <= 20, `Thursday exceeds 20 minutes: ${session.date}`);
  }
});

test('complete non-test weeks retain the four gym slots and two achievable easy bike blocks', () => {
  for (const week of programme.weeks.filter(row => row.number >= 5 && !row.testing)) {
    const gym = programme.sessions.filter(row => row.weekId === week.id && row.kind === 'strength' && !row.optional);
    assert.deepEqual(gym.map(row => weekday(row.date)).sort(), [0, 2, 3, 5], `Gym days in week ${week.number}`);
    const bikes = gym.filter(session => exerciseRows.get(session.id).some(row => exercises.get(row.exerciseId).code === 'CN01' && row.targetSets.some(target => target.seconds >= 600 && target.rpe <= 4)));
    assert.equal(bikes.length, 2, `Two short easy bike blocks in week ${week.number}`);
    assert.deepEqual(bikes.map(row => weekday(row.date)).sort(), [2, 5]);
  }
});

test('every session budget includes warm-up, work, recovery, transitions and cool-down', () => {
  for (const session of programme.sessions) {
    const b = session.durationBreakdown;
    assert.ok(b, `No duration explanation for ${session.date} ${session.title}`);
    for (const key of ['warmupMin', 'exerciseBlocksMin', 'transitionAllowanceMin', 'cooldownMin', 'roundingBufferMin', 'totalMin']) assert.ok(Number.isFinite(b[key]) && b[key] >= 0);
    close(total([b.warmupMin, b.exerciseBlocksMin, b.transitionAllowanceMin, b.cooldownMin, b.roundingBufferMin]), b.totalMin, session.title);
    assert.equal(b.totalMin, session.durationMin);
    close(total(session.warmup.map(row => row.seconds || 0)) / 60, b.warmupMin, 'Warm-up seconds are total across sides');
    close(total(session.cooldown.map(row => row.seconds || 0)) / 60, b.cooldownMin, 'Cool-down seconds are total across sides');
    const rows = exerciseRows.get(session.id);
    close(total(rows.map(row => row.estimatedBlockMin)), b.exerciseBlocksMin, `Exercise blocks: ${session.title}`, 0.01 * (rows.length + 1));
    if (!['ice', 'roller'].includes(session.kind)) assert.ok(session.durationMin <= 60, `${session.date} exceeds the inclusive hour`);
    if (['strength', 'testing'].includes(session.kind) && !session.optional) {
      assert.ok(b.warmupMin >= 5);
      assert.ok(b.cooldownMin >= 3);
      assert.ok(b.transitionAllowanceMin > 0);
    }
    for (const row of rows) {
      // This independent lower bound catches omitted rests or hold times without
      // fixing the coaching estimate for explosive movements to one formula.
      let seconds = (row.setupSec || 0) + (row.preWorkRestSec || 0);
      for (const target of [...(row.rampUpSets || []), ...row.targetSets]) {
        seconds += target.restSec || 0;
        if (target.seconds) seconds += target.seconds * (target.sides || 1);
        else if (target.rounds) seconds += target.rounds * target.workSec + Math.max(0, target.rounds - 1) * (target.recoverySec || 0);
        else if (target.planningExecutionSec) seconds += target.planningExecutionSec;
      }
      assert.ok(row.estimatedBlockMin * 60 + 0.31 >= seconds, `Work/recovery omitted for ${session.date} ${exercises.get(row.exerciseId).code}`);
    }
  }
});

test('working targets have exact numeric doses, rest, effort and no invented starting load', () => {
  for (const row of programme.session_exercises) {
    assert.ok(row.targetSets.length > 0);
    for (const [index, target] of row.targetSets.entries()) {
      assert.equal(target.index, index + 1);
      assert.ok(numericDose(target), `No measurable dose for ${row.id}`);
      assert.ok(Number.isFinite(target.restSec) && target.restSec >= 0);
      assert.ok(Number.isFinite(target.rpe) && target.rpe >= 0 && target.rpe <= 10);
      assert.equal(target.loadKg, null);
      assert.ok(typeof target.loadRule === 'string' && plan.progressionRules[target.loadRule]);
      if (['main', 'accessory'].includes(row.role)) {
        assert.ok(target.reps > 0 || target.seconds > 0, 'Loaded accessories can use a timed hold');
        if (target.reps) assert.ok(typeof target.tempo === 'string' && target.tempo.length > 0);
        assert.ok(target.rpe <= 8);
      }
      for (const key of ['reps', 'seconds', 'distanceM', 'contacts', 'rounds', 'workSec', 'recoverySec', 'sides', 'rir']) {
        if (target[key] !== undefined) assert.ok(Number.isFinite(target[key]) && target[key] >= 0, `${key} must be numeric`);
      }
    }
    for (const target of row.rampUpSets || []) assert.equal(target.loadKg, null);
  }
});

test('jump counts mean individual foot contacts and include familiarisation and test warm-ups', () => {
  const bilateral = new Set(['PW01', 'PW03', 'PW06', 'TS01', 'TS09']);
  const unilateral = new Set(['PW02', 'PW04', 'TS10']);
  for (const session of programme.sessions) {
    let low = 0, demanding = 0;
    for (const row of exerciseRows.get(session.id)) {
      const code = exercises.get(row.exerciseId).code;
      for (const target of [...(row.rampUpSets || []), ...row.targetSets]) {
        if (bilateral.has(code)) assert.equal(target.contacts, target.reps * 2, `${code}: two feet per landing`);
        if (unilateral.has(code)) assert.equal(target.contacts, target.reps * (target.sides || 1), `${code}: one foot per landing`);
        if (code === 'PW03') low += target.contacts || 0;
        else demanding += target.contacts || 0;
      }
    }
    for (const block of session.warmup) {
      if (bilateral.has(exercises.get(block.exerciseId).code) && block.contacts) assert.equal(block.contacts, block.reps * 2);
      demanding += block.contacts || 0;
    }
    if (low + demanding) {
      assert.equal(session.plannedGroundContacts.lowIntensity, low);
      assert.equal(session.plannedGroundContacts.demanding, demanding);
      assert.equal(session.plannedGroundContacts.total, low + demanding);
    }
  }
});

test('requested ballistics replace existing slots with calibrated loads and no fabricated landing contacts', () => {
  const throwCodes = new Set(['PW05', 'PW07']);
  const seenThrows = new Set();
  for (const session of programme.sessions.filter(s => s.templateId === 'upper-a')) {
    const week = weeks.get(session.weekId), rows = exerciseRows.get(session.id);
    const throws = rows.filter(row => throwCodes.has(exercises.get(row.exerciseId).code));
    if (week.number >= 6 && !week.deload) {
      assert.equal(throws.length, 1);
      assert.equal(rows[0].id, throws[0].id, 'Ballistics precede strength');
      assert.ok(!rows.some(row => exercises.get(row.exerciseId).code === 'ST11'), 'Throw replaces the pulldown slot');
      const row = throws[0], code = exercises.get(row.exerciseId).code;
      seenThrows.add(code);
      assert.equal(exercises.get(row.exerciseId).wristSensitive, true);
      for (const target of row.targetSets) {
        assert.equal(target.reps, 3);
        assert.equal(target.sides, code === 'PW05' ? 2 : 1);
        assert.equal(target.contacts, undefined, 'Throws are not foot landings');
        assert.equal(target.loadRule, 'speed');
        assert.equal(target.loadKg, null);
      }
    } else assert.equal(throws.length, 0, 'No new ballistic dose during return or deload');
  }
  assert.deepEqual([...seenThrows].sort(), ['PW05', 'PW07']);
  for (const session of programme.sessions.filter(s => s.templateId === 'lower-b-power')) {
    const week = weeks.get(session.weekId), rows = exerciseRows.get(session.id);
    const jump = rows.find(row => exercises.get(row.exerciseId).code === 'PW06');
    if (week.number >= 6 && !week.deload) {
      assert.ok(jump);
      assert.ok(!rows.some(row => exercises.get(row.exerciseId).code === 'PW03'), 'Loaded jumps replace pogos');
      assert.ok(jump.targetSets.length >= 2 && jump.targetSets.length <= 3);
      assert.equal(jump.rampUpSets.length, 1, 'Light familiarisation is explicit and counted');
      for (const target of jump.targetSets) {
        assert.equal(target.reps, 2);
        assert.equal(target.contacts, 4);
        assert.equal(target.loadRule, 'speed');
        assert.equal(target.loadKg, null);
      }
      const fallback = jump.equipmentOptions.find(option => exercises.get(option.exerciseId).code === 'PW01');
      assert.ok(fallback);
      assert.deepEqual(fallback.targetSets, jump.targetSets, 'Unloaded replacement retains exact dose and recovery');
      assert.ok(session.gameOverrideDetails.action.includes('Omit trap-bar jumps'));
    } else assert.equal(jump, undefined, 'No loaded jumps during return or deload');
  }
});

test('hip directions, belt squats and supported abs are integrated as replacements with exact alternatives', () => {
  const seen = new Set();
  for (const row of programme.session_exercises) {
    const code = exercises.get(row.exerciseId).code;
    seen.add(code);
    for (const alternative of row.equipmentOptions || []) seen.add(exercises.get(alternative.exerciseId).code);
    if (/^ST2[2-9]$/.test(code)) {
      assert.equal(row.targetSets[0].sides, 2);
      assert.ok(row.targetSets.every(t => t.rpe <= 6));
      assert.ok(row.equipmentOptions.length > 0);
      assert.ok(row.equipmentOptions.every(option => exercises.get(option.exerciseId).movementPattern === exercises.get(row.exerciseId).movementPattern));
    }
    if (code === 'ST21') {
      assert.equal(sessions.get(row.sessionId).templateId, 'lower-a-speed');
      assert.ok(row.equipmentOptions.some(option => exercises.get(option.exerciseId).code === 'ST02'));
      assert.ok(row.equipmentOptions.some(option => exercises.get(option.exerciseId).code === 'ST05'));
      assert.match(row.notes, /rated|compatible/);
    }
    if (code === 'CO07') {
      assert.equal(sessions.get(row.sessionId).templateId, 'upper-b-core');
      assert.ok(row.targetSets.every(t => t.reps >= 6 && t.reps <= 8 && t.loadRule === 'bodyweight'));
      assert.ok(row.equipmentOptions.some(option => exercises.get(option.exerciseId).code === 'CO03'));
    }
  }
  for (const code of ['ST21', 'ST22', 'ST23', 'ST24', 'ST25', 'ST26', 'ST27', 'ST28', 'ST29', 'CO07']) assert.ok(seen.has(code), `Requested equipment missing: ${code}`);
  for (const session of programme.sessions.filter(s => s.templateId === 'lower-b-power')) assert.ok(!exerciseRows.get(session.id).some(row => exercises.get(row.exerciseId).code === 'ST18'));
  for (const session of programme.sessions.filter(s => s.templateId === 'upper-b-core')) assert.ok(!exerciseRows.get(session.id).some(row => exercises.get(row.exerciseId).code === 'CO03'));
});

test('unidentified machines are confirmed-setup alternatives with truthful units and grounded squat work', () => {
  const machineCodes = new Set(['SP05', 'ST30']);
  const alternatives = programme.session_exercises.flatMap(row => row.equipmentOptions || []).filter(option => machineCodes.has(exercises.get(option.exerciseId).code));
  assert.ok(alternatives.some(option => exercises.get(option.exerciseId).code === 'SP05'));
  assert.ok(alternatives.some(option => exercises.get(option.exerciseId).code === 'ST30'));
  assert.ok(programme.session_exercises.every(row => !machineCodes.has(exercises.get(row.exerciseId).code)), 'Unconfirmed machines never become default scheduled work');
  for (const option of alternatives) {
    const exercise = exercises.get(option.exerciseId);
    assert.ok(exercise.equipmentConfirmationRequired);
    assert.match(option.notes, /confirm/i);
    if (exercise.code === 'SP05') {
      assert.equal(exercise.loggingMode, 'machineSpeed');
      assert.ok(option.targetSets.length <= 4);
      assert.ok(option.targetSets.every(t => t.seconds === 5 && t.distanceM === undefined && t.rpe <= 7 && t.loadRule === 'speed'));
      assert.ok(option.targetSets.slice(0, -1).every(t => t.restSec === 90));
      assert.match(option.notes, /Do not invent metres/);
    } else {
      assert.equal(exercise.loggingMode, 'machineStrength');
      assert.ok(option.targetSets.every(t => t.reps > 0 && t.contacts === undefined && t.rpe <= 6 && t.loadRule === 'calibrate'));
      assert.match(option.notes, /grounded squats only/);
      assert.match(option.notes, /no automatic kg progression/);
    }
  }
});

test('every explicit equipment alternative has complete numeric targets and fits its reserved block', () => {
  for (const row of programme.session_exercises) for (const option of row.equipmentOptions || []) {
    assert.ok(option.label);
    assert.ok(option.loadConvention);
    assert.ok(option.targetSets.length > 0);
    assert.ok(Array.isArray(option.rampUpSets));
    assert.ok(Number.isFinite(option.estimatedBlockMin) && option.estimatedBlockMin > 0);
    assert.ok(option.estimatedBlockMin <= row.estimatedBlockMin + 0.01, 'Swap cannot exceed its reserved slot');
    for (const [index, target] of option.targetSets.entries()) {
      assert.equal(target.index, index + 1);
      assert.ok(numericDose(target));
      assert.equal(target.loadKg, null);
      assert.ok(Number.isFinite(target.restSec) && target.restSec >= 0);
      assert.ok(Number.isFinite(target.rpe) && target.rpe >= 0 && target.rpe <= 10);
      assert.ok(plan.progressionRules[target.loadRule]);
    }
    for (const target of option.rampUpSets) assert.equal(target.loadKg, null);
  }
});

test('test batteries replace normal lifting, and locked wrist work is never scheduled', () => {
  assert.deepEqual(programme.weeks.filter(row => row.testing).map(row => row.number), [1, 10, 18, 26, 34, 42, 50]);
  for (const week of programme.weeks.filter(row => row.testing)) {
    const rows = programme.sessions.filter(row => row.weekId === week.id);
    assert.equal(rows.filter(row => row.kind === 'testing' && !row.optional).length, 3);
    assert.ok(!rows.some(row => ['upper-a', 'lower-a-speed', 'lower-b-power'].includes(row.templateId)));
    assert.ok(!rows.some(row => row.templateId === 'optional-conditioning'));
  }
  const locked = new Set(['SK09', 'SK10', 'TS11', 'TS12']);
  assert.ok(programme.session_exercises.every(row => !locked.has(exercises.get(row.exerciseId).code)));
});

test('deloads recur every fourth loaded week after the return, without added interval work', () => {
  assert.deepEqual(programme.weeks.filter(row => row.deload).map(row => row.number), [8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52]);
  for (const week of programme.weeks) {
    const extras = programme.sessions.filter(row => row.weekId === week.id && row.templateId === 'optional-conditioning');
    assert.ok(extras.length <= 1, `Repeated additional conditioning in week ${week.number}`);
    if (week.deload || week.testing || week.volumeFactor === 0) assert.equal(extras.length, 0);
    if (week.deload) assert.ok(week.volumeFactor <= 0.6 && week.targetRpe <= 6);
    for (const session of extras) {
      assert.equal(session.optional, true);
      assert.equal(session.activationRule.normalFiveSkateWeekDefault, 'Skip');
      assert.equal(session.activationRule.replacesMeaningfulIceLoad, true);
      assert.equal(session.activationRule.maximumExtraIntervalSessionsPerWeek, 1);
      assert.ok(session.gameOverride);
      assert.ok(session.mutuallyExclusiveGroup);
    }
  }
});

test('every outdoor shooting block has an exact indoor rehearsal that never counts shots', () => {
  const shooting = programme.session_exercises.filter(row => /^SH0[1-5]$/.test(exercises.get(row.exerciseId).code) || exercises.get(row.exerciseId).code === 'TS08');
  assert.ok(shooting.length > 0);
  for (const row of shooting) {
    assert.equal(row.environment, 'OUTDOOR');
    assert.ok(row.indoorSwap, `Missing indoor alternative for ${row.id}`);
    assert.equal(exercises.get(row.indoorSwap.exerciseId).code, 'SH06');
    assert.ok(row.indoorSwap.targetSets.length > 0);
    for (const target of row.indoorSwap.targetSets) {
      assert.ok(numericDose(target));
      assert.ok(Number.isFinite(target.restSec));
      assert.equal(target.metrics.shots, 0);
    }
    assert.match(row.indoorSwap.notes, /not|never|no (?:shots|attempts)/i);
  }
});

test('seed data does not fabricate completed training, wellness, records or measured tests', () => {
  for (const table of ['users', 'set_logs', 'skill_logs', 'test_results', 'wellness_logs', 'personal_records', 'sync_queue']) assert.deepEqual(programme[table], []);
  for (const session of programme.sessions) {
    assert.equal(session.status, 'planned');
    assert.equal(session.actualDurationMin, undefined);
    assert.equal(session.sessionRpe, undefined);
    assert.equal(session.completedAt, undefined);
  }
  assert.ok(programme.exercises.every(row => row.loadConvention));
  assert.equal(programme.exercises.find(row => row.code === 'ST09').loadMultiplier, 2);
});
