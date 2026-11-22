import { GENRES, CURATED, normalize, genreFromTags, genreById } from './stations.js';

// ---------- úložiště ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- katalog (Radio Browser) ----------
const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];
const CACHE_KEY = 'catalog-cz-v1';
const CACHE_TTL = 24 * 3600 * 1000;

async function apiGet(path) {
  let last;
  for (const base of MIRRORS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(base + path, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; } finally { clearTimeout(t); }
  }
  throw last || new Error('Katalog nedostupný');
}

// Stránka běží přes https → přehrát jde jen https stream.
const httpsUrl = (s) => [s.url_resolved, s.url].find((u) => u && u.startsWith('https://')) || null;
// iPhone neumí spolehlivě Ogg/FLAC → takové streamy vynecháme
const playable = (s) => { const u = httpsUrl(s); return u && !/\.(ogg|oga|opus|flac)(\?|$)/i.test(u) ? u : null; };
const hasWord = (name, phrase) => (' ' + name + ' ').includes(' ' + phrase + ' ');

function pickBest(raw, item, needUrl = true) {
  const hits = raw.filter((s) => {
    if (needUrl && !playable(s)) return false;
    const n = normalize(s.name);
    if (!item.match.some((m) => hasWord(n, normalize(m)))) return false;
    if (item.exclude && item.exclude.some((x) => hasWord(n, normalize(x)))) return false;
    return true;
  });
  hits.sort((a, b) => (b.clickcount || 0) - (a.clickcount || 0));
  return hits[0];
}

const toStation = (s, extra = {}) => ({
  id: s.stationuuid, uuid: s.stationuuid, name: (s.name || '').trim(),
  url: playable(s), logo: s.favicon && s.favicon.startsWith('https://') ? s.favicon : null,
  bitrate: s.bitrate || 0, ...extra,
});

