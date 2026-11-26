import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePreviewMath} from '../dist/index.js';

test('function tokens, limits, arrows, accents and indexed roots are typed',()=>{
  const nodes=parsePreviewMath('\\lim_{x\\to0}\\frac{\\sin x}{x}').children;
  assert.equal(nodes[0].kind,'script');
  assert.deepEqual(nodes[0].base,{kind:'function',text:'lim',limits:true});
  assert.equal(nodes[0].sub.children[1].text,'→');
  assert.deepEqual(nodes[1].numerator.children[0],{kind:'function',text:'sin'});
  assert.deepEqual(parsePreviewMath('\\log_2 x').children[0].base,{kind:'function',text:'log'});
  const accents=parsePreviewMath('\\vec{a}\\cdot\\hat{b}+\\ddot{x}').children;
  assert.equal(accents[0].kind,'accent');assert.equal(accents[0].mark,'→');
  assert.equal(accents[2].mark,'^');assert.equal(accents[4].mark,'¨');
  const root=parsePreviewMath('\\sqrt[3]{x}').children[0];
  assert.equal(root.kind,'root');assert.equal(root.index.children[0].text,'3');
});
test('nested scalable fences and one-sided delimiters preserve structure',()=>{
  const outer=parsePreviewMath('\\left[\\left(\\frac{a}{b}\\right)^2\\right]').children[0];
  assert.equal(outer.kind,'fenced');assert.equal(outer.left,'[');assert.equal(outer.right,']');
  assert.equal(outer.body.children[0].base.kind,'fenced');
  const one=parsePreviewMath('\\left.\\frac{a}{b}\\right|').children[0];
  assert.equal(one.left,'');assert.equal(one.right,'|');
  assert.equal(parsePreviewMath('\\left\\langle a,b\\right\\rangle').children[0].left,'⟨');
});
test('extended grammar still rejects malformed delimiters and executable constructs',()=>{
  for(const bad of ['\\left(x','\\right)','\\left. x\\right.','\\left)x\\right(','\\left\\unknown x\\right|','\\left(\\right)','\\sqrt[]{x}','\\sqrt[3{x}','\\sqrt[3]x','\\vec x','\\hat{}','\\sinx','\\operatorname{foo}','\\href{x}{y}','\\input{secret}','\\def{x}','\\begin{matrix}x\\end{matrix}','\\left('.repeat(26)+'x'+'\\right)'.repeat(26)])assert.throws(()=>parsePreviewMath(bad),RangeError,bad);
});
