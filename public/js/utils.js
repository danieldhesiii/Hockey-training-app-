export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt=(value,places=0)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value).toLocaleString('en-GB',{maximumFractionDigits:places}):'Not logged';
export const uid=()=>crypto.randomUUID();
export function today(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');}
export function addDays(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function prettyDate(date,opts={weekday:'short',day:'numeric',month:'short'}){return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',...opts}).format(new Date(date+'T12:00:00Z'));}
export function weekStart(date){const d=new Date(date+'T12:00:00Z');return addDays(date,-((d.getUTCDay()+6)%7));}
export function daysBetween(a,b){return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);}
export function isoNow(){return new Date().toISOString();}
export function minuteClock(seconds){const n=Math.max(0,Math.round(seconds));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
export function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
export function number(form,key,fallback=null){const v=form.get(key);return v===null||v===''?fallback:Number(v);}
export function download(name,contents,type='application/json'){const blob=new Blob([contents],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function ordinal(n){return `${n}${n%100>=11&&n%100<=13?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th')}`;}
export const alive=rows=>(rows||[]).filter(r=>!r.deleted);
export const sum=values=>values.reduce((a,b)=>a+(Number(b)||0),0);
export const mean=values=>values.length?sum(values)/values.length:null;
export function isoWeekLabel(date){return prettyDate(weekStart(date),{day:'numeric',month:'short'});}
