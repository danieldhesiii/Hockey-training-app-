import {esc,prettyDate,alive,fmt} from './utils.js';

export function historySessions(data,{query='',status='all'}={}) {
  const q=query.trim().toLowerCase(),exerciseMap=new Map(data.exercises.map(e=>[e.id,e]));
  const logs=[...data.set_logs,...data.skill_logs,...data.test_results].filter(l=>!l.deleted);
  return alive(data.sessions).filter(s=>(s.status!=='planned'||s.startedAt||logs.some(l=>l.sessionId===s.id))&&
    (status==='all'||(status==='in-progress'?s.status==='planned':s.status===status))&&
    (!q||[s.title,s.date,s.completionNotes,...data.session_exercises.filter(b=>b.sessionId===s.id).map(b=>exerciseMap.get(b.exerciseId)?.name)].join(' ').toLowerCase().includes(q)))
    .sort((a,b)=>b.date.localeCompare(a.date)||String(b.startedAt||'').localeCompare(String(a.startedAt||'')))
    .map(s=>({...s,entryCount:logs.filter(l=>l.sessionId===s.id).length}));
}

export function describeEntry(row) {
  if(row.kind?.startsWith('machine'))return `${row.reps!=null?row.reps+' reps':row.seconds+' sec'} · setting ${row.resistanceSetting} ${row.resistanceUnit}`;
  if(row.kind==='shooting')return `${row.shots} shots · ${row.durationSec} sec`;
  if(row.kind==='stickhandling')return `${row.durationSec} sec · ${row.touches??'Unrecorded'} touches`;
  if(row.kind==='rehearsal')return `${row.durationSec} sec rehearsal`;
  if(row.kind==='speed')return `${row.distanceM} m · ${row.timeSec} sec`;
  const parts=[];
  if(row.loadKg!=null)parts.push(fmt(row.loadKg,2)+' kg');
  if(row.reps!=null)parts.push(row.reps+' '+(row.powerMetric==='throw'?'throws':row.powerMetric==='loadedJump'?'jumps':'reps'));
  if(row.seconds!=null)parts.push(row.seconds+' sec');
  if(row.durationMin!=null)parts.push(row.durationMin+' min');
  if(row.contacts!=null)parts.push(row.contacts+' contacts');
  if(row.rpe!=null)parts.push('RPE '+row.rpe);
  if(row.setsCompleted!=null)parts.push(row.setsCompleted+' sets');
  return parts.join(' · ')||'Recorded entry';
}

export function renderHistory(ctx,{query='',status='all'}={}) {
  const rows=historySessions(ctx.data,{query,status});
  return `<div class="page-heading"><div><h1>Your training history.</h1><p>Review completed workouts, continue a session and find your actual exercise entries.</p></div><button class="btn btn-primary" data-action="create-workout">Create workout</button></div><div class="filters"><input id="history-search" type="search" aria-label="Search training history" placeholder="Workout, exercise or date" value="${esc(query)}"><select id="history-status" aria-label="History status">${[['all','All activity'],['in-progress','In progress'],['completed','Completed'],['skipped','Skipped']].map(([value,label])=>`<option value="${value}" ${status===value?'selected':''}>${label}</option>`).join('')}</select></div><p class="small muted mb-16">${rows.length} ${rows.length===1?'workout':'workouts'}</p><div class="history-list">${rows.map(s=>`<article class="history-item"><div><span class="badge ${s.status==='completed'?'lime':'neutral'}">${s.status==='planned'?'In progress':esc(s.status)}</span><h3 class="mt-8">${esc(s.title)}</h3><p>${prettyDate(s.date,{day:'numeric',month:'long',year:'numeric'})} · ${s.entryCount} entries${s.actualDurationMin!=null?' · '+s.actualDurationMin+' actual min':''}${s.sessionRpe!=null?' · RPE '+s.sessionRpe:''}</p>${s.completionNotes?`<p class="mt-8">${esc(s.completionNotes)}</p>`:''}</div><button class="btn btn-secondary btn-small" data-action="open-session" data-id="${s.id}">${s.status==='planned'?'Continue workout':'Review workout'}</button></article>`).join('')||'<div class="empty-state"><h2>No workouts found</h2><p>Start a session from Today or create your own workout. Actual entries appear here as soon as you save them.</p><a class="btn btn-secondary mt-16" href="#today">Open Today</a></div>'}</div>`;
}

export function exerciseHistory(ctx,id) {
  const exercise=ctx.data.exercises.find(e=>e.id===id),sessions=new Map(ctx.data.sessions.map(s=>[s.id,s]));
  const rows=[...ctx.data.set_logs,...ctx.data.skill_logs].filter(l=>!l.deleted&&l.exerciseId===id).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||String(b.loggedAt||b.updatedAt).localeCompare(String(a.loggedAt||a.updatedAt)));
  ctx.modal(exercise.name+' history',rows.length?`<p class="small muted">Actual entries only. Open a workout to edit or review it.</p><div class="history-list mt-16">${rows.map(l=>`<article class="history-item"><div><strong>${esc(describeEntry(l))}</strong><p>${esc(l.date)} · ${esc(sessions.get(l.sessionId)?.title||'Workout')}</p>${l.notes?`<p>${esc(l.notes)}</p>`:''}</div><button class="btn btn-secondary btn-small" data-action="history-open-session" data-id="${l.sessionId}">Open workout</button></article>`).join('')}</div>`:'<div class="empty-state"><h3>No recorded entries yet</h3><p>Log this exercise in a workout to see its history here.</p></div>');
}
