import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access, mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, root, readCatalog } from '../scripts/build.mjs';

test('Pages build publishes every registered viewer and transcript, without runner or raw data', async () => {
  const catalog = await build();
  assert.equal(catalog[0].id, 'zork-1');
  const data = JSON.parse(await readFile(join(root, 'dist/evals/zork-1/data/results.json')));
  assert.ok(data.runs.length >= 30);
  for (const run of data.runs) {
    const transcript = JSON.parse(await readFile(join(root, 'dist/evals/zork-1/data', run.transcript)));
    assert.equal(transcript.id, run.id);
    assert.ok(transcript.commands.length > 0);
    for (const command of transcript.commands) assert.equal(typeof command.response, 'string');
  }
  for (const path of ['evals/zork-1/src', 'evals/zork-1/data/raw', 'evals/zork-1/zork1.z3', '.env']) await assert.rejects(access(join(root, 'dist', path)));
  async function inspect(directory) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, file.name);
      if (file.isDirectory()) await inspect(path);
      else if (file.name.endsWith('.html')) {
        const html = await readFile(path, 'utf8');
        assert.doesNotMatch(html, /(?:src|href)=["']\//, `${path} must support project Pages prefixes`);
      }
    }
  }
  await inspect(join(root, 'dist'));
});

test('artifact evals register automatically; mismatched ids fail before publication', async t => {
  const base = await mkdtemp(join(tmpdir(), 'vibeval-build-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(join(base, 'evals'), { recursive: true });
  await cp(join(root, 'templates/static-artifacts'), join(base, 'evals/new-eval'), { recursive: true });
  const manifest = { id: 'new-eval', title: 'New eval', description: 'One shared prompt', kind: 'static-artifacts' };
  await writeFile(join(base, 'evals/new-eval/eval.json'), JSON.stringify(manifest));
  assert.equal((await readCatalog(base))[0].url, 'evals/new-eval/');
  await cp(join(root, 'apps'), join(base, 'apps'), { recursive: true });
  await cp(join(root, 'packages/viewer'), join(base, 'packages/viewer'), { recursive: true });
  await build(base);
  await access(join(base, 'dist/evals/new-eval/data/artifacts.json'));
  manifest.id = '../escape';
  await writeFile(join(base, 'evals/new-eval/eval.json'), JSON.stringify(manifest));
  await assert.rejects(build(base), /Invalid eval id/);
});
