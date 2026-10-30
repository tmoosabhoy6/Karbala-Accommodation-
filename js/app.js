import {
  buildModel, applyFilters, totals, withEdit, EDITABLE, floorLabel, floorShort, compareFloors, compareFeatures,
} from './data.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

const state = {
  view: 'guest', // 'guest' | 'kg'
  buildings: new Set(),
  floors: new Set(),
  beds: new Set(),
  wings: new Set(),
  features: new Set(),
  minPax: 0,
  query: '',
  by: 'floor', // capacity breakdown: 'floor' | 'beds' | 'feature'
};

let model; // { buildings, rooms } straight from the CSV files
let rooms; // rooms in active buildings, with this device's edits applied
let buildingName; // code -> name

// ---- Edits saved on this device -------------------------------------------------

const EDITS_KEY = 'karbala-rooms:edits:v1';
let edits = {};

function loadEdits() {
  try { edits = JSON.parse(localStorage.getItem(EDITS_KEY)) || {}; } catch { edits = {}; }
}

function storeEdits() {
  try { localStorage.setItem(EDITS_KEY, JSON.stringify(edits)); return true; } catch { return false; }
}

function applyEdits() {
  const active = new Set(model.buildings.filter((b) => b.active).map((b) => b.code));
  rooms = model.rooms.filter((r) => active.has(r.building)).map((r) => withEdit(r, edits[r.id]));
}

// ---- URL state, so a filtered view can be bookmarked or shared -------------------

const SET_KEYS = { b: 'buildings', f: 'floors', bd: 'beds', w: 'wings', x: 'features' };

function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const [k, field] of Object.entries(SET_KEYS)) state[field] = new Set(p.getAll(k));
  state.view = p.get('v') === 'kg' ? 'kg' : 'guest';
  state.minPax = Math.max(0, parseInt(p.get('n'), 10) || 0);
  state.query = p.get('q') || '';
  state.by = ['beds', 'feature'].includes(p.get('by')) ? p.get('by') : 'floor';
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.view === 'kg') p.set('v', 'kg');
  for (const [k, field] of Object.entries(SET_KEYS)) for (const v of state[field]) p.append(k, v);
  if (state.minPax) p.set('n', state.minPax);
  if (state.query) p.set('q', state.query);
  if (state.by !== 'floor') p.set('by', state.by);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ---- Which rooms are in play --------------------------------------------------

const isKg = () => state.view === 'kg';

// Every room in the current tab, before any filter.
function pool() {
  return rooms.filter((r) => r.kg === isKg());
}

// The filters that apply in the current tab. KG rooms are only filtered by
// building, floor and search.
function activeFilters(overrides = {}) {
  const f = { ...state, ...overrides };
  if (isKg()) return { ...f, beds: new Set(), wings: new Set(), features: new Set(), minPax: 0 };
  return f;
}

function filtered() {
  return applyFilters(pool(), activeFilters());
}

// ---- Filter controls ------------------------------------------------------------

function chip(label, pressed, data, count) {
  const c = count != null ? `<span class="chip-count">${count}</span>` : '';
  return `<button type="button" class="chip" aria-pressed="${pressed}" ${data}>${esc(label)}${c}</button>`;
}

function renderChipGroup(el, field, options, withAll = true) {
  const all = withAll ? chip('All', state[field].size === 0, `data-field="${field}" data-value=""`) : '';
  el.innerHTML = all + options.map((o) =>
    chip(o.label, state[field].has(o.value), `data-field="${field}" data-value="${esc(o.value)}"`, o.count),
  ).join('');
}

