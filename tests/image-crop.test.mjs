import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImageCrop,imageSourceRect} from '../dist/index.js';
test('source insets precede fit and retain physical aspect',()=>{
  const crop={left:1000,top:2000,right:3000,bottom:1000};
  assert.deepEqual(imageSourceRect(1000,500,300,300,'contain',crop),{x:100,y:100,width:600,height:350});
  assert.deepEqual(imageSourceRect(1000,500,300,300,'cover',crop),{x:225,y:100,width:350,height:350});
  assert.deepEqual(imageSourceRect(1000,500,300,300,'cover'),{x:250,y:0,width:500,height:500});
  assert.deepEqual(crop,{left:1000,top:2000,right:3000,bottom:1000});
});
test('invalid, empty, fractional and extra crop fields are rejected',()=>{
  for(const c of [null,[],{}, {left:9900,top:0,right:1,bottom:0},{left:-1,top:0,right:0,bottom:0},{left:.5,top:0,right:0,bottom:0},{left:0,top:0,right:0,bottom:0,url:'x'}])assert.throws(()=>validateImageCrop(c),RangeError);
});
