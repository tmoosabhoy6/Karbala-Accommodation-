// Checks data/buildings.csv and data/rooms.csv and prints the totals.
// Exits with an error if anything is malformed, so a bad edit is never published.
// Run: node scripts/check-data.mjs

import { readFileSync } from 'node:fs';
import { buildModel, totals } from '../js/data.js';

const read = (name) => readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8');
const { buildings, rooms, errors } = buildModel(read('buildings.csv'), read('rooms.csv'));

const line = (label, rs) => {
  const t = totals(rs);
  const guest = rs.filter((r) => r.guestRoom).length;
  console.log(`${label.padEnd(26)} ${String(t.rooms).padStart(4)} rooms (${guest} guest)  ${String(t.beds).padStart(4)} beds  ${String(t.extra).padStart(3)} extra  up to ${t.maxPax} people`);
};

for (const b of buildings) {
  line(`${b.code} ${b.name}${b.active ? '' : ' (hidden)'}`, rooms.filter((r) => r.building === b.code));
}
const active = new Set(buildings.filter((b) => b.active).map((b) => b.code));
line('Shown buildings combined', rooms.filter((r) => active.has(r.building)));
line('All rooms in file', rooms);

if (errors.length) {
  console.error(`\n${errors.length} problem(s) found:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('\nData OK.');
