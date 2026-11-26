import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePreviewMath,isPreviewMathFontFamily} from '../dist/index.js';

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
  for(const bad of ['\\left(x','\\right)','\\left. x\\right.','\\left)x\\right(','\\left\\unknown x\\right|','\\left(\\right)','\\sqrt[]{x}','\\sqrt[3{x}','\\sqrt[3]x','\\vec x','\\hat{}','\\sinx','\\operatorname{foo}','\\href{x}{y}','\\input{secret}','\\def{x}','\\begin{array}x\\end{array}','\\left('.repeat(26)+'x'+'\\right)'.repeat(26)])assert.throws(()=>parsePreviewMath(bad),RangeError,bad);
});


test('bounded native table environments preserve rectangular cells and nested formulas',()=>{
  const matrix=parsePreviewMath('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}').children[0];
  assert.equal(matrix.kind,'table');assert.equal(matrix.environment,'pmatrix');assert.deepEqual(matrix.rows.map(r=>r.map(c=>c.children[0].text)),[['a','b'],['c','d']]);
  const aligned=parsePreviewMath('\\begin{aligned}(x+1)^2&=(x+1)(x+1)\\\\&=x^2+2x+1\\end{aligned}').children[0];
  assert.equal(aligned.rows[1][0].children.length,0);assert.equal(aligned.rows[1][1].children[0].text,'=');
  const cases=parsePreviewMath('f(x)=\\begin{cases}x&x\\geq0\\\\-x&x<0\\end{cases}').children.at(-1);
  assert.equal(cases.environment,'cases');assert.equal(cases.rows[0][1].children[1].text,'≥');
  const nested=parsePreviewMath('\\frac{1}{\\begin{matrix}a&b\\end{matrix}}').children[0];
  assert.equal(nested.denominator.children[0].kind,'table');
  for(const env of ['matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','cases'])assert.equal(parsePreviewMath('\\begin{'+env+'}x\\end{'+env+'}').children[0].environment,env);
});
test('malformed tables, untrusted environments and resource excess are rejected',()=>{
  for(const bad of ['a&b','a\\\\b','\\end{matrix}','\\begin{pmatrix}a\\end{matrix}','\\begin{matrix}a&b\\\\c\\end{matrix}','\\begin{matrix}&b\\end{matrix}','\\begin{matrix}a\\\\\\end{matrix}','\\begin{matrix}a&\\end{matrix}','\\begin{aligned}a\\end{aligned}','\\begin{aligned}a&\\end{aligned}','\\begin{cases}a&b&c\\end{cases}','\\begin{array}a\\end{array}','\\begin{matrix}a&\\input{secret}\\end{matrix}','\\begin{matrix}'+Array(9).fill('x').join('&')+'\\end{matrix}','\\begin{matrix}'+Array(9).fill('x').join('\\\\')+'\\end{matrix}','\\begin{matrix}'+Array(8).fill(Array(8).fill('x').join('&')).join('\\\\')+'&x\\end{matrix}','\\begin{matrix}'.repeat(26)+'x'+'\\end{matrix}'.repeat(26)])assert.throws(()=>parsePreviewMath(bad),RangeError,bad);
});


test('math font role accepts only auto or opaque registered family aliases',()=>{
  for(const value of ['auto','BCFont_Math','BCFont_'+ 'a'.repeat(64)])assert.equal(isPreviewMathFontFamily(value),true,value);
  for(const value of [undefined,null,123,'serif','STIX Two Math','BCFont_','BCFont_'+ 'a'.repeat(65),'BCFont_X; color:red','BCFont_../../file','auto, serif'])assert.equal(isPreviewMathFontFamily(value),false,String(value));
});
