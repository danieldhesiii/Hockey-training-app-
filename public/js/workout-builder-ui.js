import * as db from './db.js';
import {esc,uid,number,today} from './utils.js';
import {targetText} from './coaching.js';
import {exerciseTypes,makeExercise,makeBlock,workoutRecords,blockHasHistory,copyBlocks,targetMetrics,validateWorkoutEdit} from './workout-builder.js';

const $=selector=>document.querySelector(selector);
const labels={reps:'Repetitions',seconds:'Seconds',distanceM:'Metres',contacts:'Foot contacts'};
const button=(text,action,extra='')=>`<button type="button" class="btn btn-secondary btn-small" data-builder="${action}" ${extra}>${text}</button>`;
const field=(name,label,value='',attrs='')=>`<label>${label}<input name="${name}" value="${esc(String(value??''))}" ${attrs}></label>`;
const inputNumber=(name,label,value,min,max,step=1)=>field(name,label,value,`type="number" min="${min}" max="${max}" step="${step}" required`);

export function exerciseEditor(ctx,{exercise=null,onSave=null,onCancel=null}={}) {
  const used=exercise&&[...ctx.data.session_exercises,...ctx.data.set_logs,...ctx.data.skill_logs,...ctx.data.test_results].some(row=>row.exerciseId===exercise.id);
  const e=exercise||{};
  ctx.modal(exercise?'Edit your exercise':'Create exercise',`<form id="custom-exercise-form"><div class="form-grid">
    ${field('name','Exercise name',e.name,'required maxlength="120" placeholder="e.g. Cable crunch"')}
    <label>How to log it<select name="type" ${used?'disabled':''}>${Object.entries(exerciseTypes).map(([key,type])=>`<option value="${key}" ${key===e.customType?'selected':''}>${type.label}</option>`).join('')}</select></label>
    ${field('equipment','Equipment, separated by commas',(e.equipment||[]).join(', '),'maxlength="500" placeholder="Cable machine, rope attachment"')}
    ${field('muscles','Muscles, separated by commas',(e.muscles||[]).join(', '),'maxlength="500" placeholder="Abdominals"')}
    ${field('quality','Training purpose',e.quality,'maxlength="200" placeholder="What you use it for"')}
    ${field('pattern','Movement pattern',e.movementPattern,'maxlength="120" placeholder="e.g. Trunk flexion"')}
    <label>Environment<select name="environment">${['EITHER','INDOOR','OUTDOOR'].map(value=>`<option ${e.environment===value?'selected':''}>${value}</option>`).join('')}</select></label>
    <label>Strength load convention<select name="loadMultiplier"><option value="1">Total external kg / machine setting</option><option value="2" ${e.loadMultiplier===2?'selected':''}>Kg per dumbbell, two dumbbells</option></select></label>
    <label class="full">Setup / equipment instructions<textarea name="setup" maxlength="1000">${esc(e.equipmentNotes||'')}</textarea></label>
    <label class="full">Coaching cues, one per line<textarea name="cues" maxlength="4000">${esc((e.cues||[]).join('\n'))}</textarea></label>
    <label class="full">Common mistakes, one per line<textarea name="mistakes" maxlength="4000">${esc((e.mistakes||[]).join('\n'))}</textarea></label>
    ${field('regression','Easier variation',e.regression,'maxlength="500"')}${field('progression','Harder variation',e.progression,'maxlength="500"')}
    ${field('videoUrl','Video URL (optional)',e.videoUrl,'type="url" placeholder="https://…"')}
    <label class="check-row"><input name="wristSensitive" type="checkbox" ${e.wristSensitive?'checked':''}>Needs a wrist / grip symptom check</label>
    </div>${used?'<p class="form-help">Logging type and strength load convention stay fixed once an exercise is used, so existing targets and history keep their units.</p>':''}
    <p id="exercise-error" class="form-error mt-16" role="alert"></p><div class="form-actions">${onCancel?button('Back to workout','back'):''}<button class="btn btn-primary">Save exercise</button></div></form>`);
  const form=$('#custom-exercise-form');
  if(used)form.elements.loadMultiplier.disabled=true;
  form.querySelector('[data-builder="back"]')?.addEventListener('click',onCancel);
  form.addEventListener('submit',async event=>{
    event.preventDefault();const submit=form.querySelector('button[type="submit"],button.btn-primary');submit.disabled=true;
    try {
      const values=Object.fromEntries(new FormData(form));values.wristSensitive=form.elements.wristSensitive.checked;
      values.type=used?e.customType:values.type;values.loadMultiplier=used?e.loadMultiplier:Number(values.loadMultiplier);
      const row=makeExercise(values,e.id||uid(),exercise);
      const saved=await db.save('exercises',row);await ctx.refresh({render:false});
      if(onSave)onSave(saved);else{ctx.closeModal();await ctx.refresh();ctx.toast('Exercise saved in your library.');}
    }catch(error){$('#exercise-error').textContent=error.message;submit.disabled=false;}
  });
}

