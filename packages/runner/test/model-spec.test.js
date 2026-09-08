import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeModelSpec, parseModelSpec } from '../src/model-spec.js';

test('a bare entry inherits the batch provider', () => {
  assert.deepEqual(parseModelSpec('claude-sonnet-5', 'claude-cli'), {
    provider: 'claude-cli',
    name: 'claude-sonnet-5',
    effort: null,
    web: false,
    label: 'claude-sonnet-5',
  });
});

test('an entry may carry its own backend and effort', () => {
  assert.deepEqual(parseModelSpec('codex-cli:gpt-5.6-sol@medium', 'claude-cli'), {
    provider: 'codex-cli',
    name: 'gpt-5.6-sol',
    effort: 'medium',
    web: false,
    label: 'gpt-5.6-sol',
  });
});

test('+web labels the run apart from the sealed one', () => {
  const spec = parseModelSpec('codex-cli:gpt-5.6-terra@medium+web', 'claude-cli');
  assert.equal(spec.name, 'gpt-5.6-terra');
  assert.equal(spec.effort, 'medium');
  assert.equal(spec.web, true);
  // The label is the run tag and the report row: a walkthrough-assisted run
  // must never pool with a sealed run of the same model.
  assert.equal(spec.label, 'gpt-5.6-terra+web');
  assert.notEqual(spec.label, parseModelSpec('gpt-5.6-terra', 'codex-cli').label);
});

test('+web works without an effort suffix', () => {
  const spec = parseModelSpec('codex-cli:gpt-5.6-luna+web', 'claude-cli');
  assert.equal(spec.name, 'gpt-5.6-luna');
  assert.equal(spec.effort, null);
  assert.equal(spec.web, true);
});

test('describeModelSpec round-trips what was written', () => {
  for (const entry of [
    'codex-cli:gpt-5.6-sol@medium',
    'codex-cli:gpt-5.6-luna+web',
    'codex-cli:gpt-5.6-terra@medium+web',
  ]) {
    assert.equal(describeModelSpec(parseModelSpec(entry, 'x')), entry);
  }
});
