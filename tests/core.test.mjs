import test from 'node:test';
import assert from 'node:assert/strict';
import {toMicrometres,distributeFill,layoutFlow,anchoredOffset} from '../dist/index.js';
test('physical units',()=>{assert.equal(toMicrometres('25.4mm'),25400);assert.equal(toMicrometres('72pt'),25400);assert.equal(toMicrometres('1in'),25400);assert.throws(()=>toMicrometres('-1mm'));});
test('deterministic fill with remainder',()=>assert.deepEqual(distributeFill(10,3),[3,3,4]));
test('row and column with gaps',()=>{const c=[{width:2,height:5},{width:10,height:5}], a={width:20,height:20};assert.deepEqual(layoutFlow('row',c,3,a).map(r=>[r.x,r.y]),[[0,0],[5,0]]);assert.deepEqual(layoutFlow('column',c,3,a).map(r=>[r.x,r.y]),[[0,0],[0,8]]);});
test('overflow is not clipped silently',()=>assert.throws(()=>layoutFlow('row',[{width:3,height:4}],0,{width:2,height:5}))); 
test('anchor offsets',()=>{assert.equal(anchoredOffset(100,20,'end',5),75);assert.equal(anchoredOffset(100,20,'center',-5),35);});