async function loadCatalog(force) {
  let raw = null, offline = false;
  const cached = store.get(CACHE_KEY, null);
  if (cached && !force && Date.now() - cached.at < CACHE_TTL) raw = cached.raw;
  if (!raw) {
    try {
      raw = await apiGet('/json/stations/bycountrycodeexact/CZ?hidebroken=true&order=clickcount&reverse=true&limit=600');
      raw = raw
        .filter((s) => s.lastcheckok !== 0)
        .map(({ stationuuid, name, url, url_resolved, favicon, tags, bitrate, clickcount }) =>
          ({ stationuuid, name, url, url_resolved, favicon, tags, bitrate, clickcount }));
      store.set(CACHE_KEY, { at: Date.now(), raw });
    } catch {
      if (cached) raw = cached.raw;
      else return { stations: CURATED.map((c) => ({ ...c, curated: true, url: null })), offline: true };
      offline = true;
    }
  }
  const used = new Set();
  const curated = CURATED.map((c) => {
    const b = pickBest(raw, c, !c.stream);
    if (b) used.add(b.stationuuid);
    const st = b ? toStation(b, { id: c.id, name: c.name, genre: c.genre, also: c.also, curated: true })
                 : { ...c, curated: true, url: null };
    if (c.stream) { st.url = c.stream; st.bitrate = st.bitrate || 128; }
    return st;
  });
  const seen = new Set(curated.map((c) => normalize(c.name)));
  const rest = [];
  for (const s of raw) {
    if (used.has(s.stationuuid) || !playable(s)) continue;
    const k = normalize(s.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    rest.push(toStation(s, { genre: genreFromTags(s.tags, s.name), curated: false }));
  }
  return { stations: [...curated, ...rest], offline };
}

async function searchStream(name) {
  const list = await apiGet('/json/stations/search?countrycode=CZ&hidebroken=true&order=clickcount&reverse=true&limit=10&name=' + encodeURIComponent(name));
  const s = list.find(playable);
  return s ? toStation(s) : null;
}

// ---------- stav ----------
const state = {
  stations: [], offline: false, genre: store.get('genre', 'all'), q: '',
  favs: store.get('favorites-v1', []), current: store.get('last-station-v1', null),
  phase: 'idle', error: '',
};

const $ = (id) => document.getElementById(id);
const audio = $('audio');
let tuneTimer = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function logoHtml(st) {
  const g = genreById(st.genre || 'all');
  const initials = st.name.replace(/^(ČRo|Rádio|Radio)\s+/i, '').split(/\s+/).slice(0, 2)
    .map((w) => w[0] || '').join('').toUpperCase() || '♪';
  const style = `color:${g.color};background:${g.color}33;border-color:${g.color}`;
  const img = st.logo ? `<img src="${esc(st.logo)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<div class="logo" style="${style}">${img || esc(initials)}</div>`;
}

// ---------- vykreslení ----------
function renderChips() {
  const counts = { all: state.stations.length, fav: state.favs.length };
  for (const s of state.stations) for (const g of [s.genre, ...(s.also || [])]) if (g) counts[g] = (counts[g] || 0) + 1;
  $('chips').innerHTML = GENRES.map((g) => {
    const n = counts[g.id] || 0;
    if (!n && g.id !== 'all' && g.id !== 'fav') return '';
    const on = g.id === state.genre;
    const style = on ? `background:${g.color};border-color:${g.color}` : '';
    return `<button class="chip${on ? ' on' : ''}" data-genre="${g.id}" style="${style}">${g.icon} ${esc(g.label)} <small>${n}</small></button>`;
  }).join('');
}

function rowHtml(st) {
  const g = st.genre ? genreById(st.genre).label : 'Ostatní';
  const on = state.current && state.current.id === st.id;
  const fav = state.favs.includes(st.id);
  let extra = '';
  if (on && state.phase === 'playing') extra = ' · <b>▶ hraje</b>';
  else if (on && state.phase === 'tuning') extra = ' · <b>ladím…</b>';
  const kbps = st.bitrate ? ` · ${st.bitrate} kbps` : '';
  return `<div class="row${on ? ' on' : ''}" data-id="${esc(st.id)}" role="button" tabindex="0">
    ${logoHtml(st)}
    <div class="t"><div class="n">${esc(st.name)}</div><div class="g">${esc(g)}${kbps}${extra}</div></div>
    <button class="fav${fav ? ' on' : ''}" data-fav="${esc(st.id)}" aria-label="Oblíbené">${fav ? '★' : '☆'}</button>
  </div>`;
}

// stanice v aktuálním žánru / hledání – v pořadí, jak jsou v seznamu
function visibleStations() {
  const q = normalize(state.q);
  const vis = state.stations.filter((s) => {
    if (state.genre === 'fav' && !state.favs.includes(s.id)) return false;
    if (state.genre !== 'all' && state.genre !== 'fav' && s.genre !== state.genre && !(s.also || []).includes(state.genre)) return false;
    if (q && !normalize(s.name).includes(q)) return false;
    return true;
  });
  return [...vis.filter((s) => s.curated), ...vis.filter((s) => !s.curated)];
}

// přepnutí na předchozí / další stanici (zamčená obrazovka, sluchátka, CarPlay)
function step(dir) {
  let list = visibleStations();
  if (!list.length) list = state.stations;
  if (!list.length) return;
  const i = state.current ? list.findIndex((s) => s.id === state.current.id) : -1;
  const next = list[(i + dir + list.length) % list.length];
  play(next);
}

function renderList() {
  const q = normalize(state.q);
  const vis = visibleStations();
  let html = installHint() + (state.genre === 'fav' ? favSyncPanel() : '');
  if (!vis.length) {
    html += `<p class="empty">${state.genre === 'fav' ? 'Zatím žádné oblíbené.<br>Klepni na ☆ u stanice.' : 'Nic nenalezeno.'}</p>`;
  } else {
    const cur = vis.filter((s) => s.curated), rest = vis.filter((s) => !s.curated);
    if (cur.length && rest.length && !q) {
      html += `<div class="section">Výběr</div>` + cur.map(rowHtml).join('') +
              `<div class="section">Další stanice</div>` + rest.map(rowHtml).join('');
    } else html += vis.map(rowHtml).join('');
  }
  $('list').innerHTML = html;
}

function renderSubtitle() {
  $('subtitle').textContent = `${state.stations.length} stanic${state.offline ? ' · offline' : ''}`;
}

function renderPlayer() {
  const st = state.current;
  $('player').hidden = !st;
  if (!st) return;
  $('pLogo').outerHTML = logoHtml(st).replace('class="logo"', 'class="logo" id="pLogo"');
  $('pName').textContent = st.name;
  const ps = $('pStatus').parentElement;
  ps.classList.toggle('err', state.phase === 'error');
  $('pDot').hidden = state.phase !== 'playing';
  $('pStatus').textContent = { idle: 'Klepni na ▶', tuning: state.error || 'Ladím…', playing: 'Živě', paused: 'Pozastaveno', error: state.error }[state.phase];
  const btn = $('pBtn');
  const active = state.phase === 'playing' || state.phase === 'tuning';
  btn.innerHTML = state.phase === 'tuning' ? '<span class="spin"></span>' : active ? '❚❚' : '▶';
  btn.setAttribute('aria-label', active ? 'Pozastavit' : 'Přehrát');
}

const renderAll = () => { renderChips(); renderList(); renderSubtitle(); renderPlayer(); };
const setPhase = (p, err = '') => { state.phase = p; state.error = err; renderList(); renderPlayer(); updateMediaSession(); };

// ---------- přidání na plochu (iOS) ----------
// ---------- přenos oblíbených mezi prohlížeči / zařízeními ----------
const FAV_PREFIX = 'oblibene=';
function favLink() {
  return location.origin + location.pathname + '#' + FAV_PREFIX + state.favs.map(encodeURIComponent).join(',');
}
function favSyncPanel() {
  return `<div class="hint sync">
    <b>Přenos oblíbených</b> do jiného prohlížeče nebo telefonu:
    <div class="syncBtns">
      <button class="sbtn" data-fav-export ${state.favs.length ? '' : 'disabled'}>Zkopírovat odkaz</button>
      <button class="sbtn" data-fav-import>Vložit odkaz</button>
    </div>
    <small id="syncMsg">${esc(state.syncMsg || '')}</small></div>`;
}
function syncMsg(text) { state.syncMsg = text; const el = $('syncMsg'); if (el) el.textContent = text; }
function importFavs(text) {
  const m = String(text || '').match(/oblibene=([^\s]*)/);
  const raw = m ? m[1] : String(text || '').trim();
  const ids = raw.split(',').map((x) => { try { return decodeURIComponent(x.trim()); } catch { return ''; } }).filter(Boolean);
  if (!ids.length) return 0;
  const before = state.favs.length;
  state.favs = [...new Set([...state.favs, ...ids])];
  store.set('favorites-v1', state.favs);
  return state.favs.length - before;
}
async function exportFavs() {
  const link = favLink();
  try {
    if (navigator.share) { await navigator.share({ title: 'Moje oblíbená rádia', url: link }); return syncMsg('Odesláno.'); }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(link); syncMsg('Odkaz zkopírován. Otevři ho v druhém prohlížeči, nebo ho tam vlož tlačítkem „Vložit odkaz“.'); }
  catch { syncMsg('Kopírování selhalo. Odkaz: ' + link); }
}
async function askImport() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch {}
  if (!/oblibene=/.test(text)) text = window.prompt('Vlož odkaz s oblíbenými:', '') || '';
  const n = importFavs(text);
  renderChips(); renderList();
  syncMsg(n ? `Přidáno ${n} oblíbených stanic.` : 'V odkazu nebyly žádné nové stanice.');
}

