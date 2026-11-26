const key=form=>'shift-entry-draft:'+form.dataset.draftKey;
export function keepLogDrafts(root,sessionId,prescriptions) {
  for(const form of root.querySelectorAll('form[data-log]')) {
    const block=prescriptions.find(row=>row.id===form.dataset.sx);
    form.dataset.draftKey=[sessionId,form.dataset.sx,block?.exerciseId,form.dataset.log,form.dataset.index||'entry'].join(':');
    try {
      const draft=JSON.parse(sessionStorage.getItem(key(form))||'null');
      if(draft)for(const [name,value] of Object.entries(draft)){const field=form.elements.namedItem(name);if(field&&typeof field.value==='string')field.value=value;}
    }catch{}
    const save=()=>{try{sessionStorage.setItem(key(form),JSON.stringify(Object.fromEntries(new FormData(form))));}catch{}};
    form.addEventListener('input',save);form.addEventListener('change',save);
  }
}
export function clearLogDraft(form){try{sessionStorage.removeItem(key(form));}catch{}}
