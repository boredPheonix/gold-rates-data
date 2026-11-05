#!/usr/bin/env node
// Scrapes city-wise gold/silver rates (goodreturns.in) + live international
// spot prices (gold-api.com) and publishes a static JSON API.
//
//   node scraper/src/scrape.mjs --data <state dir> --out <site dir> [--full]
//
// <state dir> persists between runs (the `data` git branch): history per city,
// last snapshot, spot reference. <site dir>/api/v1 receives the public API.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseCityList, parseGoldPage, parseSilverPage, parsePlatinumPage } from './parse.mjs';
import { metaFor, SENTINELS } from './cities.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DATA = path.resolve(opt('data', 'data'));
const OUT = path.resolve(opt('out', 'site'));
const FORCE_FULL = args.includes('--full') || process.env.FORCE_FULL === 'true';
const FULL_EVERY_MS = Number(process.env.FULL_EVERY_MIN || 180) * 60_000;
const BASE = 'https://www.goodreturns.in';
const UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const OZ = 31.1034768;
const now = new Date();
const nowIso = now.toISOString();

const log = (...a) => console.log(`[scrape]`, ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v, pretty = false) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, pretty ? 2 : 0));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Offline mode for local testing: FIXTURES=<dir> serves saved pages instead of
// hitting the network (unknown city pages fall back to the Kakinada sample).
const FIXTURES = process.env.FIXTURES;
function fixture(url) {
  const f = (n) => fs.readFileSync(path.join(FIXTURES, n), 'utf8');
  if (url.includes('gold-api.com')) {
    const inr = url.endsWith('/INR');
    const j = JSON.parse(f(url.includes('XAG') ? 'goldapi_xag.json' : inr ? 'goldapi_xau_inr.json' : 'goldapi_xau.json'));
    if (url.includes('XAG') && inr) { j.price = j.price * 94.83; j.exchangeRate = 94.83; }
    return j;
  }
  if (url.endsWith('/gold-rates/')) return f('gr_gold_index.html');
  if (url.endsWith('/silver-rates/')) return f('gr_silver_index.html');
  if (url.includes('platinum')) return f('gr_platinum_index.html');
  if (url.includes('/silver-rates/')) return f('gr_silver_kakinada.html');
  return f('gr_gold_kakinada.html');
}

async function get(url, { json = false, tries = 3 } = {}) {
  if (FIXTURES) return fixture(url);
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9', Accept: json ? 'application/json' : 'text/html' },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return json ? await res.json() : await res.text();
    } catch (e) {
      last = e;
      await sleep(800 * (i + 1) + Math.random() * 400);
    }
  }
  throw new Error(`${url}: ${last?.message}`);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e.message }; }
      await sleep(120 + Math.random() * 200);
    }
  }));
  return out;
}

const goldUrl = (slug) => (slug === 'india' ? `${BASE}/gold-rates/` : `${BASE}/gold-rates/${slug}.html`);
const silverUrl = (slug) => (slug === 'india' ? `${BASE}/silver-rates/` : `${BASE}/silver-rates/${slug}.html`);

function validGold(g, prev) {
  if (!g || !(g.k24 > 1000) || !(g.k22 > 1000) || !(g.k24 >= g.k22)) return false;
  if (prev?.k24 && Math.abs(g.k24 - prev.k24) / prev.k24 > 0.3) return false;
  return true;
}
function validSilver(s, prev) {
  if (!s || !(s.kg > 1000)) return false;
  if (prev?.kg && Math.abs(s.kg - prev.kg) / prev.kg > 0.35) return false;
  return true;
}

// ---------------------------------------------------------------- state
const state = readJson(path.join(DATA, 'state.json'), {});
const snapshot = readJson(path.join(DATA, 'snapshot.json'), { cities: {} });
const intraday = readJson(path.join(DATA, 'intraday.json'), { t: [], xau: [], xag: [] });
const histDir = path.join(DATA, 'history');

function loadHistory(slug) { return readJson(path.join(histDir, `${slug}.json`), {}); }
function saveHistory(slug, h) { writeJson(path.join(histDir, `${slug}.json`), h); }

function mergeHistory(slug, gold, silver, extra = {}) {
  const h = loadHistory(slug);
  const put = (d, k, v) => { if (d && v != null) { (h[d] ||= {})[k] = v; } };
  for (const r of gold?.history || []) { put(r.d, 'k24', r.k24); put(r.d, 'k22', r.k22); }
  for (const r of silver?.history || []) put(r.d, 'ag', r.kg);
  if (gold?.date) { put(gold.date, 'k24', gold.k24); put(gold.date, 'k22', gold.k22); put(gold.date, 'k18', gold.k18); }
  if (silver?.date) put(silver.date, 'ag', silver.kg);
  for (const [k, rows] of Object.entries(extra)) for (const r of rows || []) put(r.d, k, r.v);
  saveHistory(slug, h);
  return h;
}

