import test from 'node:test';
import assert from 'node:assert/strict';
import {watchAppUpdates} from '../public/js/app-updates.js';

class Worker extends EventTarget{state='installing';messages=[];postMessage(value){this.messages.push(value);}setState(value){this.state=value;this.dispatchEvent(new Event('statechange'));}}
function setup(){const serviceWorker=new EventTarget();serviceWorker.controller=null;const registration=new EventTarget();registration.waiting=null;registration.installing=null;let reloads=0,ready=0;const controls=watchAppUpdates(registration,serviceWorker,{onReload:()=>reloads++,onReady:()=>ready++});return {serviceWorker,registration,controls,get reloads(){return reloads;},get ready(){return ready;}};}

test('first offline installation does not prevent a later accepted update from reloading',async()=>{
  const h=setup();h.serviceWorker.controller={};h.serviceWorker.dispatchEvent(new Event('controllerchange'));assert.equal(h.reloads,0);
  const worker=new Worker();h.registration.installing=worker;h.registration.dispatchEvent(new Event('updatefound'));h.registration.waiting=worker;worker.setState('installed');assert.equal(h.ready,1);
  await h.controls.apply();assert.deepEqual(worker.messages,[{type:'SKIP_WAITING'}]);h.serviceWorker.dispatchEvent(new Event('controllerchange'));h.serviceWorker.dispatchEvent(new Event('controllerchange'));assert.equal(h.reloads,1);
});
test('an update activated by another tab does not discard this tab until accepted',async()=>{
  const h=setup();h.serviceWorker.controller={};const worker=new Worker();h.registration.installing=worker;h.registration.dispatchEvent(new Event('updatefound'));worker.setState('installed');h.serviceWorker.dispatchEvent(new Event('controllerchange'));assert.equal(h.reloads,0);
  await h.controls.apply();assert.equal(h.reloads,1,'already-active update reloads directly instead of messaging an obsolete worker');
});
test('accepting an update uses the latest waiting worker after a newer deployment replaces it',async()=>{
  const h=setup(),old=new Worker(),latest=new Worker();h.registration.waiting=old;h.registration.waiting=latest;await h.controls.apply();assert.deepEqual(old.messages,[]);assert.equal(latest.messages.length,1);
});
