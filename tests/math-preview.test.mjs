import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePreviewMath,parseDisplayMath} from '../dist/index.js';
test('bounded TeX subset yields fraction, root and paired scripts',()=>{
  const ast=parsePreviewMath(String.raw`\frac{-b+\sqrt{b^2-4ac}}{2a}`);
  assert.equal(ast.children[0].kind,'frac');
  const frac=ast.children[0],root=frac.numerator.children[3];
  assert.equal(root.kind,'sqrt');
  assert.equal(root.body.children[0].kind,'script');
  assert.equal(root.body.children[0].sup.text,'2');
  const sum=parsePreviewMath(String.raw`\sum_{k=1}^{n}k`).children[0];
  assert.equal(sum.kind,'script');assert.equal(sum.base.text,'∑');
  assert.equal(sum.sub.children[0].text,'k');assert.equal(sum.sup.children[0].text,'n');
  assert.deepEqual(parsePreviewMath('x^12').children.map(x=>x.kind),['script','mn']);
});
test('reject malformed or unsafe formula syntax and enforce work bounds',()=>{
  for(const value of ['', ' ', 'x^', 'x^2^3', '{}','{x','x}', '\\frac{x}', '\\sqrt{}','\\input{a}','\\href{x}{y}','\\htmlClass{x}{y}','\\def\\x{y}','\\begin{array}a&b\\end{array}','x\n+y','x'.repeat(513),'{'.repeat(26)+'x'+'}'.repeat(26),'a'.repeat(2049)])
    assert.throws(()=>parsePreviewMath(value),RangeError,value);
  assert.equal(parsePreviewMath('x<y').children[1].text,'<');
});


test('display source preserves lexical boundaries across LF and CRLF',()=>{
  const source=['\\begin{aligned}','  (x+1)^2 &= (x+1)(x+1) \\\\','  &= x^2+2x+1','\\end{aligned}'].join('\n');
  assert.deepEqual(parseDisplayMath(source),parsePreviewMath(source.replace(/\n/g,' ')));
  assert.deepEqual(parseDisplayMath(source.replace(/\n/g,'\r\n')),parseDisplayMath(source));
  assert.deepEqual(parseDisplayMath('x\n+\t y'),parsePreviewMath('x + y'));
  assert.throws(()=>parsePreviewMath(source),RangeError);
  for(const bad of ['x\ry','\\si\nn x','\\input\n{secret}','x\n$$\ny','x\n'+ ' '.repeat(2048),'\n\t\r\n'])assert.throws(()=>parseDisplayMath(bad),RangeError,bad);
});
