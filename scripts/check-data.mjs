// Checks data/buildings.csv and data/rooms.csv and prints the totals.
// Exits with an error if anything is malformed, so a bad edit is never published.
// Run: node scripts/check-data.mjs

import { readFileSync } from 'node:fs';
import { buildModel, totals } from '../js/data.js';

const read = (name) => readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8');
const { buildings, rooms, errors } = buildModel(read('buildings.csv'), read('rooms.csv'));

// data/live.json holds the address of the live sheet connector (see apps-script/README.md).
try {
  const live = JSON.parse(read('live.json'));
  if (typeof live.url !== 'string') errors.push('live.json: "url" must be text (it can be empty)');
  else if (live.url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(live.url)) {
    errors.push('live.json: "url" must be a Google Apps Script web app address');
  }
} catch (err) {
  errors.push(`live.json: ${err.code === 'ENOENT' ? 'file is missing' : `not valid JSON (${err.message})`}`);
}

const line = (label, rs) => {
  const t = totals(rs);
  const kg = rs.filter((r) => r.kg).length;
  console.log(`${label.padEnd(26)} ${String(t.rooms).padStart(4)} rooms (${String(kg).padStart(2)} KG)  ${String(t.beds).padStart(4)} beds  ${String(t.extra).padStart(3)} extra  up to ${t.maxPax} people`);
};

for (const b of buildings) {
  line(`${b.code} ${b.name}${b.active ? '' : ' (hidden)'}`, rooms.filter((r) => r.building === b.code));
}
const active = new Set(buildings.filter((b) => b.active).map((b) => b.code));
line('Shown buildings combined', rooms.filter((r) => active.has(r.building)));
line('Guest rooms (shown)', rooms.filter((r) => active.has(r.building) && !r.kg));
line('All rooms in file', rooms);

if (errors.length) {
  console.error(`\n${errors.length} problem(s) found:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('\nData OK.');
