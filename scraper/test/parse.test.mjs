// Run with: node --test scraper/test/*.test.mjs
// Synthetic markup mirroring the structure the parser relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { amount, change, isoDate, parseCityList, parseGoldPage, parseSilverPage, signedCell } from '../src/parse.mjs';

const R = '&#x20b9;';
const goldHtml = `
<h1>Gold Rate in Testpur</h1>
<section data-gr-title="Today Gold Price Per Gram in Testpur (INR)"><h2>Today Gold Price Per Gram in Testpur (INR)</h2>
<table><thead><tr><th>Gram</th><th>24K</th><th>22K</th><th>18K</th></tr></thead><tbody>
<tr><td>1</td><td>${R}14,280 <span>(+316)</span></td><td>${R}13,090 <span>(+290)</span></td><td>${R}10,710 <span>(-237)</span></td></tr>
<tr><td>8</td><td>${R}1,14,240</td><td>${R}1,04,720</td><td>${R}85,680</td></tr>
</tbody></table></section>
<section data-gr-title="Gold Rate in Testpur for Last 10 Days (1 gram)"><h2>Gold Rate in Testpur for Last 10 Days (1 gram)</h2>
<table><thead><tr><th>Date</th><th>24K</th><th>22K</th></tr></thead><tbody>
<tr><td>Nov 04, 2026</td><td>${R}14,280 <span>(+316)</span></td><td>${R}13,090 <span>(+290)</span></td></tr>
<tr><td>Nov 03, 2026</td><td>${R}13,964 <span>(+27)</span></td><td>${R}12,800 <span>(+25)</span></td></tr>
</tbody></table></section>`;

const silverHtml = `
<h2>Today Silver Price Per Gram/Kg in Testpur (INR)</h2>
<table><tr><th>Gram</th><th>Today</th><th>Yesterday</th><th>Change</th></tr>
<tr><td>1</td><td>${R}210</td><td>${R}200</td><td>+&nbsp;${R}10</td></tr>
<tr><td>1000</td><td>${R}2,10,000</td><td>${R}2,00,000</td><td>+&nbsp;${R}10,000</td></tr></table>
<h2>Silver Rate in Testpur for Last 10 Days</h2>
<table><tr><th>Date</th><th>Silver /kg</th></tr>
<tr><td>Nov 04, 2026</td><td>${R}2,10,000 (+10,000)</td></tr>
<tr><td>Nov 03, 2026</td><td>${R}2,00,000 (0)</td></tr></table>`;

test('number helpers', () => {
  assert.equal(amount('₹1,14,240 (+2,528)'), 114240);
  assert.equal(change('₹13,090 (+290)'), 290);
  assert.equal(change('₹4,239 (-138)'), -138);
  assert.equal(signedCell('- ₹1,104'), -1104);
  assert.equal(signedCell('0'), 0);
  assert.equal(isoDate('Nov 04, 2026'), '2026-11-04');
});

test('gold page', () => {
  const g = parseGoldPage(goldHtml);
  assert.deepEqual([g.k24, g.k22, g.k18], [14280, 13090, 10710]);
  assert.deepEqual([g.ch24, g.ch22, g.ch18], [316, 290, -237]);
  assert.equal(g.date, '2026-11-04');
  assert.deepEqual(g.history[1], { d: '2026-11-03', k24: 13964, k22: 12800 });
});

test('silver page', () => {
  const s = parseSilverPage(silverHtml);
  assert.equal(s.g, 210);
  assert.equal(s.kg, 210000);
  assert.equal(s.chKg, 10000);
  assert.equal(s.history.length, 2);
});

test('city list', () => {
  const html = `<div class="gd-metal-indian-city"><a href="/gold-rates/agra.html"> Agra </a><a href="/gold-rates/vasai-virar.html">Vasai-Virar</a></div>`;
  assert.deepEqual(parseCityList(html), [{ slug: 'agra', name: 'Agra' }, { slug: 'vasai-virar', name: 'Vasai-Virar' }]);
});
