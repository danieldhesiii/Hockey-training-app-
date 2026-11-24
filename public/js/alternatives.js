import { compatibleDose, powerMetric, applyEquipmentChoice } from './equipment.js';

// Use the replacement's prescription, never reinterpret the old movement's units.
export function exerciseChoices(prescription, exercises, baseline = []) {
  const original = exercises.find(e => e.id === prescription.exerciseId);
  const choices = new Map();
  const explicit = [...(prescription.equipmentOptions || []), ...(prescription.equipmentSwap ? [prescription.equipmentSwap] : []), ...(prescription.indoorSwap ? [prescription.indoorSwap] : [])];
  for (const option of explicit) {
    const exercise = exercises.find(e => e.id === option.exerciseId && !e.deleted);
    if (exercise && exercise.id !== original.id && option.targetSets?.length) choices.set(exercise.id, {...structuredClone(option), name: exercise.name, suggested: true});
  }
  for (const exercise of exercises.filter(e => !e.deleted && e.id !== original.id && !['sport', 'test'].includes(e.category) && !['SK09', 'SK10'].includes(e.code))) {
    if (choices.has(exercise.id)) continue;
    const candidates = baseline.filter(row => !row.deleted && row.exerciseId === exercise.id && row.targetSets?.length);
    candidates.sort((a, b) => Math.abs((a.estimatedBlockMin || 0) - (prescription.estimatedBlockMin || 0)) - Math.abs((b.estimatedBlockMin || 0) - (prescription.estimatedBlockMin || 0)));
    const source = candidates[0];
    const option = {exerciseId: exercise.id, name: exercise.name, role: exercise.category, suggested: compatibleDose(original, exercise), targetSets: [], rampUpSets: [], notes: 'Personal alternative for this session. Review the targets and use a comfortable effort.'};
    if (source) {
      for (const key of ['targetSets', 'rampUpSets', 'setupSec', 'preWorkRestSec', 'estimatedBlockMin', 'repRange']) if (source[key] !== undefined) option[key] = structuredClone(source[key]);
      const cap = prescription.targetSets?.[0]?.rpe;
      option.targetSets = option.targetSets.map(t => ({...t, loadKg: null, ...(cap ? {rpe: Math.min(t.rpe || cap, cap)} : {})}));
    }
    choices.set(exercise.id, option);
  }
  return choices;
}

export function targetMetrics(exercise) {
  if (exercise.loggingMode === 'machineSpeed') return ['seconds'];
  if (exercise.loggingMode === 'machineStrength') return ['reps'];
  if (exercise.category === 'power') return [powerMetric(exercise) === 'jump' ? 'contacts' : 'reps'];
  if (exercise.category === 'speed') return ['distanceM'];
  if (['conditioning', 'skill'].includes(exercise.category)) return ['seconds'];
  return ['reps', 'seconds'];
}

export function customTargets(exercise, {metric, amount, sets, sides, restSec, rpe}) {
  if (!targetMetrics(exercise).includes(metric)) throw new Error('Choose a target unit supported by this exercise.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 3600 || ['reps', 'contacts'].includes(metric) && !Number.isInteger(amount)) throw new Error('Enter a valid target amount.');
  if (!Number.isInteger(sets) || sets < 1 || sets > 20) throw new Error('Choose between 1 and 20 sets.');
  if (![1, 2].includes(sides) || !Number.isFinite(restSec) || restSec < 0 || restSec > 1200 || !Number.isFinite(rpe) || rpe < 1 || rpe > 10) throw new Error('Check sides, rest and effort.');
  return Array.from({length: sets}, (_, i) => ({index: i + 1, [metric]: amount, sides, restSec: i === sets - 1 ? 0 : restSec, rpe, loadKg: null, loadRule: 'calibrate'}));
}

export function applyAlternative(prescription, option, exercise, variant, confirmed) {
  const row = applyEquipmentChoice(prescription, option, exercise, variant, confirmed);
  // db.save merges records. Explicit empty values clear old metadata in IndexedDB
  // and in sync; deleting properties would leave the previous links in place.
  for (const key of ['testProtocolId', 'testReferenceExerciseId', 'equipmentSwap', 'indoorSwap', 'symptomGate', 'repRange']) row[key] = option[key] ?? null;
  row.linkedTestProtocolIds = option.linkedTestProtocolIds || [];
  row.powerMetric = exercise.category === 'power' ? powerMetric(exercise) : null;
  row.isRehearsal = !!option.isRehearsal;
  row.setupSec = option.setupSec ?? 0;
  row.preWorkRestSec = option.preWorkRestSec ?? 0;
  return row;
}
