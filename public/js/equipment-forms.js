import {esc,fmt} from './utils.js';
import {powerMetric} from './equipment.js';

const saved = (logs, describe) => !logs.length ? '' : `<details class="mt-16"><summary>Saved entries</summary>${logs.map(l=>`<div class="row-between mb-16"><span class="small muted">${esc(describe(l))}</span><button class="link-btn" data-action="remove-log" data-table="set_logs" data-id="${l.id}">Remove</button></div>`).join('')}</details>`;
const number = (name,label,{value='',placeholder='',min=0,max=1000,step=1,required=false}={}) => `<label>${label}<input name="${name}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" ${required?'required':''} value="${esc(String(value))}" placeholder="${esc(String(placeholder))}"></label>`;

export function renderPowerBlock(sx,exercise,blocked,logs) {
  const metric=powerMetric(exercise), t=sx.targetSets[Math.min(logs.length,sx.targetSets.length-1)]||{}, last=logs.at(-1);
  let fields='';
  if(metric==='throw') fields=number('reps',t.sides===2?'Throws per side':'Throws',{min:1,max:100,placeholder:t.reps||3,required:true})
    +`<label>Sides<select name="sides"><option value="1">Both arms together / one side</option><option value="2" ${t.sides===2?'selected':''}>Left and right</option></select></label>`
    +number('loadKg','Medicine-ball mass (kg)',{min:.1,max:30,step:.1,value:last?.loadKg??'',required:true})
    +number('distanceCm','Throw distance (cm, optional)',{max:3000,step:1});
  else if(metric==='loadedJump') fields=number('reps','Jumps completed',{min:1,max:50,placeholder:t.reps||2,required:true})
    +number('loadKg','Total bar + plates (kg)',{min:.1,max:300,step:.25,value:last?.loadKg??'',required:true})
    +number('heightCm','Jump height (cm, optional)',{max:200,step:.1})
    +`<p class="form-help full">Each two-foot landing records two foot contacts. Use a light, crisp load and reset fully; this is not strength-load progression.</p>`;
  else fields=number('contacts','Foot contacts',{min:1,max:200,placeholder:t.contacts||6,required:true})
    +number('distanceCm','Distance (cm, optional)',{max:1000,step:.1})
    +number('heightCm','Height (cm, optional)',{max:200,step:.1});
  const description=metric==='throw'?'Log throws and the actual ball mass. Retrieve the ball between repetitions; a throw is not a foot contact.':exercise.loadConvention||'Record actual contacts and measured results.';
  return `<p class="small muted mt-16">${esc(description)}</p><form class="drill-form" data-log="power" data-sx="${sx.id}">${fields}${number('restSec','Rest timer (sec)',{value:t.restSec||0,max:1200,required:true})}<label class="full">Notes<input name="notes" placeholder="Quality, setup, measurement method or symptoms"></label><div class="row-between full"><span class="small muted">${logs.length} ${logs.length===1?'entry':'entries'} saved</span><button class="btn btn-primary" ${blocked?'disabled':''}>Log power set</button></div></form>${saved(logs,l=>metric==='throw'?`${l.reps??'Unrecorded'} throws${l.sides===2?' per side':''} · ${fmt(l.loadKg,2)} kg ball`:metric==='loadedJump'?`${l.reps??'Unrecorded'} jumps · ${fmt(l.loadKg,2)} kg · ${l.contacts??'Unrecorded'} foot contacts`:`${l.contacts} foot contacts${l.distanceCm!=null?' · '+l.distanceCm+' cm':''}${l.heightCm!=null?' · '+l.heightCm+' cm high':''}`)}`;
}

export function renderMachineBlock(sx,exercise,blocked,logs) {
  const strength=exercise.loggingMode==='machineStrength';
  const targets=strength?sx.targetSets:[sx.targetSets[Math.min(logs.length,sx.targetSets.length-1)]||{}];
  return `<p class="small muted mt-16">Record the machine’s displayed setting and unit exactly. These entries do not create kilogram targets, estimated 1RM or track sprint times.</p>${!strength?`<button class="btn btn-secondary btn-small mt-16" data-action="preset-prescription" data-sx="${sx.id}" ${blocked?'disabled':''}>Start prescribed bouts</button>`:''}${targets.map((t,i)=>{
    const log=strength?logs.find(l=>l.setIndex===i+1):null, last=log||logs.at(-1), index=strength?i+1:logs.length+1;
    return `<form class="drill-form" data-log="${exercise.loggingMode}" data-sx="${sx.id}" data-index="${index}" data-reduced="${sx.reduced?'true':'false'}"><h4 class="full">${strength?'Set '+index:'Log one resisted-running bout'}</h4><label>Resistance setting<input name="resistanceSetting" required maxlength="80" value="${esc(last?.resistanceSetting||'')}" placeholder="Value shown on machine"></label><label>Unit / display label<input name="resistanceUnit" required maxlength="40" value="${esc(last?.resistanceUnit||'')}" placeholder="e.g. level, psi, kgf"></label>${strength?number('reps','Repetitions',{value:log?.reps??'',placeholder:t.reps||6,min:1,max:100,required:true}):number('seconds','Actual bout (sec)',{placeholder:t.seconds||5,min:.1,max:600,step:.1,required:true})}${number('rpe','Effort (RPE)',{value:log?.rpe??'',placeholder:t.rpe||6,max:10,step:.5,required:true})}${!strength?number('restSec','Recovery after bout (sec)',{value:t.restSec||0,max:1200,required:true}):''}${number('watts','Displayed watts (optional)',{value:log?.watts??'',max:10000,step:1})}<label class="full">Notes<input name="notes" maxlength="500" value="${esc(log?.notes||'')}" placeholder="Machine setup, range or quality"></label><div class="row-between full"><span class="small muted">${esc(sx.variant||'Confirm the machine setup before logging')}</span><button class="btn btn-primary" ${blocked?'disabled':''}>${log?'Update':'Log'} ${strength?'set':'bout'}</button></div></form>`;
  }).join('')}${saved(logs,l=>`${strength?l.reps+' reps':l.seconds+'s'} · setting ${l.resistanceSetting} ${l.resistanceUnit} · RPE ${l.rpe??'not logged'}${l.watts!=null?' · '+l.watts+' W':''}`)}`;
}
