// Pure HTML parsing helpers for goodreturns.in metal-rate pages.
// No dependencies: the pages are server-rendered with stable table markup,
// so a small, defensive regex-based extractor is enough and keeps CI fast.

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&percnt;': '%', '&rsquo;': "'", '&lsquo;': "'", '&ndash;': '-', '&mdash;': '-',
};

export function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

export function text(html) {
  return decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** First rupee amount in a cell, e.g. "₹1,14,240 (+2,528)" -> 114240 */
export function amount(cell) {
  const m = String(cell).match(/₹\s*([\d,]+(?:\.\d+)?)/) || String(cell).match(/([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Signed change in parentheses or "+ ₹10" / "- ₹138" style, 0 when "0". */
export function change(cell) {
  const s = String(cell);
  const p = s.match(/\(\s*([+-]?)\s*₹?\s*([\d,]+(?:\.\d+)?)\s*\)/);
  if (p) return (p[1] === '-' ? -1 : 1) * Number(p[2].replace(/,/g, ''));
  return null;
}

/** Change column on silver/platinum tables: "+ ₹10", "- ₹1,104", "0" */
export function signedCell(cell) {
  const s = String(cell).trim();
  const m = s.match(/^([+-])?\s*₹?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * Number(m[2].replace(/,/g, ''));
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Nov 04, 2026" -> "2026-11-04" */
export function isoDate(s) {
  const m = String(s).match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * Returns the body rows (array of cell-text arrays) of the first <table> that
 * follows a heading/section whose title contains `title` (case-insensitive).
 */
export function tableAfter(html, title) {
  const lower = html.toLowerCase();
  const t = title.toLowerCase();
  let from = 0;
  while (true) {
    const i = lower.indexOf(t, from);
    if (i < 0) return null;
    from = i + t.length;
    // Only accept matches inside a heading or a data-gr-title attribute.
    const before = lower.slice(Math.max(0, i - 200), i);
    if (!/<h[1-4][^>]*>[^<]*$/.test(before) && !/data-gr-title="[^"]*$/.test(before)) continue;
    const start = lower.indexOf('<table', i);
    if (start < 0) return null;
    const end = lower.indexOf('</table>', start);
    if (end < 0) return null;
    // Make sure no other heading sits between the title and the table.
    if (/<h[1-4][\s>]/.test(lower.slice(i + t.length, start))) continue;
    const tbl = html.slice(start, end);
    const rows = [];
    for (const r of tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (/<th[\s>]/i.test(r[1])) continue;
      const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => text(c[1]));
      if (cells.length) rows.push(cells);
    }
    return rows;
  }
}

/** Indian city list from the "Select your city" popup. */
export function parseCityList(html, metal = 'gold') {
  const i = html.indexOf('gd-metal-indian-city');
  if (i < 0) return [];
  const end = html.indexOf('</div>', i);
  const seg = html.slice(i, end < 0 ? undefined : end);
  const re = new RegExp(`href="(?:https://www\\.goodreturns\\.in)?/${metal}-rates/([a-z0-9-]+)\\.html"[^>]*>\\s*([^<]+?)\\s*<`, 'g');
  const out = [];
  const seen = new Set();
  for (const m of seg.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ slug: m[1], name: decode(m[2]).trim() });
  }
  return out;
}

function spanById(html, id) {
  const m = html.match(new RegExp(`id="${id}"[^>]*>([^<]+)<`));
  return m ? amount(decode(m[1])) : null;
}

/** Gold page (city or national). */
export function parseGoldPage(html) {
  const today = tableAfter(html, 'Today Gold Price Per Gram');
  const out = { k24: null, k22: null, k18: null, ch24: null, ch22: null, ch18: null, date: null, history: [] };
  const one = today?.find((r) => r[0] === '1');
  if (one) {
    [out.k24, out.k22, out.k18] = [amount(one[1]), amount(one[2]), amount(one[3])];
    [out.ch24, out.ch22, out.ch18] = [change(one[1]), change(one[2]), change(one[3])];
  }
  out.k24 ??= spanById(html, '24K-price');
  out.k22 ??= spanById(html, '22K-price');
  out.k18 ??= spanById(html, '18K-price');
  const hist = tableAfter(html, 'for Last 10 Days') || [];
  for (const r of hist) {
    const d = isoDate(r[0]);
    if (!d) continue;
    out.history.push({ d, k24: amount(r[1]), k22: amount(r[2]) });
  }
  out.date = out.history[0]?.d ?? null;
  return out;
}

/** Silver page (city or national). Prices per gram and per kg. */
export function parseSilverPage(html) {
  const out = { g: null, kg: null, chG: null, chKg: null, date: null, history: [] };
  const today = tableAfter(html, 'Today Silver Price');
  if (today) {
    const byGram = Object.fromEntries(today.map((r) => [r[0], r]));
    if (byGram['1']) { out.g = amount(byGram['1'][1]); out.chG = signedCell(byGram['1'][3]); }
    const kgRow = byGram['1000'] || byGram['1,000'];
    if (kgRow) { out.kg = amount(kgRow[1]); out.chKg = signedCell(kgRow[3]); }
  }
  out.g ??= spanById(html, 'silver-1g-price');
  out.kg ??= spanById(html, 'silver-1kg-price');
  const hist = tableAfter(html, 'for Last 10 Days') || [];
  for (const r of hist) {
    const d = isoDate(r[0]);
    if (!d) continue;
    out.history.push({ d, kg: amount(r[1]) });
  }
  if (out.kg == null && out.history[0]) out.kg = out.history[0].kg;
  if (out.chKg == null && hist[0]) out.chKg = change(hist[0][1]);
  out.date = out.history[0]?.d ?? null;
  return out;
}

/** National platinum page. Price per gram. */
export function parsePlatinumPage(html) {
  const out = { g: null, chG: null, date: null, history: [] };
  const today = tableAfter(html, 'Today Platinum Price Per Gram');
  const one = today?.find((r) => r[0] === '1');
  if (one) { out.g = amount(one[1]); out.chG = signedCell(one[3]); }
  const hist = tableAfter(html, 'for Last 10 Days') || [];
  for (const r of hist) {
    const d = isoDate(r[0]);
    if (!d) continue;
    out.history.push({ d, g: amount(r[1]) });
  }
  out.date = out.history[0]?.d ?? null;
  return out;
}