function columnar(h) {
  const dates = Object.keys(h).sort();
  const col = (k) => dates.map((d) => h[d][k] ?? null);
  // goodreturns derives 18K as 75% of 24K; fill older days the 10-day table omits.
  const k18 = dates.map((d) => h[d].k18 ?? (h[d].k24 != null ? Math.round(h[d].k24 * 0.75) : null));
  const out = { d: dates, k24: col('k24'), k22: col('k22'), k18, ag: col('ag') };
  if (dates.some((d) => h[d].pt != null)) out.pt = col('pt');
  return out;
}

// ---------------------------------------------------------------- spot
async function fetchSpot() {
  const sym = async (s, c = '') => get(`https://api.gold-api.com/price/${s}${c ? '/' + c : ''}`, { json: true });
  const [xau, xag, xauInr, xagInr] = await Promise.all([sym('XAU'), sym('XAG'), sym('XAU', 'INR'), sym('XAG', 'INR')]);
  return {
    at: xauInr.updatedAt || nowIso,
    xauUsd: xau.price,
    xagUsd: xag.price,
    usdInr: xauInr.exchangeRate,
    xauInrG: +(xauInr.price / OZ).toFixed(2),
    xagInrG: +(xagInr.price / OZ).toFixed(3),
  };
}

// ---------------------------------------------------------------- main
async function main() {
  fs.mkdirSync(DATA, { recursive: true });

  let spot = null;
  try { spot = await fetchSpot(); log('spot', spot); } catch (e) { log('spot failed', e.message); }

  // 1) National + sentinels, always.
  const [gIndia, sIndia, pIndia] = await Promise.all([
    get(goldUrl('india')), get(silverUrl('india')), get(`${BASE}/platinum-price.html`).catch(() => null),
  ]);
  const cityList = parseCityList(gIndia, 'gold');
  const silverSet = new Set(parseCityList(sIndia, 'silver').map((c) => c.slug));
  if (cityList.length < 50) throw new Error(`city list looks wrong (${cityList.length})`);

  const prevCities = snapshot.cities || {};
  const sentinel = await pool(SENTINELS.filter((s) => cityList.some((c) => c.slug === s)), 4, async (slug) => {
    const g = parseGoldPage(await get(goldUrl(slug)));
    return { slug, g };
  });
  const changed = sentinel.some((r) => r?.g && prevCities[r.slug] && (
    r.g.k24 !== prevCities[r.slug].gold?.k24 || r.g.k22 !== prevCities[r.slug].gold?.k22 || r.g.date !== prevCities[r.slug].date));
  const stale = !state.lastFullRefresh || now - new Date(state.lastFullRefresh) > FULL_EVERY_MS;
  const missing = cityList.some((c) => !prevCities[c.slug]);
  const full = FORCE_FULL || changed || stale || missing;
  log(`cities=${cityList.length} changed=${changed} stale=${stale} missing=${missing} -> ${full ? 'FULL' : 'national only'}`);

  // 2) National record.
  const indiaGold = parseGoldPage(gIndia);
  const indiaSilver = parseSilverPage(sIndia);
  const indiaPt = pIndia ? parsePlatinumPage(pIndia) : null;
  const cities = { ...prevCities };
  const prevIndia = snapshot.india;
  const india = {
    slug: 'india', name: 'India', state: 'National average', lat: null, lon: null,
    ...(validGold(indiaGold, prevIndia?.gold) ? goldShape(indiaGold) : pick(prevIndia, ['date', 'gold', 'goldChange'])),
    ...(validSilver(indiaSilver, prevIndia?.silver) ? silverShape(indiaSilver) : pick(prevIndia, ['silver', 'silverChange', 'silverDate'])),
    ...(indiaPt?.g ? { platinum: { g: indiaPt.g }, platinumChange: { g: indiaPt.chG } } : pick(prevIndia, ['platinum', 'platinumChange'])),
  };
  mergeHistory('india', indiaGold, indiaSilver, { pt: (indiaPt?.history || []).map((r) => ({ d: r.d, v: r.g })) });

  // 3) Every city (full) or just the sentinels we already fetched.
  const todo = full ? cityList : cityList.filter((c) => SENTINELS.includes(c.slug));
  const sentinelGold = Object.fromEntries(sentinel.filter((r) => r?.g).map((r) => [r.slug, r.g]));
  let ok = 0, fail = 0;
  await pool(todo, 6, async (c) => {
    const prev = prevCities[c.slug];
    let g = sentinelGold[c.slug] || null, s = null;
    try { g ||= parseGoldPage(await get(goldUrl(c.slug))); } catch (e) { log('gold failed', c.slug, e.message); }
    if (silverSet.has(c.slug)) {
      try { s = parseSilverPage(await get(silverUrl(c.slug))); } catch (e) { log('silver failed', c.slug, e.message); }
    }
    const goldOk = validGold(g, prev?.gold);
    const silverOk = validSilver(s, prev?.silver);
    if (!goldOk && !prev) { fail++; return; }
    goldOk ? ok++ : fail++;
    let silverPart = silverOk ? silverShape(s) : pick(prev, ['silver', 'silverChange', 'silverDate']);
    if (!silverPart.silver) silverPart = { ...silverFromIndia(india), silverEstimated: true };
    cities[c.slug] = {
      slug: c.slug, name: c.name, ...metaFor(c.slug),
      ...(goldOk ? goldShape(g) : pick(prev, ['date', 'gold', 'goldChange'])),
      ...silverPart,
      checkedAt: goldOk ? nowIso : prev?.checkedAt,
    };
    mergeHistory(c.slug, goldOk ? g : null, silverOk ? s : null);
  });
  log(`cities ok=${ok} fail=${fail}`);
  // Drop cities goodreturns no longer lists.
  for (const k of Object.keys(cities)) if (!cityList.some((c) => c.slug === k)) delete cities[k];

  // 4) Change detection + spot reference (for live estimates in the apps).
  const sig = crypto.createHash('sha1')
    .update(JSON.stringify([india.gold, india.silver, Object.values(cities).sort((a, b) => a.slug.localeCompare(b.slug)).map((c) => [c.slug, c.gold, c.silver])]))
    .digest('hex');
  const ratesChanged = sig !== state.sig;
  if (ratesChanged) { state.sig = sig; state.ratesChangedAt = nowIso; }
  if (spot && (ratesChanged || !state.spotRef || state.spotRef.date !== india.date)) {
    state.spotRef = { at: spot.at, date: india.date, xauInrG: spot.xauInrG, xagInrG: spot.xagInrG };
  }
  if (full && fail < todo.length / 4) state.lastFullRefresh = nowIso;
  state.checkedAt = nowIso;

  if (spot) {
    intraday.t.push(Math.round(now / 1000)); intraday.xau.push(spot.xauInrG); intraday.xag.push(spot.xagInrG);
    const cutoff = now / 1000 - 3 * 86400;
    while (intraday.t.length && intraday.t[0] < cutoff) { intraday.t.shift(); intraday.xau.shift(); intraday.xag.shift(); }
  }

  snapshot.india = india;
  snapshot.cities = cities;
  writeJson(path.join(DATA, 'snapshot.json'), snapshot);
  writeJson(path.join(DATA, 'state.json'), state, true);
  writeJson(path.join(DATA, 'intraday.json'), intraday);

  publish({ india, cities, spot: spot || state.lastSpot, state, intraday });
  if (spot) { state.lastSpot = spot; writeJson(path.join(DATA, 'state.json'), state, true); }
}

