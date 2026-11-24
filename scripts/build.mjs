import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await rm(path.join(root,'dist'),{recursive:true,force:true});
await mkdir(path.join(root,'dist'),{recursive:true});
await cp(path.join(root,'public'),path.join(root,'dist'),{recursive:true});
try { await cp(path.join(root,'docs/training-programme.html'),path.join(root,'dist/training-programme.html')); } catch { throw new Error('Generate the training programme before building. Run npm run generate.'); }
async function files(dir,relative='') { let out=[]; for(const d of await readdir(dir,{withFileTypes:true})) { const r=path.posix.join(relative,d.name); if(d.isDirectory()) out.push(...await files(path.join(dir,d.name),r));else out.push(r); }return out; }
const all=(await files(path.join(root,'dist'))).filter(f=>f!=='sw.js').sort();
const hash=createHash('sha256');for(const f of all)hash.update(await readFile(path.join(root,'dist',f)));
const version=hash.digest('hex').slice(0,14);
let sw=await readFile(path.join(root,'public/sw.js'),'utf8');
sw=sw.replace('__BUILD_VERSION__',version).replace('__PRECACHE_FILES__',JSON.stringify(['./',...all.map(f=>'./'+f)]));
await writeFile(path.join(root,'dist/sw.js'),sw);
console.log(`Built ${all.length+1} local assets. Cache version ${version}. No runtime CDN dependencies.`);
