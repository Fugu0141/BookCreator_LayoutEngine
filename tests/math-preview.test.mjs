import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePreviewMath} from '../dist/index.js';
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
  for(const value of ['', ' ', 'x^', 'x^2^3', '{}','{x','x}', '\\frac{x}', '\\sqrt{}','\\input{a}','\\href{x}{y}','\\htmlClass{x}{y}','\\def\\x{y}','\\begin{matrix}a&b\\end{matrix}','x\n+y','x'.repeat(513),'{'.repeat(26)+'x'+'}'.repeat(26),'a'.repeat(2049)])
    assert.throws(()=>parsePreviewMath(value),RangeError,value);
  assert.equal(parsePreviewMath('x<y').children[1].text,'<');
});
