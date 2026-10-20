import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/process.js';
import { fixture, reviewFor } from './fixtures.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('offline lint handles evaluate/review files and malformed JSON without available model or Python tools', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'doom-lint-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = fixture(), revised = { ...target, action: 'submit', review: reviewFor(target) };
  const previous = join(directory, 'previous.json'), candidate = join(directory, 'candidate.json');
  await writeFile(previous, JSON.stringify(target));
  await writeFile(candidate, JSON.stringify(revised));
  const args = [cli, '--as-of', '2026-10-19T00:00:00Z', '--codex', '/missing/codex', '--python', '/missing/python'];
  const evaluated = await execute(process.execPath, [...args, '--lint', previous]);
  assert.equal(evaluated.code, 0); assert.equal(JSON.parse(evaluated.stdout).valid, true);
  const reviewed = await execute(process.execPath, [...args, '--lint', candidate, '--previous', previous]);
  assert.equal(reviewed.code, 0); assert.equal(JSON.parse(reviewed.stdout).valid, true);
  const noTarget = await execute(process.execPath, [...args, '--lint', candidate]);
  assert.equal(noTarget.code, 1); assert.equal(JSON.parse(noTarget.stdout).valid, false);
  await writeFile(candidate, '{broken');
  const broken = await execute(process.execPath, [...args, '--lint', candidate]);
  assert.equal(broken.code, 1); assert.equal(JSON.parse(broken.stdout).errors[0].code, 'input');
});
