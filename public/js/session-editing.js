import {applyAlternative} from './alternatives.js';
import {blockHasHistory,estimateBlock} from './workout-builder.js';

export function replacementRecords(session, prescription, option, exercise, variant, confirmed, logs, newId) {
  if(session.status!=='planned')throw new Error('Reopen this session before changing its exercises.');
  const next=applyAlternative(prescription,option,exercise,variant,confirmed);
  next.skipped=false;next.skipReason=null;
  const previous={exerciseId:prescription.exerciseId,role:prescription.role,targetSets:prescription.targetSets,rampUpSets:prescription.rampUpSets||[],notes:prescription.notes||''};
  for(const key of ['setupSec','estimatedBlockMin','preWorkRestSec','repRange','testProtocolId','linkedTestProtocolIds','testReferenceExerciseId','indoorSwap','symptomGate'])if(prescription[key]!==undefined)previous[key]=structuredClone(prescription[key]);
  next.equipmentOptions=[previous,...(prescription.equipmentOptions||[]).filter(o=>o.exerciseId!==prescription.exerciseId)];
  next.estimatedBlockMin=option.estimatedBlockMin??estimateBlock(next.targetSets);
  if(!blockHasHistory(prescription,logs))return [next];
  // Keep the entire recorded block, including tombstones, for history. Continue
  // this workout in a new block rather than relabelling an existing set.
  const kept={...prescription,skipped:true,skipReason:'Continued with '+exercise.name};
  for(const key of ['createdAt','updatedAt','changeId','deleted'])delete next[key];
  next.id=newId;next.order=prescription.order+0.01;next.replacesSessionExerciseId=prescription.id;
  return [kept,next];
}

export function reopenSession(session) {
  return {...session,status:'planned',completedAt:null,actualDurationMin:null,sessionRpe:null,completionNotes:session.completionNotes||''};
}

export function sessionProgress(blocks, logs, tests=[]) {
  const entries=[...logs,...tests].filter(l=>!l.deleted);
  const done=blocks.filter(block=>entries.some(l=>l.sessionExerciseId===block.id||l.sessionId===block.sessionId&&l.exerciseId===block.exerciseId));
  return {total:blocks.length,logged:done.length,skipped:blocks.filter(b=>b.skipped).length};
}
