import {customTargets, targetMetrics} from './alternatives.js';
import {powerMetric} from './equipment.js';

export const exerciseTypes = {
  strength: {label:'Strength: repetitions and kg', category:'strength', metric:'reps'},
  bodyweight: {label:'Bodyweight / core: repetitions', category:'core', metric:'reps'},
  hold: {label:'Core: timed hold', category:'core', metric:'seconds'},
  mobility: {label:'Mobility: time', category:'mobility', metric:'seconds'},
  conditioning: {label:'Conditioning: time', category:'conditioning', metric:'seconds'},
  skill: {label:'Stickhandling: timed practice', category:'skill', metric:'seconds'},
  speed: {label:'Sprint: metres and time', category:'speed', metric:'distanceM'},
  jump: {label:'Jump: foot contacts', category:'power', metric:'contacts', powerMetric:'jump'},
  throw: {label:'Medicine-ball throw: reps and ball kg', category:'power', metric:'reps', powerMetric:'throw'},
  loadedJump: {label:'Loaded jump: reps and total kg', category:'power', metric:'reps', powerMetric:'loadedJump'},
  machineStrength: {label:'Machine: reps and displayed setting', category:'strength', metric:'reps', loggingMode:'machineStrength'},
  machineSpeed: {label:'Resisted runner: seconds and setting', category:'speed', metric:'seconds', loggingMode:'machineSpeed'}
};
const text = (value, limit=500) => String(value || '').trim().slice(0, limit);
const lines = value => text(value, 4000).split('\n').map(s=>s.trim()).filter(Boolean);

export function makeExercise(values, id, existing=null) {
  const type = exerciseTypes[values.type];
  if (!type || !text(values.name,120)) throw new Error('Enter an exercise name and choose how to log it.');
  if (existing && !existing.custom) throw new Error('Only your own exercises can be edited here.');
  const url = text(values.videoUrl,2000);
  if (url && !/^https?:$/.test(new URL(url).protocol)) throw new Error('Use an http or https video URL.');
  return {...existing, id, custom:true, customType:values.type, code:existing?.code || 'CU'+id.replaceAll('-','').slice(0,8).toUpperCase(),
    name:text(values.name,120), category:type.category, defaultMetric:type.metric, loggingMode:type.loggingMode || null,
    powerMetric:type.powerMetric || null, equipmentConfirmationRequired:!!type.loggingMode,
    equipmentNotes:text(values.setup,1000), environment:['INDOOR','OUTDOOR','EITHER'].includes(values.environment)?values.environment:'EITHER',
    equipment:text(values.equipment,500).split(',').map(s=>s.trim()).filter(Boolean),
    muscles:text(values.muscles,500).split(',').map(s=>s.trim()).filter(Boolean),
    quality:text(values.quality,200) || 'Personal exercise', movementPattern:text(values.pattern,120) || type.category,
    cues:lines(values.cues), mistakes:lines(values.mistakes), regression:text(values.regression), progression:text(values.progression),
    wristSensitive:!!values.wristSensitive, videoUrl:url, loadMultiplier:values.loadMultiplier===2?2:1,
    loadConvention:type.loggingMode?'Record the displayed machine setting and its unit. Do not convert it to kg.':
      type.powerMetric==='throw'?'Record throws and the ball mass in kg. Throws are not foot contacts.':
      type.powerMetric==='loadedJump'?'Record jumps and total bar plus plates in kg. Each bilateral landing is two foot contacts.':
      type.category==='strength'?(values.loadMultiplier===2?'Log kg per dumbbell. Strength volume uses two dumbbells.':'Log total external load in kg.'):
      'Record the prescribed repetitions, time, distance or contacts. No external strength load is assumed.'};
}

export function makeBlock(exercise, values, id) {
  if (!exercise || exercise.deleted || ['test','sport'].includes(exercise.category) || ['SK09','SK10'].includes(exercise.code)) throw new Error('Choose an available training exercise.');
  const targets = customTargets(exercise, values);
  return {id, exerciseId:exercise.id, role:exercise.category, targetSets:targets, rampUpSets:[],
    notes:text(values.notes,2000), environment:exercise.environment, loadConvention:exercise.loadConvention,
    variant:text(values.variant,100) || 'standard', equipmentConfirmed:false,
    setupSec:30, preWorkRestSec:0, estimatedBlockMin:estimateBlock(targets),
    ...(exercise.category==='power'?{powerMetric:powerMetric(exercise)}:{})};
}

