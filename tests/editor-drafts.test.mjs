import test from 'node:test';
import assert from 'node:assert/strict';
import {readDraft,writeDraft,removeDraft} from '../public/js/editor-drafts.js';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('drafts retain incomplete fields, nested targets and workout order across a new reader',()=>{const s=storage(),value={draft:{title:'My workout',durationMin:''},blocks:[{id:'b'},{id:'a'}],pendingTarget:{exerciseId:'custom',values:{amount:'',sets:'3'}},fields:{name:'My exercise',wristSensitive:true,cues:'First\nSecond'}};assert.equal(writeDraft('workout',value,s),true);assert.deepEqual(readDraft('workout',s),value);assert.equal(readDraft('exercise',s),null);});
test('saving one editor removes only its own draft',()=>{const s=storage();writeDraft('exercise',{name:'A'},s);writeDraft('workout',{title:'B'},s);removeDraft('exercise',s);assert.equal(readDraft('exercise',s),null);assert.deepEqual(readDraft('workout',s),{title:'B'});});
test('unavailable storage reports failure without crashing an editor',()=>{const s={getItem(){throw Error('blocked');},setItem(){throw Error('full');},removeItem(){throw Error('blocked');}};assert.equal(readDraft('a',s),null);assert.equal(writeDraft('a',{},s),false);assert.doesNotThrow(()=>removeDraft('a',s));});
