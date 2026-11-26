import * as db from './db.js';
import {esc,number} from './utils.js';
import {machineRecord,powerRecord} from './equipment.js';

const fields={loadKg:'Load (kg)',reps:'Repetitions',rpe:'Effort (RPE)',seconds:'Duration (sec)',setsCompleted:'Sets completed',sides:'Sides',durationMin:'Duration (minutes)',rounds:'Rounds completed',heartRate:'Heart rate (bpm)',distanceM:'Distance (m)',timeSec:'Time (sec)',restSec:'Recovery (sec)',contacts:'Foot contacts',distanceCm:'Distance (cm)',heightCm:'Height (cm)',durationSec:'Duration (sec)',touches:'Touches',errors:'Errors',eyesUpPercent:'Eyes-up score (%)',shots:'Shots',shotSpeedKmh:'Shot speed (km/h)',releaseTimeSec:'Release time (sec)',watts:'Watts'};
export function editedEntry(original,values,exercise) {
  const row={...original,notes:String(values.notes||'')};
  for(const key of Object.keys(fields))if(key in values){const n=values[key];if(n!==null&&(!Number.isFinite(n)||n<0))throw new Error('Enter valid non-negative measurements.');row[key]=n;}
  if(row.kind==='strength'&&(!Number.isFinite(row.reps)||!Number.isFinite(row.loadKg)||!Number.isFinite(row.rpe)))throw new Error('Load, reps and effort are required.');
  if(row.kind==='strength')row.rir=10-row.rpe;
  if(row.kind==='power')Object.assign(row,powerRecord(exercise,row));
  if(row.kind?.startsWith('machine'))Object.assign(row,machineRecord(exercise,{...row,resistanceSetting:values.resistanceSetting,resistanceUnit:values.resistanceUnit}));
  if(row.kind==='shooting'){
    row.hitsByZone={...original.hitsByZone};
    for(const zone of ['topLeft','topRight','bottomLeft','bottomRight','fiveHole'])if(zone in values)row.hitsByZone[zone]=values[zone];
    if(!Number.isFinite(row.shots)||Object.values(row.hitsByZone).some(v=>!Number.isFinite(v)||v<0)||Object.values(row.hitsByZone).reduce((a,b)=>a+b,0)>row.shots)throw new Error('Target hits cannot exceed valid actual shots.');
  }
  return row;
}

export async function entryEditor(ctx,table,id) {
  if(!['set_logs','skill_logs'].includes(table))throw new Error('Open this record in its matching editor.');
  const original=await db.get(table,id),exercise=ctx.data.exercises.find(e=>e.id===original.exerciseId);
  const numeric=Object.keys(fields).filter(key=>key in original);
  ctx.modal('Edit recorded entry',`<p>${esc(exercise?.name||'Exercise')} · ${esc(original.date)}</p><form id="edit-entry-form" class="mt-16"><div class="form-grid">${numeric.map(key=>`<label>${fields[key]}<input name="${key}" type="number" min="0" step="any" value="${original[key]??''}"></label>`).join('')}${original.kind?.startsWith('machine')?`<label>Resistance setting<input name="resistanceSetting" required value="${esc(original.resistanceSetting)}"></label><label>Setting unit<input name="resistanceUnit" required value="${esc(original.resistanceUnit)}"></label>`:''}${original.kind==='shooting'?Object.entries(original.hitsByZone||{}).map(([zone,value])=>`<label>${esc(zone)} hits<input name="${zone}" type="number" min="0" required value="${value}"></label>`).join(''):''}<label class="full">Notes<textarea name="notes">${esc(original.notes||'')}</textarea></label></div><p id="entry-error" role="alert" class="form-error"></p><div class="sticky-form-actions"><span>Updates this entry only.</span><button class="btn btn-primary">Save changes</button></div></form>`);
  document.querySelector('#edit-entry-form').addEventListener('submit',async event=>{
    event.preventDefault();const save=event.target.querySelector('button');save.disabled=true;
    try{const f=new FormData(event.target),values={notes:f.get('notes'),resistanceSetting:f.get('resistanceSetting'),resistanceUnit:f.get('resistanceUnit')};
      for(const key of [...numeric,...Object.keys(original.hitsByZone||{})])values[key]=number(f,key);
      const latest=await db.get(table,id);if(latest.changeId!==original.changeId||latest.deleted)throw new Error('This entry changed elsewhere. Close and reopen its editor.');
      await db.save(table,editedEntry(original,values,exercise));await ctx.refresh({render:false});await ctx.recalculate();ctx.closeModal();await ctx.refresh();ctx.toast('Recorded entry updated.');
    }catch(err){document.querySelector('#entry-error').textContent=err.message;save.disabled=false;}
  });
}
