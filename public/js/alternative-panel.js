import * as db from './db.js';
import {esc,uid,number} from './utils.js';
import {exerciseChoices,customTargets,targetMetrics} from './alternatives.js';
import {exercisePicker} from './exercise-picker-ui.js';
import {exerciseEditor} from './workout-builder-ui.js';
import {targetText} from './coaching.js';
import {replacementRecords} from './session-editing.js';

export async function alternativePanel(ctx,id) {
  const sx=await db.get('session_exercises',id),session=await db.get('sessions',sx.sessionId);
  if(session.status!=='planned')return ctx.toast('Reopen the session to change its exercises.',true);
  const current=ctx.data.exercises.find(e=>e.id===sx.exerciseId),exercises=[...ctx.data.exercises];
  let choices,selected=null;
  const metricLabels={reps:'Reps per set / side',seconds:'Seconds per set / side',distanceM:'Metres per sprint',contacts:'Foot contacts per set'};
  function render(){
    choices=exerciseChoices(sx,exercises,ctx.data.session_exercises);
    ctx.modal('Change exercise',`<p class="small muted">Replace <strong>${esc(current.name)}</strong> in this workout. Your previous logs stay attached to their original exercise.</p><div class="change-layout"><div id="change-picker"></div><form id="change-form"><div id="change-targets"><div class="empty-state"><h3>Choose your replacement</h3><p>Select an exercise from the list. Its targets and equipment will appear here.</p></div></div><p id="change-error" role="alert" class="form-error"></p><div class="sticky-form-actions"><span id="change-selected" class="small muted">No exercise selected</span><button class="btn btn-primary" disabled>Use this exercise</button></div></form></div>`);
    document.querySelector('#modal').classList.add('wide-dialog');
    exercisePicker(document.querySelector('#change-picker'),exercises.filter(e=>choices.has(e.id)),{category:current.category,suggested:new Set([...choices].filter(([,o])=>o.suggested).map(([key])=>key)),onSelect:select,onCreate:()=>exerciseEditor(ctx,{onCancel:render,onSave:saved=>{exercises.push(saved);render();select(saved);}})});
    document.querySelector('#change-form').addEventListener('submit',async event=>{
      event.preventDefault();const form=event.target,save=form.querySelector('button.btn-primary');save.disabled=true;
      try{
        const option=structuredClone(choices.get(selected.id)),f=new FormData(form);
        if(form.elements.editTargets.checked){option.targetSets=customTargets(selected,{metric:String(f.get('metric')),amount:number(f,'amount'),sets:number(f,'sets'),sides:number(f,'sides'),restSec:number(f,'restSec'),rpe:number(f,'rpe')});option.estimatedBlockMin=undefined;delete option.repRange;}
        const latest=await db.get('session_exercises',id),freshSession=await db.get('sessions',session.id);
        if(latest.changeId!==sx.changeId)throw new Error('This block changed in another tab. Close and reopen the picker.');
        const logs=(await Promise.all(['set_logs','skill_logs','test_results'].map(t=>db.all(t,{includeDeleted:true})))).flat();
        const rows=replacementRecords(freshSession,latest,option,selected,String(f.get('variant')||'standard'),f.has('confirmed'),logs,uid());
        await db.saveRecords(rows.map(row=>({table:'session_exercises',row})));
        ctx.closeModal();await ctx.refresh();ctx.toast('Changed to '+selected.name+'. Previous training entries are preserved.');
        document.querySelector(`[data-block="${rows.at(-1).id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});
      }catch(err){document.querySelector('#change-error').textContent=err.message;save.disabled=false;}
    });
  }
  function select(exercise){
    selected=exercise;const option=choices.get(exercise.id),original=sx.targetSets[0]||{};
    const metrics=targetMetrics(exercise),metric=exercise.defaultMetric||(['CO02','CO05','ST15'].includes(exercise.code)?'seconds':metrics.find(key=>option.targetSets[0]?.[key])||metrics[0]);
    // Unscheduled library movements use editable targets in the correct units.
    const fallback=ctx.data.session_exercises.find(row=>exercises.find(e=>e.id===row.exerciseId)?.category===exercise.category&&row.targetSets[0]?.[metric]);
    const t=option.targetSets[0]||{[metric]:original[metric]||fallback?.targetSets[0]?.[metric]||'',sides:1,rpe:original.rpe||5,restSec:original.restSec||0};
    const preset=option.targetSets.length>0;
    const field=(key,label,value,min,max,step=1)=>`<label>${label}<input name="${key}" type="number" min="${min}" max="${max}" step="${step}" required value="${value}"></label>`;
    document.querySelector('#change-targets').innerHTML=`<h3 tabindex="-1" id="replacement-name">${esc(exercise.name)}</h3><p class="small muted mt-8">${esc(exercise.equipment.join(' · '))}</p><details class="mt-8"><summary>Exercise instructions</summary><ul>${exercise.cues.map(c=>`<li>${esc(c)}</li>`).join('')}</ul><p>${esc(exercise.loadConvention||'')}</p></details>${preset?`<ol class="small mt-16">${option.targetSets.map(target=>`<li>${esc(targetText(target,exercise))} · ${target.restSec||0}s rest</li>`).join('')}</ol>`:''}<label class="check-row mt-16"><input type="checkbox" name="editTargets" ${preset?'':'checked disabled'}>${preset?'Edit the prescribed targets':'Review your starting targets'}</label><div id="change-custom" class="form-grid mt-16">${field('sets','Sets',option.targetSets.length||sx.targetSets.length,1,20)}<label>Target unit<select name="metric">${metrics.map(key=>`<option value="${key}" ${key===metric?'selected':''}>${metricLabels[key]}</option>`).join('')}</select></label>${field('amount','Amount per set / side',t[metric]||'',0.1,3600,'any')}<label>Sides<select name="sides"><option value="1">Both together / one side</option><option value="2" ${t.sides===2?'selected':''}>Left and right</option></select></label>${field('restSec','Rest between sets (sec)',t.restSec||0,0,1200)}${field('rpe','Effort (RPE)',t.rpe||5,1,10,0.5)}</div>${preset?`<p class="small muted mt-16">${option.targetSets.length} prescribed ${option.targetSets.length===1?'set':'sets'}. Select Edit the prescribed targets to change reps, time or rest.</p>`:''}<label class="mt-16">Equipment / variant label<input name="variant" maxlength="100" placeholder="${exercise.equipmentConfirmationRequired?'Machine model and setup':'Optional equipment notes'}" ${exercise.equipmentConfirmationRequired?'required':''}></label>${exercise.equipmentConfirmationRequired?'<label class="check-row mt-16"><input name="confirmed" type="checkbox" required>I have checked this equipment and its permitted movement.</label>':''}${exercise.wristSensitive?'<p class="notice amber mt-16">Wrist and grip symptom checks still apply.</p>':''}`;
    const form=document.querySelector('#change-form'),toggle=()=>{const edit=form.elements.editTargets.checked;form.querySelector('#change-custom').hidden=!edit;for(const el of form.querySelectorAll('#change-custom input,#change-custom select'))el.disabled=!edit;};
    form.elements.editTargets.addEventListener('change',toggle);toggle();
    document.querySelector('#change-selected').textContent=exercise.name;
    form.querySelector('button.btn-primary').disabled=false;
    document.querySelector('#replacement-name').focus({preventScroll:true});
    if(matchMedia('(max-width:760px)').matches)document.querySelector('#change-form').scrollIntoView({block:'start',behavior:'smooth'});
  }
  render();
}