export function estimateBlock(targets) {
  // Planning allowance only. Recorded training still uses actual minutes and RPE.
  return Math.ceil((30+targets.reduce((total,t)=>total+(t.seconds?t.seconds*(t.sides||1):t.rounds?t.rounds*(t.workSec||0)+Math.max(0,t.rounds-1)*(t.recoverySec||0):t.distanceM?t.distanceM/2:(t.reps||t.contacts||1)*(t.sides||1)*5)+(t.restSec||0),0))/6)/10;
}

export function workoutRecords(values, blocks, weeks, id, existing=null) {
  if (!text(values.title,150)) throw new Error('Name your workout.');
  if (!blocks.length) throw new Error('Add at least one exercise.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !weeks.some(w=>values.date>=w.startDate&&values.date<=w.endDate)) throw new Error('Choose a date within your training year.');
  if (existing && !existing.customWorkout) throw new Error('Copy this programme session to make your own workout.');
  const kind=['strength','conditioning','skills','mobility'].includes(values.kind)?values.kind:'strength';
  const weekday=new Date(values.date+'T12:00:00Z').getUTCDay();
  if (kind==='strength' && weekday===1) throw new Error('Monday is your no-gym day. Choose another date or workout type.');
  const max=weekday===4?20:60;
  if (!Number.isFinite(values.durationMin)||values.durationMin<5||values.durationMin>max) throw new Error(`Keep this workout between 5 and ${max} minutes, including preparation and cool-down.`);
  if (!Number.isFinite(values.intensityRpe)||values.intensityRpe<1||values.intensityRpe>10) throw new Error('Choose an effort from 1 to 10.');
  const plannedWork=blocks.reduce((total,block)=>total+(Number.isFinite(block.estimatedBlockMin)?block.estimatedBlockMin:estimateBlock(block.targetSets)),0);
  const prep=[...(existing?.warmup||values.warmup||[]),...(existing?.cooldown||values.cooldown||[])];
  const prepMinutes=prep.length?prep.reduce((total,item)=>total+(item.seconds||0)/60,0):5;
  if(plannedWork+prepMinutes>values.durationMin) throw new Error(`Exercise blocks need about ${Math.ceil(plannedWork)} minutes. Allow ${prepMinutes} more for preparation and cool-down, or reduce the targets.`);
  const week=weeks.find(w=>values.date>=w.startDate&&values.date<=w.endDate);
  const session={...existing,id,customWorkout:true,extra:true,optional:true,templateId:existing?.templateId||values.workoutTemplateId||'custom-'+id,
    title:text(values.title,150),date:values.date,weekId:week.id,phaseId:week.phaseId,kind,
    durationMin:values.durationMin,intensityRpe:values.intensityRpe,environment:'EITHER',
    status:existing?.status||'planned',warmup:existing?.warmup||structuredClone(values.warmup||[]),cooldown:existing?.cooldown||structuredClone(values.cooldown||[]),notes:text(values.notes,4000)};
  return {session, prescriptions:blocks.map((block,index)=>({...structuredClone(block),sessionId:id,order:index+1}))};
}

export function blockHasHistory(block, logs) {
  return logs.some(log=>log.sessionExerciseId===block.id || log.sessionId===block.sessionId&&log.exerciseId===block.exerciseId);
}

export function copyBlocks(blocks, newId) {
  return blocks.map(block=>{
    const row=structuredClone(block);
    for (const key of ['sessionId','createdAt','updatedAt','changeId','deleted','equipmentConfirmed']) delete row[key];
    return {...row,id:newId(),equipmentConfirmed:false};
  });
}

export function validateWorkoutEdit(current, originalBlocks, blocks, logs, values) {
  if (!current) return;
  if(current.status==='completed'||current.status==='skipped') throw new Error('Copy this finished or skipped session to create a new workout.');
  for(const old of originalBlocks){
    const next=blocks.find(row=>row.id===old.id);
    if(blockHasHistory(old,logs)&&(!next||JSON.stringify({...next,order:0})!==JSON.stringify({...old,order:0}))) throw new Error('A block now has saved history. Reopen the builder to keep its targets.');
  }
  if(logs.some(log=>log.sessionId===current.id)&&(values.date!==current.date||values.kind!==current.kind)) throw new Error('Keep the date and type of a workout with saved history.');
}

export {targetMetrics};
