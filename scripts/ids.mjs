import { createHash } from 'node:crypto';
export function uuid(key) {
  const s = createHash('sha256').update('shift-hockey-v1:'+key).digest('hex').slice(0,32).split('');
  s[12]='5'; s[16]=((parseInt(s[16],16)&3)|8).toString(16);
  const h=s.join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export const seededAt='2026-11-24T00:00:00.000Z';
export const record=(key,data)=>({id:uuid(key),createdAt:seededAt,updatedAt:seededAt,deleted:false,...data});
