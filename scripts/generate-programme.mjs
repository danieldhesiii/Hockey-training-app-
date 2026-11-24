/**
 * Expand the complete, dated SHIFT training programme into portable seed data.
 *
 * This is a coaching programme, not a clinical rehabilitation prescription.
 * Planned values are targets only. No completed sets, test scores or wellness
 * observations are generated. Loading is calibrated by the athlete and future
 * kg targets are calculated from actual completed logs by the app.
 *
 * Run after generate-exercises.mjs and after test-protocols.json is available:
 *   node scripts/generate-programme.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uuid, record, seededAt } from './ids.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
function readArray(file, nextStep) {
  const full = path.join(DATA, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Programme input missing: ${full}. ${nextStep}`);
  }
  const value = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(value) || !value.length) {
    throw new Error(`${file} must be a non-empty JSON array of entity records.`);
  }
  return value;
}
const exercises = readArray('exercises.json', 'Run node scripts/generate-exercises.mjs first.');
const testProtocols = readArray('test-protocols.json', 'Create the documented TS01-TS13 test-protocol records before generating the programme.');
const exerciseMap = new Map(exercises.map(e => [e.code, e]));
const protocolMap = new Map(testProtocols.map(p => [p.code, p]));
function ex(code) {
  const found = exerciseMap.get(code);
  if (!found) throw new Error(`Required exercise ${code} is missing from exercises.json.`);
  return found;
}
function protocol(code) {
  const found = protocolMap.get(code);
  if (!found) throw new Error(`Required protocol ${code} is missing from test-protocols.json.`);
  return found;
}

const START = '2026-11-24';
const CALENDAR_START = '2026-11-23';
const END = '2027-11-21';
const HOLIDAY_START = '2026-12-05';
const HOLIDAY_END = '2026-12-19';
const RETURN_DATE = '2026-12-21';
const TEST_WEEKS = new Set([1, 10, 18, 26, 34, 42, 50]);
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ZONES = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'fiveHole'];
const minutes = seconds => Math.round(seconds / 60 * 100) / 100;
const clone = value => JSON.parse(JSON.stringify(value));
// Dates are constructed from integer calendar parts. No locale or time-zone
// conversion is applied to an athlete's scheduled YYYY-MM-DD day.
function addDays(iso, count) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + count, 12));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
function holiday(date) { return date >= HOLIDAY_START && date <= HOLIDAY_END; }
function normalTrainingDate(date) { return date >= START && !holiday(date) && date !== '2026-12-20'; }
const shortWristNote = 'Use a comfortable wrist position and obey clinician restrictions. Stop the exercise if wrist symptoms increase, grip changes or compensation appears. Do not treat a brace as permission to train through pain.';
const skillsWristNote = 'Optional and wrist-tolerance gated. If handling or shooting increases symptoms, use the no-stick scan or footwork alternative. No weighted pucks, one-hand control or fatigue-handling prescription is active.';

const progressionRules = {
  calibrate: {
    name: 'Find the first comfortable working load',
    instruction: 'After ramp-up sets, select a load that allows every prescribed repetition with the stated RPE and consistent technique. Start at the lower end when uncertain. No baseline kg is assumed.',
    targetRpeCap: 8, incrementKg: 0, stepKg: 0,
    noHistory: 'Leave target kg blank until a real calibration set is recorded. A previously painful exercise is not calibrated under load.'
  },
  'lower-main': {
    name: 'Lower-body main lift', incrementKg: 2.5, stepKg: 2.5,
    targetRpeCap: 8, minimumRir: 2,
    success: 'For the next occurrence of this same exercise and variant, add 2.5 kg only after all planned working sets were completed at or above target repetitions, every recorded set RPE is at or below its target and no target exceeds RPE 8. Do not progress a partial session or a session with missing RPE.',
    repeat: 'If repetitions or the RPE cap were missed, repeat the last working load next time. A skipped or incomplete session is not a failed attempt.',
    repeatedMiss: 'After two consecutive completed occurrences with actual target misses, suggest a 5-10% load reset or a reduced-volume week. The user reviews the suggestion; it does not silently rewrite the plan.',
    deload: 'Use approximately 85-90% of the last comfortable working load, or less to meet RPE 6. No progression is earned during deload or taper.',
    rounding: 'Round down to available plates. If an increment is unavailable, retain the current load until the smaller step is possible.'
  },
  'upper-main': {
    name: 'Upper-body main lift', incrementKg: 1, stepKg: 1,
    targetRpeCap: 8, minimumRir: 2,
    success: 'Add 1 kg in the exercise-specific logging convention only after all planned working sets hit target repetitions at or below the stated RPE, with a cap of 8, comfortable grip and no later symptom increase. For floor press this means 1 kg per dumbbell; row values follow the library convention.',
    repeat: 'Retain the load if a target is missed, a set is incomplete, RPE is absent or the wrist response is uncertain.',
    repeatedMiss: 'Two target misses on two completed occurrences trigger a review and a suggested 5-10% reset, not an automatic load increase.',
    deload: 'Use roughly 85-90% of the last comfortable load and meet RPE 6. No increase during a deload or taper.',
    rounding: 'Use the nearest available increment at or below 1 kg. If the available jump is larger, repeat the current load or add one repetition within the prescribed range first.'
  },
  accessory: {
    name: 'Accessory double progression', incrementKg: 1, stepKg: 1,
    targetRpeCap: 8,
    success: 'Build from the stated repetitions to the stated repRange upper end. Once every set reaches that upper end with RPE at or below 8 and comfortable technique, add 1 kg using that exercise load convention and return to the lower end.',
    repeat: 'Repeat load and repetitions if form, range, symptom response or RPE is not acceptable. A different machine requires a new baseline.',
    repeatedMiss: 'After two completed sessions with actual misses, suggest a 5-10% reduction or one fewer set.',
    equipmentStep: 'For selectorised machines, use the smallest available step only if it stays within the RPE cap; otherwise continue repetitions at the existing setting.'
  },
  bodyweight: {
    name: 'Bodyweight control before load', incrementKg: 0, stepKg: 0,
    instruction: 'Complete the exact prescribed range or hold first. Add one controlled repetition per side, or five seconds per side, only within the listed maximum. Add external load or a longer lever only after two comfortable completions. Do not progress through pain.'
  },
  speed: {
    name: 'Quality governs speed and jumps', incrementKg: 0, stepKg: 0,
    instruction: 'Use the exact distances, landing counts and full rests. Repeat the current dose until landings and mechanics remain consistent. Stop after two clearly slower timed repetitions, a repeatable decline greater than approximately 3-5% using the same reliable timing method, or technique deterioration. This is a coaching quality rule, not an injury prediction threshold.',
    progression: 'The dated plan changes one principal variable at a time. Never shorten recovery to turn a speed session into conditioning. Loaded jumps and medicine-ball throws use a light individually calibrated implement; no automatic kg increases. Stationary resisted-running work is timed separately from track sprint results.'
  },
  conditioning: {
    name: 'Maintain the stated effort and recovery', incrementKg: 0, stepKg: 0,
    instruction: 'Choose resistance or pace to meet the prescribed effort without wrist loading. Complete the stated work and recovery. When all rounds are consistent, follow the next dated dose; do not add unscheduled rounds.',
    optionalIntervals: 'At most one extra interval session weekly, and only when it replaces rather than stacks onto meaningful hockey load. It is omitted during deload, testing, holiday and taper weeks.'
  },
  skill: {
    name: 'Accuracy and symptoms govern skill progression', incrementKg: 0, stepKg: 0,
    instruction: 'Record actual duration, touches, errors and eyes-up observation, or actual shots and hits by zone. Increase one variable only after two clean symptom-stable sessions: up to 5% more clean touches, one extra target difficulty, or the next planned shot block. Keep the current level when errors or wrist symptoms rise.',
    locked: 'One-hand handling, weighted-puck work and handling under deliberate fatigue remain locked until specifically appropriate under clinician guidance. Dry rehearsals never become shot attempts or accuracy data.'
  },
  mobility: {
    name: 'Comfortable controlled movement', incrementKg: 0, stepKg: 0,
    instruction: 'Use the stated repetitions or hold times without forcing end range. A pinching hip or painful wrist is a reason to reduce range or stop, not stretch harder.'
  }
};

const readinessRules = {
  status: 'Coaching heuristic, not a medical readiness test or injury predictor',
  availableInputs: ['sleepHours', 'sleepQuality', 'soreness', 'energy', 'mood'],
  inputScales: 'Sleep quality, energy and mood use 1-5. Soreness uses 0-10, where 10 is most sore. Sleep is entered in hours.',
  formula: 'round(100 * sum(available normalised score * weight) / sum(available weights)); sleep=clamp(sleepHours/8,0,1), weight30; energy=energy/5, weight20; soreness=1-soreness/10, weight20; sleepQuality=sleepQuality/5, weight15; mood=mood/5, weight15. Clamp every component to 0-1.',
  missingData: 'Use available observations with their weights renormalised and identify a partial check-in. With no observations show no score. Never invent missing sleep, soreness or mood values. Bodyweight does not enter this score.',
  bands: [
    { min: 75, max: 100, label: 'Usual plan if symptoms and warm-up are normal', action: 'Follow planned targets; the score does not override pain, illness or clinician restrictions.' },
    { min: 55, max: 74, label: 'Review warm-up and recent load', action: 'Keep the usual load only if warm-up is normal. Omit optional intervals when recovery is uncertain.' },
    { min: 0, max: 54, label: 'Reduce today or recover', action: 'The lighter-session suggestion retains ceil(75% of working sets), with at least one set, an RPE cap of 7 and at least three repetitions in reserve. Offer easy movement or rest when that is more appropriate. No maximal testing or additional intervals when readiness is poor.' }
  ],
  overrideTriggers: 'Fewer than six hours sleep, soreness at least seven out of ten or illness also prompts the lighter/recovery option. Worsening wrist or grip symptoms pauses added skills and painful grip work regardless of score.',
  symptomOverride: 'Sharp or worsening pain, swelling, neurological symptoms, altered movement or illness overrides the score. Stop and seek appropriate clinical assessment when indicated.',
  repeatedLow: 'Three low-readiness days, worsening symptoms or two completed target misses prompt a review of skating, sleep and total training before a 5-10% reset or reduced-volume week.',
  workloadChart: 'Display seven-day load and the mean of the preceding four complete weeks descriptively. Require four complete weeks. Do not present an acute:chronic ratio as a safe zone or an injury risk probability.'
};

const phaseSpecs = [
  { key: 'preparation', name: 'Preparation, holiday and return', start: 1, end: 5, focus: 'Establish repeatable baselines, wrist-tolerated movement, and a gradual return after holiday.', mainSets: 2, mainReps: 6, mainRpe: 6, accessorySets: 2, accessoryReps: 8, sprintReps: 4, sprintDistance: 10, jumpSets: 2, jumpReps: 2, handlingSec: 20, handlingSets: 3, shots: 15, bikeTue: 12, bikeFri: 10, intensity: 'RPE 5-6; approximately 50-70% of a known comparable 1RM where available.' },
  { key: 'foundation', name: 'Foundation and work capacity', start: 6, end: 9, focus: 'Build repeatable bilateral and unilateral strength, controlled landings and comfortable aerobic work.', mainSets: 3, mainReps: 6, mainRpe: 7, accessorySets: 2, accessoryReps: 8, sprintReps: 4, sprintDistance: 10, jumpSets: 3, jumpReps: 2, handlingSec: 30, handlingSets: 4, shots: 20, bikeTue: 14, bikeFri: 12, intensity: 'RPE 6-7.5; approximately 60-78% of a known comparable 1RM.' },
  { key: 'strength', name: 'Maximal strength emphasis', start: 10, end: 17, focus: 'Increase lower-body and upper-back force while maintaining acceleration and bodyweight.', mainSets: 4, mainReps: 4, mainRpe: 8, accessorySets: 2, accessoryReps: 6, sprintReps: 4, sprintDistance: 10, jumpSets: 3, jumpReps: 2, handlingSec: 30, handlingSets: 5, shots: 30, bikeTue: 14, bikeFri: 12, intensity: 'RPE 7-8; approximately 75-87% of a known comparable 1RM. No grinding or failure.' },
  { key: 'strength-power', name: 'Strength and power', start: 18, end: 25, focus: 'Retain strength and improve fresh acceleration, lateral landing control and rapid force expression.', mainSets: 3, mainReps: 3, mainRpe: 8, accessorySets: 2, accessoryReps: 6, sprintReps: 5, sprintDistance: 20, jumpSets: 3, jumpReps: 2, handlingSec: 40, handlingSets: 5, shots: 40, bikeTue: 14, bikeFri: 12, intensity: 'Main lifts RPE 7-8; power work fast and technically crisp, with full recovery.' },
  { key: 'tryout-preparation', name: 'Tryout preparation and readiness', start: 26, end: 33, focus: 'Express acceleration and puck-strength capacity, with a taper tied to an actual June or July tryout date.', mainSets: 3, mainReps: 3, mainRpe: 7.5, accessorySets: 2, accessoryReps: 6, sprintReps: 5, sprintDistance: 20, jumpSets: 3, jumpReps: 2, handlingSec: 40, handlingSets: 6, shots: 50, bikeTue: 12, bikeFri: 12, intensity: 'RPE 7-7.5 for strength; low-fatigue fast work. Reduce sets 40-60% during the final 5-7 days before a confirmed tryout.' },
  { key: 'tryout-window', name: 'Tryout window and transition', start: 34, end: 37, focus: 'Stay fresh for confirmed tryouts, retain key qualities, and rebuild only after the final event.', mainSets: 2, mainReps: 3, mainRpe: 7, accessorySets: 2, accessoryReps: 6, sprintReps: 3, sprintDistance: 20, jumpSets: 2, jumpReps: 2, handlingSec: 30, handlingSets: 4, shots: 30, bikeTue: 12, bikeFri: 10, intensity: 'RPE 6-7, reduced sets. Actual event dates govern taper; August is transition if tryouts have finished.' },
  { key: 'preseason', name: 'Pre-season integration', start: 38, end: 41, focus: 'Retain strength and speed while integrating checking skills and the emerging team schedule.', mainSets: 3, mainReps: 4, mainRpe: 7.5, accessorySets: 2, accessoryReps: 6, sprintReps: 4, sprintDistance: 20, jumpSets: 3, jumpReps: 2, handlingSec: 40, handlingSets: 5, shots: 40, bikeTue: 12, bikeFri: 12, intensity: 'RPE 7-7.5; keep volume responsive to added ice time. Contact skills need appropriate on-ice coaching.' },
  { key: 'inseason', name: 'In-season maintenance and progress', start: 42, end: 52, focus: 'Maintain useful force and speed while arriving fresh for games and hard Monday practice.', mainSets: 3, mainReps: 3, mainRpe: 7.5, accessorySets: 2, accessoryReps: 6, sprintReps: 4, sprintDistance: 10, jumpSets: 2, jumpReps: 2, handlingSec: 30, handlingSets: 4, shots: 25, bikeTue: 12, bikeFri: 10, intensity: 'RPE 6.5-7.5. Retain comfortable intensity while reducing sets during congested game weeks.' }
];

const weeklyTemplate = {
  Mon: 'Hard evening ice only; no gym. Record actual duration and session RPE.',
  Tue: 'Brief medicine-ball ballistics in suitable loaded weeks, then upper strength and short easy bike. Optional controlled handling only if the wrist tolerates it.',
  Wed: 'Fresh speed and landing work, then main lower-body strength with belt-squat options. Test batteries replace this session in test weeks.',
  Thu: 'Light roller. One optional mobility and comfortable walking session, maximum 20 minutes.',
  Fri: 'Short lower power, including calibrated trap-bar jumps in eligible weeks, controlled strength, one hip accessory and easy bike before light evening ice. Reduce to a primer when Saturday is a game.',
  Sat: 'Medium ice or occasional game. One optional skills module OR a conditional conditioning replacement, never required extra hard work.',
  Sun: 'Low-fatigue upper body, supported hanging abs and a controlled hip direction before light evening ice; keep legs and wrist fresh for Monday.'
};
const phases = phaseSpecs.map(p => record(`phase:${p.key}`, {
  name: p.name, startWeek: p.start, endWeek: p.end,
  startDate: addDays(CALENDAR_START, (p.start - 1) * 7),
  endDate: addDays(CALENDAR_START, p.end * 7 - 1),
  focus: p.focus, intensity: p.intensity, weeklyTemplate: clone(weeklyTemplate),
  description: `${p.focus} All numeric doses are coaching prescriptions, not universal elite standards. Four gym slots are available, but symptom and game overrides take priority.`,
  progressionProfile: {
    mainSets: p.mainSets, mainReps: p.mainReps, mainRpe: p.mainRpe,
    sprintReps: p.sprintReps, sprintDistanceM: p.sprintDistance,
    handlingSecondsPerSet: p.handlingSec, handlingSets: p.handlingSets,
    optionalShootingUpperDose: p.shots,
    skillDoseGate: 'Advance only after symptom-stable practice. Future larger doses are ceilings, not automatic increases.'
  }
}));

const weeks = [], sessions = [], session_exercises = [];
const plan = [record('plan:shift-2026-2027', {
  title: 'SHIFT: 52-week hockey development programme',
  startDate: START, calendarStartDate: CALENDAR_START, endDate: END,
  totalWeeks: 52, sessionBudgetMin: 60, thursdayBudgetMin: 20,
  timezone: 'Europe/London', returnToTrainingDate: RETURN_DATE,
  athlete: { heightCm: 185, bodyweightKgRange: [75, 76], position: 'Centre', shoots: 'Right', liftingExperience: 'Experienced', bodyweightGoal: 'Maintain' },
  goals: ['Stronger lower body, hips and single-leg control', 'More stable puck protection and contact readiness', 'Faster first strides and acceleration', 'Recover better between bursts', 'Build useful capacity with comfortable, controlled movement'],
  holidayRanges: [{ startDate: HOLIDAY_START, endDate: HOLIDAY_END }],
  eventWindows: [
    { name: 'Tryouts, exact dates to be confirmed', startDate: '2027-06-01', endDate: '2027-07-31', confirmed: false },
    { name: 'Checking-league season, exact fixtures to be confirmed', startDate: '2027-09-01', endDate: END, confirmed: false }
  ],
  assumptions: [
    'The current five skating evenings remain the default until the actual team schedule changes: Thursday light roller, Friday light ice, Saturday medium ice or game, Sunday light ice and Monday hard ice.',
    'Ice and roller durations of 60 minutes are editable planning placeholders. They are not measured time on ice, completed logs or a prescription to change coached practice.',
    'Gym sessions include warm-up, ramp-up sets, all planned work and recovery, equipment setup, transitions and cool-down within 60 minutes. Thursday optional activity is at most 20 minutes.',
    'The first calendar week starts Monday 23 November 2026 but the first prescribed activity is Tuesday 24 November. No missed Monday workout is created.',
    'No mandatory gym or hockey is prescribed during 5-19 December holiday. Sunday 20 December is a return/rest day; normal training resumes 21 December with reduced lifting intensity.',
    'No baseline strength, sprint, jump, skill score, heart rate or completed session is fabricated. First loads are calibrated with RPE and recorded technique.',
    'Routine one-hand handling, weighted-puck work and deliberate fatigue-handling are not activated by default. Any loaded wrist rehabilitation follows the treating clinician, not a generic calendar.',
    'Two short easy-bike blocks sit inside Tuesday and Friday gym budgets. Additional Saturday intervals are optional replacement work and are omitted in test, deload and taper weeks.',
    'Known June-July tryout timing is a window. A confirmed event date triggers a 5-7 day taper by reducing sets, not by increasing conditioning.',
    'Main lifts remain specific to the recorded variant and equipment. Machine settings and dumbbell load conventions must not be mixed when comparing progress.',
    'Requested equipment replaces existing slots: medicine-ball throws replace a Tuesday accessory, trap-bar jumps replace Friday pogos in eligible weeks, cable or multi-hip work replaces one hip accessory, and ab slings replace reverse crunches. These are not additional workouts.',
    'A squat belt requires a compatible purpose-designed and rated belt-squat machine or attachment. Owning a belt does not confirm that a cable, dip-belt or improvised platform arrangement is suitable.',
    'The chest-supported resisted-running machine and hydraulic/pneumatic squat machine are identified only by description. Their exact model, manufacturer-permitted movement and staff-demonstrated setup must be confirmed before use. No airborne repetitions are prescribed on the unidentified squat machine.',
    'A machine resistance level or pressure is not kilograms. Record its actual display and unit without converting an arbitrary setting into kg or an estimated 1RM. Stationary resisted running is logged by work seconds, not invented metres.',
    'Outdoor shooting requires a safe backstop, dry footing and daylight or adequate lighting. Indoor dry release and video practice train related movement or decisions but are not shots or an accuracy substitute.'
  ],
  progressionRules, readinessRules,
  deloadRules: {
    weeks: [8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52],
    explanation: 'After holiday and return, every fourth loaded calendar week is reduced. Weeks 3-4 are holiday recovery. Baseline/retest weeks also reduce training because assessments replace work.',
    workingSetsFactor: 0.5, targetRpeCap: 6, jumpAndSprintDoseFactor: 0.5,
    skillDoseFactor: 0.5, extraIntervals: false,
    fixedIceLimit: 'Off-ice deload does not make unchanged team practice a whole-body deload. Discuss a lighter skate or omit optional ice if fatigue persists.'
  },
  gameRules: {
    saturdayGame: 'Replace Saturday practice with the actual game. Omit optional Saturday shooting/intervals. Friday becomes a 15-20 minute primer or rest; omit its loaded lower-body blocks if the game is important or recovery is poor. Sunday becomes recovery/mobility if sore.',
    unexpectedGame: 'Move or skip the closest fatiguing lower-body or interval session. Do not make up omitted volume on another day.',
    within48Hours: 'Avoid new exercises, high-volume eccentric work and extra intervals during the final 48 hours before an important game or tryout.'
  },
  testRules: {
    weeks: [...TEST_WEEKS],
    replacesTraining: true,
    priority: 'Familiarised, recovered and repeatable conditions. Defer testing if the preceding hard skate leaves abnormal soreness or performance is not representative.',
    fastProgress: 'When a change exceeds ordinary repeat-test variation and technique remains consistent, continue the same successful progression. Do not skip phases or raise every training dose.',
    slowProgress: 'If a test stalls, first check timing protocol, fatigue, sleep, adherence and symptoms. If two comparable retests and training logs show stagnation, change one training variable and reassess.',
    noUniversalBands: 'Use protocol-matched reference cohorts only. Personal baselines are the default; no invented amateur or professional cutoffs.'
  },
  timingConventions: {
    estimate: 'Every row includes an estimated block duration. Tempo X uses a one-second planning allowance while actual concentric intent remains fast. Rests are minimum planned recoveries; busy equipment may require dropping a low-priority accessory, never rushing sprints.',
    lastSetRest: 'The final working-set rest is normally zero because subsequent setup/transition is budgeted separately. Testing recovery measurements are explicitly retained.',
    sides: 'Repetitions and hold seconds on a target with sides:2 are per side. Warm-up/cool-down seconds are total allocated seconds across both sides.',
    contacts: 'Count individual foot contacts: one two-foot landing counts as two contacts, and one unilateral landing counts as one contact. Low pogo and demanding bound contacts are reported separately. Doubling the count for a bilateral landing does not add a jump.',
    strengthLoad: 'Use exercise.loadConvention. Bodyweight is not added to volume load; a dumbbell floor press is recorded per dumbbell and its external volume multiplier is two.'
  }
})];

function block(code, seconds, extra = {}) { return { exerciseId: ex(code).id, seconds, ...extra }; }
function upperWarmup() {
  return [block('CN01', 120, { note: 'Easy bike, relaxed hands, RPE 2.' }), block('MO07', 60, { reps: 10, note: 'Ten circles each direction; use remaining time to reset.' }), block('MO06', 60, { reps: 6, sides: 2, note: 'Six controlled rotations per side.' }), block('MO05', 60, { reps: 10, note: 'Ten glute bridges with a two-second top hold.' }), block('MO01', 60, { reps: 8, sides: 2, note: 'Eight ankle rocks per side.' }), block('MO08', 60, { reps: 6, note: 'Six comfortable movements in each tolerated direction; no forced stretch.' }), block('MO16', 60, { note: 'Check symptoms and the clinician plan. This is not a loaded rehabilitation prescription.' })];
}
function lowerWarmup(speed = false) {
  const out = [block('CN01', 120, { note: 'Easy bike at RPE 2; on a track use a brisk walk/easy jog for the same time.' }), block('MO01', 60, { reps: 8, sides: 2, note: 'Eight ankle rocks per side.' }), block('MO02', 60, { reps: 6, note: 'Six slow hip switches in each direction.' }), block('MO03', 60, { reps: 6, sides: 2, note: 'Six comfortable lateral shifts per side.' }), block('MO04', 60, { reps: 5, sides: 2, note: 'Five reverse lunges with rotation per side.' }), block('MO05', 60, { reps: 10, note: 'Ten bridges, two-second top hold.' })];
  out.push(speed ? block('SP01', 180, { reps: 3, note: 'Three 10 m progressive accelerations at approximately 50%, 65% and 80%, one each minute including walking return. These are warm-up runs, not timed tests.' }) : block('MO06', 60, { reps: 6, sides: 2, note: 'Six thoracic rotations per side.' }));
  return out;
}
function cooldown(kind = 'lower', secondsEach = 60) {
  const codes = kind === 'upper' ? ['MO14', 'MO15', 'MO09', 'MO12', 'MO11'] : ['MO09', 'MO10', 'MO11', 'MO12', 'MO15'];
  return codes.map(code => block(code, secondsEach, { sides: 2, note: code === 'MO10' ? 'Six slow adductor rockbacks per side within this minute; do not force a hip pinch.' : `Hold a comfortable position for ${secondsEach / 2} seconds each side. No bouncing or painful end range.` }));
}
const skillWarmup = () => [block('MO07', 60, { reps: 10, note: 'Comfortable shoulder circles.' }), block('MO08', 60, { note: 'Comfortable unforced wrist motion and symptom check.' }), block('MO04', 60, { reps: 4, sides: 2, note: 'Four controlled lunges per side.' })];
const skillCooldown = () => [block('MO15', 60, { sides: 2, note: 'Thirty seconds each side.' }), block('MO16', 60, { note: 'Record wrist response and check again the next morning; no invented rehab loading.' })];

function makeSets(count, values, lastRest = 0) {
  return Array.from({ length: count }, (_, i) => ({ index: i + 1, loadKg: null, ...clone(values), restSec: i === count - 1 ? lastRest : (values.restSec ?? 0) }));
}
function strengthSets(count, reps, rpe, restSec, loadRule, sides = 1, tempo = '2-0-X-1') {
  return makeSets(count, { reps, sides, restSec, tempo, rpe, rir: Math.max(2, Math.round(10 - rpe)), loadRule });
}
function ramp(reps, fraction, restSec) { return { reps, loadFractionOfWorkingLoad: fraction, loadKg: null, restSec, tempo: '2-0-1-1', note: 'If working kg is unknown, use an easy load and build gradually without exceeding the target effort.' }; }
function workSeconds(t, code) {
  if (t.planningExecutionSec != null) return t.planningExecutionSec;
  if (t.rounds != null) return t.rounds * t.workSec + Math.max(0, t.rounds - 1) * t.recoverySec;
  if (t.seconds != null) return t.seconds * (t.sides || 1);
  if (t.distanceM != null && /^SP|^TS0[234]$/.test(code)) return t.distanceM <= 10 ? 5 : t.distanceM <= 21 ? 8 : 20;
  if (code === 'PW03') return (t.reps || (t.contacts || 2) / 2) * 0.5;
  if (code.startsWith('PW') || ['TS01', 'TS09', 'TS10'].includes(code)) return (t.reps || 1) * (t.sides || 1) * 5;
  if (code.startsWith('SH') || code === 'TS08') return (t.reps || 1) * (t.secondsBetweenReps || 15);
  const parts = String(t.tempo || '2-0-1-1').split('-');
  const repSec = parts.length === 4 ? parts.reduce((n, x) => n + (x === 'X' ? 1 : Number(x) || 0), 0) : 4;
  return (t.reps || 1) * (t.sides || 1) * Math.max(1, repSec);
}
function row(code, role, targetSets, opts = {}) {
  const value = { code, exerciseId: ex(code).id, role, targetSets, notes: '', environment: ex(code).environment, setupSec: 30, ...opts };
  return value;
}
function baseRowSeconds(r) {
  const warm = (r.rampUpSets || []).reduce((n, t) => n + workSeconds(t, r.code) + t.restSec, 0);
  return r.setupSec + warm + (r.preWorkRestSec || 0) + r.targetSets.reduce((n, t) => n + workSeconds(t, r.code) + t.restSec, 0);
}
function rowSeconds(r) {
  // Reserve the longest explicit equipment choice, not the sum of alternatives.
  // A selected swap can then fit without rushing rest or adding another block.
  return Math.max(baseRowSeconds(r), ...(r.equipmentOptions || []).map(option => baseRowSeconds({ ...r, ...option, code: exercises.find(e => e.id === option.exerciseId).code })));
}
function equipmentOption(code, targetSets, opts = {}) {
  const option = { exerciseId: ex(code).id, label: ex(code).name, targetSets: clone(targetSets), rampUpSets: [], setupSec: 30, environment: ex(code).environment, loadConvention: ex(code).loadConvention, notes: '', ...opts };
  option.estimatedBlockMin = minutes(baseRowSeconds({ ...option, code }));
  return option;
}
function sumBlockSeconds(items) { return items.reduce((n, x) => n + (x.seconds || 0), 0); }
function countSets(p, count, minimum = 1) { return p.deload ? Math.max(minimum, Math.ceil(count / 2)) : count; }
function bodyHold(p, seconds, sides = 2) { return makeSets(countSets(p, 2), { seconds, sides, restSec: 45, tempo: 'steady hold', rpe: p.deload ? 5 : 6, loadRule: 'bodyweight', maximumSeconds: 30 }); }
function mainRamp(upper = false) { return upper ? [ramp(8, 0.4, 45), ramp(4, 0.7, 60)] : [ramp(8, 0.4, 45), ramp(5, 0.6, 60), ramp(3, 0.8, 90)]; }
function addSession(week, date, templateId, title, kind, rows, config = {}) {
  const warmup = config.warmup || [], cool = config.cooldown || [];
  const budget = config.budgetMin ?? (kind === 'ice' || kind === 'roller' ? 180 : 60);
  const transitionSec = config.transitionSec ?? (kind === 'strength' || kind === 'testing' ? 180 : 60);
  const getTotal = () => sumBlockSeconds(warmup) + sumBlockSeconds(cool) + rows.reduce((n, r) => n + rowSeconds(r), 0) + transitionSec;
  // Reduce low-priority accessories before cutting recovery or essential warm-up.
  // Final output contains the actual resulting set targets, never a hidden cap.
  while (getTotal() > budget * 60) {
    const candidate = [...rows].reverse().find(r => r.trimPriority && r.targetSets.length > 1);
    if (candidate) {
      candidate.targetSets.pop();
      candidate.targetSets.at(-1).restSec = 0;
      for (const option of candidate.equipmentOptions || []) {
        if (option.targetSets.length > candidate.targetSets.length) {
          option.targetSets = option.targetSets.slice(0, candidate.targetSets.length);
          option.targetSets.at(-1).restSec = 0;
          option.estimatedBlockMin = minutes(baseRowSeconds({ ...candidate, ...option, code: exercises.find(e => e.id === option.exerciseId).code }));
        }
      }
      candidate.notes += ' One accessory set is omitted to keep the complete session within its time budget.';
      continue;
    }
    const bike = rows.find(r => r.code === 'CN01' && r.targetSets[0]?.seconds > 600);
    if (bike) { bike.targetSets[0].seconds -= 60; continue; }
    throw new Error(`Session exceeds ${budget} min: week ${week.number}, ${date}, ${title} (${minutes(getTotal())} min).`);
  }
  const totalSec = getTotal();
  const durationMin = Math.ceil(totalSec / 60);
  const idKey = `session:${date}:${templateId}`;
  const lowContacts = rows.filter(r => r.code === 'PW03').flatMap(r => [...(r.rampUpSets || []), ...r.targetSets]).reduce((n, t) => n + (t.contacts || 0), 0);
  const highContacts = rows.filter(r => r.code.startsWith('PW') && r.code !== 'PW03' || ['TS01', 'TS09', 'TS10'].includes(r.code)).flatMap(r => [...(r.rampUpSets || []), ...r.targetSets]).reduce((n, t) => n + (t.contacts || 0), 0) + warmup.reduce((n, b) => n + (b.contacts || 0), 0);
  const session = record(idKey, {
    weekId: week.id, phaseId: week.phaseId, date, kind, templateId, title,
    durationMin, intensityRpe: config.rpe ?? week.targetRpe,
    optional: config.optional ?? false, environment: config.environment || 'INDOOR', status: 'planned',
    notes: config.notes || '', warmup, cooldown: cool,
    durationBreakdown: {
      warmupMin: minutes(sumBlockSeconds(warmup)), exerciseBlocksMin: minutes(rows.reduce((n, r) => n + rowSeconds(r), 0)),
      transitionAllowanceMin: minutes(transitionSec), cooldownMin: minutes(sumBlockSeconds(cool)),
      roundingBufferMin: minutes(durationMin * 60 - totalSec), totalMin: durationMin,
      explanation: 'Exercise blocks include stated repetitions, prescribed rests, equipment setup and any ramp-up sets. A slot with explicit equipment choices reserves the longest choice, not their combined work. The last-set rest is zero unless an explicit measurement needs it.'
    },
    ...(lowContacts || highContacts ? { plannedGroundContacts: { lowIntensity: lowContacts, demanding: highContacts, total: lowContacts + highContacts, convention: 'Individual foot contacts: bilateral landing = 2, unilateral landing = 1. Includes prescribed jump-test warm-ups.' } } : {}),
    ...(config.indoorSwap ? { indoorSwap: config.indoorSwap } : {}),
    ...(config.activationRule ? { activationRule: config.activationRule } : {}),
    ...(config.gameOverride != null ? { gameOverride: config.gameOverride } : {}),
    ...(config.gameOverrideDetails ? { gameOverrideDetails: config.gameOverrideDetails } : {}),
    ...(config.mutuallyExclusiveGroup ? { mutuallyExclusiveGroup: config.mutuallyExclusiveGroup } : {}),
    ...(config.timeOfDay ? { timeOfDay: config.timeOfDay } : {}),
    ...(config.provisionalDuration ? { provisionalDuration: true } : {})
  });
  sessions.push(session);
  rows.forEach((r, i) => {
    const { code, trimPriority, ...fields } = r;
    session_exercises.push(record(`${idKey}:exercise:${i + 1}:${code}`, {
      sessionId: session.id, order: i + 1, ...fields,
      estimatedBlockMin: minutes(rowSeconds(r)),
      loadConvention: ex(code).loadConvention,
      ...(ex(code).wristSensitive ? { symptomGate: shortWristNote } : {})
    }));
  });
  return session;
}

function equipmentBlock(week) { return Math.floor(Math.max(0, week.number - 6) / 4); }
function hipAccessory(week, p, day) {
  const block = equipmentBlock(week), direction = day === 'friday' ? (block % 2 ? 'extension' : 'flexion') : (block % 2 ? 'adduction' : 'abduction');
  const cable = { flexion: 'ST22', extension: 'ST23', abduction: 'ST24', adduction: 'ST25' }[direction];
  const machine = { flexion: 'ST26', extension: 'ST27', abduction: 'ST28', adduction: 'ST29' }[direction];
  const code = Math.floor(block / 2) % 2 ? machine : cable;
  const other = code === cable ? machine : cable;
  const reps = day === 'friday' ? 8 : 10;
  const targets = strengthSets(countSets(p, 2), reps, p.deload || p.key === 'preparation' ? 5 : 6, 45, 'accessory', 2, '2-1-1-1');
  return row(code, 'accessory', targets, {
    trimPriority: 1, setupSec: 45, repRange: [reps, reps + 2],
    notes: `One hip direction today: ${direction}, ${reps} controlled repetitions per side. Keep the pelvis steady and use a cuff or comfortable machine support. Record machine identity, pulley or pad setting and the actual displayed load. This replaces an existing accessory, not an additional four-direction circuit.`,
    equipmentOptions: [equipmentOption(other, targets, { setupSec: 45, repRange: [reps, reps + 2], notes: `Same ${direction} pattern using the alternative equipment. Recalibrate the load; cable and multi-hip displays are separate variants. Do not transfer kg between machines.` })]
  });
}

function upperTuesday(week, p, date) {
  const n = countSets(p, p.mainSets), reps = p.mainReps, rpe = p.deload ? 6 : p.mainRpe;
  const ballistic = week.number >= 6 && !p.deload;
  const scoop = equipmentBlock(week) % 2 === 0;
  const throwCode = scoop ? 'PW05' : 'PW07';
  const throwN = scoop || ['tryout-window', 'inseason'].includes(p.key) ? 2 : 3;
  const throwTargets = makeSets(throwN, { reps: 3, sides: scoop ? 2 : 1, restSec: scoop ? 90 : 60, tempo: 'crisp release; reset every throw', rpe: 6, loadRule: 'speed' });
  const rows = [
    ...(ballistic ? [row(throwCode, 'power', throwTargets, {
      setupSec: 45,
      notes: `${shortWristNote} Use a light ball that accelerates crisply and an approved throw area. Retrieve and reset instead of catching a forceful rebound. Record ball mass and throws per side; throws are not foot contacts. This replaces the pulldown accessory. Stop before speed or technique declines.`,
      equipmentOptions: [equipmentOption('CO01', makeSets(2, { reps: 6, sides: 2, restSec: 30, tempo: '2-1-1-1', rpe: 5, loadRule: 'bodyweight' }), { role: 'core', notes: 'Wrist-comfortable trunk-control replacement when throwing is unsuitable. Six controlled repetitions per side; no throw or landing metrics.' })]
    })] : []),
    row('ST09', 'main', strengthSets(n, reps, rpe, 120, 'upper-main'), { rampUpSets: mainRamp(true), setupSec: 45, notes: `${shortWristNote} Log kg per dumbbell. This slot can be omitted if no pressing option is comfortable.` }),
    row('ST10', 'main', strengthSets(n, reps, rpe, 120, 'upper-main'), { rampUpSets: [ramp(8, 0.5, 45)], setupSec: 45, notes: 'Keep the same row variant and load convention. Use supported rowing only while grip is comfortable.' }),
    ...(!ballistic ? [row('ST11', 'accessory', strengthSets(countSets(p, 2), 8, p.deload ? 5 : 7, 60, 'accessory', 1, '2-1-1-1'), { trimPriority: 1, notes: 'Repetition range 8-10. Comfortable neutral grip only.', repRange: [8, 10] })] : []),
    row('ST16', 'accessory', strengthSets(countSets(p, 2), 12, 5, 30, 'accessory', 2, '2-0-1-0'), { trimPriority: 1, notes: 'Twelve repetitions per side. Choose light band resistance; no wrist twisting.' }),
    row('CO01', 'core', makeSets(countSets(p, 2), { reps: 6, sides: 2, restSec: 30, tempo: '2-1-1-1', rpe: 5, loadRule: 'bodyweight' }), { trimPriority: 1 }),
    row('CN01', 'conditioning', makeSets(1, { seconds: p.bikeTue * 60, restSec: 0, rpe: 3, loadRule: 'conditioning', cadenceRpmRange: [65, 85] }), { notes: 'Continuous conversational pace; keep hands relaxed. Resistance is individual, not a prescribed wattage.' })
  ];
  addSession(week, date, 'upper-a', ballistic ? 'Medicine-ball power, upper strength and easy aerobic work' : 'Upper strength and easy aerobic work', 'strength', rows, { warmup: upperWarmup(), cooldown: cooldown('upper'), rpe, notes: `Tuesday follows hard Monday ice: review fatigue before loading. ${p.deload ? 'Deload: reduced sets, RPE cap 6, no earned load increase.' : 'Use the logged-load progression rules, not a guessed starting weight.'} ${ballistic ? 'Medicine-ball work is brief and fresh before strength. It replaces one accessory; do not add the omitted pulldown back.' : ''}` });
}

function lowerWednesday(week, p, date) {
  const rpe = p.deload ? 6 : p.mainRpe;
  const speedCode = p.sprintDistance === 20 ? 'SP02' : 'SP01';
  const sprintN = countSets(p, p.sprintReps, 2);
  const accessoryN = countSets(p, p.accessorySets);
  const squatCode = week.number >= 6 && equipmentBlock(week) % 2 === 0 ? 'ST21' : 'ST02';
  const squatTargets = strengthSets(countSets(p, p.mainSets), p.mainReps, rpe, p.mainReps <= 4 ? 180 : 150, 'lower-main');
  const squatOptions = ['ST21', 'ST02', 'ST05'].filter(code => code !== squatCode).map(code => equipmentOption(code, squatTargets, {
    role: 'main', setupSec: 60, rampUpSets: mainRamp(),
    notes: code === 'ST21' ? 'Use only a compatible purpose-designed rated belt-squat machine or attachment after confirming the setup. A belt alone does not make an improvised cable or platform arrangement suitable. Recalibrate this setup; retain the exact sets, repetitions, effort and rest.' : `Use a comfortable ${ex(code).name.toLowerCase()} setup. Recalibrate its kg independently; retain the exact working targets and full rest. Do not transfer load from the other squat variant.`
  }));
  squatOptions.push(equipmentOption('ST30', strengthSets(Math.min(2, countSets(p, p.mainSets)), p.mainReps, Math.min(6, rpe), 90, 'calibrate', 1, '3-1-1-1'), {
    role: 'main', setupSec: 60, rampUpSets: [ramp(8, 0.4, 45), ramp(4, 0.6, 60)].map(t => ({ ...t, loadFractionOfWorkingLoad: null, note: 'Use a low confirmed machine setting for controlled familiarisation. Keep feet grounded; record the actual display and unit, not an invented kg equivalent.' })),
    notes: 'Unidentified hydraulic/pneumatic squat machine. Confirm the model, manufacturer instructions and staff-demonstrated setup before use. These are controlled grounded squats only, with no jumps. Record actual resistance setting and unit; no automatic kg progression or estimated 1RM.'
  }));
  const sledTargets = makeSets(Math.min(sprintN, 4), { distanceM: 10, restSec: 90, rpe: p.deload ? 5 : 7, loadRule: 'speed', planningExecutionSec: 12 });
  const runnerTargets = makeSets(Math.min(sprintN, 4), { seconds: 5, restSec: 90, rpe: p.deload ? 5 : 7, loadRule: 'speed', tempo: 'fast controlled steps; stop before slowing' });
  const rows = [
    row(speedCode, 'speed', makeSets(sprintN, { distanceM: p.sprintDistance, restSec: p.sprintDistance === 20 ? 150 : 120, rpe: 9, loadRule: 'speed', planningExecutionSec: p.sprintDistance === 20 ? 8 : 5 }), {
      environment: 'OUTDOOR', setupSec: 60,
      notes: 'Dry track, full walk-back recovery and clear run-off. Sprint quality first. If no safe sprint space exists, use one explicitly prescribed indoor alternative or defer this block. A stationary runner does not produce a 10 m or 20 m sprint time.',
      indoorSwap: { exerciseId: ex('SP03').id, targetSets: sledTargets, notes: 'Use a light sled for crisp acceleration if an indoor lane is available and handles do not load the wrist painfully. This is a different drill, not a sprint-time test. Otherwise omit the block.' },
      equipmentOptions: [
        equipmentOption('SP03', sledTargets, { role: 'speed', setupSec: 60, notes: 'Indoor resisted-acceleration replacement, not additional sprint work. Use a light sled and a clear lane only while handle pressure is comfortable; record the sled and surface.' }),
        equipmentOption('SP05', runnerTargets, { role: 'speed', setupSec: 60, rampUpSets: makeSets(1, { seconds: 10, restSec: 60, rpe: 3, loadRule: 'speed', note: 'Ten seconds at an easy confirmed setting to check the staff-demonstrated setup; then recover sixty seconds.' }, 60), notes: 'Unidentified chest-supported resisted-running machine. Confirm model, manufacturer use and safe staff-demonstrated setup first. Complete five-second fast controlled bouts, with full ninety-second recovery between bouts. Record seconds, machine identity and actual resistance display/unit. Do not invent metres or compare these bouts with track sprint tests. Stop if wrist support is uncomfortable.' })
      ]
    }),
    row('PW01', 'power', makeSets(countSets(p, p.jumpSets), { reps: p.jumpReps, contacts: p.jumpReps * 2, restSec: 75, tempo: 'fast take-off; hold landing 2 seconds', rpe: 6, loadRule: 'speed' }), { notes: 'Reset between repetitions. Each two-foot landing counts as two foot contacts. Distance is recorded only if measured; stop when landing control deteriorates.' }),
    row(squatCode, 'main', squatTargets, { rampUpSets: mainRamp(), setupSec: 60, notes: squatCode === 'ST21' ? 'Use a compatible purpose-designed rated belt-squat setup confirmed by staff. Owning a belt does not confirm attachment or platform compatibility. Recalibrate load for the exact setup; keep the torso controlled and feet planted. Use the explicit squat or leg-press alternative if the setup is unsuitable.' : 'Use safety bar if available and comfortable. If bar position aggravates the wrist, choose the explicit belt-squat or leg-press alternative with a new equipment-specific baseline.', equipmentOptions: squatOptions }),
    row('ST03', 'accessory', strengthSets(accessoryN, p.accessoryReps, p.deload ? 5 : 7, 90, 'accessory', 2, '3-0-1-0'), { trimPriority: 1, repRange: [p.accessoryReps, p.accessoryReps + 2], notes: 'Repetitions are per leg. Bodyweight or a vest can reduce grip demands. End each side with stable pelvis and knee tracking.' }),
    row('ST06', 'accessory', strengthSets(accessoryN, 8, p.deload ? 5 : 7, 60, 'accessory', 1, '3-0-1-1'), { trimPriority: 1, repRange: [8, 10] }),
    row('ST15', 'accessory', bodyHold(p, p.key === 'preparation' ? 10 : 15), { notes: 'Short-lever Copenhagen on the forearm. This is progressive adductor capacity work, not a promise of injury prevention. Regress to a shorter comfortable hold if needed.' }),
    row('CO02', 'core', bodyHold(p, 20), { trimPriority: 1, notes: 'Forearm support, twenty seconds each side per set.' })
  ];
  addSession(week, date, 'lower-a-speed', 'Acceleration and main lower-body strength', 'strength', rows, { warmup: lowerWarmup(true), cooldown: cooldown(), rpe, notes: 'Speed precedes strength. Track and gym must be close enough for the three-minute transition allowance. If travel between them takes longer, perform the speed block separately or omit one accessory; never exceed the 60-minute gym budget or rush sprint recovery. Equipment choices replace their block; use only one choice.', activationRule: { requiresNormalWarmup: true, afterHardMonday: 'If fatigue remains abnormal, omit maximal speed and reduce main lift to RPE 6.' } });
}

function lowerFriday(week, p, date) {
  const rpe = p.deload ? 5.5 : Math.min(7, p.mainRpe - 0.5);
  const n = p.deload ? 1 : p.key === 'strength' ? 3 : 2;
  const loadedJump = week.number >= 6 && !p.deload;
  const jumpN = ['foundation', 'tryout-window', 'inseason'].includes(p.key) ? 2 : 3;
  const jumpTargets = makeSets(jumpN, { reps: 2, contacts: 4, restSec: 120, tempo: 'fast take-off; stable landing; reset', rpe: 6, loadRule: 'speed' });
  const jumpRamp = [{ index: 1, reps: 2, contacts: 4, restSec: 90, loadKg: null, rpe: 3, loadRule: 'speed', tempo: 'two separate light jumps', note: 'One familiarisation set using a light individually suitable trap bar. Record total bar-plus-plate mass. If the lightest bar compromises speed, landing or grip, use the unloaded alternative.' }];
  const rows = [
    loadedJump ? row('PW06', 'power', jumpTargets, {
      setupSec: 60, rampUpSets: jumpRamp,
      notes: `${shortWristNote} Choose a light total bar-plus-plate mass that permits crisp take-off and a stable landing. Reset each repetition and do not chase height with extra load. This replaces pogos; no automatic kg increase and no added jump sets. Each landing is two foot contacts.`,
      equipmentOptions: [equipmentOption('PW01', jumpTargets, { role: 'power', setupSec: 30, rampUpSets: jumpRamp.map(t => ({ ...t, note: 'Two submaximal unloaded broad jumps, each with a stable landing. Recover ninety seconds before working sets.' })), notes: 'Unloaded broad-jump replacement if the trap bar is unsuitable or grip is not comfortable. Two jumps per set, each landing counted as two foot contacts. Reset each repetition; use the same full recoveries.' })]
    }) : row('PW03', 'power', makeSets(countSets(p, 2), { reps: 10, contacts: 20, restSec: 45, rpe: 4, loadRule: 'speed' }), { notes: 'Ten two-foot ankle bounces per set means twenty foot contacts. These low-intensity contacts are counted separately from demanding bounds. No loaded jump prescription during return or deload.' }),
    row('PW02', 'power', makeSets(countSets(p, p.key === 'preparation' ? 2 : 3), { reps: p.key === 'preparation' ? 2 : 3, sides: 2, contacts: p.key === 'preparation' ? 4 : 6, restSec: 75, tempo: 'push; hold each landing 2 seconds', rpe: 6, loadRule: 'speed' }), { notes: 'Each side is a separate landing event. Distance is secondary to stable landing and pelvis control.' }),
    row('ST01', 'main', strengthSets(n, p.key === 'foundation' ? 4 : 3, rpe, 150, 'lower-main'), { setupSec: 60, rampUpSets: [ramp(5, 0.5, 60), ramp(3, 0.75, 90)], notes: 'Fast concentric intent at submaximal effort. Same handle height for every comparison. Replace with leg press if grip is not comfortable.', equipmentOptions: [equipmentOption('ST05', strengthSets(n, p.key === 'foundation' ? 4 : 3, rpe, 150, 'lower-main'), { setupSec: 60, rampUpSets: [ramp(5, 0.5, 60), ramp(3, 0.75, 90)], notes: 'Grip-comfortable machine replacement. Recalibrate machine kg, keep the same seat and range, and retain the exact effort and repetitions.' })] }),
    row('ST04', 'accessory', strengthSets(countSets(p, 2), 6, p.deload ? 5 : 6, 75, 'accessory', 1, '2-1-X-1'), { trimPriority: 1, repRange: [6, 8], notes: 'Use a comfortable bar or machine setup without painful hand bracing.' }),
    hipAccessory(week, p, 'friday'),
    row('ST14', 'accessory', strengthSets(countSets(p, 2), 10, 6, 45, 'accessory', 1, '2-1-1-1'), { trimPriority: 1, repRange: [10, 12] }),
    row('CN01', 'conditioning', makeSets(1, { seconds: p.bikeFri * 60, restSec: 0, rpe: 3, loadRule: 'conditioning', cadenceRpmRange: [65, 85] }), { notes: 'Easy conversational bike. Do not turn this into an interval finisher before evening ice.' })
  ];
  addSession(week, date, 'lower-b-power', 'Lower power and controlled strength', 'strength', rows, { warmup: lowerWarmup(), cooldown: cooldown(), rpe, timeOfDay: 'Before evening ice, preferably with several hours available for recovery', notes: 'Finish feeling capable of more work. Saturday game or tryout overrides this session. Lower the dose if Friday ice becomes harder than planned. Loaded jumps replace the pogo block and one hip direction replaces step-ups; do not add the replaced work back.', gameOverride: true, gameOverrideDetails: { condition: 'Saturday is an important game or a tryout is within 48 hours', action: 'Use the warm-up plus 2 x 2 unloaded broad jumps with 90 seconds rest, then 3 minutes of comfortable mobility, or rest. Omit trap-bar jumps, loaded lower-body work and extra conditioning.', maximumDurationMin: 20 } });
}

function upperSunday(week, p, date) {
  const n = countSets(p, 2), rpe = p.deload ? 5 : 6;
  const abReps = p.key === 'preparation' ? 6 : 8;
  const abTargets = strengthSets(n, abReps, 5, 45, 'bodyweight', 1, '2-1-1-1');
  const rows = [
    row('ST10', 'main', strengthSets(n, 8, rpe, 90, 'upper-main'), { rampUpSets: [ramp(8, 0.5, 45)], notes: 'Low-fatigue supported row, same recorded equipment. This easy occurrence does not justify increasing Tuesday load unless its own targets and symptom criteria are met.' }),
    row('ST12', 'accessory', strengthSets(n, 6, rpe, 75, 'accessory', 2, '2-0-1-1'), { trimPriority: 1, repRange: [6, 8], notes: 'Six per side. Omit if gripping or pressing irritates the wrist; do not substitute painful push-ups.' }),
    hipAccessory(week, p, 'sunday'),
    row('CO01', 'core', makeSets(n, { reps: 6, sides: 2, restSec: 30, tempo: '2-1-1-1', rpe: 5, loadRule: 'bodyweight' })),
    row('CO07', 'core', abTargets, { trimPriority: 1, setupSec: 45, notes: 'Use securely attached rated ab slings with comfortable upper-arm and shoulder support. Curl the pelvis gently as the knees lift; no swinging or forced shoulder position. Arms support you without sustained hard gripping. Bodyweight only initially.', equipmentOptions: [equipmentOption('CO03', abTargets, { role: 'core', notes: 'Floor reverse-crunch replacement if the slings, shoulders or support are uncomfortable. Keep the same controlled repetitions and rest, without swinging.' })] }),
    row('CO02', 'core', bodyHold(p, 20), { trimPriority: 1 }),
    row('MO02', 'mobility', makeSets(1, { reps: 6, sides: 2, restSec: 0, tempo: '3-1-1-0', rpe: 2, loadRule: 'mobility' })),
    row('MO06', 'mobility', makeSets(1, { reps: 6, sides: 2, restSec: 0, tempo: '2-1-1-1', rpe: 2, loadRule: 'mobility' }))
  ];
  addSession(week, date, 'upper-b-core', 'Low-fatigue upper body, supported abs and hips', 'strength', rows, { warmup: upperWarmup(), cooldown: cooldown('upper'), rpe, notes: 'Keep at least four comfortable repetitions in reserve on loaded movements. Monday hard ice takes priority. After a Saturday game, use recovery mobility or skip this session if soreness or fatigue is elevated. Hip and ab-sling work replace the previous accessory and reverse-crunch slots.', gameOverride: true, gameOverrideDetails: { condition: 'Residual fatigue after Saturday game', action: 'Replace with 10-15 minutes of comfortable mobility or rest. Do not make up the omitted sets.' } });
}

function thursdayMobility(week, date) {
  const rows = [
    row('CN06', 'conditioning', makeSets(1, { seconds: 300, restSec: 0, rpe: 2, loadRule: 'conditioning' }), { setupSec: 0, notes: 'Comfortable walk, indoors if weather is poor.' }),
    row('MO01', 'mobility', makeSets(1, { reps: 8, sides: 2, restSec: 0, tempo: '2-0-1-0', rpe: 2, loadRule: 'mobility' })),
    row('MO02', 'mobility', makeSets(1, { reps: 6, sides: 2, restSec: 0, tempo: '3-1-1-0', rpe: 2, loadRule: 'mobility' })),
    row('MO03', 'mobility', makeSets(1, { reps: 6, sides: 2, restSec: 0, tempo: '3-1-1-0', rpe: 2, loadRule: 'mobility' })),
    row('MO09', 'mobility', makeSets(1, { seconds: 30, sides: 2, restSec: 0, rpe: 2, loadRule: 'mobility' })),
    row('MO15', 'mobility', makeSets(1, { seconds: 30, sides: 2, restSec: 0, rpe: 2, loadRule: 'mobility' })),
    row('MO16', 'mobility', makeSets(1, { seconds: 60, restSec: 0, rpe: 1, loadRule: 'mobility' }), { notes: 'Review clinician instructions and symptoms; no generic loaded wrist rehabilitation exercises.' })
  ];
  addSession(week, date, 'optional-thursday-mobility', 'Optional mobility before light roller', 'mobility', rows, { optional: true, budgetMin: 20, rpe: 2, environment: 'EITHER', notes: 'Optional. Omit when rest is more useful. Walking and movement stay comfortable.' });
}

function handling(week, p, date) {
  const stage = p.key === 'preparation' ? 0 : p.key === 'foundation' ? 1 : p.key === 'strength' ? 2 : 3;
  const codes = stage === 0 ? ['SK01', 'SH07'] : stage === 1 ? ['SK04', 'SK06'] : stage === 2 ? ['SK05', 'SK06'] : ['SK07', 'SK06'];
  const n = countSets(p, Math.max(2, Math.ceil(p.handlingSets / 2)), 1);
  const rows = codes.map(code => row(code, 'skill', makeSets(n, { seconds: p.handlingSec, restSec: 30, rpe: 3, loadRule: 'skill', metrics: { durationSec: p.handlingSec, maximumErrors: 2, eyesUpTargetPercent: stage >= 2 ? 60 : 50, touchesTarget: null }, tempo: 'controlled, clean touches' }), { environment: 'EITHER', notes: `${skillsWristNote} Targets are coaching goals. Measure clean touches without sacrificing control. Eyes-up percentage needs video sampling or an observer; mark self-ratings as estimates.`, indoorSwap: { exerciseId: ex('SH07').id, targetSets: makeSets(n, { seconds: p.handlingSec, restSec: 30, rpe: 2, loadRule: 'skill' }), notes: 'No-stick scan and decision rehearsal when wrist symptoms prevent handling. Do not log puck touches for this alternative.' } }));
  addSession(week, date, 'optional-handling', 'Optional short controlled hands and scanning', 'skills', rows, { warmup: [block('MO08', 60, { note: 'Symptom check and comfortable motion.' })], cooldown: [block('MO16', 60, { note: 'Record actual wrist response.' })], optional: true, budgetMin: 12, rpe: 3, environment: 'EITHER', notes: 'Separate short optional practice, not an extension required to complete the gym session. Keep it away from fatigue and stop while control is good.', activationRule: { wristTolerated: true, defaultIfSymptomatic: 'No-stick scan drill', requiresClinicianRestrictionsRespected: true } });
}

function shooting(week, p, date) {
  const total = p.deload ? Math.max(5, Math.floor(p.shots / 2 / 5) * 5) : p.shots;
  const codes = p.key === 'preparation' ? ['SH01'] : p.key === 'foundation' ? ['SH01', 'SH03'] : p.key === 'strength' ? ['SH01', 'SH02', 'SH03'] : ['SH02', 'SH04', 'SH03', 'SH05'];
  const groups = Array.from({ length: total / 5 }, (_, i) => ({ code: codes[i % codes.length], zone: ZONES[i % ZONES.length] }));
  const rows = codes.map(code => {
    const own = groups.filter(x => x.code === code);
    if (!own.length) return null;
    const shotType = code === 'SH03' ? 'backhand' : code === 'SH01' ? 'wrist' : 'snap';
    const sets = own.map((g, i) => ({ index: i + 1, reps: 5, secondsBetweenReps: 15, restSec: i === own.length - 1 ? 0 : 45, tempo: 'reset and aim between attempts', rpe: 3, loadRule: 'skill', loadKg: null, metrics: { shotType, shots: 5, targetZone: g.zone, accuracyGoalPercent: p.key === 'preparation' ? 50 : 60, shotSpeedKmh: null, releaseTimeSec: null }, planningExecutionSec: 75 }));
    const swaps = makeSets(own.length, { seconds: 45, restSec: 45, rpe: 2, loadRule: 'skill', metrics: { shots: 0, accuracyApplicable: false } });
    return row(code, 'skill', sets, { environment: 'OUTDOOR', setupSec: 45, notes: `${skillsWristNote} Five shots per set, 15 seconds between attempts. Use the named target and record actual hits. Accuracy goal is provisional coaching guidance. ${code === 'SH05' ? 'Only use a safe partner/rebounder pass; otherwise rehearse receiving and release footwork without a puck.' : ''}`, indoorSwap: { exerciseId: ex('SH06').id, targetSets: swaps, notes: 'Rehearse the matching stance, weight transfer and release sequence without a shot. This preserves movement practice, not target accuracy. Log duration/repetitions with zero actual shots.' } });
  }).filter(Boolean);
  addSession(week, date, 'optional-shooting', `Optional target and release practice: ${total} planned shots`, 'skills', rows, { warmup: skillWarmup(), cooldown: skillCooldown(), optional: true, budgetMin: 30, rpe: 3, environment: 'OUTDOOR', gameOverride: true, mutuallyExclusiveGroup: `saturday-option:${date}`, notes: `Only actual safe shooting counts toward shots or accuracy. ${skillsWristNote} In rain, darkness or an unsuitable space, use each listed indoor rehearsal instead. This optional block is omitted on game days.`, indoorSwap: { title: 'Indoor release footwork and scanning', exerciseId: ex('SH06').id, notes: 'Use each exercise-specific indoor set list. No shots, speed or accuracy are fabricated.' }, activationRule: { requiresDrySafeArea: true, requiresDaylightOrLighting: true, requiresSafeBackstop: true, wristTolerated: true, noGameToday: true, doseAdvancesOnlyAfterTwoSymptomStableSessions: true } });
}

function optionalConditioning(week, p, date) {
  if (p.deload || week.testing || ['preparation', 'tryout-window'].includes(p.key)) return;
  let code, sets, title, note;
  if (p.key === 'foundation') {
    code = 'CN01'; sets = makeSets(1, { seconds: 1080, restSec: 0, rpe: 3, loadRule: 'conditioning' }); title = 'Optional easy aerobic replacement';
    note = 'Use this only instead of the optional Saturday skill module or a missed easy skate. Eighteen minutes at conversational effort, plus the listed warm-up and cool-down, fits the complete 30-minute budget; it is not HIIT.';
  } else if (p.key === 'strength') {
    code = 'CN02'; sets = makeSets(1, { rounds: 3, workSec: 180, recoverySec: 120, restSec: 0, rpe: 7, loadRule: 'conditioning', recoveryRpe: 2 }); title = 'Optional aerobic intervals if skating load is lower';
    note = 'Three rounds of 3 minutes at RPE 7, with 2 minutes easy between rounds. Use only when Saturday ice is cancelled or genuinely easy and no game is close.';
  } else if (p.key === 'strength-power') {
    const rounds = week.number < 22 ? 6 : 8;
    code = 'CN03'; sets = makeSets(1, { rounds, workSec: 6, recoverySec: 54, restSec: 0, rpe: 9, loadRule: 'conditioning', recoveryRpe: 1 }); title = 'Optional short bike-power replacement';
    note = `${rounds} six-second crisp efforts with 54 seconds easy between them. Stop when output or technique drops. This replaces a missed demanding skate; it is not added to the usual five-skate week.`;
  } else if (p.key === 'tryout-preparation' || p.key === 'preseason') {
    const work = p.key === 'preseason' ? 20 : 15, recovery = p.key === 'preseason' ? 40 : 45;
    code = 'CN04'; sets = makeSets(2, { rounds: 4, workSec: work, recoverySec: recovery, restSec: 120, rpe: 8, loadRule: 'conditioning', recoveryRpe: 1 }); title = 'Optional repeated-burst conditioning replacement';
    note = `Two sets of four rounds: ${work} seconds work and ${recovery} seconds easy between rounds, with 120 seconds easy between sets. Omit within seven days of tryouts and when normal hard ice has already supplied the week's conditioning.`;
  } else {
    code = 'CN02'; sets = makeSets(1, { rounds: 3, workSec: 120, recoverySec: 120, restSec: 0, rpe: 7, loadRule: 'conditioning', recoveryRpe: 2 }); title = 'Optional conditioning after missed skating';
    note = 'Three rounds of 2 minutes at RPE 7 with 2 minutes easy between. Only when at least two skating sessions were missed and no game is within 48 hours.';
  }
  addSession(week, date, 'optional-conditioning', title, 'conditioning', [row(code, 'conditioning', sets, { setupSec: 30, notes: note })], { optional: true, budgetMin: 30, rpe: code === 'CN01' ? 3 : 7, warmup: [block('CN01', 300, { note: 'Five minutes easy, gradually raise cadence, relaxed hands.' })], cooldown: [block('CN01', 300, { note: 'Five minutes very easy.' })], gameOverride: true, mutuallyExclusiveGroup: `saturday-option:${date}`, notes: `${note} Choose either this module or optional skills. Never complete both to make up missed work.`, activationRule: { maximumExtraIntervalSessionsPerWeek: 1, replacesMeaningfulIceLoad: true, normalFiveSkateWeekDefault: 'Skip', noGameWithin48Hours: true, noTryoutWithin7Days: true, normalReadinessAndSymptoms: true } });
}

function testStrengthRow(code, week) {
  return row(code, 'test', strengthSets(1, 5, week.number === 1 ? 7 : 7.5, 0, 'calibrate'), {
    setupSec: 45, rampUpSets: [ramp(5, 0.4, 60), ramp(3, 0.6, 90), ramp(2, 0.8, 120)], preWorkRestSec: 180,
    testProtocolId: protocol('TS06').id, testReferenceExerciseId: ex(code).id,
    notes: 'Submaximal reference only: one set of five at RPE 7-8 with 2-3 repetitions in reserve. Three easy ramp sets, then 3 minutes before the reference. Save actual load/repetitions/RPE and exact variant. Epley is an estimate, not a measured maximum. Defer if symptoms or fatigue distort technique.'
  });
}
function testingTuesday(week, p, date) {
  const rows = [testStrengthRow('ST09', week), testStrengthRow('ST10', week), row('CO01', 'core', makeSets(1, { reps: 6, sides: 2, restSec: 0, tempo: '2-1-1-1', rpe: 4, loadRule: 'bodyweight' })), row('CN01', 'conditioning', makeSets(1, { seconds: 300, restSec: 0, rpe: 2, loadRule: 'conditioning' }), { notes: 'Five-minute easy bike warm-up before the fixed-load reference.' }), row('TS13', 'test', makeSets(1, { seconds: 360, restSec: 60, rpe: 3.5, loadRule: 'conditioning', metrics: { fixedBaselineWatts: null, cadenceRpm: null, finalMinuteHeartRate: null, recoveryHeartRate60Sec: null } }, 60), { testProtocolId: protocol('TS13').id, notes: 'Six minutes at the same previously calibrated RPE 3-4 workload, followed by a 60-second heart-rate recovery observation. At baseline choose and save the workload, cadence and bike. If no monitor, leave heart rate blank.' })];
  addSession(week, date, 'test-upper-cycle', `${week.number === 1 ? 'Baseline' : 'Retest'}: comfortable strength and submax bike`, 'testing', rows, { warmup: upperWarmup(), cooldown: cooldown('upper'), rpe: 6, notes: 'These references replace Tuesday training. They are not maximal tests. Keep the same equipment and protocol; postpone an affected lift rather than force the wrist.' });
}
function testWarmup() {
  return [block('CN06', 300, { note: 'Five minutes of brisk walking or easy jogging on a dry safe surface.' }), block('ST17', 100, { reps: 5, sides: 2, note: 'Five reverse/split lunges per side plus eight comfortable bodyweight squats.' }), block('MO01', 60, { reps: 8, sides: 2, note: 'Eight ankle rocks per side.' }), block('MO03', 60, { reps: 6, sides: 2, note: 'Six adductor shifts per side.' }), block('SP02', 240, { reps: 3, note: 'Three progressive 20 m runs at approximately 60%, 75% and 90%, with 60 seconds recovery and setup.' }), block('PW01', 40, { reps: 2, contacts: 4, note: 'Two submaximal practice broad jumps with stable landings: four foot contacts.' }), block('TS09', 40, { reps: 2, contacts: 4, note: 'Two submaximal hands-on-hips vertical practice jumps: four foot contacts.' }), block('SP04', 60, { reps: 2, note: 'One half-speed course in each direction, only if wrist-safe. Omit hand-touch practice if symptomatic.' })];
}
function testingWednesday(week, p, date) {
  const rows = [
    row('TS01', 'test', makeSets(3, { reps: 1, contacts: 2, restSec: 90, rpe: 9, loadRule: 'speed' }), { testProtocolId: protocol('TS01').id, notes: 'Three valid attempts; nearest heel, arm swing allowed, stable two-second landing. Each two-foot landing is two foot contacts. Record all results.' }),
    row('TS09', 'test', makeSets(3, { reps: 1, contacts: 2, restSec: 60, rpe: 9, loadRule: 'speed' }), { testProtocolId: protocol('TS09').id, notes: 'Hands on hips. Each two-foot landing is two foot contacts. Keep the same measurement device and method.' }),
    row('TS03', 'test', makeSets(3, { distanceM: 20, restSec: 180, rpe: 9, loadRule: 'speed', planningExecutionSec: 8, metrics: { splitDistancesM: [10, 20], timeSec: null, split10mSec: null } }), { setupSec: 60, testProtocolId: protocol('TS03').id, linkedTestProtocolIds: [protocol('TS02').id, protocol('TS03').id], notes: 'Three 20 m trials with 3 minutes recovery. Where video/gates allow it, save both 10 m and 20 m splits from the same runs. Do not add three extra 10 m sprints. Same standing start and timing definition each retest.' }),
    row('TS10', 'test', Array.from({ length: 6 }, (_, i) => ({ index: i + 1, reps: 1, contacts: 1, restSec: i === 5 ? 0 : 60, rpe: 8, loadRule: 'speed', loadKg: null, side: i % 2 ? 'left' : 'right' })), { testProtocolId: protocol('TS10').id, notes: 'Three valid trials per side, alternating sides. Hands on hips; land on the same leg and hold two seconds.' }),
    row('TS04', 'test', Array.from({ length: 4 }, (_, i) => ({ index: i + 1, distanceM: 18.288, restSec: i === 3 ? 0 : 180, rpe: 8, loadRule: 'speed', loadKg: null, direction: i % 2 ? 'right-first' : 'left-first', planningExecutionSec: 8 })), { setupSec: 60, testProtocolId: protocol('TS04').id, optional: true, activationRule: { handTouchWristTolerated: true }, notes: 'Optional wrist-tolerated test, not required for completing the battery. Outer lines 4.572 m from centre; full route 18.288 m. Two valid attempts each starting direction. If a hand touch hurts, defer; a no-hand course needs its own labelled baseline.' })
  ];
  addSession(week, date, 'test-speed-jumps', `${week.number === 1 ? 'Baseline' : 'Retest'}: jumps, acceleration and change of direction`, 'testing', rows, { warmup: testWarmup(), cooldown: cooldown(), environment: 'OUTDOOR', rpe: 7, notes: 'This battery replaces Wednesday strength/speed. Dry, stable surface and adequate run-off are required. The ten- and twenty-metre times can come from the same three runs. Record context after hard Monday practice; defer to a recovered day if needed and replace that day\'s workout.', indoorSwap: { title: 'Defer outdoor tests; comfortable mobility', exerciseId: ex('MO02').id, notes: 'Postpone timed runs if no safe indoor course exists. Indoor jump results on a different surface are a separate protocol. Do not create sprint or jump scores from a substitute workout.' } });
}
function testingFriday(week, p, date) {
  const rows = [testStrengthRow('ST02', week), testStrengthRow('ST01', week), row('ST15', 'accessory', makeSets(1, { seconds: 10, sides: 2, restSec: 0, rpe: 5, loadRule: 'bodyweight' })), row('CO02', 'core', makeSets(1, { seconds: 20, sides: 2, restSec: 0, rpe: 5, loadRule: 'bodyweight' })), row('CN01', 'conditioning', makeSets(1, { seconds: 600, restSec: 0, rpe: 3, loadRule: 'conditioning' }), { notes: 'Easy conversational pace after the reference sets.' })];
  addSession(week, date, 'test-lower-reference', `${week.number === 1 ? 'Baseline' : 'Retest'}: lower-body submaximal references`, 'testing', rows, { warmup: lowerWarmup(), cooldown: cooldown(), rpe: 6, notes: 'One controlled reference set per main lift replaces the usual Friday working sets. Use the same comfortable bar/handle settings. If the wrist prevents a lift, record a separately named leg-press baseline instead. If Saturday is a game, defer reference sets rather than add fatigue.', gameOverride: true, gameOverrideDetails: { condition: 'Saturday game or important trial', action: 'Defer the reference sets to a recovered day and replace its normal work; use a short primer or rest today.' } });
}
function skillTesting(week, p, date) {
  const rows = [row('TS07', 'test', makeSets(2, { seconds: 30, restSec: 60, rpe: 3, loadRule: 'skill', metrics: { touches: null, errors: null, eyesUpPercent: null } }), { setupSec: 30, rampUpSets: [{ seconds: 60, restSec: 60, loadKg: null, loadRule: 'skill' }], testProtocolId: protocol('TS07').id, notes: 'Optional symptom-limited reference: same object, stick, floor and markers 30 cm apart. Record clean touches and errors, not speed at the expense of control.', indoorSwap: { exerciseId: ex('SH07').id, targetSets: makeSets(2, { seconds: 30, restSec: 60, rpe: 2, loadRule: 'skill' }), notes: 'If wrist symptoms prevent handling, use no-stick scanning. This does not produce a comparable handling-test result.' } }), row('TS08', 'test', ZONES.map((zone, i) => ({ index: i + 1, reps: 5, secondsBetweenReps: 15, restSec: i === 4 ? 0 : 60, rpe: 3, loadRule: 'skill', loadKg: null, planningExecutionSec: 75, metrics: { shotType: 'wrist', shots: 5, targetZone: zone, shootingDistanceM: 3, actualHits: null } })), { environment: 'OUTDOOR', setupSec: 60, rampUpSets: [{ reps: 5, secondsBetweenReps: 15, restSec: 60, loadKg: null, loadRule: 'skill', planningExecutionSec: 75 }], testProtocolId: protocol('TS08').id, optional: true, notes: 'Five non-counted warm-up shots, then five at each of five fixed targets: 25 counted attempts. Fifteen seconds between shots, 60 seconds between groups. Same safe distance, target sizes and shot type. Only perform when wrist-tolerated and the shooting setup is safe.', indoorSwap: { exerciseId: ex('SH06').id, targetSets: makeSets(5, { seconds: 30, restSec: 30, rpe: 2, loadRule: 'skill', metrics: { shots: 0, accuracyApplicable: false } }), notes: 'Dry release rehearsal. Defer actual shooting accuracy testing; no attempts or hits are recorded for this swap.' } })];
  addSession(week, date, 'optional-skill-reference', 'Optional wrist-tolerated skill references', 'testing', rows, { warmup: skillWarmup(), cooldown: skillCooldown(), optional: true, budgetMin: 30, environment: 'EITHER', rpe: 3, gameOverride: true, mutuallyExclusiveGroup: `saturday-option:${date}`, notes: 'Replaces optional Saturday skill practice, not an extra session. Grip and wrist strength max tests are not scheduled. A shortened symptom-limited sample records its actual attempts and is not silently compared with a full protocol.', activationRule: { wristTolerated: true, noGameToday: true, shootingRequiresSafeArea: true } });
}

function skating(week, date, day) {
  const roller = day === 3;
  const labels = { 0: ['Hard evening ice', 8], 3: ['Light roller practice', 3], 4: ['Light evening ice', 3], 5: ['Medium ice or game', 5], 6: ['Light evening ice', 3] };
  const [title, rpe] = labels[day];
  addSession(week, date, roller ? 'roller' : `ice-${day}`, title, roller ? 'roller' : 'ice', [row(roller ? 'IC02' : 'IC01', 'conditioning', makeSets(1, { seconds: 3600, restSec: 0, rpe, loadRule: 'conditioning' }), { setupSec: 0, notes: 'Duration and RPE are editable planning placeholders. Record actual session duration and overall RPE after practice. Do not equate full rink-session minutes with active match time on ice.' })], { rpe, transitionSec: 0, environment: 'INDOOR', provisionalDuration: true, timeOfDay: 'Evening', notes: `${day === 5 ? 'If this is a game, replace the practice description with the actual game and activate the Friday/Sunday overrides. ' : ''}Planned 60 minutes is provisional. ${day === 0 ? 'No gym is scheduled on Monday.' : ''} This is the existing team session, not an additional prescribed workout.` });
}
function travelSession(week, date) {
  const rows = [row('CN06', 'conditioning', makeSets(1, { seconds: 480, restSec: 0, rpe: 2, loadRule: 'conditioning' }), { setupSec: 0 }), row('MO01', 'mobility', makeSets(1, { reps: 8, sides: 2, restSec: 0, tempo: '2-0-1-0', rpe: 2, loadRule: 'mobility' }), { setupSec: 15 }), row('MO02', 'mobility', makeSets(1, { reps: 6, sides: 2, restSec: 0, tempo: '3-1-1-0', rpe: 2, loadRule: 'mobility' }), { setupSec: 15 }), row('MO15', 'mobility', makeSets(1, { seconds: 30, sides: 2, restSec: 0, rpe: 2, loadRule: 'mobility' }), { setupSec: 15 })];
  addSession(week, date, 'optional-holiday-movement', 'Optional holiday walk and comfortable mobility', 'mobility', rows, { optional: true, budgetMin: 15, rpe: 2, environment: 'EITHER', notes: 'Holiday means no mandatory training. This equipment-free option can be skipped completely. No catch-up workouts on return.' });
}

for (let number = 1; number <= 52; number++) {
  const specIndex = phaseSpecs.findIndex(p => number >= p.start && number <= p.end);
  const base = phaseSpecs[specIndex];
  const deload = number >= 8 && (number - 4) % 4 === 0;
  const testing = TEST_WEEKS.has(number);
  const p = { ...base, deload };
  const startDate = addDays(CALENDAR_START, (number - 1) * 7), endDate = addDays(startDate, 6);
  const holidayWeek = number === 3 || number === 4;
  const volumeFactor = holidayWeek ? 0 : deload ? 0.5 : testing ? 0.65 : number === 2 ? 0.65 : number === 5 ? 0.6 : 1;
  const week = record(`week:${number}`, {
    number, startDate, endDate, phaseId: phases[specIndex].id,
    deload, testing, holiday: holidayWeek,
    focus: holidayWeek ? 'Holiday recovery; optional comfortable movement only.' : `${testing ? 'Comparable testing replaces normal training. ' : ''}${deload ? 'Reduce sets and skill volume; keep movement quality. ' : ''}${base.focus}`,
    volumeFactor, targetRpe: deload ? 6 : p.mainRpe,
    volumeTrend: holidayWeek ? 'No mandatory training' : deload ? 'Approximately half working sets' : testing ? 'Reduced training; assessments replace working blocks' : number === 5 ? 'Gradual return after holiday' : 'Stable or gradually progressed from actual completed logs',
    intensityRange: deload ? 'RPE 5-6, comfortable loads' : base.intensity,
    loadedWeekSinceHoliday: number >= 5 ? number - 4 : number <= 2 ? number : null,
    testingProtocolIds: testing ? ['TS01', 'TS02', 'TS03', 'TS04', 'TS06', 'TS07', 'TS08', 'TS09', 'TS10', 'TS13'].map(code => protocol(code).id) : [],
    notes: number === 1 ? 'Partial first week; no mandatory activity before 24 November.' : number === 2 ? 'Holiday starts Saturday 5 December; weekend sessions are removed.' : number === 4 ? 'Sunday 20 December is a return/rest day. Normal skating resumes Monday 21 December.' : 'If the actual game or team schedule changes, move or omit work without stacking catch-up sessions.'
  });
  weeks.push(week);
  for (let day = 0; day < 7; day++) {
    const date = addDays(startDate, day);
    if (date < START) continue;
    if (!normalTrainingDate(date)) {
      if ([1, 3, 6].includes(day)) travelSession(week, date);
      continue;
    }
    if ([0, 3, 4, 5, 6].includes(day)) skating(week, date, day);
    if (day === 1) {
      testing ? testingTuesday(week, p, date) : upperTuesday(week, p, date);
      if (!testing) handling(week, p, date);
    }
    if (day === 2) testing ? testingWednesday(week, p, date) : lowerWednesday(week, p, date);
    if (day === 3) thursdayMobility(week, date);
    if (day === 4) testing ? testingFriday(week, p, date) : lowerFriday(week, p, date);
    if (day === 5) {
      testing ? skillTesting(week, p, date) : shooting(week, p, date);
      optionalConditioning(week, p, date);
    }
    if (day === 6) upperSunday(week, p, date);
  }
  const weekSessions = sessions.filter(s => s.weekId === week.id);
  week.plannedSessionCount = weekSessions.length;
  week.mandatoryGymSessionCount = weekSessions.filter(s => !s.optional && ['strength', 'testing'].includes(s.kind)).length;
  week.optionalSessionCount = weekSessions.filter(s => s.optional).length;
  week.plannedGymMinutes = weekSessions.filter(s => !s.optional && ['strength', 'testing'].includes(s.kind)).reduce((n, s) => n + s.durationMin, 0);
  week.plannedProvisionalSkatingMinutes = weekSessions.filter(s => ['ice', 'roller'].includes(s.kind)).reduce((n, s) => n + s.durationMin, 0);
}

const sources = [
  ['lignell-2018', 'NHL match movement demands', 'https://pubmed.ncbi.nlm.nih.gov/28557852/', 'Primary observational study; 36 male NHL players, one game. Demands are descriptive, not training targets.'],
  ['brocherie-2018', 'Active versus elapsed shift time', 'https://pubmed.ncbi.nlm.nih.gov/30449944/', 'Primary observational study; ten elite male players in one international game.'],
  ['daehlin-2017', 'Combined strength and plyometric training', 'https://pubmed.ncbi.nlm.nih.gov/27918670/', 'Small randomised hockey study; supports combined qualities, not copying five weekly lifting sessions.'],
  ['vigh-larsen-2022', 'On-ice speed-endurance intervention', 'https://pubmed.ncbi.nlm.nih.gov/35894877/', 'Youth national-team crossover study. Extra intervals here are conditional replacement work.'],
  ['tyler-2002', 'Adductor-strengthening intervention in hockey', 'https://pubmed.ncbi.nlm.nih.gov/12239001/', 'One NHL team with historical controls, not a randomised Copenhagen hockey trial.'],
  ['haroy-2019', 'Adductor programme in male football', 'https://pubmed.ncbi.nlm.nih.gov/29891614/', 'Football cluster trial. Application to hockey is explicitly an extrapolation.'],
  ['zourdos-2016', 'Repetitions-in-reserve RPE', 'https://pubmed.ncbi.nlm.nih.gov/26049792/', 'RPE 10 = zero RIR, 9 = one RIR, 8 = two RIR; estimates require practice.'],
  ['foster-2001', 'Session-RPE monitoring', 'https://pubmed.ncbi.nlm.nih.gov/11708692/', 'Whole-session RPE multiplied by duration is a descriptive within-athlete monitoring tool.'],
  ['impellizzeri-2020', 'Limitations of acute:chronic workload ratios', 'https://pubmed.ncbi.nlm.nih.gov/32502973/', 'No validated safe zone or individual injury prediction is assigned.'],
  ['petre-2024', 'Acute HIIT effects on hockey power performance', 'https://pubmed.ncbi.nlm.nih.gov/38608001/', 'Fifteen elite female players; supports preserving fresh power work, not a universal recovery deadline.'],
  ['iihf-training', 'IIHF seasonal training guidance', 'https://blob.iihf.com/iihf-media/iihfmvc/media/downloads/sport%20files/development-guide/physical-development/iihf_physical_development_training_season.pdf', 'Official coaching guidance. Exact dates, sets and dose choices in SHIFT are individual coaching decisions.']
].map(([key, title, url, limitation]) => record(`source:${key}`, { title, url, limitation, type: key === 'iihf-training' ? 'official-coaching-guidance' : 'research', accessedDate: '2026-11-24' }));

const output = {
  schemaVersion: 1, generatedAt: seededAt,
  plan, phases, weeks, sessions, session_exercises,
  exercises, testProtocols, sources,
  users: [], set_logs: [], skill_logs: [], test_results: [], wellness_logs: [], personal_records: [], sync_queue: []
};

// Validate the expanded deliverable rather than hoping templates will fit.
function validate() {
  const entityTables = ['plan', 'phases', 'weeks', 'sessions', 'session_exercises', 'exercises', 'testProtocols', 'sources'];
  const ids = new Set();
  for (const table of entityTables) for (const item of output[table]) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.id)) throw new Error(`Invalid UUID in ${table}.`);
    if (ids.has(item.id)) throw new Error(`Duplicate entity ID ${item.id}.`);
    ids.add(item.id);
    if (!item.createdAt || !item.updatedAt || typeof item.deleted !== 'boolean') throw new Error(`Missing sync metadata in ${table}: ${item.id}.`);
  }
  if (weeks.length !== 52 || weeks[0].startDate !== CALENDAR_START || weeks.at(-1).endDate !== END) throw new Error('Calendar is not the exact 52-week requested range.');
  const sessionMap = new Map(sessions.map(s => [s.id, s]));
  const allExerciseIds = new Set(exercises.map(e => e.id));
  const knownRules = new Set(Object.keys(progressionRules));
  for (const s of sessions) {
    if (s.date < START || s.date > END) throw new Error(`Session outside plan dates: ${s.date}.`);
    if (holiday(s.date) && !s.optional) throw new Error(`Mandatory holiday session: ${s.date}.`);
    const day = (new Date(`${s.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (day === 0 && ['strength', 'testing'].includes(s.kind)) throw new Error(`Monday gym session: ${s.date}.`);
    if (!['ice', 'roller'].includes(s.kind) && s.durationMin > 60) throw new Error(`Session exceeds 60 minutes: ${s.title}.`);
    if (day === 3 && !['ice', 'roller'].includes(s.kind) && s.durationMin > 20) throw new Error(`Thursday exceeds 20 minutes: ${s.date}.`);
    for (const b of [...s.warmup, ...s.cooldown]) if (!allExerciseIds.has(b.exerciseId)) throw new Error('Unknown warm-up/cool-down exercise.');
  }
  for (const r of session_exercises) {
    if (!sessionMap.has(r.sessionId) || !allExerciseIds.has(r.exerciseId)) throw new Error('Broken exercise-session relationship.');
    if (!r.targetSets.length) throw new Error('Empty exercise target.');
    for (const [i, t] of r.targetSets.entries()) {
      if (t.index !== i + 1 || t.restSec < 0 || !knownRules.has(t.loadRule)) throw new Error(`Invalid target set in ${r.id}.`);
      if (t.loadKg !== null) throw new Error('A baseline working kg was fabricated.');
      if (!['reps', 'seconds', 'distanceM', 'rounds'].some(k => Number(t[k]) > 0)) throw new Error('Target set has no exact work dose.');
    }
    for (const option of r.equipmentOptions || []) {
      if (!allExerciseIds.has(option.exerciseId) || !option.targetSets?.length) throw new Error('Invalid explicit equipment alternative.');
      if (option.estimatedBlockMin > r.estimatedBlockMin + 0.01) throw new Error('Equipment alternative exceeds its reserved time slot.');
      for (const [i, t] of option.targetSets.entries()) {
        if (t.index !== i + 1 || t.restSec < 0 || !knownRules.has(t.loadRule) || t.loadKg !== null) throw new Error('Invalid equipment alternative target.');
        if (!['reps', 'seconds', 'distanceM', 'rounds'].some(k => Number(t[k]) > 0)) throw new Error('Equipment alternative has no measurable dose.');
      }
    }
    const exercise = exercises.find(e => e.id === r.exerciseId);
    if ((exercise.code.startsWith('SH') && !['SH06', 'SH07'].includes(exercise.code) || exercise.code === 'TS08') && !r.indoorSwap) throw new Error(`Outdoor shooting is missing its indoor swap: ${exercise.code}.`);
    if (['SK09', 'SK10', 'TS11', 'TS12'].includes(exercise.code)) throw new Error(`Initially locked exercise was automatically scheduled: ${exercise.code}.`);
  }
  for (const w of weeks) {
    const extra = sessions.filter(s => s.weekId === w.id && s.templateId === 'optional-conditioning');
    if (extra.length > 1) throw new Error(`More than one optional conditioning module in week ${w.number}.`);
    if ((w.testing || w.deload) && extra.length) throw new Error('Extra intervals scheduled in a test/deload week.');
  }
  const encoded = JSON.stringify(output, null, 2);
  if (encoded.includes('\u2014')) throw new Error('An em dash entered the programme.');
  return encoded;
}

const encoded = validate();
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'programme.json'), `${encoded}\n`);
const gym = sessions.filter(s => !s.optional && ['strength', 'testing'].includes(s.kind));
console.log(JSON.stringify({ file: 'public/data/programme.json', weeks: weeks.length, sessions: sessions.length, exerciseRows: session_exercises.length, workingTargets: session_exercises.reduce((n, r) => n + r.targetSets.length, 0), maximumGymMinutes: Math.max(...gym.map(s => s.durationMin)), firstDate: START, lastDate: END, deloadWeeks: weeks.filter(w => w.deload).map(w => w.number), testWeeks: weeks.filter(w => w.testing).map(w => w.number) }, null, 2));
