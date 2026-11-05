#!/usr/bin/env node
// Safety net before the data branch is force-pushed: every history file that
// existed before this run must still exist and contain at least as many days.
//   node scraper/src/check-history.mjs <before-dir> <after-dir>
import fs from 'node:fs';
import path from 'node:path';

const [before, after] = process.argv.slice(2);
const days = (f) => Object.keys(JSON.parse(fs.readFileSync(f, 'utf8'))).length;
const files = fs.existsSync(before) ? fs.readdirSync(before).filter((f) => f.endsWith('.json')) : [];
const problems = [];
for (const f of files) {
  const a = path.join(after, f);
  const was = days(path.join(before, f));
  if (!fs.existsSync(a)) { problems.push(`${f}: missing (had ${was} days)`); continue; }
  const now = days(a);
  if (now < was) problems.push(`${f}: ${was} → ${now} days`);
}
if (problems.length) {
  console.error(`::error::History would shrink; refusing to save.\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`History OK: ${files.length} files checked, none lost days.`);
