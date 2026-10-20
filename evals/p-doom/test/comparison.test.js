import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonMatrix, thinkingLevels } from '../src/batch.js';
import { calculationGraph, formulaFor, formatPercent, modelName } from '../viewer/graph.js';

test('comparison matrix has three attempts for each supported Luna thinking level and matched medium model trials', () => {
  const matrix = comparisonMatrix();
  assert.equal(matrix.length, 21);
  for (const effort of thinkingLevels) assert.deepEqual(matrix.filter(j => j.model === 'gpt-6-luna' && j.effort === effort).map(j => j.trial), [1,2,3]);
  for (const model of ['gpt-6-sol', 'gpt-6-astra']) assert.deepEqual(matrix.filter(j => j.model === model).map(j => [j.effort,j.trial]), [['medium',1],['medium',2],['medium',3]]);
});

test('calculation diagram reuses shared assumptions and preserves AND/OR proof structure without inventing gate probabilities', () => {
  const submission = { parameters: ['shared','a','b'].map(atom => ({ atom, low: 0.1, central: 0.2, high: 0.4 })),
    rules: [{ head: 'p_doom', body: ['shared', 'a'] }, { head: 'p_doom', body: ['shared', 'b'] }] };
  const graph = calculationGraph(submission, { queries: { p_doom: 0.072 } });
  assert.equal(graph.nodes.filter(n => n.id === 'shared').length, 1);
  assert.equal(graph.nodes.find(n => n.id === 'p_doom').operator, 'OR');
  assert.equal(graph.nodes.filter(n => n.kind === 'gate' && n.operator === 'AND').length, 2);
  assert.ok(graph.nodes.filter(n => n.kind === 'gate').every(n => n.probability === undefined));
  assert.equal(graph.edges.filter(e => e.from === 'shared').length, 2);
  assert.equal(formulaFor(graph.nodes.find(n => n.id === 'p_doom')), '(shared AND a) OR (shared AND b)');
  for (const edge of graph.edges) assert.ok(graph.nodes.find(n => n.id === edge.from).rank < graph.nodes.find(n => n.id === edge.to).rank);
  assert.equal(formatPercent(0), '0.0%'); assert.equal(formatPercent(1e-8), '0.0%');
  assert.equal(formatPercent(0.025706862942653015), '2.6%');
  assert.equal(modelName('gpt-6-sol'), 'Sol 6');
  assert.equal(modelName('gpt-6.1-sol'), 'Sol 6.1');
});
