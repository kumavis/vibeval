import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildAxes} from '../src/axes.mjs';
const rubric = JSON.parse(await readFile(new URL('../axis-rubric.json', import.meta.url), 'utf8'));
const vote = (contestId, choice, status = 'voted') => ({contestId, choices: choice ? [choice] : [], status});
const run = (id, decisions = [], extra = {}) => ({id, status: 'completed', validation: {valid: true}, response: {decisions, compass: {economic: -3.7, social: null}}, ...extra});
const build = runs => buildAxes({runs}, rubric);

test('eligibility excludes pending, failed, invalid and unvalidated results', () => {
  const result = build([run('ok'), run('pending', [], {status:'pending'}), run('failed', [], {status:'failed'}), run('invalid', [], {validation:{valid:false}}), run('unknown', [], {validation:null})]);
  assert.deepEqual(Object.keys(result.runs), ['ok']);
  assert.equal(result.counts.excludedRuns, 4);
});

test('abstentions are missing, not neutral; minimum is half rounded up', () => {
  const result = build([run('one', [vote('ca-proposition-3', 'Yes')]), run('two', [vote('ca-proposition-3','Yes'), vote('ca-proposition-40',null,'abstain'), vote('alameda-measure-j','No')])]);
  assert.equal(result.runs.one['public-revenue'], null);
  assert.equal(result.evidence.one['public-revenue'].answered, 1);
  assert.equal(result.evidence.one['public-revenue'].minAnswered, 2);
  assert.equal(result.runs.two['public-revenue'], 0); // a genuine balanced mean
  assert.equal(result.evidence.two['public-revenue'].answered, 2);
  assert.equal(result.evidence.two['public-revenue'].total, 4);
});

test('single-item axis has only yes/no endpoints or null, never imputed zero', () => {
  const result = build([run('yes',[vote('ca-proposition-39','Yes')]),run('no',[vote('ca-proposition-39','No')]),run('blank',[vote('ca-proposition-39',null,'insufficient_information')])]);
  assert.equal(result.runs.yes['voter-id'],10);
  assert.equal(result.runs.no['voter-id'],-10);
  assert.equal(result.runs.blank['voter-id'],null);
});

test('equal weights use answered denominator and retain exact self-report', () => {
  const input = [run('r',[vote('ca-proposition-3','Yes'),vote('ca-proposition-40','No'),vote('alameda-measure-rtm','Yes')])];
  const before = JSON.stringify(input), result = build(input);
  assert.equal(result.runs.r['public-revenue'],10/3);
  assert.equal(result.runs.r.economic,-3.7);
  assert.equal(result.runs.r.social,null);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(build(input),result);
});

test('ambiguous or malformed votes and invalid self-reports cannot masquerade as data', () => {
  const result = build([run('r',[vote('ca-proposition-39','Yes'),vote('ca-proposition-39','No'),{contestId:'ca-proposition-44',status:'voted',choices:['Yes','No']}],{response:{decisions:[vote('ca-proposition-39','Yes'),vote('ca-proposition-39','No'),{contestId:'ca-proposition-44',status:'voted',choices:['Yes','No']}],compass:{economic:11,social:'0'}}})]);
  assert.equal(result.runs.r['voter-id'],null);
  assert.equal(result.runs.r['clinic-spending-rule'],null);
  assert.equal(result.runs.r.economic,null);
  assert.equal(result.runs.r.social,null);
  assert.throws(()=>build([run('duplicate'),run('duplicate')]), /duplicate run ID/);
});

test('rubric references only frozen measures, includes clear labels/sources and rejects collisions', async () => {
  const ballot = JSON.parse(await readFile(new URL('../research/san-leandro-ballot.json', import.meta.url),'utf8'));
  const result = buildAxes({ballot,runs:[run('r')]},rubric);
  assert.equal(result.axes.length,15);
  for (const a of result.axes) {
    assert.equal(a.lowLabel,a.negativeLabel);
    assert.equal(a.highLabel,a.positiveLabel);
    assert.ok(a.description.includes('minimum'));
    for (const i of a.items) assert.ok(i.sourceUrls.every(url=>url.startsWith('https://')));
  }
  assert.throws(()=>buildAxes({ballot:{contests:[]},runs:[]},rubric), /absent\/non-measure/);
  assert.throws(()=>buildAxes({runs:[]},{...rubric,axes:[rubric.axes[0],rubric.axes[0]]}),/unique/);
});

// A reversed legal-constraint vote must have the opposite sign from a funding vote.
test('primary dimensions reverse constraint items and require their published minima', () => {
  const result = build([run('r',[vote('ca-proposition-3','Yes'),vote('ca-proposition-40','No'),vote('ca-proposition-42','No'),vote('ca-proposition-41','No'),vote('ca-proposition-43','No'),vote('ca-proposition-44','No'),vote('ca-proposition-45','Yes'),vote('ca-proposition-1','Yes'),vote('ca-proposition-37','Yes')])]);
  assert.equal(result.runs.r['redistributive-taxation'],10/3);
  assert.equal(result.runs.r['governance-constraints'],-10);
  assert.equal(result.runs.r['public-investment'],null);
  assert.equal(result.evidence.r['public-investment'].minAnswered,3);
  assert.equal(result.evidence.r['governance-constraints'].items.find(i=>i.contestId==='ca-proposition-45').score,-10);
});
