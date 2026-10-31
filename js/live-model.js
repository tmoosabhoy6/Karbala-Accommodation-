// Turns the live feed of the ACCOMMODATION tab (see apps-script/Code.gs) into
// rooms with who is staying on each day. Pure functions only, so they can be
// tested outside the browser.

const squash = (s) => String(s).toLowerCase().replace(/\s+/g, '').replace(/\.0+$/, '');

// Cell texts that mean the room is out of use rather than taken by guests.
const BLOCK_WORDS = /^(block|blocked|maint|maint\.|maintenance|repair|closed|out of order)$/i;

export const isBlockText = (t) => BLOCK_WORDS.test(t.trim());

// Matches each sheet row to a room in rooms.csv. The room list was made from
// this sheet, so rows are matched in order: each row takes the next room with
// the same number, which keeps "Q 108" in the Q Building apart from "Q 108"
// in Q list 2. Rows with no room in the list are kept on their own.
export function matchRows(feedRows, appRooms) {
  const keys = appRooms.map((r) => squash(r.room));
  const byKey = new Map();
  keys.forEach((k, i) => { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); });

  let pointer = 0;
  return feedRows.map((row) => {
    const key = squash(row.room);
    let index = keys.indexOf(key, pointer);
    if (index !== -1) pointer = index;
    else if (byKey.get(key)?.length === 1) index = byKey.get(key)[0];
    return index === -1 ? null : appRooms[index];
  });
}

function textsByDay(row, days) {
  const out = new Array(days).fill('');
  for (const [start, length, text] of row.runs) {
    for (let i = start; i < start + length && i < days; i++) out[i] = text;
  }
  return out;
}

const DAY_MS = 86400000;
const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

// Builds { dates, labels, rooms } where each room has one `days` array per
// sheet row (a room such as 135 can have a row per bed).
export function buildLive(feed, appRooms, buildingOrder = []) {
  const days = feed.dates.length;
  const matches = matchRows(feed.rows, appRooms);
  const rooms = new Map();
  let last = null; // the room above, so unlisted rows are shown next to it

  feed.rows.forEach((row, i) => {
    const app = matches[i];
    const texts = textsByDay(row, days);
    if (!app && !texts.some(Boolean)) return; // e.g. the totals row
    const id = app ? app.id : `row:${row.n}`;
    if (!rooms.has(id)) {
      rooms.set(id, {
        id,
        room: app ? app.room : row.room,
        building: app ? app.building : (last?.building ?? ''),
        floor: app ? app.floor : (last?.floor ?? ''),
        sortOrder: app ? app.sortOrder : (last ? last.sortOrder + 0.001 * (i + 1) : 1e6 + i),
        kg: app ? app.kg : false,
        listedBlocked: app ? app.blocked && !app.kg : false,
        listed: Boolean(app),
        info: row.info,
        beds: app ? app.beds : (Number(row.beds) || 0),
        maxPax: app ? app.maxPax : (Number(row.beds) || 0) + (Number(row.add) || 0) + (Number(row.add2) || 0),
        sheetRows: [],
        lines: [],
      });
    }
    const room = rooms.get(id);
    room.sheetRows.push(row.n);
    room.lines.push(texts);
    if (row.info && !room.info) room.info = row.info;
    last = room;
  });

  const order = new Map(buildingOrder.map((code, i) => [code, i]));
  const list = [...rooms.values()].sort((a, b) =>
    (order.get(a.building) ?? 99) - (order.get(b.building) ?? 99) || a.sortOrder - b.sortOrder);

  // Index of the calendar day before each column (or -1 when the sheet skips a day).
  const prevIndex = feed.dates.map((d, i) => (i > 0 && dayNumber(feed.dates[i - 1]) === dayNumber(d) - 1 ? i - 1 : -1));
  return { dates: feed.dates, labels: feed.labels || [], prevIndex, rooms: list };
}

const unique = (arr) => [...new Set(arr.filter(Boolean))];

// What is happening in a room on day d.
export function roomDay(live, room, d) {
  const p = live.prevIndex[d];
  const now = unique(room.lines.map((l) => l[d]));
  const arriving = [];
  const leaving = [];
  let until = -1;
  for (const line of room.lines) {
    const t = line[d];
    const before = p === -1 ? null : line[p];
    if (t && before !== null && t !== before) arriving.push(t);
    if (before && before !== t) leaving.push(before);
    if (t) {
      let end = d;
      while (end + 1 < line.length && line[end + 1] === t) end++;
      until = Math.max(until, end);
    }
  }

  let status;
  if (now.length === 0) status = room.listedBlocked ? 'blocked' : 'vacant';
  else if (now.every(isBlockText)) status = 'blocked';
  else status = 'occupied';

  let next = null;
  if (status !== 'occupied') {
    for (let i = d + 1; i < live.dates.length && !next; i++) {
      const t = unique(room.lines.map((l) => l[i])).filter((x) => !isBlockText(x));
      if (t.length) next = { index: i, who: t };
    }
  }

  return {
    status,
    who: now,
    arriving: unique(arriving),
    leaving: unique(leaving),
    until: status === 'occupied' && until < live.dates.length - 1 ? until : -1,
    next,
    known: p !== -1,
  };
}

// Consecutive stays in one room, for the room's calendar.
export function roomStays(live, room) {
  const stays = [];
  room.lines.forEach((line, lineIndex) => {
    let start = -1;
    for (let i = 0; i <= line.length; i++) {
      const t = line[i] ?? '';
      if (start !== -1 && t !== line[start]) {
        stays.push({ from: start, to: i - 1, who: line[start], line: lineIndex });
        start = -1;
      }
      if (t && start === -1) start = i;
    }
  });
  return stays.sort((a, b) => a.from - b.from || a.line - b.line);
}

// The guest group in a cell, e.g. "fh mumbai 2155 - 3 ladies" -> "fh mumbai 2155",
// used to put the arrivals and departures of one group together.
export function groupName(text) {
  return text.replace(/\s*[-–(].*$/, '').replace(/\s+/g, ' ').trim().toLowerCase() || text.toLowerCase();
}

export function todayIn(timeZone = 'Asia/Baghdad', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
