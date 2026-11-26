import {esc} from './utils.js';

// Visible choices rather than a collapsed native select. Reused inside workouts.
export function exercisePicker(root, exercises, {category='', selected=null, suggested=new Set(), onSelect, onCreate}={}) {
  let active=selected;
  root.innerHTML=`<div class="exercise-picker"><div class="picker-tools"><label>Search exercises<input type="search" name="pickerSearch" placeholder="Name, muscle or equipment"></label><label>Category<select name="pickerCategory"><option value="">All exercises</option>${[...new Set(exercises.map(e=>e.category))].sort().map(c=>`<option value="${esc(c)}" ${c===category?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div><p class="small muted picker-count" aria-live="polite"></p><div class="picker-results" aria-label="Available exercises"></div>${onCreate?'<button type="button" class="btn btn-secondary picker-create">Create an exercise</button>':''}</div>`;
  const search=root.querySelector('[name="pickerSearch"]'),filter=root.querySelector('[name="pickerCategory"]'),list=root.querySelector('.picker-results');
  const render=()=>{
    const q=search.value.trim().toLowerCase();
    const matches=exercises.filter(e=>(!filter.value||filter.value===e.category)&&(!q||[e.name,e.code,...(e.muscles||[]),...(e.equipment||[])].join(' ').toLowerCase().includes(q))).sort((a,b)=>Number(suggested.has(b.id))-Number(suggested.has(a.id))||a.name.localeCompare(b.name));
    root.querySelector('.picker-count').textContent=`${matches.length} ${matches.length===1?'exercise':'exercises'} · Select a movement below`;
    list.innerHTML=matches.length?matches.map(e=>`<button type="button" class="picker-choice ${e.id===active?'selected':''}" data-exercise="${e.id}" aria-pressed="${e.id===active}"><span><strong>${esc(e.name)}</strong><small>${esc(e.category)} · ${esc(e.equipment?.join(' · ')||'No equipment specified')}</small></span><span class="picker-mark">${e.id===active?'Selected':suggested.has(e.id)?'Similar':e.custom?'Yours':'Choose'}</span></button>`).join(''):'<div class="empty-state"><h3>No matching exercises</h3><p>Try another search or choose All exercises.</p></div>';
    for(const button of list.querySelectorAll('[data-exercise]'))button.addEventListener('click',()=>{active=button.dataset.exercise;render();onSelect(exercises.find(e=>e.id===active));});
  };
  search.addEventListener('input',render);filter.addEventListener('change',render);
  root.querySelector('.picker-create')?.addEventListener('click',onCreate);
  render();
  return {select(id){active=id;render();}};
}
