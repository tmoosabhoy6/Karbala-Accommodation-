// Parsing and counting for the room data. Pure functions only, so the same
// code runs in the browser and in scripts/check-data.mjs.

// Floors in the order they appear on screen. Anything else sorts after these.
export const FLOOR_ORDER = ['G', '1', '2', '3', '4', '5', 'A'];

export function floorLabel(floor) {
  if (floor === 'G') return 'Ground floor';
  if (floor === 'A') return 'Annex';
  return `Floor ${floor}`;
}

export function floorShort(floor) {
  if (floor === 'G') return 'Ground';
  if (floor === 'A') return 'Annex';
  return floor;
}

export function compareFloors(a, b) {
  const ia = FLOOR_ORDER.indexOf(a);
  const ib = FLOOR_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

// Feature chips appear in this order; features not listed here follow alphabetically.
export const FEATURE_ORDER = [
  'Ladies', 'Gents', 'Suite', 'Partition', '2 bedrooms', '2 bathrooms',
  'Bathroom inside', 'Bathroom outside', 'Window', 'No window', 'Sofa bed', 'Low ceiling', 'Staff',
];

export function compareFeatures(a, b) {
  const ia = FEATURE_ORDER.indexOf(a);
  const ib = FEATURE_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);

  const [header, ...body] = rows;
  const keys = header.map((h) => h.trim());
  return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])));
}

function yes(value) {
  return /^(yes|y|true|1)$/i.test(value);
}

function count(value, where, errors) {
  if (value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    errors.push(`${where}: "${value}" is not a whole number`);
    return 0;
  }
  return n;
}

// Turns the two CSV files into { buildings, rooms, errors }.
// Rooms keep their file order (sortOrder), which is the order the house uses.
export function buildModel(buildingsCsv, roomsCsv) {
  const errors = [];

  const buildings = parseCSV(buildingsCsv).map((b, i) => ({
    code: b.code,
    name: b.name || b.code,
    active: yes(b.active),
    sortOrder: Number(b.sort_order) || i + 1,
  }));
  const byCode = new Map(buildings.map((b) => [b.code, b]));

  const seen = new Set();
  const rooms = parseCSV(roomsCsv).map((r, i) => {
    const line = i + 2; // header is line 1
    const where = `rooms.csv line ${line} (${r.building} ${r.room})`;
    if (!byCode.has(r.building)) errors.push(`${where}: unknown building "${r.building}"`);
    if (!r.room) errors.push(`rooms.csv line ${line}: room is empty`);
    if (!r.floor) errors.push(`${where}: floor is empty`);
    const key = `${r.building}|${r.room}`;
    if (seen.has(key)) errors.push(`${where}: room is listed twice`);
    seen.add(key);

    const beds = count(r.beds, `${where} beds`, errors);
    const extraMattress = count(r.extra_mattress, `${where} extra_mattress`, errors);
    const extra2 = count(r.extra_2, `${where} extra_2`, errors);
    return {
      id: key,
      building: r.building,
      room: r.room,
      floor: r.floor,
      wing: r.wing,
      roomType: r.room_type,
      features: r.features ? r.features.split(';').map((f) => f.trim()).filter(Boolean) : [],
      beds,
      extra: extraMattress + extra2,
      maxPax: beds + extraMattress + extra2,
      guestRoom: yes(r.guest_room),
      notes: r.notes,
      sortOrder: i,
    };
  });

  buildings.sort((a, b) => a.sortOrder - b.sortOrder);
  return { buildings, rooms, errors };
}

export function totals(rooms) {
  let beds = 0, extra = 0, maxPax = 0;
  for (const r of rooms) { beds += r.beds; extra += r.extra; maxPax += r.maxPax; }
  return { rooms: rooms.length, beds, extra, maxPax };
}

// filters: { buildings: Set, floors: Set, wings: Set, features: Set, minPax, query, includeNonGuest }
// Empty sets mean "any". Features must all be present (AND).
export function applyFilters(rooms, f) {
  const q = f.query.trim().toLowerCase().replace(/\s+/g, '');
  return rooms.filter((r) =>
    (f.includeNonGuest || r.guestRoom) &&
    (f.buildings.size === 0 || f.buildings.has(r.building)) &&
    (f.floors.size === 0 || f.floors.has(r.floor)) &&
    (f.wings.size === 0 || f.wings.has(r.wing)) &&
    [...f.features].every((feat) => r.features.includes(feat)) &&
    r.maxPax >= f.minPax &&
    (q === '' || r.room.toLowerCase().replace(/\s+/g, '').includes(q)),
  );
}
