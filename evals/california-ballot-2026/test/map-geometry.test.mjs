import test from 'node:test';
import assert from 'node:assert/strict';
import {envelope,projectTurn,nextAxes,projectHero,nextHeroAxes,heroAngle,heroWallOpacity} from '../viewer/map-geometry.js';

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

test('hero keeps continuous position and angular velocity through aligned faces',()=>{
  const p=[3,-4,8],epsilon=1e-5;
  for(let quarter=1;quarter<=16;quarter++){
    const a=quarter*Math.PI/2,before=projectHero(p,a-epsilon),at=projectHero(p,a),after=projectHero(p,a+epsilon);
    assert.ok(Math.abs(at.reduce((sum,n)=>sum+n*n,0)-89)<1e-10);
    for(let k=0;k<3;k++){
      const incoming=(at[k]-before[k])/epsilon,outgoing=(after[k]-at[k])/epsilon;
      assert.ok(Math.abs(incoming-outgoing)<.0002);
    }
  }
});

test('hero swaps only the invisible dimension without changing screen position',()=>{
  const values={a:3,b:-6,c:8,d:-9,e:5,f:-2,g:7},pool=Object.keys(values),seen=new Set();
  let current=['a','b','c'],cursor=3;
  for(let quarter=-28;quarter<=28;quarter++){
    const angle=quarter*Math.PI/2,before=projectHero(current.map(k=>values[k]),angle);
    const next=nextHeroAxes(current,pool,cursor,quarter);
    const after=projectHero(next.axes.map(k=>values[k]),angle);
    assert.equal(new Set(next.axes).size,3);
    assert.ok(Math.abs(before[0]-after[0])<1e-10);
    assert.ok(Math.abs(before[1]-after[1])<1e-10);
    current=next.axes;cursor=next.cursor;current.forEach(id=>seen.add(id));
  }
  assert.equal(seen.size,pool.length);
});

test('hero reverses smoothly and projects rotation around two axes',()=>{
  assert.ok(heroAngle(18000)>heroAngle(17000));
  assert.ok(heroAngle(19000)<heroAngle(18000));
  assert.ok(Math.abs(heroAngle(18000+1)-heroAngle(18000-1))<1e-12);
  assert.ok(projectHero([0,1,0],.5)[2]>.1);
  assert.ok(Math.abs(projectHero([1,0,0],.5)[2])>.1);
});

test('wall grids appear only on the far walls and fade at edge-on orientations',()=>{
  for(const angle of [-5,-1,.2,1,2,5]){
    for(let axis=0;axis<3;axis++){
      const normal=[0,0,0];normal[axis]=1;
      const front=heroWallOpacity(normal,angle),back=heroWallOpacity(normal.map(n=>-n),angle);
      assert.ok(front>=0&&front<=1&&back>=0&&back<=1);
      assert.equal(front*back,0);
      assert.ok(front+back>0);
    }
  }
  assert.equal(heroWallOpacity([0,0,1],0),0);
  assert.equal(heroWallOpacity([0,0,-1],0),1);
  assert.equal(heroWallOpacity([1,0,0],0),0);
});
