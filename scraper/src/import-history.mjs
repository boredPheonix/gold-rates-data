#!/usr/bin/env node
// Merges one-off historical series (import/history/<slug>.json) into the
// persistent per-city history (data/history/<slug>.json).
//
// Safe to run on every scrape: it only fills dates and fields that are
// missing, never overwrites a value that is already there (scraped data
// always wins), and never removes anything.
//
//   node scraper/src/import-history.mjs --data data --dir import/history
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const DATA = arg('data', 'data');
const DIR = arg('dir', 'import/history');
const FIELDS = ['k24', 'k22', 'k18', 'ag', 'pt'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return d; throw e; } };

export function mergeImport(existing, days) {
  const h = { ...existing };
  let added = 0;
  const conflicts = [];
  for (const [d, rec] of Object.entries(days || {})) {
    if (!DATE.test(d) || !rec || typeof rec !== 'object') continue;
    for (const f of FIELDS) {
      const v = rec[f];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      const cur = h[d]?.[f];
      if (cur == null) { h[d] = { ...h[d], [f]: v }; added++; }
      else if (Math.abs(cur - v) / cur > 0.005) conflicts.push(`${d} ${f}: kept ${cur}, import had ${v}`);
    }
  }
  return { h, added, conflicts };
}

function main() {
  if (!fs.existsSync(DIR)) { console.log(`[import] no ${DIR}, nothing to do`); return; }
  const histDir = path.join(DATA, 'history');
  fs.mkdirSync(histDir, { recursive: true });
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
    const slug = path.basename(file, '.json');
    if (!/^[a-z0-9-]+$/.test(slug)) continue;
    const src = readJson(path.join(DIR, file), null);
    const target = path.join(histDir, `${slug}.json`);
    const before = readJson(target, {});
    const { h, added, conflicts } = mergeImport(before, src?.days);
    if (added) fs.writeFileSync(target, JSON.stringify(h));
    console.log(`[import] ${slug}: ${Object.keys(src?.days || {}).length} days in file, ${added} values added, ${Object.keys(before).length} → ${Object.keys(h).length} days`);
    for (const c of conflicts.slice(0, 20)) console.log(`[import]   ${c}`);
    if (conflicts.length > 20) console.log(`[import]   … ${conflicts.length - 20} more`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
