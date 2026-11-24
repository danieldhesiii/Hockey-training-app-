import { alive, addDays, weekStart, sum, mean } from './utils.js';

// Transparent coaching heuristics. These are not medical or injury prediction models.
export function readiness(wellness){
 if(!wellness)return {score:null,label:'Check in',tone:'neutral',reasons:['Add today’s sleep and energy to personalise the session.'],reduce:false,wristHold:false};
 const w=wellness, values=[];
 const item=(v,max,weight,invert=false)=>{if(v!==null&&v!==undefined&&Number.isFinite(+v))values.push({score:Math.max(0,Math.min(1,invert?1-v/max:v/max)),weight});};
 item(w.sleepHours,8,30);item(w.energy,5,20);item(w.soreness,10,20,true);item(w.sleepQuality,5,15);item(w.mood,5,15);
 const score=values.length?Math.round(values.reduce((a,v)=>a+v.score*v.weight,0)/sum(values.map(v=>v.weight))*100):null;
 const reasons=[];if(w.sleepHours!=null&&w.sleepHours<6)reasons.push('Under 6 hours of sleep: use the lighter option today.');if(w.soreness>=7)reasons.push('High soreness: reduce loaded sets and skip hard intervals.');if(w.energy&&w.energy<=2)reasons.push('Low energy: prioritise a short, manageable session.');
 const wristHold=!!(w.wristWorse||w.gripLimited);
 if(wristHold)reasons.push('Wrist or grip has worsened: pause additional handling, shooting and painful grip work. Arrange a hand or sports physio review.');
 if(w.illness)reasons.push('Illness reported: no hard exercise. Return when recovered; seek medical advice for concerning symptoms.');
 const reduce=score!==null&&(score<55||w.sleepHours!=null&&w.sleepHours<6||w.soreness>=7)||!!w.illness;
 return {score,label:w.illness?'Recover':reduce?'Ease back':score!==null&&score>=75?'Ready to train':'Build steadily',tone:w.illness||reduce?'amber':'green',reasons,reduce,wristHold,illness:!!w.illness};
}
export const epley=(kg,reps)=>Number.isFinite(kg)&&Number.isFinite(reps)&&kg>0&&reps>0&&reps<=10?kg*(1+reps/30):null;
export function nextTarget(exercise,prescription,data,prefs={}){
 const target=prescription.targetSets?.[0]||{};
 if(exercise.loggingMode)return {loadKg:null,label:'Use the recorded machine setting',reason:'Keep the same machine and displayed unit. Recalibrate to the prescribed effort; machine settings do not earn automatic kilogram increases.',state:'calibrate'};
 const currentSession=data.sessions.find(s=>s.id===prescription.sessionId);
 const currentWeek=data.weeks?.find(w=>w.id===currentSession?.weekId);
 const variant=prescription.variant||prefs.exerciseVariants?.[exercise.id]||'standard';
 const completed=new Map(alive(data.sessions).filter(s=>s.status==='completed'&&s.id!==prescription.sessionId&&(!currentSession?.date||s.date<currentSession.date)).map(s=>[s.id,s]));
 const logs=alive(data.set_logs).filter(l=>l.exerciseId===exercise.id&&completed.has(l.sessionId)&&l.kind==='strength'&&l.loadKg>0&&(l.variant||'standard')===variant);
 const groups=new Map();for(const log of logs){if(!groups.has(log.sessionId))groups.set(log.sessionId,[]);groups.get(log.sessionId).push(log);}
 const allHistory=[...groups].map(([sessionId,sets])=>({session:completed.get(sessionId),sets:sets.sort((a,b)=>a.setIndex-b.setIndex)})).sort((a,b)=>(b.session.completedAt||b.session.date).localeCompare(a.session.completedAt||a.session.date));
 const sameSlot=allHistory.filter(h=>!currentSession||h.session.templateId===currentSession.templateId);
 const history=sameSlot.length?sameSlot:allHistory.filter(h=>h.sets[0]?.loadRule===target.loadRule);
 if(!history.length)return {loadKg:null,label:'Find your starting load',reason:`Build up to the prescribed reps at RPE ${target.rpe||7}, keeping ${target.rir??3} reps in reserve. Save that as your reference.`,state:'calibrate'};
 const success=h=>{const expected=h.sets[0]?.expectedSets||h.sets.length;const indexes=new Set(h.sets.map(l=>l.setIndex));return h.sets.length>=expected&&indexes.size>=expected&&Array.from({length:expected},(_,i)=>i+1).every(i=>indexes.has(i))&&!h.sets.some(l=>l.reduced||l.deload)&&h.sets.every(l=>l.reps>=(target.loadRule==='accessory'?(l.repRangeMax||prescription.repRange?.[1]||l.targetReps||target.reps||1):(l.targetReps||target.reps||1))&&Number.isFinite(l.rpe)&&l.rpe<=Math.min(l.targetRpe||8,8));};
 const missed=h=>h.sets.some(l=>l.reps<(l.targetReps||target.reps||1)||Number.isFinite(l.rpe)&&l.rpe>(l.targetRpe||8));
 const last=history[0],load=last.sets.at(-1).loadKg;
 if(currentSession&&last.session.templateId!==currentSession.templateId)return {loadKg:load,label:'Calibrate for this session',reason:'This load comes from a different session template. It is a reference only. Recalibrate to the prescribed reps and RPE before earning an increase here.',state:'calibrate',last};
 if(prescription.reduced)return {loadKg:Math.floor(load*.9*2)/2,label:'Lighter-day reference',reason:'A reduced session does not earn an increase. Use this 90% reference or less to meet the day’s effort cap.',state:'reduced',last};
 if(currentWeek?.deload||currentSession?.taper)return {loadKg:Math.floor(load*.875*2)/2,label:'Deload reference',reason:'Approximately 87.5% of your last reference. Reduce further to meet the prescribed RPE. This session does not earn an increase.',state:'deload',last};
 if(target.reps>(last.sets[0].targetReps||target.reps)&&target.loadRule!=='accessory')return {loadKg:load,label:'Recalibrate for more reps',reason:'The new prescription has more repetitions. Use this previous load only as a reference and reduce it to meet the new RPE before progressing.',state:'recalibrate',last};
 const lower=target.loadRule==='lower-main';
 const step=Number(prefs.exerciseIncrements?.[exercise.id]??(lower?prefs.lowerIncrement??2.5:prefs.upperIncrement??1));
 if(history.length>1&&missed(history[0])&&missed(history[1]))return {loadKg:load,label:'Reset suggested',resetLoadKg:Math.round(load*.925*2)/2,reason:'Targets were missed in two completed sessions. Consider 7.5% less load or a deload, then rebuild. This is a suggestion you can edit.',state:'reset',last};
 if(success(last)&&['lower-main','upper-main','accessory'].includes(target.loadRule))return {loadKg:Math.round((load+step)*100)/100,label:`Progress +${step} kg`,reason:'Every prescribed work set reached its rep target within the RPE cap. Adjust the increment to your equipment.',state:'progress',last};
 const accessory=target.loadRule==='accessory'&&prescription.repRange;
 return {loadKg:load,label:accessory?'Build the repetitions':'Repeat the load',reason:accessory?`Keep the load and build every set toward ${prescription.repRange[1]} reps within the RPE cap before adding weight.`:'Keep this reference load while you meet all prescribed targets with controlled technique.',state:'repeat',last};
}
export function dailyPrescription(sx,readinessResult,{applyReduction=false,gameWithin48h=false,tryoutTaper=false}={}){
 const copy=structuredClone(sx),reduce=applyReduction&&readinessResult.reduce||gameWithin48h||tryoutTaper;
 if(reduce&&copy.targetSets?.length){const count=Math.max(1,Math.ceil(copy.targetSets.length*(tryoutTaper ? 0.5 : 0.75)));copy.targetSets=copy.targetSets.slice(0,count).map(s=>({...s,rpe:Math.min(s.rpe||7,7),rir:Math.max(s.rir||3,3)}));copy.reduced=true;}
 if(reduce&&['test','speed','power','conditioning'].includes(copy.role)&&sx.targetSets?.some(s=>(s.rpe||0)>=8))copy.hold=true;
 if(reduce&&copy.role==='power'&&['throw','loadedJump'].includes(copy.powerMetric))copy.hold=true;
 if(readinessResult.illness||readinessResult.wristHold&&['skill'].includes(sx.role))copy.hold=true;
 return copy;
}
export function weeklyLoads(sessions,anchor,count=8){
 const start=addDays(weekStart(anchor),-7*(count-1));
 return Array.from({length:count},(_,i)=>{const date=addDays(start,i*7),end=addDays(date,6),rows=alive(sessions).filter(s=>s.date>=date&&s.date<=end&&s.date<=anchor&&s.status==='completed'),valid=rows.filter(s=>Number.isFinite(s.actualDurationMin)&&Number.isFinite(s.sessionRpe));return {date,end,load:valid.length?sum(valid.map(s=>s.actualDurationMin*s.sessionRpe)):null,count:valid.length,completed:rows.length,incomplete:rows.length-valid.length};});
}
export function loadComparison(weeks){
 const current=weeks.at(-1),prior=weeks.slice(-5,-1);
 if(!current||current.load===null||current.incomplete>0||prior.length<4||prior.some(w=>w.load===null||w.incomplete>0))return {ratio:null,chronic:null,message:'Log all training, including ice and roller, for at least four prior weeks to compare workload. Missing weeks are not treated as zero.'};
 const chronic=mean(prior.map(w=>w.load));const ratio=chronic>0?current.load/chronic:null;
 return {ratio,chronic,message:ratio>1.3?'This partial week is already more than 30% above the prior four-week average. Review added sessions and recovery; this is not an injury forecast.':'The current week is partial. This descriptive comparison is not a safe-zone or injury prediction.'};
}
export function strengthVolume(data,start,end){const ids=new Set(alive(data.sessions).filter(s=>s.date>=start&&s.date<=end&&s.status==='completed').map(s=>s.id));const ex=new Map(data.exercises.map(e=>[e.id,e]));const out={};for(const l of alive(data.set_logs)){if(!ids.has(l.sessionId)||l.kind!=='strength'||!l.loadKg||!l.reps)continue;const exercise=ex.get(l.exerciseId),key=exercise?.movementPattern||'Other';out[key]=(out[key]||0)+l.loadKg*l.reps*(exercise?.loadMultiplier||1);}return out;}
export function compliance(data,start,end){const rows=alive(data.sessions).filter(s=>s.date>=start&&s.date<=end&&!s.optional&&!s.extra);return {planned:rows.length,completed:rows.filter(s=>s.status==='completed').length,skipped:rows.filter(s=>s.status==='skipped').length};}
export function targetText(set,exercise={}){const parts=[],throwing=exercise.powerMetric==='throw'||['PW05','PW07'].includes(exercise.code),jump=exercise.powerMetric==='loadedJump'||exercise.code==='PW06';if(set.reps)parts.push(`${set.reps}${set.sides===2?' / side':''} ${throwing?'throws':jump?'jumps':'reps'}`);if(set.distanceM)parts.push(`${set.distanceM} m`);if(set.seconds)parts.push(`${set.seconds}s${set.sides===2?' / side':''}`);if(set.rounds)parts.push(`${set.rounds} rounds`);if(set.workSec)parts.push(`${set.workSec}s work / ${set.recoverySec||0}s easy`);if(set.contacts&&!throwing)parts.push(`${set.contacts} foot contacts`);if(set.rpe)parts.push(`RPE ${set.rpe}`);if(set.tempo)parts.push(`tempo ${set.tempo}`);return parts.join(' · ')||exercise.quality||'Follow the session notes';}