function installHint() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (standalone || !ios || store.get('hint-closed', false)) return '';
  return `<div class="hint"><button data-close-hint aria-label="Zavřít">✕</button>
    <b>Tip:</b> V Safari klepni na <b>Sdílet</b> (čtvereček se šipkou) → <b>Přidat na plochu</b>. Rádia pak otevřeš jako appku.</div>`;
}

// ---------- přehrávání: start okamžitě, zásobník se plní za běhu, při výpadku obnovení spojení ----------
const STALL_MS = 8000;      // jak dlouho tolerovat zaseknutí, než se připojíme znovu
const MAX_RETRIES = 4;

let session = 0;            // id aktuálního přehrávání (přepnutí stanice ho zneplatní)
let currentUrl = null;
let retries = 0;
let stallTimer = null, retryTimer = null;

function clearTimers() {
  clearTimeout(tuneTimer); clearTimeout(stallTimer); clearTimeout(retryTimer);
}

// kolik sekund zvuku je stažených dopředu
function bufferedAhead() {
  const b = audio.buffered, t = audio.currentTime;
  for (let i = b.length - 1; i >= 0; i--) if (b.start(i) <= t + 0.5) return Math.max(0, b.end(i) - t);
  return 0;
}

function connect(sid, reconnect) {
  const url = reconnect ? currentUrl + (currentUrl.includes('?') ? '&' : '?') + '_=' + Date.now() : currentUrl;
  audio.preload = 'auto';
  audio.src = url;
  audio.play().catch((e) => {
    if (sid !== session || (e && e.name === 'AbortError')) return;
    if (reconnect) reconnectOrFail(sid); else { clearTimers(); setPhase('error', 'Stanici nelze přehrát.'); }
  });
  clearTimeout(tuneTimer);
  tuneTimer = setTimeout(() => { if (sid === session && state.phase !== 'playing') reconnectOrFail(sid); }, 15000);
}

function reconnectOrFail(sid) {
  if (sid !== session) return;
  clearTimers();
  if (retries >= MAX_RETRIES) {
    audio.pause();
    return setPhase('error', 'Stanice teď nevysílá.');
  }
  retries++;
  setPhase('tuning', 'Obnovuji spojení…');
  // první pokus hned, další s rostoucím odstupem
  retryTimer = setTimeout(() => { if (sid === session) connect(sid, true); }, retries === 1 ? 0 : 1000 * (retries - 1));
}

