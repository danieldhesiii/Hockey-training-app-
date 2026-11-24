import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateBackup } from '../public/js/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const check = async (name, fn) => {
  try { const detail = await fn(); console.log(`OK ${name}${detail ? ': ' + detail : ''}`); }
  catch (error) { errors.push(name); console.error(`FAIL ${name}: ${error.message}`); }
};

await check('Node runtime', () => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'Node 22 or later is required');
  return process.versions.node;
});

await check('Programme schema and core references', async () => {
  const programme = JSON.parse(await readFile(path.join(root, 'public/data/programme.json'), 'utf8'));
  validateBackup(programme);
  assert.equal(programme.plan.length, 1);
  assert.equal(programme.weeks.length, 52);
  assert.equal(programme.weeks[0].startDate, programme.plan[0].calendarStartDate);
  assert.equal(programme.weeks.at(-1).endDate, programme.plan[0].endDate);
  const exerciseIds = new Set(programme.exercises.map(row => row.id));
  const sessionIds = new Set(programme.sessions.map(row => row.id));
  const weekIds = new Set(programme.weeks.map(row => row.id));
  assert.equal(sessionIds.size, programme.sessions.length, 'Duplicate session identifiers');
  for (const row of programme.sessions) {
    assert.ok(weekIds.has(row.weekId), 'Session references a missing week');
    for (const block of [...row.warmup, ...row.cooldown]) assert.ok(exerciseIds.has(block.exerciseId), 'Warm-up or cool-down references a missing exercise');
  }
  for (const row of programme.session_exercises) {
    assert.ok(sessionIds.has(row.sessionId), 'Exercise row references a missing session');
    assert.ok(exerciseIds.has(row.exerciseId), 'Prescription references a missing exercise');
    assert.ok(row.targetSets.length > 0, 'Prescription has no working targets');
    if (row.indoorSwap) assert.ok(exerciseIds.has(row.indoorSwap.exerciseId), 'Indoor swap references a missing exercise');
  }
  for (const name of ['set_logs', 'skill_logs', 'test_results', 'wellness_logs', 'personal_records']) assert.equal(programme[name].length, 0, 'Seed must not contain fabricated logs');
  return `${programme.weeks.length} weeks, ${programme.sessions.length} sessions, ${programme.session_exercises.length} exercise prescriptions`;
});

await check('Manifest and local application assets', async () => {
  const publicRoot = path.join(root, 'public');
  const manifest = JSON.parse(await readFile(path.join(publicRoot, 'manifest.webmanifest'), 'utf8'));
  assert.ok(manifest.name && manifest.short_name && manifest.start_url);
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    assert.ok(!/^(?:https?:)?\/\//.test(icon.src), 'Application icons must be locally available offline');
    await access(path.resolve(publicRoot, icon.src.replace(/^\//, '')));
  }
  for (const file of ['index.html', 'styles.css', 'sw.js', 'js/app.js', 'js/db.js', 'js/coaching.js', 'js/timers.js']) await access(path.join(publicRoot, file));
  return `${manifest.icons.length} bundled icons`;
});

await check('JavaScript syntax', async () => {
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (/\.(?:mjs|js)$/.test(entry.name)) files.push(file);
    }
  }
  for (const directory of ['public/js', 'scripts', 'tests']) await collect(path.join(root, directory));
  files.push(path.join(root, 'public/sw.js'));
  const failures = [];
  for (const file of files.sort()) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.error || result.status !== 0) failures.push(`${path.relative(root, file)}: ${result.error?.message || result.stderr.trim()}`);
  }
  assert.equal(failures.length, 0, failures.join('\n'));
  return `${files.length} source files, including the service worker template`;
});

if (errors.length) {
  console.error(`${errors.length} check group(s) failed. Run npm test for behavioural regression coverage.`);
  process.exitCode = 1;
} else {
  console.log('Checks passed. Run npm test for behavioural regression coverage.');
}
