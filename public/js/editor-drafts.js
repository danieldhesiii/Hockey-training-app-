const prefix='shift-editor-draft:';
export function readDraft(key,storage){try{return JSON.parse((storage||globalThis.localStorage).getItem(prefix+key)||'null');}catch{return null;}}
export function writeDraft(key,value,storage){try{(storage||globalThis.localStorage).setItem(prefix+key,JSON.stringify(value));return true;}catch{return false;}}
export function removeDraft(key,storage){try{(storage||globalThis.localStorage).removeItem(prefix+key);}catch{}}

export function bindFormDraft(form,key,{onChange=()=>{}}={}) {
  const status=document.createElement('p');status.className='small muted mt-16';status.setAttribute('role','status');
  form.prepend(status);
  const saved=readDraft(key);
  if(saved?.fields)for(const field of form.elements){if(!field.name||field.disabled||!(field.name in saved.fields))continue;if(field.type==='checkbox')field.checked=!!saved.fields[field.name];else field.value=saved.fields[field.name];}
  status.textContent=saved?'Draft restored from this device.':'Your draft saves automatically on this device.';
  const save=()=>{
    const fields={};for(const field of form.elements)if(field.name&&!field.disabled)fields[field.name]=field.type==='checkbox'?field.checked:field.value;
    const ok=writeDraft(key,{fields,updatedAt:new Date().toISOString()});
    status.textContent=ok?'Draft saved on this device.':'Draft could not be saved. Keep this editor open until you save.';
    onChange();
  };
  form.addEventListener('input',save);form.addEventListener('change',save);
  return {clear:()=>removeDraft(key)};
}