async function play(st) {
  clearTimers();
  const sid = ++session;
  retries = 0;
  state.current = st;
  store.set('last-station-v1', st);
  setPhase('tuning');

  let target = st;
  if (!target.url) {
    try {
      const f = await searchStream(st.name);
      if (f) target = { ...st, url: f.url, uuid: f.uuid, logo: st.logo || f.logo };
    } catch {}
  }
  if (sid !== session) return;            // mezitím vybrána jiná stanice
  if (!target.url) return setPhase('error', 'Stream se nepodařilo najít.');

  currentUrl = target.url;
  connect(sid, false);
  if (target.uuid) apiGet('/json/url/' + target.uuid).catch(() => {});
}

function stop() {
  session++;
  clearTimers();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  setPhase('paused');
}

function toggle() {
  if (!state.current) return;
  if (state.phase === 'playing' || state.phase === 'tuning') stop();
  else play(state.stations.find((s) => s.id === state.current.id) || state.current);
}

audio.addEventListener('playing', () => {
  clearTimeout(stallTimer); clearTimeout(tuneTimer);
  retries = 0;
  setPhase('playing');
});
const onStall = () => {
  if (state.phase !== 'playing') return;
  setPhase('tuning', 'Načítám…');
  const sid = session;
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => { if (sid === session && state.phase !== 'playing') reconnectOrFail(sid); }, STALL_MS);
};
audio.addEventListener('waiting', onStall);
audio.addEventListener('stalled', onStall);
audio.addEventListener('ended', () => { if (audio.getAttribute('src') && state.phase !== 'paused') reconnectOrFail(session); });
audio.addEventListener('pause', () => { if (state.phase === 'playing') { clearTimers(); setPhase('paused'); } });
audio.addEventListener('error', () => {
  if (audio.getAttribute('src') && state.phase !== 'paused' && state.phase !== 'error') reconnectOrFail(session);
});

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.current) return;
  const st = state.current;
  const artwork = [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }];
  if (st.logo) artwork.unshift({ src: st.logo, sizes: '256x256' });
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: st.name, artist: 'Česká rádia', artwork });
    navigator.mediaSession.playbackState = state.phase === 'playing' ? 'playing' : 'paused';
  } catch {}
}
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', () => toggle());
    navigator.mediaSession.setActionHandler('pause', () => stop());
    navigator.mediaSession.setActionHandler('stop', () => stop());
  } catch {}
  // místo ±10 s ukázat na zamčené obrazovce předchozí / další stanici
  for (const [action, fn] of [['previoustrack', () => step(-1)], ['nexttrack', () => step(1)],
                              ['seekbackward', null], ['seekforward', null], ['seekto', null]]) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
  }
}

// ---------- události ----------
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-genre]');
  if (!b) return;
  state.genre = b.dataset.genre;
  store.set('genre', state.genre);
  renderChips(); renderList();
  window.scrollTo({ top: 0 });
});
$('list').addEventListener('click', (e) => {
  if (e.target.closest('[data-close-hint]')) { store.set('hint-closed', true); return renderList(); }
  if (e.target.closest('[data-fav-export]')) return exportFavs();
  if (e.target.closest('[data-fav-import]')) return askImport();
  const f = e.target.closest('[data-fav]');
  if (f) {
    const id = f.dataset.fav;
    state.favs = state.favs.includes(id) ? state.favs.filter((x) => x !== id) : [...state.favs, id];
    store.set('favorites-v1', state.favs);
    renderChips(); renderList();
    return;
  }
  const r = e.target.closest('[data-id]');
  if (r) {
    const st = state.stations.find((s) => s.id === r.dataset.id);
    if (st) play(st);
  }
});
$('q').addEventListener('input', (e) => { state.q = e.target.value; renderList(); });
$('pBtn').addEventListener('click', toggle);

// ---------- start ----------
(async () => {
  if (state.current) state.phase = 'idle';
  // požádat systém, aby data aplikace (oblíbené) nemazal
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
  // otevřeno z odkazu „#oblibene=…“ → importovat a ukázat oblíbené
  if (location.hash.includes(FAV_PREFIX)) {
    let h = location.hash; try { h = decodeURIComponent(h); } catch {}
    const n = importFavs(h);
    history.replaceState(null, '', location.pathname);
    state.genre = 'fav';
    store.set('genre', 'fav');
    syncMsg(n ? `Přidáno ${n} oblíbených stanic.` : 'Oblíbené už tu máš.');
  }
  const res = await loadCatalog(false);
  state.stations = res.stations;
  state.offline = res.offline;
  if (!GENRES.some((g) => g.id === state.genre)) state.genre = 'all';
  renderAll();
  // tiché obnovení katalogu, když je cache starší
  if (!res.offline && store.get(CACHE_KEY, { at: 0 }).at < Date.now() - CACHE_TTL) {
    const fresh = await loadCatalog(true).catch(() => null);
    if (fresh && !fresh.offline) { state.stations = fresh.stations; renderAll(); }
  }
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