export async function workoutBuilder(ctx,{session=null,copy=null,date=today()}={}) {
  const exercises=[...ctx.data.exercises];
  const allLogs=(await Promise.all(['set_logs','skill_logs','test_results'].map(table=>db.all(table,{includeDeleted:true})))).flat();
  const source=session||copy;
  const originals=source?ctx.data.session_exercises.filter(row=>row.sessionId===source.id).sort((a,b)=>a.order-b.order):[];
  let blocks=session?structuredClone(originals):copy?copyBlocks(originals,uid):[];
  let draft={workoutTemplateId:source?.customWorkout?source.templateId:null,title:copy?copy.title+' (copy)':session?.title||'',date:session?.date||date,kind:source&&['strength','conditioning','skills','mobility'].includes(source.kind)?source.kind:'strength',durationMin:source?.durationMin||(new Date(date+'T12:00:00Z').getUTCDay()===4?20:45),intensityRpe:source?.intensityRpe||6,notes:source?.notes||'',warmup:structuredClone(source?.warmup||[]),cooldown:structuredClone(source?.cooldown||[])};
  const historical=!!session&&allLogs.some(log=>log.sessionId===session.id);
  const locked=block=>!!session&&blockHasHistory(block,allLogs);
  const capture=()=>{const form=$('#workout-builder-form');if(!form)return;for(const key of ['title','date','kind','durationMin','intensityRpe','notes'])draft[key]=form.elements[key].value;};
  const error=message=>{$('#workout-error').textContent=message;};

  function targetEditor(exercise,block=null,index=null) {
    capture();const t=block?.targetSets?.[0]||{},metrics=targetMetrics(exercise),metric=metrics.find(key=>t[key])||exercise.defaultMetric||metrics[0];
    ctx.modal(block?'Edit exercise targets':'Add exercise to workout',`<p><strong>${esc(exercise.name)}</strong></p><p class="small muted mt-8">${esc(exercise.equipment.join(' · '))}</p><form id="builder-target-form" class="mt-16"><div class="form-grid">
      ${inputNumber('sets','Sets',block?.targetSets?.length||1,1,20)}<label>Target unit<select name="metric">${metrics.map(key=>`<option value="${key}" ${key===metric?'selected':''}>${labels[key]}</option>`).join('')}</select></label>
      ${inputNumber('amount','Amount per set / side',t[metric]||'',0.1,3600,'any')}
      <label>Sides<select name="sides"><option value="1">One / both together</option><option value="2" ${t.sides===2?'selected':''}>Left and right</option></select></label>
      ${inputNumber('restSec','Rest between sets (sec)',t.restSec||0,0,1200)}${inputNumber('rpe','Effort (RPE)',t.rpe||draft.intensityRpe,1,10,0.5)}
      ${field('variant','Equipment / variant label',block?.variant==='standard'?'':block?.variant,'maxlength="100" placeholder="Optional, e.g. machine model"')}
      <label class="full">Block notes<textarea name="notes" maxlength="2000">${esc(block?.notes||'')}</textarea></label></div>
      ${exercise.wristSensitive?'<p class="notice amber mt-16">Daily wrist and grip checks still apply to this exercise.</p>':''}
      <p class="form-help">These targets replace this block’s targets. Log actual load during training. Allow time for preparation, recovery and cool-down.</p>
      <p id="target-error" role="alert" class="form-error"></p><div class="form-actions">${button('Back to workout','back')}<button class="btn btn-primary">${block?'Save targets':'Add to workout'}</button></div></form>`);
    $('#builder-target-form [data-builder="back"]').addEventListener('click',render);
    $('#builder-target-form').addEventListener('submit',event=>{
      event.preventDefault();const f=new FormData(event.target);
      try{const next=makeBlock(exercise,{metric:String(f.get('metric')),amount:number(f,'amount'),sets:number(f,'sets'),sides:number(f,'sides'),restSec:number(f,'restSec'),rpe:number(f,'rpe'),notes:f.get('notes'),variant:f.get('variant')},block?.id||uid());
        if(index===null)blocks.push(next);else blocks[index]={...block,...next};render();
      }catch(err){$('#target-error').textContent=err.message;}
    });
  }

  function render(){
    ctx.modal(session?'Edit workout':'Create workout',`<form id="workout-builder-form"><div class="form-grid">
      ${field('title','Workout name',draft.title,'required maxlength="150" placeholder="e.g. My core workout"')}
      ${field('date','Workout date',draft.date,`type="date" required ${historical?'readonly':''}`)}
      <label>Workout type<select name="kind" ${historical?'disabled':''}>${[['strength','Gym / strength'],['conditioning','Conditioning'],['skills','Skills'],['mobility','Mobility']].map(([key,label])=>`<option value="${key}" ${draft.kind===key?'selected':''}>${label}</option>`).join('')}</select></label>
      ${inputNumber('durationMin','Planned minutes, including warm-up',draft.durationMin,5,60)}${inputNumber('intensityRpe','Planned effort (RPE)',draft.intensityRpe,1,10,0.5)}
      <label class="full">Workout notes / preparation / cool-down<textarea name="notes" maxlength="4000">${esc(draft.notes)}</textarea></label></div>
      <p class="small muted mt-16">Exercise blocks: approximately ${Math.ceil(blocks.reduce((total,b)=>total+(b.estimatedBlockMin||0),0))} min. Keep room for preparation and cool-down.</p><h3 class="mt-24">Exercises <span class="small muted">${blocks.length}</span></h3>
      <div class="builder-blocks mt-16">${blocks.map((block,index)=>{const exercise=exercises.find(e=>e.id===block.exerciseId);return `<section class="builder-block"><div class="row-between"><strong>${index+1}. ${esc(exercise?.name||'Exercise')}</strong><span class="badge neutral">${block.targetSets.length} sets</span></div><p class="small muted mt-8">${esc(targetText(block.targetSets[0],exercise))}</p><div class="row wrap mt-16">${locked(block)?'<span class="small muted">Saved history: targets preserved</span>':button('Edit targets','edit',`data-index="${index}"`)+button('Remove','remove',`data-index="${index}" aria-label="Remove ${esc(exercise?.name)}"`)}${button('↑','up',`data-index="${index}" aria-label="Move ${esc(exercise?.name)} up" ${index===0?'disabled':''}`)}${button('↓','down',`data-index="${index}" aria-label="Move ${esc(exercise?.name)} down" ${index===blocks.length-1?'disabled':''}`)}</div></section>`;}).join('')||'<p class="small muted">Start by adding an exercise below.</p>'}</div>
      <div class="builder-add mt-24"><label>Find an exercise<input name="exerciseSearch" type="search" placeholder="Search name, muscles or equipment"></label><label class="mt-16">Exercise to add<select name="exerciseId"></select></label><div class="row wrap mt-16">${button('Add selected exercise','add')}${button('Create new exercise','create')}</div></div>
      <p class="form-help mt-16">Your workout is optional and appears on its chosen date. Monday stays free of gym workouts. Thursday workouts have a 20-minute limit; other workouts have a 60-minute limit.</p>
      <p id="workout-error" class="form-error mt-16" role="alert"></p><div class="form-actions"><button class="btn btn-primary">Save workout</button></div></form>`);
    const form=$('#workout-builder-form');
    const search=()=>{const q=form.elements.exerciseSearch.value.trim().toLowerCase();const matches=exercises.filter(e=>!e.deleted&&!['test','sport'].includes(e.category)&&!['SK09','SK10'].includes(e.code)&&(!q||[e.name,e.code,...e.muscles,...e.equipment].join(' ').toLowerCase().includes(q))).sort((a,b)=>a.name.localeCompare(b.name));form.elements.exerciseId.innerHTML=matches.map(e=>`<option value="${e.id}">${esc(e.name)}${e.custom?' · Yours':''}</option>`).join('');form.querySelector('[data-builder="add"]').disabled=!matches.length;};
    form.elements.exerciseSearch.addEventListener('input',search);search();
    for(const control of form.querySelectorAll('[data-builder]'))control.addEventListener('click',()=>{
      capture();const index=Number(control.dataset.index),action=control.dataset.builder;
      if(action==='add'){const exercise=exercises.find(e=>e.id===form.elements.exerciseId.value);if(exercise)targetEditor(exercise);return;}
      if(action==='create'){exerciseEditor(ctx,{onCancel:render,onSave:saved=>{exercises.push(saved);targetEditor(saved);}});return;}
      if(action==='edit'){if(!locked(blocks[index]))targetEditor(exercises.find(e=>e.id===blocks[index].exerciseId),blocks[index],index);return;}
      if(action==='remove'){if(!locked(blocks[index]))blocks.splice(index,1);}
      if(action==='up'&&index>0)[blocks[index-1],blocks[index]]=[blocks[index],blocks[index-1]];
      if(action==='down'&&index<blocks.length-1)[blocks[index+1],blocks[index]]=[blocks[index],blocks[index+1]];
      render();
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();capture();const save=form.querySelector('button.btn-primary');save.disabled=true;
      try {
        const values={...draft,durationMin:Number(draft.durationMin),intensityRpe:Number(draft.intensityRpe)};
        const current=session?await db.get('sessions',session.id):null;
        const freshLogs=(await Promise.all(['set_logs','skill_logs','test_results'].map(table=>db.all(table,{includeDeleted:true})))).flat();
        const freshBlocks=session?(await db.all('session_exercises')).filter(row=>row.sessionId===session.id):[];
        validateWorkoutEdit(current,freshBlocks,blocks,freshLogs,values);
        const records=workoutRecords(values,blocks,ctx.data.weeks,session?.id||uid(),current);
        const removed=freshBlocks.filter(old=>!blocks.some(row=>row.id===old.id)).map(row=>({...row,deleted:true}));
        await db.saveRecords([{table:'sessions',row:records.session},...records.prescriptions.map(row=>({table:'session_exercises',row})),...removed.map(row=>({table:'session_exercises',row}))]);
        ctx.closeModal();await ctx.refresh();location.hash='session/'+records.session.id;ctx.toast('Workout saved. Copy it onto another date whenever you need it.');
      }catch(err){error(err.message);save.disabled=false;}
    });
  }
  render();
}