function renderFilters() {
  const all = pool();
  const codes = new Set(all.map((r) => r.building));
  renderChipGroup($('f-building'), 'buildings',
    model.buildings.filter((b) => codes.has(b.code)).map((b) => ({ value: b.code, label: b.name })));

  const inBuildings = all.filter((r) => state.buildings.size === 0 || state.buildings.has(r.building));
  const floors = [...new Set(inBuildings.map((r) => r.floor))].sort(compareFloors);
  renderChipGroup($('f-floor'), 'floors', floors.map((f) => ({ value: f, label: floorShort(f) })));

  $('q').placeholder = isKg() ? 'Find a room or a name' : 'Find a room number';
  $('q-label').textContent = $('q').placeholder;
  $('q').value = state.query;

  let moreActive = 0;
  if (!isKg()) {
    // Bed chips show how many rooms each bed count would give with the other filters.
    const withoutBeds = applyFilters(all, activeFilters({ beds: new Set() }));
    const bedCounts = new Map();
    for (const r of inBuildings) bedCounts.set(String(r.beds), 0);
    for (const r of withoutBeds) if (!r.blocked) bedCounts.set(String(r.beds), bedCounts.get(String(r.beds)) + 1);
    const beds = [...bedCounts.keys()].sort((a, b) => a - b);
    renderChipGroup($('f-beds'), 'beds', beds.map((b) => ({ value: b, label: b, count: bedCounts.get(b) })));

    const wings = [...new Set(inBuildings.map((r) => r.wing).filter(Boolean))].sort();
    $('wing-set').hidden = wings.length < 2 && state.wings.size === 0;
    renderChipGroup($('f-wing'), 'wings', wings.map((w) => ({ value: w, label: w })));

    // Feature counts: how many rooms you'd see if you added that feature.
    const withoutFeatures = applyFilters(all, activeFilters({ features: new Set() }));
    const counts = new Map();
    for (const r of inBuildings) for (const f of r.features) counts.set(f, 0);
    for (const f of state.features) counts.set(f, 0);
    for (const r of withoutFeatures) {
      if (!r.blocked && [...state.features].every((f) => r.features.includes(f))) {
        for (const f of r.features) counts.set(f, counts.get(f) + 1);
      }
    }
    renderChipGroup($('f-feature'), 'features',
      [...counts.keys()].sort(compareFeatures).map((f) => ({ value: f, label: f, count: counts.get(f) })), false);

    $('pax-value').textContent = state.minPax ? `${state.minPax}+ people` : 'Any';
    $('pax-down').disabled = state.minPax === 0;

    moreActive = state.wings.size + state.features.size + (state.minPax ? 1 : 0);
    $('more-count').textContent = moreActive ? ` · ${moreActive}` : '';
  }

  const f = activeFilters();
  const anyActive = f.buildings.size + f.floors.size + f.beds.size + moreActive + (f.query ? 1 : 0);
  $('clear').hidden = anyActive === 0;
}

// ---- Summary ----------------------------------------------------------------------

function stat(label, value, sub, main = false) {
  return `<div class="stat${main ? ' stat-main' : ''}"><span class="stat-label">${label}</span>`
    + `<span class="stat-value">${fmt(value)}</span>${sub ? `<span class="of">${sub}</span>` : ''}</div>`;
}

function renderSummary(list) {
  const el = $('summary');
  if (isKg()) {
    const occupied = list.filter(isOccupied).length;
    el.className = 'summary summary-3';
    el.innerHTML = stat('KG rooms', list.length, '')
      + stat('Someone staying', occupied, '', true)
      + stat('No one listed', list.length - occupied, '');
    return;
  }
  const t = totals(list);
  const all = totals(pool());
  const isFiltered = list.length !== pool().length;
  const of = (total) => (isFiltered ? `of ${fmt(total)}` : '');
  const blocked = list.filter((r) => r.blocked).length;
  const roomsSub = [of(all.rooms), blocked ? `<span class="blocked-count">${fmt(blocked)} blocked</span>` : '']
    .filter(Boolean).join(' · ');
  el.className = 'summary';
  el.innerHTML = stat('Rooms', t.rooms, roomsSub)
    + stat('Beds', t.beds, of(all.beds))
    + stat('Extra mattresses', t.extra, of(all.extra))
    + stat('Fits up to', t.maxPax, isFiltered ? `of ${fmt(all.maxPax)} people` : 'people', true);
}

