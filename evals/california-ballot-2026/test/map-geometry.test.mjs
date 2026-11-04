import test from 'node:test';
import assert from 'node:assert/strict';
import {envelope,projectTurn,nextAxes} from '../viewer/map-geometry.js';

test('observed envelopes collapse duplicates and collinear rounds without inventing area',()=>{
  assert.deepEqual(envelope([]),[]);
  assert.deepEqual(envelope([{x:2,y:4},{x:2,y:4}]),[{x:2,y:4}]);
  assert.deepEqual(envelope([{x:1,y:1},{x:0,y:0},{x:2,y:2},{x:1,y:1}]),[{x:0,y:0},{x:2,y:2}]);
  assert.deepEqual(envelope([{x:0,y:3},{x:0,y:1},{x:0,y:2}]),[{x:0,y:1},{x:0,y:3}]);
  assert.equal(envelope([{x:0,y:0},{x:3,y:0},{x:1,y:2},{x:1,y:1}]).length,3);
});

test('a hidden-axis swap preserves visible coordinates at each quarter-turn boundary',()=>{
  const values={a:3,b:-6,c:8,d:-9,e:5},pool=Object.keys(values);
  let current=['a','b','c'],cursor=3;
  for(let turn=0;turn<20;turn++){
    const vertical=turn%2===1;
    const end=projectTurn(current.map(k=>values[k]),Math.PI/2,vertical);
    const next=nextAxes(current,pool,cursor,vertical);
    assert.equal(new Set(next.axes).size,3);
    const start=projectTurn(next.axes.map(k=>values[k]),0,!vertical);
    assert.ok(Math.abs(end[0]-start[0])<1e-12);
    assert.ok(Math.abs(end[1]-start[1])<1e-12);
    current=next.axes;cursor=next.cursor;
  }
});

test('tour projections preserve length and visit every dimension',()=>{
  const p=[3,-4,8],q=projectTurn(p,.67,true);
  assert.ok(Math.abs(p.reduce((s,n)=>s+n*n,0)-q.reduce((s,n)=>s+n*n,0))<1e-10);
  let current=['a','b','c'],cursor=3;const pool=['a','b','c','d','e','f','g'],seen=new Set(current);
  for(let n=0;n<30;n++){const next=nextAxes(current,pool,cursor,n%2===1);current=next.axes;cursor=next.cursor;current.forEach(id=>seen.add(id));}
  assert.equal(seen.size,pool.length);
});