function goldShape(g) {
  return {
    date: g.date,
    gold: { k24: g.k24, k22: g.k22, k18: g.k18 },
    goldChange: { k24: g.ch24 ?? 0, k22: g.ch22 ?? 0, k18: g.ch18 ?? 0 },
  };
}
function silverShape(s) {
  const kg = s.kg ?? (s.g ? s.g * 1000 : null);
  return {
    silverDate: s.date,
    silver: { g: kg ? +(kg / 1000).toFixed(2) : s.g, kg },
    silverChange: { g: s.chKg != null ? +(s.chKg / 1000).toFixed(2) : s.chG ?? 0, kg: s.chKg ?? (s.chG != null ? s.chG * 1000 : 0) },
  };
}
function silverFromIndia(india) { return pick(india, ['silver', 'silverChange', 'silverDate']); }
function pick(o, keys) { const r = {}; for (const k of keys) if (o?.[k] !== undefined) r[k] = o[k]; return r; }

function publish({ india, cities, spot, state, intraday }) {
  const api = path.join(OUT, 'api', 'v1');
  fs.mkdirSync(path.join(api, 'cities'), { recursive: true });
  const list = Object.values(cities).sort((a, b) => a.name.localeCompare(b.name));
  const meta = {
    v: 1,
    generatedAt: nowIso,
    checkedAt: state.checkedAt,
    ratesChangedAt: state.ratesChangedAt,
    lastFullRefresh: state.lastFullRefresh,
    source: { name: 'goodreturns.in', url: 'https://www.goodreturns.in/gold-rates/' },
    unit: { gold: 'INR per gram', silver: 'INR per gram / per kg', platinum: 'INR per gram' },
  };
  const spotOut = spot ? { ...spot, ref: state.spotRef } : null;
  writeJson(path.join(api, 'latest.json'), { ...meta, spot: spotOut, india, cities: list });
  writeJson(path.join(api, 'spot.json'), { generatedAt: nowIso, spot: spotOut, intraday });
  writeJson(path.join(api, 'cities.json'), { generatedAt: nowIso, cities: list.map(({ slug, name, state, lat, lon }) => ({ slug, name, state, lat, lon })) });
  for (const c of [india, ...list]) {
    writeJson(path.join(api, 'cities', `${c.slug}.json`), { ...meta, spot: spotOut, city: c, history: columnar(loadHistory(c.slug)) });
  }
  log(`published ${list.length + 1} cities to ${api}`);
}

main().catch((e) => { console.error('[scrape] FAILED', e); process.exit(1); });
