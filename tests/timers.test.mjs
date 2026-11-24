import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalSteps } from '../public/js/timers.js';
test('multi-block intervals preserve round recovery and distinct between-block rest',()=>{
 const steps=intervalSteps([{rounds:4,workSec:15,recoverySec:45,restSec:120},{rounds:4,workSec:15,recoverySec:45,restSec:0}]);
 assert.equal(steps.filter(s=>s.phase.startsWith('Work')).length,8);
 assert.equal(steps.filter(s=>s.phase.startsWith('Recover')).length,6);
 assert.equal(steps.filter(s=>s.phase==='Between blocks')[0].seconds,120);
 assert.equal(steps.reduce((n,s)=>n+s.seconds,0),510);
 assert.match(steps.at(-1).phase,/Work/);
});
test('aerobic interval timer does not add an unprescribed final rest',()=>{
 const steps=intervalSteps([{rounds:4,workSec:180,recoverySec:120,restSec:0}]);
 assert.equal(steps.length,7);assert.equal(steps.reduce((n,s)=>n+s.seconds,0),1080);
});
