// Keep power, machine settings and measured sprint results in their own units.
export const powerMetric = exercise => exercise.powerMetric || (['PW05','PW07'].includes(exercise.code) ? 'throw' : exercise.code === 'PW06' ? 'loadedJump' : 'jump');
const positive = (value, label, integer = false) => {
  if (!Number.isFinite(value) || value <= 0 || integer && !Number.isInteger(value)) throw new Error(`Enter a valid ${label}.`);
  return value;
};
const optionalNumber = value => Number.isFinite(value) ? value : null;

export function powerRecord(exercise, values) {
  const metric = powerMetric(exercise);
  const row = {kind:'power', powerMetric:metric, distanceCm:optionalNumber(values.distanceCm), heightCm:optionalNumber(values.heightCm)};
  if (metric === 'throw') {
    const reps = positive(values.reps,'throw count',true), sides = values.sides === 2 ? 2 : 1;
    return {...row,reps,sides,throwCount:reps*sides,loadKg:positive(values.loadKg,'medicine-ball mass'),contacts:0,heightCm:null};
  }
  if (metric === 'loadedJump') {
    const reps = positive(values.reps,'jump count',true);
    return {...row,reps,contacts:reps*2,loadKg:positive(values.loadKg,'total trap-bar mass')};
  }
  return {...row,contacts:positive(values.contacts,'foot-contact count',true),loadKg:null};
}

export function machineRecord(exercise, values) {
  if (!['machineSpeed','machineStrength'].includes(exercise.loggingMode)) throw new Error('This exercise is not a machine-setting entry.');
  const resistanceSetting=String(values.resistanceSetting||'').trim(), resistanceUnit=String(values.resistanceUnit||'').trim();
  if (!resistanceSetting || !resistanceUnit) throw new Error('Record the displayed resistance setting and its unit or label.');
  const row={kind:exercise.loggingMode,loadKg:null,resistanceSetting,resistanceUnit,watts:optionalNumber(values.watts),rpe:optionalNumber(values.rpe)};
  if (exercise.loggingMode==='machineSpeed') return {...row,seconds:positive(values.seconds,'bout duration'),restSec:optionalNumber(values.restSec)};
  return {...row,reps:positive(values.reps,'repetition count',true)};
}

export function compatibleDose(original, alternative) {
  return original.category===alternative.category && original.movementPattern===alternative.movementPattern
    && (original.loggingMode||'')===(alternative.loggingMode||'')
    && (original.category!=='power'||powerMetric(original)===powerMetric(alternative));
}

export function applyEquipmentChoice(prescription, option, exercise, variant, confirmed = false) {
  const row={...prescription,originalExerciseId:prescription.originalExerciseId||prescription.exerciseId,
    exerciseId:exercise.id,variant,role:option.role||prescription.role,
    targetSets:structuredClone(option.targetSets||prescription.targetSets).map(t=>({...t,loadKg:null})),
    rampUpSets:structuredClone(option.rampUpSets||[]),
    notes:option.notes||prescription.notes,environment:exercise.environment||prescription.environment,
    loadConvention:exercise.loadConvention,equipmentConfirmed:!!confirmed};
  for (const key of ['setupSec','preWorkRestSec','estimatedBlockMin','repRange']) if(option[key]!==undefined) row[key]=structuredClone(option[key]);
  if (row.testReferenceExerciseId) row.testReferenceExerciseId=exercise.id;
  // A selected equipment option has its own dose, rather than an old weather swap.
  delete row.indoorSwap;
  if (exercise.loggingMode) row.targetSets=row.targetSets.map(t=>({...t,loadRule:'calibrate',loadKg:null}));
  if (!exercise.wristSensitive) delete row.symptomGate;
  return row;
}
