// The "Live" tab: a read-only view of the ACCOMMODATION tab of the Google
// sheet, refreshed every few seconds while it is open.
//
// The sheet is read by a small Google Apps Script web app (apps-script/Code.gs)
// that runs under the account that set it up. Its address is kept in
// data/live.json, so once one person connects it, every device just works.

import { buildLive, roomDay, roomStays, groupName, todayIn } from './live-model.js';
import { floorLabel } from './data.js';

const CONFIG_PATH = 'data/live.json';
const LOCAL_URL_KEY = 'karbala-rooms:live-url';
const POLL_MS = 15000;
const TIME_ZONE = 'Asia/Baghdad';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

const SCRIPT_URL = /^https:\/\/script\.google(?:usercontent)?\.com\/(?:a\/[^/]+\/)?macros\/s\/[\w-]+\/(?:exec|dev)(?:\?.*)?$/;

function dayLabel(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

function timeLabel(isoTime) {
  return new Date(isoTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
}

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h === 1 ? '1 hour ago' : `${h} hours ago`;
}

export function createLive({ getModel, buildingName, readFile, writeFile, getKey, showToast, onChange }) {
  const view = {
    active: false,
    config: null, // { url, sheet }
    configSha: null,
    feed: null,
    live: null,
    lastOk: 0,
    error: '',
    loading: false,
    date: null, // ISO date picked, or null for today
    status: 'all', // all | occupied | vacant | arriving | leaving
    buildings: new Set(),
    query: '',
    timer: null,
    ticker: null,
    setupOpen: false,
    expanded: new Set(), // 'arriving' / 'leaving' lists shown in full
  };

  // ---- Connection -------------------------------------------------------------

  async function loadConfig() {
    let config = { url: '', sheet: '' };
    try {
      const file = await readFile(CONFIG_PATH);
      config = { ...config, ...JSON.parse(file.text) };
      view.configSha = file.sha;
    } catch { /* no file yet */ }
    try {
      const local = localStorage.getItem(LOCAL_URL_KEY);
      if (local && !config.url) config.url = local;
    } catch { /* storage blocked */ }
    view.config = config;
  }

  async function fetchFeed(url) {
    let res;
    try {
      res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
    } catch {
      throw new Error('Could not reach the sheet. Check the internet connection.');
    }
    if (!res.ok) throw new Error(`The sheet connection answered with an error (${res.status}).`);
    let feed;
    try { feed = await res.json(); } catch {
      throw new Error('The sheet connection did not send room data. Check that the web app is deployed with access for "Anyone".');
    }
    if (!feed.ok) throw new Error(feed.error || 'The sheet could not be read.');
    if (!Array.isArray(feed.dates) || !Array.isArray(feed.rows)) throw new Error('The sheet connection sent something unexpected.');
    return feed;
  }

  function rebuild() {
    if (!view.feed) return;
    const model = getModel();
    view.live = buildLive(view.feed, model.rooms, model.buildings.map((b) => b.code));
  }

  async function poll() {
    if (!view.config?.url || view.loading) return;
    view.loading = true;
    try {
      const feed = await fetchFeed(view.config.url);
      const changed = !view.feed || feed.modified !== view.feed.modified || feed.today !== view.feed.today
        || JSON.stringify(feed.rows) !== JSON.stringify(view.feed.rows);
      view.feed = feed;
      view.lastOk = Date.now();
      view.error = '';
      if (changed) { rebuild(); if (view.active) render(); }
    } catch (err) {
      view.error = err.message;
      if (view.active && !view.feed) render();
    } finally {
      view.loading = false;
      renderState();
    }
  }

  function startPolling() {
    stopPolling();
    poll();
    view.timer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    view.ticker = setInterval(renderState, 5000);
  }

  function stopPolling() {
    clearInterval(view.timer);
    clearInterval(view.ticker);
    view.timer = null;
    view.ticker = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (view.active && !document.hidden) poll();
  });

  async function connect() {
    const input = $('live-url');
    const url = input.value.trim();
    const error = $('live-setup-error');
    error.hidden = true;
    if (!SCRIPT_URL.test(url)) {
      error.textContent = 'That is not a web app address. It should start with https://script.google.com/macros/s/ and end with /exec.';
      error.hidden = false;
      return;
    }
    const button = $('live-connect');
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const feed = await fetchFeed(url);
      const config = { ...view.config, url };
      let sharedNote = '';
      if (getKey()) {
        const file = await readFile(CONFIG_PATH).catch(() => ({ sha: undefined }));
        await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, file.sha, 'Connect the live accommodation sheet');
        try { localStorage.removeItem(LOCAL_URL_KEY); } catch { /* ignore */ }
        sharedNote = 'Every device will now show it.';
      } else {
        try { localStorage.setItem(LOCAL_URL_KEY, url); } catch { /* ignore */ }
        sharedNote = 'Connected on this device only. Set up saving and connect again to share it with every device.';
      }
      view.config = config;
      view.feed = feed;
      view.lastOk = Date.now();
      view.error = '';
      view.setupOpen = false;
      rebuild();
      render();
      startPolling();
      showToast(`Live sheet connected. ${sharedNote}`);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Connect';
    }
  }

  // ---- Rendering -----------------------------------------------------------------

  function dayIndex() {
    const { dates } = view.live;
    const today = todayIn(TIME_ZONE);
    const want = view.date || today;
    let i = dates.indexOf(want);
    if (i === -1) {
      // Closest day the sheet has.
      i = dates.findIndex((d) => d > want);
      if (i === -1) i = dates.length - 1;
    }
    return i;
  }

  function renderState() {
    const el = $('live-state');
    if (!el) return;
    el.classList.remove('ok', 'bad');
    if (!view.config) {
      el.textContent = 'Loading…';
      return;
    }
    if (!view.config.url) {
      el.textContent = 'Not connected';
      return;
    }
    if (view.error && (!view.lastOk || Date.now() - view.lastOk > POLL_MS * 2)) {
      el.classList.add('bad');
      el.textContent = view.lastOk ? `Not updating: ${view.error} Last update ${ago(Date.now() - view.lastOk)}.` : view.error;
      return;
    }
    if (!view.lastOk) {
      el.textContent = 'Connecting to the sheet…';
      return;
    }
    el.classList.add('ok');
    const changed = view.feed?.modified ? ` · sheet last changed ${timeLabel(view.feed.modified)}` : '';
    el.textContent = `Live · checked ${ago(Date.now() - view.lastOk)}${changed}`;
  }

  function relativeName(iso) {
    const today = todayIn(TIME_ZONE);
    const diff = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return dayLabel(iso, { weekday: 'long' });
  }

  function stat(label, value, sub, main = false) {
    return `<div class="stat${main ? ' stat-main' : ''}"><span class="stat-label">${label}</span>`
      + `<span class="stat-value">${fmt(value)}</span>${sub ? `<span class="of">${sub}</span>` : ''}</div>`;
  }

  function matchesQuery(room, day) {
    const q = view.query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) return true;
    const squashed = q.replace(/\s/g, '');
    if (room.room.toLowerCase().replace(/\s/g, '').includes(squashed)) return true;
    return [...day.who, ...day.leaving, ...(day.next?.who || [])].some((t) => t.toLowerCase().includes(q));
  }

  function moves(entries, key) {
    const groups = new Map();
    for (const { room, day } of entries) {
      for (const who of day[key]) {
        const g = groupName(who);
        if (!groups.has(g)) groups.set(g, { name: who, rooms: [] });
        const group = groups.get(g);
        if (!group.rooms.includes(room)) group.rooms.push(room);
      }
    }
    const all = [...groups.values()].sort((a, b) => b.rooms.length - a.rooms.length || a.name.localeCompare(b.name));
    if (!all.length) return '<p class="empty-small">No one.</p>';
    const LIMIT = 5;
    const full = view.expanded.has(key) || all.length <= LIMIT + 1;
    const list = full ? all : all.slice(0, LIMIT);
    const more = full
      ? (all.length > LIMIT + 1 ? `<button type="button" class="link-btn" data-live-expand="${key}">Show fewer</button>` : '')
      : `<button type="button" class="link-btn" data-live-expand="${key}">Show all ${all.length} groups</button>`;
    return `<ul class="moves">${list.map((g) => `
      <li>
        <button type="button" class="move-name" data-live-query="${esc(g.name)}">${esc(g.name)}</button>
        <span class="move-count">${plural(g.rooms.length, 'room', 'rooms')}</span>
        <span class="move-rooms">${g.rooms.map((r) => `<button type="button" class="pill" data-live-room="${esc(r.id)}">${esc(r.room)}</button>`).join('')}</span>
      </li>`).join('')}</ul>${more}`;
  }

  function groupCount(entries, key) {
    return new Set(entries.flatMap(({ day }) => day[key].map(groupName))).size;
  }

  function badge(day) {
    if (day.status === 'blocked') return '<span class="badge badge-blocked">Blocked</span>';
    if (day.arriving.length) return '<span class="badge badge-in">Arriving</span>';
    if (day.status === 'occupied') return '<span class="badge badge-busy">In</span>';
    if (day.leaving.length) return '<span class="badge badge-out">Left</span>';
    return '<span class="badge badge-free">Free</span>';
  }

  function tile(room, day) {
    const { dates } = view.live;
    let body;
    if (day.status === 'occupied' || (day.status === 'blocked' && day.who.length)) {
      body = `<div class="tile-who">${day.who.map(esc).join('<br>')}</div>`;
      if (day.until !== -1) body += `<div class="tile-extra">until ${esc(dayLabel(dates[day.until]))}</div>`;
      const left = day.leaving.filter((t) => !day.who.includes(t));
      if (left.length) body += `<div class="tile-extra">Left: ${left.map(esc).join(', ')}</div>`;
    } else {
      body = day.leaving.length ? `<div class="tile-extra">Left: ${day.leaving.map(esc).join(', ')}</div>` : '';
      if (day.status === 'blocked') body += '<div class="tile-extra">Blocked in the room list</div>';
      else if (room.maxPax) body += `<div class="tile-cap">${plural(room.maxPax, 'place', 'places')}</div>`;
      if (day.next) body += `<div class="tile-extra">Next: ${esc(day.next.who.join(', '))} · ${esc(dayLabel(dates[day.next.index]))}</div>`;
    }
    const cls = `tile live-tile is-${day.status}${day.arriving.length ? ' is-arriving' : ''}`;
    return `
      <li><button type="button" class="${cls}" data-live-room="${esc(room.id)}">
        <div class="tile-top"><span class="tile-room">${esc(room.room)}</span>${badge(day)}</div>
        ${body}
        ${room.kg ? '<div class="tile-tags"><span class="tag">KG &amp; staff</span></div>' : ''}
      </button></li>`;
  }

  function render() {
    const setup = $('live-setup');
    const body = $('live-body');
    if (!view.config) {
      setup.hidden = true;
      body.hidden = false;
      $('live-date').hidden = true;
      $('live-change').hidden = true;
      $('live-content').innerHTML = '<div class="skeleton block tall"></div>';
      return;
    }
    const connected = Boolean(view.config.url);
    $('live-sheet-link').hidden = !view.config?.sheet;
    if (view.config?.sheet) $('live-sheet-link').href = view.config.sheet;
    $('live-change').hidden = !connected;

    if (!connected || view.setupOpen) {
      setup.hidden = false;
      body.hidden = true;
      $('live-url').value = view.config?.url || '';
      $('live-cancel').hidden = !connected;
      renderState();
      return;
    }
    setup.hidden = true;
    body.hidden = false;

    if (!view.live) {
      $('live-content').innerHTML = view.error
        ? `<div class="empty"><p class="empty-title">Could not load the sheet</p><p>${esc(view.error)}</p>
            <button type="button" class="btn" data-live-action="retry">Try again</button></div>`
        : '<div class="skeleton block tall"></div>';
      $('live-date').hidden = true;
      renderState();
      return;
    }

    const { dates, labels } = view.live;
    const d = dayIndex();
    const iso = dates[d];
    $('live-date').hidden = false;
    $('live-day-name').textContent = relativeName(iso);
    $('live-day-date').textContent = [dayLabel(iso, { day: 'numeric', month: 'long', year: 'numeric' }), labels[d]].filter(Boolean).join(' · ');
    $('live-prev').disabled = d <= 0;
    $('live-next').disabled = d >= dates.length - 1;
    $('live-today').hidden = iso === todayIn(TIME_ZONE);

    const entries = view.live.rooms.map((room) => ({ room, day: roomDay(view.live, room, d) }));
    const inBuildings = entries.filter(({ room }) => view.buildings.size === 0 || view.buildings.has(room.building));

    const count = (fn) => inBuildings.filter(fn).length;
    const occupied = count((e) => e.day.status === 'occupied');
    const free = inBuildings.filter((e) => e.day.status === 'vacant');
    const freePlaces = free.reduce((sum, e) => sum + e.room.maxPax, 0);
    const arriving = count((e) => e.day.arriving.length > 0);
    const leaving = count((e) => e.day.leaving.length > 0);
    const blocked = count((e) => e.day.status === 'blocked');
    const known = entries[0]?.day.known !== false;

    const summary = stat('Occupied', occupied, `of ${plural(inBuildings.length, 'room', 'rooms')}`)
      + stat('Free', free.length, `${plural(freePlaces, 'place', 'places')}${blocked ? ` · <span class="blocked-count">${fmt(blocked)} blocked</span>` : ''}`, true)
      + stat('Arriving', known ? arriving : 0, known ? `rooms · ${plural(groupCount(inBuildings, 'arriving'), 'group', 'groups')}` : 'no earlier day in the sheet')
      + stat('Leaving', known ? leaving : 0, known ? `rooms · ${plural(groupCount(inBuildings, 'leaving'), 'group', 'groups')}` : 'no earlier day in the sheet');

    const buildingCodes = [...new Set(entries.map((e) => e.room.building))].filter(Boolean);
    const chip = (label, pressed, data) => `<button type="button" class="chip" aria-pressed="${pressed}" ${data}>${esc(label)}</button>`;
    const buildingChips = buildingCodes.length > 1
      ? chip('All buildings', view.buildings.size === 0, 'data-live-building=""')
        + buildingCodes.map((c) => chip(buildingName(c) || c, view.buildings.has(c), `data-live-building="${esc(c)}"`)).join('')
      : '';
    const statuses = [['all', 'All'], ['occupied', 'Occupied'], ['vacant', 'Free'], ['arriving', 'Arriving'], ['leaving', 'Leaving']];
    const statusChips = statuses.map(([v, l]) => chip(l, view.status === v, `data-live-status="${v}"`)).join('');

    const shown = inBuildings.filter(({ room, day }) => {
      if (view.status === 'occupied' && day.status !== 'occupied') return false;
      if (view.status === 'vacant' && day.status !== 'vacant') return false;
      if (view.status === 'arriving' && !day.arriving.length) return false;
      if (view.status === 'leaving' && !day.leaving.length) return false;
      return matchesQuery(room, day);
    });

    const floors = new Map();
    for (const e of shown) {
      const key = `${e.room.building}|${e.room.floor}`;
      if (!floors.has(key)) floors.set(key, []);
      floors.get(key).push(e);
    }
    const roomsHtml = shown.length === 0
      ? `<div class="empty"><p class="empty-title">No rooms match</p><p>Try a different name, room or filter.</p>
          <button type="button" class="btn" data-live-action="clear">Show all rooms</button></div>`
      : [...floors.entries()].map(([key, list]) => {
        const [code, floor] = key.split('|');
        const busy = list.filter((e) => e.day.status === 'occupied').length;
        return `
          <div class="floor">
            <h3 class="floor-title">
              <span>${esc(buildingName(code) || 'Other rows')} <span class="dot" aria-hidden="true">·</span> ${esc(floor ? floorLabel(floor) : 'Other')}</span>
              <span class="floor-total">${fmt(busy)} of ${plural(list.length, 'room', 'rooms')} occupied</span>
            </h3>
            <ul class="grid">${list.map((e) => tile(e.room, e.day)).join('')}</ul>
          </div>`;
      }).join('');

    const movesEntries = inBuildings;
    $('live-content').innerHTML = `
      <section class="summary" aria-live="polite">${summary}</section>
      ${known ? `
      <div class="live-moves">
        <section class="panel"><h2 class="panel-title">Arriving ${esc(relativeName(iso).toLowerCase() === 'today' ? 'today' : `on ${dayLabel(iso)}`)}</h2>${moves(movesEntries, 'arriving')}</section>
        <section class="panel"><h2 class="panel-title">Leaving ${esc(relativeName(iso).toLowerCase() === 'today' ? 'today' : `on ${dayLabel(iso)}`)}</h2>${moves(movesEntries, 'leaving')}</section>
      </div>` : ''}
      <section class="live-filters" aria-label="Filter rooms">
        <div class="search">
          <label for="live-q" class="visually-hidden">Find a room or a name</label>
          <svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="9" cy="9" r="6"/><path d="m14 14 4 4"/></svg>
          <input id="live-q" type="search" placeholder="Find a room or a name" autocomplete="off" value="${esc(view.query)}">
        </div>
        ${buildingChips ? `<div class="chips">${buildingChips}</div>` : ''}
        <div class="chips">${statusChips}</div>
      </section>
      <section aria-labelledby="live-rooms-title">
        <div class="rooms-head">
          <h2 id="live-rooms-title" class="section-title">${plural(shown.length, 'room', 'rooms')}</h2>
          <span class="hint">Tap a room to see its dates</span>
        </div>
        ${roomsHtml}
      </section>`;
    renderState();
  }

  // Keeps the cursor in the search box when the list re-renders as you type.
  function renderKeepingFocus() {
    const focused = document.activeElement?.id === 'live-q';
    const pos = focused ? document.activeElement.selectionStart : 0;
    render();
    if (focused) {
      const input = $('live-q');
      input.focus();
      input.setSelectionRange(pos, pos);
    }
  }

  function openRoom(id) {
    const room = view.live?.rooms.find((r) => r.id === id);
    if (!room) return;
    const { dates } = view.live;
    const d = dayIndex();
    const stays = roomStays(view.live, room);
    const model = getModel();
    const app = model.rooms.find((r) => r.id === room.id);
    $('ld-where').textContent = [buildingName(room.building), room.floor ? floorLabel(room.floor) : '', room.info].filter(Boolean).join(' · ');
    $('ld-title').textContent = /\d/.test(room.room) ? `Room ${room.room}` : room.room;
    const range = (s) => (s.from === s.to ? dayLabel(dates[s.from]) : `${dayLabel(dates[s.from])} – ${dayLabel(dates[s.to])}`);
    const nights = (s) => plural(s.to - s.from + 1, 'day', 'days');
    $('ld-body').innerHTML = `
      <p class="ld-cap">${app ? `${plural(app.beds, 'bed', 'beds')} · fits up to ${app.maxPax}` : 'Not in the room list'}${room.sheetRows.length > 1 ? ` · ${room.sheetRows.length} rows in the sheet` : ''}</p>
      ${stays.length ? `<ol class="stays">${stays.map((s) => `
        <li class="${s.from <= d && d <= s.to ? 'now' : s.to < d ? 'past' : ''}">
          <span class="stay-when">${esc(range(s))}${s.from === 0 ? ' <span class="muted">(or earlier)</span>' : ''}${s.to === dates.length - 1 ? ' <span class="muted">(or later)</span>' : ''}</span>
          <span class="stay-who">${esc(s.who)}</span>
          <span class="stay-len">${nights(s)}</span>
        </li>`).join('')}</ol>`
        : '<p class="empty-small">No one in this room from '
          + `${esc(dayLabel(dates[0]))} to ${esc(dayLabel(dates[dates.length - 1]))}.</p>`}
      <p class="device-note">From the ${esc(view.feed.sheet)} tab, row ${room.sheetRows.join(', ')}. Changes are made in the sheet.</p>`;
    $('live-dialog').showModal();
  }

  // ---- Events ----------------------------------------------------------------------

  function wire() {
    $('live-connect').addEventListener('click', connect);
    $('live-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); connect(); } });
    $('live-change').addEventListener('click', () => { view.setupOpen = true; render(); });
    $('live-cancel').addEventListener('click', () => { view.setupOpen = false; render(); });
    $('live-prev').addEventListener('click', () => step(-1));
    $('live-next').addEventListener('click', () => step(1));
    $('live-today').addEventListener('click', () => { view.date = null; render(); onChange(); });

    const content = $('live-content');
    content.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.liveRoom) { openRoom(t.dataset.liveRoom); return; }
      if (t.dataset.liveQuery != null) {
        view.query = t.dataset.liveQuery;
        view.status = 'all';
        render();
        $('live-rooms-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (t.dataset.liveExpand) {
        const k = t.dataset.liveExpand;
        if (view.expanded.has(k)) view.expanded.delete(k); else view.expanded.add(k);
        render();
        return;
      }
      if (t.dataset.liveStatus) { view.status = t.dataset.liveStatus; render(); return; }
      if (t.dataset.liveBuilding != null) {
        const c = t.dataset.liveBuilding;
        if (c === '') view.buildings.clear();
        else if (view.buildings.has(c)) view.buildings.delete(c);
        else view.buildings.add(c);
        render();
        return;
      }
      if (t.dataset.liveAction === 'retry') { view.error = ''; render(); poll(); }
      if (t.dataset.liveAction === 'clear') { view.query = ''; view.status = 'all'; view.buildings.clear(); render(); }
    });
    content.addEventListener('input', (e) => {
      if (e.target.id !== 'live-q') return;
      view.query = e.target.value;
      renderKeepingFocus();
    });
  }

  function step(delta) {
    if (!view.live) return;
    const { dates } = view.live;
    const i = Math.min(dates.length - 1, Math.max(0, dayIndex() + delta));
    view.date = dates[i] === todayIn(TIME_ZONE) ? null : dates[i];
    render();
    onChange();
  }

  let wired = false;

  return {
    async show() {
      view.active = true;
      if (!wired) { wire(); wired = true; }
      if (!view.config) {
        render();
        await loadConfig();
      }
      render();
      if (view.config.url && !view.timer) startPolling();
    },
    hide() {
      view.active = false;
      stopPolling();
    },
    roomsChanged() {
      rebuild();
      if (view.active) render();
    },
    get date() { return view.date; },
    set date(value) { view.date = value || null; },
  };
}