const isOccupied = (r) => r.occupant.trim() !== '' || r.people > 0;

// ---- Capacity breakdown ---------------------------------------------------------

function row({ label, t, max, pressed, data }) {
  const pct = max ? Math.max(2, Math.round((t.maxPax / max) * 100)) : 0;
  return `
    <button type="button" class="brow" aria-pressed="${pressed}" ${data}>
      <span class="brow-label">${esc(label)}</span>
      <span class="num">${fmt(t.rooms)}</span>
      <span class="num">${fmt(t.beds)}</span>
      <span class="num strong">${fmt(t.maxPax)}</span>
      <span class="bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
    </button>`;
}

const HEAD = `
  <div class="bhead" aria-hidden="true">
    <span></span><span class="num">Rooms</span><span class="num">Beds</span><span class="num">Up to</span>
  </div>`;

function groupBy(list, keyOf) {
  const map = new Map();
  for (const r of list) if (!r.blocked) for (const k of keyOf(r)) {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function renderBreakdown(list) {
  const el = $('breakdown');
  for (const b of document.querySelectorAll('[data-by]')) b.setAttribute('aria-selected', b.dataset.by === state.by);

  if (!list.some((r) => !r.blocked)) {
    el.innerHTML = '<p class="empty-small">Nothing to count with these filters.</p>';
    return;
  }

  if (state.by === 'floor') {
    const groups = groupByBuildingFloor(list);
    const max = Math.max(...groups.flatMap((g) => g.floors.map((f) => totals(f.rooms).maxPax)));
    el.innerHTML = groups.filter((g) => totals(g.rooms).rooms).map((g) => {
      const bt = totals(g.rooms);
      return `
        <div class="bgroup">
          <h3 class="bgroup-title">${esc(buildingName.get(g.code))}
            <span class="bgroup-total">${fmt(bt.rooms)} rooms · ${fmt(bt.beds)} beds · up to ${fmt(bt.maxPax)}</span></h3>
          ${HEAD}
          ${g.floors.filter((f) => totals(f.rooms).rooms).map((f) => row({
            label: floorLabel(f.floor),
            t: totals(f.rooms),
            max,
            pressed: state.floors.has(f.floor) && state.buildings.has(g.code),
            data: `data-building="${esc(g.code)}" data-floor="${esc(f.floor)}"`,
          })).join('')}
        </div>`;
    }).join('');
    return;
  }

  if (state.by === 'beds') {
    const byBeds = groupBy(list, (r) => [r.beds]);
    const keys = [...byBeds.keys()].sort((a, b) => a - b);
    const max = Math.max(...keys.map((k) => totals(byBeds.get(k)).maxPax));
    el.innerHTML = `<div class="bgroup">${HEAD}${keys.map((k) => row({
      label: k === 1 ? '1 bed' : `${k} beds`,
      t: totals(byBeds.get(k)),
      max,
      pressed: state.beds.has(String(k)),
      data: `data-beds="${k}"`,
    })).join('')}</div>
    <p class="note">Rooms grouped by their number of fixed beds. "Up to" adds the extra mattresses.</p>`;
    return;
  }

  const NONE = 'No listed features';
  const byFeature = groupBy(list, (r) => (r.features.length ? r.features : [NONE]));
  const keys = [...byFeature.keys()].sort((a, b) => (a === NONE) - (b === NONE) || compareFeatures(a, b));
  const max = Math.max(...keys.map((k) => totals(byFeature.get(k)).maxPax));
  el.innerHTML = `<div class="bgroup">${HEAD}${keys.map((k) => row({
    label: k,
    t: totals(byFeature.get(k)),
    max,
    pressed: state.features.has(k),
    data: k === NONE ? 'disabled' : `data-feature="${esc(k)}"`,
  })).join('')}</div>
  <p class="note">A room with several features is counted under each of them.</p>`;
}

function groupByBuildingFloor(list) {
  const order = new Map(model.buildings.map((b, i) => [b.code, i]));
  const map = new Map();
  for (const r of list) {
    if (!map.has(r.building)) map.set(r.building, new Map());
    const floors = map.get(r.building);
    if (!floors.has(r.floor)) floors.set(r.floor, []);
    floors.get(r.floor).push(r);
  }
  return [...map.entries()]
    .sort((a, b) => order.get(a[0]) - order.get(b[0]))
    .map(([code, floors]) => ({
      code,
      rooms: [...floors.values()].flat(),
      floors: [...floors.entries()]
        .sort((a, b) => compareFloors(a[0], b[0]))
        .map(([floor, rs]) => ({ floor, rooms: rs.sort((x, y) => x.sortOrder - y.sortOrder) })),
    }));
}

// ---- Room tiles -----------------------------------------------------------------

const EDITED = '<span class="edited" title="Changed on this device">Edited</span>';
const BLOCKED_X = '<span class="blocked-x" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></span>';

function guestTile(r) {
  const tags = [...r.features];
  if (r.wing === 'New wing') tags.unshift('New wing');
  return `
    <div class="tile-top"><span class="tile-room">${esc(r.room)}</span>${r.edited ? EDITED : ''}${r.blocked ? BLOCKED_X : ''}</div>
    ${r.blocked ? '<div class="tile-blocked-label">Blocked</div>' : ''}
    <div class="tile-cap">${plural(r.beds, 'bed', 'beds')} · up to <strong>${r.maxPax}</strong></div>
    ${r.extra ? `<div class="tile-extra">+${plural(r.extra, 'extra mattress', 'extra mattresses')}</div>` : ''}
    ${tags.length ? `<div class="tile-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${r.notes ? `<div class="tile-note">${esc(r.notes)}</div>` : ''}`;
}

function kgTile(r) {
  const who = r.occupant.trim()
    ? `<div class="tile-who">${esc(r.occupant)}</div>`
    : '<div class="tile-who tile-empty">No one listed</div>';
  return `
    <div class="tile-top"><span class="tile-room">${esc(r.room)}</span>${r.edited ? EDITED : ''}</div>
    ${who}
    ${r.people ? `<div class="tile-extra">${plural(r.people, 'person', 'people')}</div>` : ''}
    ${r.extra ? `<div class="tile-extra">+${plural(r.extra, 'extra mattress', 'extra mattresses')}</div>` : ''}
    ${r.notes ? `<div class="tile-note">${esc(r.notes)}</div>` : ''}`;
}

function renderRooms(list) {
  const el = $('rooms');
  $('rooms-title').textContent = plural(list.length, 'room', 'rooms');
  if (list.length === 0) {
    el.innerHTML = `
      <div class="empty">
        <p class="empty-title">No rooms match these filters</p>
        <p>${isKg() ? 'Try a different name or room number.' : 'Try removing a filter or lowering “Fits at least”.'}</p>
        <button type="button" class="btn" data-action="clear">Clear all filters</button>
      </div>`;
    return;
  }
  el.innerHTML = groupByBuildingFloor(list).map((g) => g.floors.map((f) => {
    const t = totals(f.rooms);
    const total = isKg()
      ? `${plural(t.rooms, 'room', 'rooms')} · ${fmt(f.rooms.filter(isOccupied).length)} with someone`
      : `${plural(t.rooms, 'room', 'rooms')} · up to ${fmt(t.maxPax)}${f.rooms.length > t.rooms ? ` · ${fmt(f.rooms.length - t.rooms)} blocked` : ''}`;
    return `
      <div class="floor">
        <h3 class="floor-title">
          <span>${esc(buildingName.get(g.code))} <span class="dot" aria-hidden="true">·</span> ${esc(floorLabel(f.floor))}</span>
          <span class="floor-total">${total}</span>
        </h3>
        <ul class="grid">${f.rooms.map((r) => `
          <li><button type="button" class="tile${r.kg && !isOccupied(r) ? ' tile-off' : ''}${r.blocked && !r.kg ? ' tile-blocked' : ''}" data-room="${esc(r.id)}"${r.blocked && !r.kg ? ` aria-label="${esc(r.room)}, blocked"` : ''}>
            ${r.kg ? kgTile(r) : guestTile(r)}
          </button></li>`).join('')}</ul>
      </div>`;
  }).join('')).join('');
}

// ---- Room panel (edit) ------------------------------------------------------------

let editing = null; // { room, draft }

const roomTitle = (r) => (/\d/.test(r.room) ? `Room ${r.room}` : r.room);

function options(list, selected) {
  return list.map(([value, label]) =>
    `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

function openRoom(id) {
  const room = rooms.find((r) => r.id === id);
  if (!room) return;
  const draft = {};
  for (const k of EDITABLE) draft[k] = k === 'features' ? [...room.features] : room[k];
  editing = { room, draft };

  $('rd-where').textContent = `${buildingName.get(room.building)} · ${floorLabel(room.floor)}${room.wing ? ` · ${room.wing}` : ''}`;
  $('rd-title').textContent = roomTitle(room);

  $('rd-occupant').value = room.occupant;
  $('rd-notes').value = room.notes;
  $('rd-room').value = room.room;
  $('rd-type').value = room.roomType;
  $('rd-blocked').checked = room.blocked;
  $('rd-kg').checked = room.kg;
  $('rd-new-feature').value = '';

  $('rd-building').innerHTML = options(
    model.buildings.filter((b) => b.active || b.code === room.building).map((b) => [b.code, b.name]), room.building);
  const floors = [...new Set([...model.rooms.map((r) => r.floor), room.floor])].sort(compareFloors);
  $('rd-floor').innerHTML = options(floors.map((f) => [f, floorLabel(f)]), room.floor);
  const wings = [...new Set([...model.rooms.map((r) => r.wing), room.wing])].filter(Boolean).sort();
  $('rd-wing').innerHTML = options([['', 'None'], ...wings.map((w) => [w, w])], room.wing);

  $('rd-reset').hidden = !room.edited;
  document.querySelector('.rd-more').open = false;
  renderDraft();
  $('room-dialog').showModal();
}

function renderDraft() {
  const { draft } = editing;
  for (const el of document.querySelectorAll('.kg-field')) el.hidden = !draft.kg;
  $('rd-block-field').hidden = draft.kg;
  $('rd-beds').textContent = draft.beds;
  $('rd-extra').textContent = draft.extra;
  $('rd-people').textContent = draft.people ? plural(draft.people, 'person', 'people') : 'Not set';
  $('rd-fits').innerHTML = `${plural(draft.beds, 'bed', 'beds')} + ${plural(draft.extra, 'mattress', 'mattresses')} = fits up to <strong>${draft.beds + draft.extra}</strong>`;
  for (const b of document.querySelectorAll('[data-step]')) {
    if (Number(b.dataset.delta) < 0) b.disabled = draft[b.dataset.step] <= 0;
  }
  const known = [...new Set([...model.rooms.flatMap((r) => r.features), ...draft.features])].sort(compareFeatures);
  $('rd-features').innerHTML = known.map((f) =>
    `<button type="button" class="chip" aria-pressed="${draft.features.includes(f)}" data-feature="${esc(f)}">${esc(f)}</button>`).join('');
}

function addFeature() {
  const f = $('rd-new-feature').value.trim();
  if (f && !editing.draft.features.includes(f)) editing.draft.features.push(f);
  $('rd-new-feature').value = '';
  renderDraft();
}

// Saves the edit for one room and offers an undo that puts back what was there.
function saveEdit(room, next, message) {
  const before = edits[room.id];
  if (next) edits[room.id] = next; else delete edits[room.id];
  const ok = storeEdits();
  applyEdits();
  render();
  showToast(ok ? message : 'Could not save on this device (storage is blocked)', ok ? () => {
    if (before) edits[room.id] = before; else delete edits[room.id];
    storeEdits();
    applyEdits();
    render();
  } : null);
}

// action: 'save' | 'reset' | anything else (cancel)
function finishEdit(action) {
  if (!editing) return;
  const { room, draft } = editing;
  editing = null;
  if (action === 'reset') {
    saveEdit(room, null, `${roomTitle(room)} reset to original`);
    return;
  }
  if (action !== 'save') return;

  draft.occupant = $('rd-occupant').value.trim();
  draft.notes = $('rd-notes').value.trim();
  draft.room = $('rd-room').value.trim() || room.room;
  draft.roomType = $('rd-type').value.trim();
  draft.building = $('rd-building').value;
  draft.floor = $('rd-floor').value;
  draft.wing = $('rd-wing').value;
  draft.kg = $('rd-kg').checked;
  draft.blocked = draft.kg ? false : $('rd-blocked').checked;
  draft.features.sort(compareFeatures);

  // Keep only the fields that differ from the room list.
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const base = room.original || room;
  const next = {};
  for (const k of EDITABLE) if (!same(draft[k], base[k])) next[k] = draft[k];
  const changed = EDITABLE.filter((k) => !same(draft[k], room[k]));
  if (changed.length === 0) return;

  let message = `Saved ${roomTitle({ room: draft.room })}`;
  if (changed.length === 1 && changed[0] === 'blocked') {
    message = `${draft.blocked ? 'Blocked' : 'Unblocked'} ${roomTitle(room)}`;
  } else if (changed.includes('kg')) {
    message = `Moved ${roomTitle({ room: draft.room })} to ${draft.kg ? 'KG & staff' : 'Guest rooms'}`;
  }
  if (Object.keys(next).length) next.at = new Date().toISOString();
  saveEdit(room, Object.keys(next).length ? next : null, message);
}

// ---- Toast with undo ------------------------------------------------------------

let toastTimer;
let toastUndo;

function showToast(text, undo) {
  $('toast-text').textContent = text;
  $('toast-undo').hidden = !undo;
  toastUndo = undo;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}

// ---- Wiring ---------------------------------------------------------------------

function render() {
  document.body.dataset.view = state.view;
  $('view-guest').setAttribute('aria-selected', !isKg());
  $('view-kg').setAttribute('aria-selected', isKg());
  $('sub').textContent = isKg()
    ? 'Who is staying in the KG and staff rooms'
    : 'Guest room capacity by building, floor, beds and feature';

  // Drop selections that no longer exist (e.g. a floor after changing building).
  const all = pool();
  const valid = {
    buildings: new Set(all.map((r) => r.building)),
    floors: new Set(all.filter((r) => state.buildings.size === 0 || state.buildings.has(r.building)).map((r) => r.floor)),
    wings: new Set(all.map((r) => r.wing)),
  };
  for (const [field, ok] of Object.entries(valid)) {
    for (const v of state[field]) if (!ok.has(v)) state[field].delete(v);
  }

  const list = filtered();
  renderFilters();
  renderSummary(list);
  if (!isKg()) renderBreakdown(list);
  renderRooms(list);
  writeUrl();
}

function clearAll() {
  Object.assign(state, {
    buildings: new Set(), floors: new Set(), beds: new Set(), wings: new Set(), features: new Set(),
    minPax: 0, query: '',
  });
  render();
}

function toggle(field, value) {
  if (value === '') state[field].clear();
  else if (state[field].has(value)) state[field].delete(value);
  else state[field].add(value);
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  state.floors.clear();
  state.query = '';
  render();
}

function wire() {
  $('view-guest').addEventListener('click', () => setView('guest'));
  $('view-kg').addEventListener('click', () => setView('kg'));

  document.querySelector('.filters').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    toggle(c.dataset.field, c.dataset.value);
    render();
  });

  $('breakdown').addEventListener('click', (e) => {
    const b = e.target.closest('.brow');
    if (!b || b.disabled) return;
    if (b.dataset.feature) toggle('features', b.dataset.feature);
    else if (b.dataset.beds) toggle('beds', b.dataset.beds);
    else if (b.dataset.floor) {
      // Tapping a floor row shows just that floor; tapping it again goes back.
      const { building, floor } = b.dataset;
      const already = state.buildings.size === 1 && state.buildings.has(building)
        && state.floors.size === 1 && state.floors.has(floor);
      state.buildings = already ? new Set() : new Set([building]);
      state.floors = already ? new Set() : new Set([floor]);
    }
    render();
    if (window.matchMedia('(max-width: 899px)').matches) {
      $('rooms-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  for (const b of document.querySelectorAll('[data-by]')) {
    b.addEventListener('click', () => { state.by = b.dataset.by; render(); });
  }

  $('q').addEventListener('input', (e) => { state.query = e.target.value; render(); });
  $('pax-up').addEventListener('click', () => { state.minPax += 1; render(); });
  $('pax-down').addEventListener('click', () => { state.minPax = Math.max(0, state.minPax - 1); render(); });
  $('clear').addEventListener('click', clearAll);

  $('rooms').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="clear"]')) { clearAll(); return; }
    const tile = e.target.closest('[data-room]');
    if (tile) openRoom(tile.dataset.room);
  });

  $('room-form').addEventListener('click', (e) => {
    if (!editing) return;
    const chipEl = e.target.closest('#rd-features .chip');
    if (chipEl) {
      const f = chipEl.dataset.feature;
      const list = editing.draft.features;
      editing.draft.features = list.includes(f) ? list.filter((x) => x !== f) : [...list, f];
      renderDraft();
      return;
    }
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const k = b.dataset.step;
    editing.draft[k] = Math.max(0, editing.draft[k] + Number(b.dataset.delta));
    renderDraft();
  });
  // The form uses method="dialog", so submitting closes the panel; the edit is
  // applied right away rather than waiting for the dialog's close event.
  $('room-form').addEventListener('submit', (e) => finishEdit(e.submitter?.value));
  $('rd-add-feature').addEventListener('click', addFeature);
  $('rd-new-feature').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addFeature(); }
  });
  $('rd-kg').addEventListener('change', (e) => { if (editing) { editing.draft.kg = e.target.checked; renderDraft(); } });
  $('rd-reset').addEventListener('click', () => { finishEdit('reset'); $('room-dialog').close(); });
  $('room-dialog').addEventListener('close', () => finishEdit('cancel'));

  $('toast-undo').addEventListener('click', () => {
    $('toast').hidden = true;
    if (toastUndo) toastUndo();
    toastUndo = null;
  });

  $('more-toggle').addEventListener('click', () => {
    const open = $('more-toggle').getAttribute('aria-expanded') !== 'true';
    $('more-toggle').setAttribute('aria-expanded', open);
    $('more-filters').classList.toggle('open', open);
  });
}

async function load() {
  const get = async (path) => {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.text();
  };
  try {
    const [b, r] = await Promise.all([get('data/buildings.csv'), get('data/rooms.csv')]);
    model = buildModel(b, r);
    if (model.errors.length) console.warn('Room data problems:', model.errors);
  } catch (err) {
    console.error(err);
    $('main').innerHTML = `
      <div class="empty">
        <p class="empty-title">Could not load the room list</p>
        <p>Check your internet connection and reload the page.</p>
        <button type="button" class="btn" onclick="location.reload()">Reload</button>
      </div>`;
    return;
  }
  buildingName = new Map(model.buildings.map((x) => [x.code, x.name]));
  loadEdits();
  applyEdits();

  readUrl();
  // Open "More filters" on load if any of them are in use.
  if (state.wings.size || state.features.size || state.minPax) {
    $('more-toggle').setAttribute('aria-expanded', 'true');
    $('more-filters').classList.add('open');
  }
  wire();
  render();
}

load();
