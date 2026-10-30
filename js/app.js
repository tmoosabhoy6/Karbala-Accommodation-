import {
  buildModel, applyFilters, totals, floorLabel, floorShort, compareFloors, compareFeatures,
} from './data.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  buildings: new Set(),
  floors: new Set(),
  wings: new Set(),
  features: new Set(),
  minPax: 0,
  query: '',
  includeNonGuest: false,
  view: 'floor',
};

let model; // { buildings, rooms }
let activeRooms; // rooms in active buildings only
let buildingName; // code -> name

// ---- URL state, so a filtered view can be bookmarked or shared -------------

const SET_KEYS = { b: 'buildings', f: 'floors', w: 'wings', x: 'features' };

function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const [k, field] of Object.entries(SET_KEYS)) {
    state[field] = new Set(p.getAll(k));
  }
  state.minPax = Math.max(0, parseInt(p.get('n'), 10) || 0);
  state.query = p.get('q') || '';
  state.includeNonGuest = p.get('all') === '1';
  state.view = p.get('by') === 'feature' ? 'feature' : 'floor';
}

function writeUrl() {
  const p = new URLSearchParams();
  for (const [k, field] of Object.entries(SET_KEYS)) {
    for (const v of state[field]) p.append(k, v);
  }
  if (state.minPax) p.set('n', state.minPax);
  if (state.query) p.set('q', state.query);
  if (state.includeNonGuest) p.set('all', '1');
  if (state.view === 'feature') p.set('by', 'feature');
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ---- Filter controls ----------------------------------------------------------

function chip(label, pressed, data, extra = '') {
  return `<button type="button" class="chip" aria-pressed="${pressed}" ${data}>${esc(label)}${extra}</button>`;
}

function renderChipGroup(el, field, options) {
  const all = chip('All', state[field].size === 0, `data-field="${field}" data-value=""`);
  el.innerHTML = all + options.map((o) =>
    chip(o.label, state[field].has(o.value), `data-field="${field}" data-value="${esc(o.value)}"`,
      o.count != null ? `<span class="chip-count">${o.count}</span>` : ''),
  ).join('');
}

// Rooms that the base filters (building, guest toggle) allow, used to decide
// which floor / wing / feature options make sense to offer.
function baseRooms() {
  return activeRooms.filter((r) =>
    (state.includeNonGuest || r.guestRoom) &&
    (state.buildings.size === 0 || state.buildings.has(r.building)));
}

function renderFilters() {
  const activeBuildings = model.buildings.filter((b) => b.active);
  renderChipGroup($('f-building'), 'buildings', activeBuildings.map((b) => ({ value: b.code, label: b.name })));

  const base = baseRooms();
  const floors = [...new Set(base.map((r) => r.floor))].sort(compareFloors);
  renderChipGroup($('f-floor'), 'floors', floors.map((f) => ({ value: f, label: floorShort(f) })));

  const wings = [...new Set(base.map((r) => r.wing).filter(Boolean))].sort();
  $('wing-set').hidden = wings.length < 2 && state.wings.size === 0;
  renderChipGroup($('f-wing'), 'wings', wings.map((w) => ({ value: w, label: w })));

  // Feature counts reflect every other active filter, so the number on a chip
  // is how many rooms you'd see if you added it.
  const withoutFeatures = applyFilters(activeRooms, { ...state, features: new Set() });
  const counts = new Map();
  for (const r of base) for (const f of r.features) counts.set(f, 0);
  for (const f of state.features) counts.set(f, 0);
  for (const r of withoutFeatures) {
    if ([...state.features].every((f) => r.features.includes(f))) {
      for (const f of r.features) counts.set(f, counts.get(f) + 1);
    }
  }
  const features = [...counts.keys()].sort(compareFeatures);
  $('f-feature').innerHTML = features.map((f) =>
    chip(f, state.features.has(f), `data-field="features" data-value="${esc(f)}"`,
      `<span class="chip-count">${counts.get(f)}</span>`)).join('');

  $('pax-value').textContent = state.minPax ? `${state.minPax}+ people` : 'Any';
  $('pax-down').disabled = state.minPax === 0;
  $('q').value = state.query;
  $('f-nonguest').checked = state.includeNonGuest;

  const moreActive = state.wings.size + state.features.size + (state.minPax ? 1 : 0) + (state.includeNonGuest ? 1 : 0);
  $('more-count').textContent = moreActive ? ` · ${moreActive}` : '';
  const anyActive = moreActive + state.buildings.size + state.floors.size + (state.query ? 1 : 0);
  $('clear').hidden = anyActive === 0;
}

// ---- Summary ------------------------------------------------------------------

function renderSummary(rooms) {
  const t = totals(rooms);
  const all = totals(baseAll());
  const filtered = t.rooms !== all.rooms;
  const of = (v, total) => (filtered ? `<span class="of">of ${fmt(total)}</span>` : '');
  $('summary').innerHTML = `
    <div class="stat"><span class="stat-label">Rooms</span><span class="stat-value">${fmt(t.rooms)}</span>${of(t.rooms, all.rooms)}</div>
    <div class="stat"><span class="stat-label">Beds</span><span class="stat-value">${fmt(t.beds)}</span>${of(t.beds, all.beds)}</div>
    <div class="stat"><span class="stat-label">Extra mattresses</span><span class="stat-value">${fmt(t.extra)}</span>${of(t.extra, all.extra)}</div>
    <div class="stat stat-main"><span class="stat-label">Fits up to</span><span class="stat-value">${fmt(t.maxPax)}</span><span class="of">${filtered ? `of ${fmt(all.maxPax)} people` : 'people'}</span></div>`;
}

// Everything in active buildings, respecting only the guest-room toggle.
function baseAll() {
  return activeRooms.filter((r) => state.includeNonGuest || r.guestRoom);
}

// ---- Capacity breakdown -------------------------------------------------------

function row({ label, sub, t, max, pressed, data }) {
  const pct = max ? Math.max(2, Math.round((t.maxPax / max) * 100)) : 0;
  return `
    <button type="button" class="brow" aria-pressed="${pressed}" ${data}>
      <span class="brow-label">${esc(label)}${sub ? `<span class="brow-sub">${esc(sub)}</span>` : ''}</span>
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

function renderBreakdown(rooms) {
  const el = $('breakdown');
  $('tab-floor').setAttribute('aria-selected', state.view === 'floor');
  $('tab-feature').setAttribute('aria-selected', state.view === 'feature');

  if (rooms.length === 0) {
    el.innerHTML = '<p class="empty-small">Nothing to count with these filters.</p>';
    return;
  }

  if (state.view === 'floor') {
    const groups = groupByBuildingFloor(rooms);
    const max = Math.max(...groups.flatMap((g) => g.floors.map((f) => totals(f.rooms).maxPax)));
    el.innerHTML = groups.map((g) => {
      const bt = totals(g.rooms);
      return `
        <div class="bgroup">
          <h3 class="bgroup-title">${esc(buildingName.get(g.code))}
            <span class="bgroup-total">${fmt(bt.rooms)} rooms · ${fmt(bt.beds)} beds · up to ${fmt(bt.maxPax)}</span></h3>
          ${HEAD}
          ${g.floors.map((f) => row({
            label: floorLabel(f.floor),
            t: totals(f.rooms),
            max,
            pressed: state.floors.has(f.floor) && state.buildings.has(g.code),
            data: `data-building="${esc(g.code)}" data-floor="${esc(f.floor)}"`,
          })).join('')}
        </div>`;
    }).join('');
  } else {
    const byFeature = new Map();
    for (const r of rooms) {
      const feats = r.features.length ? r.features : ['No listed features'];
      for (const f of feats) {
        if (!byFeature.has(f)) byFeature.set(f, []);
        byFeature.get(f).push(r);
      }
    }
    const keys = [...byFeature.keys()].sort((a, b) =>
      (a === 'No listed features') - (b === 'No listed features') || compareFeatures(a, b));
    const max = Math.max(...keys.map((k) => totals(byFeature.get(k)).maxPax));
    el.innerHTML = `<div class="bgroup">${HEAD}${keys.map((k) => row({
      label: k,
      t: totals(byFeature.get(k)),
      max,
      pressed: state.features.has(k),
      data: k === 'No listed features' ? 'disabled' : `data-feature="${esc(k)}"`,
    })).join('')}</div>
    <p class="note">A room with several features is counted under each of them.</p>`;
  }
}

function groupByBuildingFloor(rooms) {
  const order = new Map(model.buildings.map((b, i) => [b.code, i]));
  const map = new Map();
  for (const r of rooms) {
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

// ---- Room tiles ---------------------------------------------------------------

function tile(r) {
  const tags = [...r.features.filter((f) => f !== 'Staff')];
  if (r.wing === 'New wing') tags.unshift('New wing');
  const nonGuest = !r.guestRoom;
  const status = nonGuest
    ? `<span class="tile-flag">${r.features.includes('Staff') ? 'Staff room' : 'Not a guest room'}</span>`
    : '';
  let cap = `${r.beds} ${r.beds === 1 ? 'bed' : 'beds'} · up to <strong>${r.maxPax}</strong>`;
  if (r.maxPax === 0) cap = r.features.includes('Staff') ? 'Beds not recorded' : 'No beds';
  const title = [r.roomType && `Listed as: ${r.roomType}`, r.notes].filter(Boolean).join('\n');
  return `
    <li class="tile${nonGuest ? ' tile-off' : ''}"${title ? ` title="${esc(title)}"` : ''}>
      <div class="tile-top">
        <span class="tile-room">${esc(r.room)}</span>
      </div>
      <div class="tile-cap">${cap}</div>
      ${r.extra ? `<div class="tile-extra">+${r.extra} extra ${r.extra === 1 ? 'mattress' : 'mattresses'}</div>` : ''}
      ${tags.length ? `<div class="tile-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${r.notes && !nonGuest ? `<div class="tile-note">${esc(r.notes)}</div>` : ''}
      ${status}
    </li>`;
}

function renderRooms(rooms) {
  const el = $('rooms');
  $('rooms-title').textContent = rooms.length === 1 ? '1 room' : `${fmt(rooms.length)} rooms`;
  if (rooms.length === 0) {
    el.innerHTML = `
      <div class="empty">
        <p class="empty-title">No rooms match these filters</p>
        <p>Try removing a feature or lowering “Fits at least”.</p>
        <button type="button" class="btn" data-action="clear">Clear all filters</button>
      </div>`;
    return;
  }
  el.innerHTML = groupByBuildingFloor(rooms).map((g) => g.floors.map((f) => {
    const t = totals(f.rooms);
    return `
      <div class="floor">
        <h3 class="floor-title">
          <span>${esc(buildingName.get(g.code))} <span class="dot" aria-hidden="true">·</span> ${esc(floorLabel(f.floor))}</span>
          <span class="floor-total">${fmt(t.rooms)} rooms · up to ${fmt(t.maxPax)}</span>
        </h3>
        <ul class="grid">${f.rooms.map(tile).join('')}</ul>
      </div>`;
  }).join('')).join('');
}

// ---- Wiring -------------------------------------------------------------------

function render() {
  // Drop selections that no longer exist (e.g. a floor after changing building).
  const base = baseRooms();
  const floors = new Set(base.map((r) => r.floor));
  for (const f of state.floors) if (!floors.has(f)) state.floors.delete(f);
  const wings = new Set(base.map((r) => r.wing));
  for (const w of state.wings) if (!wings.has(w)) state.wings.delete(w);

  const rooms = applyFilters(activeRooms, state);
  renderFilters();
  renderSummary(rooms);
  renderBreakdown(rooms);
  renderRooms(rooms);
  writeUrl();
}

function clearAll() {
  Object.assign(state, {
    buildings: new Set(), floors: new Set(), wings: new Set(), features: new Set(),
    minPax: 0, query: '', includeNonGuest: false,
  });
  render();
}

function toggle(field, value) {
  if (value === '') state[field].clear();
  else if (state[field].has(value)) state[field].delete(value);
  else state[field].add(value);
}

function wire() {
  document.querySelector('.filters').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    toggle(c.dataset.field, c.dataset.value);
    render();
  });

  $('breakdown').addEventListener('click', (e) => {
    const b = e.target.closest('.brow');
    if (!b || b.disabled) return;
    if (b.dataset.feature) {
      toggle('features', b.dataset.feature);
    } else if (b.dataset.floor) {
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

  for (const id of ['tab-floor', 'tab-feature']) {
    $(id).addEventListener('click', () => { state.view = id === 'tab-floor' ? 'floor' : 'feature'; render(); });
  }

  $('q').addEventListener('input', (e) => { state.query = e.target.value; render(); });
  $('pax-up').addEventListener('click', () => { state.minPax += 1; render(); });
  $('pax-down').addEventListener('click', () => { state.minPax = Math.max(0, state.minPax - 1); render(); });
  $('f-nonguest').addEventListener('change', (e) => { state.includeNonGuest = e.target.checked; render(); });
  $('clear').addEventListener('click', clearAll);
  $('rooms').addEventListener('click', (e) => { if (e.target.closest('[data-action="clear"]')) clearAll(); });

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
  const active = new Set(model.buildings.filter((x) => x.active).map((x) => x.code));
  activeRooms = model.rooms.filter((x) => active.has(x.building));
  buildingName = new Map(model.buildings.map((x) => [x.code, x.name]));

  readUrl();
  // Open "More filters" on load if any of them are in use.
  if (state.wings.size || state.features.size || state.minPax || state.includeNonGuest) {
    $('more-toggle').setAttribute('aria-expanded', 'true');
    $('more-filters').classList.add('open');
  }
  wire();
  render();
}

load();
