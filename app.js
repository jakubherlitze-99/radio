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
const hasWord = (name, phrase) => (' ' + name + ' ').includes(' ' + phrase + ' ');

function pickBest(raw, item) {
  const hits = raw.filter((s) => {
    if (!httpsUrl(s)) return false;
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
  url: httpsUrl(s), logo: s.favicon && s.favicon.startsWith('https://') ? s.favicon : null,
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
    const b = pickBest(raw, c);
    if (b) used.add(b.stationuuid);
    return b ? toStation(b, { id: c.id, name: c.name, genre: c.genre, curated: true })
             : { ...c, curated: true, url: null };
  });
  const seen = new Set(curated.map((c) => normalize(c.name)));
  const rest = [];
  for (const s of raw) {
    if (used.has(s.stationuuid) || !httpsUrl(s)) continue;
    const k = normalize(s.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    rest.push(toStation(s, { genre: genreFromTags(s.tags, s.name), curated: false }));
  }
  return { stations: [...curated, ...rest], offline };
}

async function searchStream(name) {
  const list = await apiGet('/json/stations/search?countrycode=CZ&hidebroken=true&order=clickcount&reverse=true&limit=10&name=' + encodeURIComponent(name));
  const s = list.find(httpsUrl);
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
  for (const s of state.stations) if (s.genre) counts[s.genre] = (counts[s.genre] || 0) + 1;
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

function renderList() {
  const q = normalize(state.q);
  const vis = state.stations.filter((s) => {
    if (state.genre === 'fav' && !state.favs.includes(s.id)) return false;
    if (state.genre !== 'all' && state.genre !== 'fav' && s.genre !== state.genre) return false;
    if (q && !normalize(s.name).includes(q)) return false;
    return true;
  });
  let html = installHint();
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
  $('pStatus').textContent = { idle: 'Klepni na ▶', tuning: 'Ladím…', playing: 'Živě', paused: 'Pozastaveno', error: state.error }[state.phase];
  const btn = $('pBtn');
  const active = state.phase === 'playing' || state.phase === 'tuning';
  btn.innerHTML = state.phase === 'tuning' ? '<span class="spin"></span>' : active ? '❚❚' : '▶';
  btn.setAttribute('aria-label', active ? 'Pozastavit' : 'Přehrát');
}

const renderAll = () => { renderChips(); renderList(); renderSubtitle(); renderPlayer(); };
const setPhase = (p, err = '') => { state.phase = p; state.error = err; renderList(); renderPlayer(); updateMediaSession(); };

// ---------- přidání na plochu (iOS) ----------
function installHint() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (standalone || !ios || store.get('hint-closed', false)) return '';
  return `<div class="hint"><button data-close-hint aria-label="Zavřít">✕</button>
    <b>Tip:</b> V Safari klepni na <b>Sdílet</b> (čtvereček se šipkou) → <b>Přidat na plochu</b>. Rádia pak otevřeš jako appku.</div>`;
}

// ---------- přehrávání ----------
async function play(st) {
  clearTimeout(tuneTimer);
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
  if (!target.url) return setPhase('error', 'Stream se nepodařilo najít.');
  if (state.current !== st) return; // mezitím vybrána jiná stanice

  audio.src = target.url;
  try {
    await audio.play();
  } catch (e) {
    if (state.current === st) setPhase('error', 'Stanici nelze přehrát.');
    return;
  }
  if (target.uuid) apiGet('/json/url/' + target.uuid).catch(() => {});
  tuneTimer = setTimeout(() => {
    if (state.phase === 'tuning' && state.current === st) { audio.pause(); setPhase('error', 'Stanice neodpovídá.'); }
  }, 15000);
}

function stop() {
  clearTimeout(tuneTimer);
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

audio.addEventListener('playing', () => { clearTimeout(tuneTimer); setPhase('playing'); });
audio.addEventListener('waiting', () => { if (state.phase === 'playing') setPhase('tuning'); });
audio.addEventListener('pause', () => { if (state.phase === 'playing') setPhase('paused'); });
audio.addEventListener('error', () => {
  if (audio.getAttribute('src') && state.phase !== 'paused') { clearTimeout(tuneTimer); setPhase('error', 'Stanice teď nevysílá.'); }
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
