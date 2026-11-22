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
// všechny přehratelné adresy stejné stanice (pro přepnutí při výpadku)
function altUrls(raw, item) {
  const urls = raw.filter((s) => {
    if (!playable(s)) return false;
    const n = normalize(s.name);
    return item.match.some((m) => hasWord(n, normalize(m))) && !(item.exclude || []).some((x) => hasWord(n, normalize(x)));
  }).sort((a, b) => (b.clickcount || 0) - (a.clickcount || 0)).map(playable);
  return [...new Set([item.stream, ...(item.alt || []), ...urls].filter(Boolean))].slice(0, 4);
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
    st.alts = altUrls(raw, c);
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
  if (state.editOrder && state.genre === 'fav') {
    return `<div class="row edit" data-id="${esc(st.id)}">
      <span class="handle" data-handle aria-label="Přetáhnout">≡</span>
      ${logoHtml(st)}
      <div class="t"><div class="n">${esc(st.name)}</div><div class="g">${esc(g)}</div></div>
      <button class="mv" data-move="-1" aria-label="Posunout výš">▲</button>
      <button class="mv" data-move="1" aria-label="Posunout níž">▼</button>
    </div>`;
  }
  return `<div class="row${on ? ' on' : ''}" data-id="${esc(st.id)}" role="button" tabindex="0">
    ${logoHtml(st)}
    <div class="t"><div class="n">${esc(st.name)}</div><div class="g">${esc(g)}${kbps}${extra}</div></div>
    <button class="fav${fav ? ' on' : ''}" data-fav="${esc(st.id)}" aria-label="Oblíbené">${fav ? '★' : '☆'}</button>
  </div>`;
}

// stanice v aktuálním žánru / hledání – v pořadí, jak jsou v seznamu
function visibleStations() {
  const q = normalize(state.q);
  if (state.genre === 'fav') {
    const byId = new Map(state.stations.map((s) => [s.id, s]));
    return state.favs.map((id) => byId.get(id)).filter((s) => s && (!q || normalize(s.name).includes(q)));
  }
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
  let html = installHint() + (state.genre === 'fav' && state.editOrder ? editBar() : '');
  if (!vis.length) {
    html += `<p class="empty">${state.genre === 'fav' ? 'Zatím žádné oblíbené.<br>Klepni na ☆ u stanice.' : 'Nic nenalezeno.'}</p>`;
  } else {
    const cur = vis.filter((s) => s.curated), rest = vis.filter((s) => !s.curated);
    if (cur.length && rest.length && !q && state.genre !== 'fav') {
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
function editBar() {
  return `<div class="hint sync"><button class="sbtn order on" data-edit-order>✓ Hotovo</button>
    <small>Přetáhni stanici za ≡, nebo ji posouvej šipkami ▲ ▼.</small></div>`;
}

// ---------- nastavení (ozubené kolečko) ----------
function renderSheet() {
  const canOrder = state.favs.length > 1;
  $('sheet').innerHTML = `<div class="sheetBox" role="dialog" aria-label="Nastavení">
    <div class="sheetHead"><b>Nastavení</b><button class="x" data-close-sheet aria-label="Zavřít">✕</button></div>
    <div class="sheetSec">Oblíbené</div>
    <button class="sbtn order" data-edit-order ${canOrder ? '' : 'disabled'}>⇅ Upravit pořadí oblíbených</button>
    <p class="sheetNote">Přenos oblíbených do jiného prohlížeče nebo telefonu:</p>
    <div class="syncBtns">
      <button class="sbtn" data-fav-export ${state.favs.length ? '' : 'disabled'}>Zkopírovat odkaz</button>
      <button class="sbtn ghost" data-fav-import>Vložit odkaz</button>
    </div>
    <small id="syncMsg">${esc(state.syncMsg || '')}</small>
    <div class="sheetSec">Stanice</div>
    <button class="sbtn ghost wide" data-refresh>⟳ Obnovit seznam stanic</button>
    <div class="sheetSec">Diagnostika přehrávání</div>
    <p class="sheetNote" style="margin-top:0">${diagSummary()}</p>
    <pre class="diag">${esc(diagLog.slice(-40).reverse().map((l) => l.replace(todayPrefix(), '')).join('\n') || 'Zatím žádné záznamy.')}</pre>
    <div class="syncBtns">
      <button class="sbtn ghost" data-diag-copy ${diagLog.length ? '' : 'disabled'}>Zkopírovat záznam</button>
      <button class="sbtn ghost" data-diag-clear ${diagLog.length ? '' : 'disabled'}>Vymazat</button>
    </div>
  </div>`;
}
const todayPrefix = () => new Date().toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }) + ' ';
function diagSummary() {
  const today = new Date().toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
  const todays = diagLog.filter((l) => l.startsWith(today + ' '));
  const outages = todays.filter((l) => l.includes('výpadek')).length;
  const fixed = todays.filter((l) => l.includes('po ') && l.includes('. pokusu')).length;
  const gaveUp = todays.filter((l) => l.includes('VZDÁNO')).length;
  if (!outages) return 'Dnes bez výpadků. Aplikace si zapisuje, co se se streamem děje, a výpadky opravuje sama.';
  return `Dnes ${outages}× výpadek, ${fixed}× automaticky opraveno${gaveUp ? `, ${gaveUp}× se nepodařilo` : ''}.`;
}
function openSheet() { state.syncMsg = ''; renderSheet(); $('sheet').hidden = false; }
function closeSheet() { $('sheet').hidden = true; }

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

// ---------- diagnostika: záznam událostí přehrávání (jen v tomto zařízení) ----------
const DIAG_KEY = 'diag-log-v1';
let diagLog = store.get(DIAG_KEY, []);
let diagSaveT = null;
function diag(msg) {
  const d = new Date();
  const ts = d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('cs-CZ');
  diagLog.push(ts + '  ' + msg);
  if (diagLog.length > 300) diagLog = diagLog.slice(-300);
  clearTimeout(diagSaveT);
  diagSaveT = setTimeout(() => store.set(DIAG_KEY, diagLog), 500);
}
const host = (u) => { try { return new URL(u).host; } catch { return '?'; } };
const MEDIA_ERR = { 1: 'přerušeno', 2: 'chyba sítě', 3: 'chyba dekódování', 4: 'formát/adresa nepodporována' };
const netInfo = () => {
  const c = navigator.connection;
  return (navigator.onLine ? 'online' : 'OFFLINE') + (c && c.effectiveType ? ' ' + c.effectiveType : '');
};

// ---------- přehrávání: start okamžitě, hlídání výpadků, automatická oprava ----------
// Pozn.: na zamčeném iPhonu se nově navázaný stream nerozjede (iOS ho pustí až po odemknutí).
// Proto na pozadí stream NEzahazujeme – necháme prohlížeč, ať se ze zaseknutí vzpamatuje sám,
// jen ho „šťouchneme“ play(). Tvrdé nové připojení děláme v popředí, nebo když stream opravdu skončil.
const STALL_MS = 20000;       // jak dlouho tolerovat „načítám“ v popředí, než se připojíme znovu
const FREEZE_MS = 20000;      // zvuk „hraje“, ale čas se nehýbe → zamrzlý stream
const hidden = () => document.visibilityState === 'hidden';
const MAX_RETRIES = 6;

let session = 0;              // id aktuálního přehrávání (přepnutí stanice ho zneplatní)
let urls = [], urlIdx = 0;    // hlavní + záložní adresy stanice
let retries = 0;
let stallTimer = null, retryTimer = null;
let userPaused = false;
let lastTime = 0, lastProgress = 0, startedAt = 0;

const currentUrl = () => urls[urlIdx];
function clearTimers() { clearTimeout(tuneTimer); clearTimeout(stallTimer); clearTimeout(retryTimer); }

function connect(sid, reconnect) {
  const base = currentUrl();
  const url = reconnect ? base + (base.includes('?') ? '&' : '?') + '_=' + Date.now() : base;
  startedAt = Date.now();
  audio.preload = 'auto';
  audio.src = url;
  audio.play().catch((e) => {
    if (sid !== session || (e && e.name === 'AbortError')) return;
    diag(`play() odmítnuto: ${e && e.name}`);
    if (e && e.name === 'NotAllowedError') { clearTimers(); return setPhase('paused'); } // iOS chce klepnutí
    if (audio.error) return;                 // chybu už řeší událost „error“
    reconnectOrFail(sid, 'play() selhalo');
  });
  clearTimeout(tuneTimer);
  const tuneCheck = () => {
    if (sid !== session || state.phase === 'playing') return;
    if (hidden()) { tuneTimer = setTimeout(tuneCheck, 15000); return; }   // dořeší se po odemknutí
    reconnectOrFail(sid, 'start trvá přes 15 s');
  };
  tuneTimer = setTimeout(tuneCheck, 15000);
}

function reconnectOrFail(sid, reason) {
  if (sid !== session) return;
  clearTimers();
  // bez internetu nemá smysl zkoušet – počkáme na událost „online“
  if (!navigator.onLine) {
    diag(`výpadek (${reason}) – telefon je offline, čekám na připojení`);
    return setPhase('tuning', 'Čekám na internet…');
  }
  if (retries >= MAX_RETRIES) {
    diag(`VZDÁNO po ${retries} pokusech (${reason})`);
    audio.pause();
    return setPhase('error', 'Stanice teď nevysílá.');
  }
  retries++;
  // po 2 neúspěších na stejné adrese zkusit záložní stream
  if (retries > 2 && urls.length > 1 && retries % 2 === 1) {
    urlIdx = (urlIdx + 1) % urls.length;
    diag(`přepínám na záložní stream ${urlIdx + 1}/${urls.length}: ${host(currentUrl())}`);
  }
  const delay = retries === 1 ? 0 : Math.min(1000 * (retries - 1), 5000);
  diag(`výpadek: ${reason} → nové připojení #${retries} za ${delay / 1000} s [${netInfo()}]`);
  setPhase('tuning', 'Obnovuji spojení…');
  retryTimer = setTimeout(() => { if (sid === session) connect(sid, true); }, delay);
}

async function play(st) {
  clearTimers();
  const sid = ++session;
  retries = 0; userPaused = false; pausedAt = 0;
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
  if (!target.url) { diag(`${st.name}: stream nenalezen`); return setPhase('error', 'Stream se nepodařilo najít.'); }

  urls = [...new Set([target.url, ...(target.alts || [])])];
  urlIdx = 0;
  diag(`▶ ${st.name} (${host(urls[0])}${urls.length > 1 ? `, záloh ${urls.length - 1}` : ''}) [${netInfo()}]`);
  connect(sid, false);
  if (target.uuid) apiGet('/json/url/' + target.uuid).catch(() => {});
}

// pauza bez zahození streamu – iOS pak dovolí ze zamčené obrazovky pokračovat
let pausedAt = 0;
function softPause() {
  userPaused = true;
  clearTimers();
  pausedAt = Date.now();
  audio.pause();
  setPhase('paused');
}

// ▶ ze zamčené obrazovky / sluchátek: iOS na pozadí nedovolí otevřít nový stream,
// ale dovolí pokračovat ve stávajícím přehrávači → nejdřív play(), pak případně reload stejné adresy
function resumeFromRemote(force = false) {
  if (!state.current) return;
  if (!audio.getAttribute('src')) {
    diag('▶ ze zamčené obrazovky – přehrávač je prázdný, spouštím stanici');
    return play(state.stations.find((s) => s.id === state.current.id) || state.current);
  }
  userPaused = false;
  const sid = session;
  const long = pausedAt && Date.now() - pausedAt > 30000;
  const broken = force === true || state.phase === 'tuning' || state.phase === 'error' || audio.error || audio.ended
    || (!audio.paused && !reallyPlaying());
  const reload = long || broken;
  diag(`▶ ze zamčené obrazovky – ${reload ? 'znovu načítám stávající stream' : 'pokračuji ve stávajícím streamu'}`);
  if (reload) audio.load();   // stejná adresa, stejný přehrávač (nový stream by iOS na pozadí nepustil)
  setPhase('tuning', 'Navazuji…');
  audio.play().catch((e) => diag(`pokračování odmítnuto: ${e && e.name}`));
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (sid !== session || state.phase === 'playing' || userPaused) return;
    diag('pokračování nenaběhlo – načítám stejnou adresu znovu');
    audio.load();
    audio.play().catch((e) => diag(`opětovné načtení odmítnuto: ${e && e.name}`));
  }, 5000);
}

function stop() {
  session++;
  userPaused = true;
  clearTimers();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  setPhase('paused');
}

function toggle() {
  if (!state.current) return;
  if (state.phase === 'playing' || state.phase === 'tuning') softPause();
  else play(state.stations.find((s) => s.id === state.current.id) || state.current);
}

audio.addEventListener('playing', () => {
  clearTimeout(stallTimer); clearTimeout(tuneTimer);
  if (state.phase !== 'playing') diag(`hraje (za ${((Date.now() - startedAt) / 1000).toFixed(1)} s${retries ? `, po ${retries}. pokusu` : ''})`);
  retries = 0;
  lastTime = audio.currentTime; lastProgress = Date.now();
  setPhase('playing');
});
const onStall = (ev) => {
  if (state.phase !== 'playing') return;
  diag(`stream se zasekl (${ev.type}) [${netInfo()}]`);
  setPhase('tuning', 'Načítám…');
  const sid = session;
  clearTimeout(stallTimer);
  const check = () => {
    if (sid !== session || state.phase === 'playing') return;
    if (hidden()) {                       // na pozadí: nezahazovat, jen zkusit pokračovat
      diag('zaseknutí trvá (na pozadí) – zkouším pokračovat; na zamčené obrazovce lze klepnout ▶');
      audio.play().catch(() => {});
      stallTimer = setTimeout(check, STALL_MS);
      return;
    }
    reconnectOrFail(sid, `zaseknutí přes ${STALL_MS / 1000} s`);
  };
  stallTimer = setTimeout(check, STALL_MS);
};
audio.addEventListener('waiting', onStall);
audio.addEventListener('stalled', onStall);
audio.addEventListener('ended', () => {
  if (audio.getAttribute('src') && state.phase !== 'paused') reconnectOrFail(session, 'server ukončil stream');
});
audio.addEventListener('pause', () => {
  if (state.phase !== 'playing' || audio.ended) return;   // konec streamu řeší „ended“
  clearTimers();
  diag(userPaused ? 'pozastaveno uživatelem' : 'pozastaveno systémem (hovor, jiná aplikace, sluchátka…)');
  setPhase('paused');
});
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src') || state.phase === 'paused' || state.phase === 'error') return;
  const err = audio.error;
  reconnectOrFail(session, `chyba přehrávače: ${err ? MEDIA_ERR[err.code] || err.code : '?'}`);
});

audio.addEventListener('timeupdate', () => {
  if (audio.currentTime > lastTime + 0.2) { lastTime = audio.currentTime; lastProgress = Date.now(); }
});
// opravdu teď hraje zvuk? (iOS ukazuje ⏸ i u zaseknutého streamu)
const reallyPlaying = () =>
  !audio.paused && audio.readyState >= 3 && Date.now() - lastProgress < 3000;

// hlídač: zvuk se tváří, že hraje, ale stream stojí (iOS to občas nehlásí)
setInterval(() => {
  if (state.phase !== 'playing' || audio.paused) return;
  if (audio.currentTime > lastTime + 0.2) { lastTime = audio.currentTime; lastProgress = Date.now(); return; }
  if (Date.now() - lastProgress > FREEZE_MS) {
    lastProgress = Date.now();
    if (hidden()) { diag('stream stojí (na pozadí) – zkouším pokračovat bez odpojení'); audio.play().catch(() => {}); }
    else reconnectOrFail(session, 'stream zamrzl bez hlášení');
  }
}, 3000);

// návrat internetu → hned znovu připojit
window.addEventListener('online', () => {
  diag('internet je zpět');
  if (state.current && (state.phase === 'tuning' || state.phase === 'error') && !userPaused) {
    retries = 0; reconnectOrFail(session, 'obnova po výpadku internetu');
  }
});
window.addEventListener('offline', () => diag('telefon ztratil internet'));
document.addEventListener('visibilitychange', () => {
  if (!state.current || userPaused) return;
  if (hidden()) { if (state.phase === 'playing') diag('aplikace na pozadí / telefon zamčen'); return; }
  diag('aplikace zpět v popředí');
  const sid = session, t0 = audio.currentTime;
  // ověřit za 1,5 s, jestli zvuk opravdu postupuje; když ne, rychle znovu připojit
  setTimeout(() => {
    if (sid !== session || userPaused || hidden()) return;
    const moving = !audio.paused && audio.currentTime > t0 + 0.3;
    if (moving) { lastTime = audio.currentTime; lastProgress = Date.now(); if (state.phase !== 'playing') setPhase('playing'); return; }
    if (state.phase === 'playing' || state.phase === 'tuning') { retries = 0; reconnectOrFail(sid, 'po odemknutí stream nehrál'); }
  }, 1500);
});

// Přepínání stanic z zamčené obrazovky. iOS u webových aplikací často trvá na tlačítkách ±10 s,
// proto i ta přepínají stanice (⟲10 = předchozí, ⟳10 = další). Kde systém ukáže ⏮ ⏭, fungují stejně.
function applyTrackHandlers() {
  if (!('mediaSession' in navigator)) return;
  const prev = () => { diag('⏮ přepnutí ze zamčené obrazovky'); step(-1); };
  const next = () => { diag('⏭ přepnutí ze zamčené obrazovky'); step(1); };
  for (const [action, fn] of [['previoustrack', prev], ['nexttrack', next],
                              ['seekbackward', prev], ['seekforward', next], ['seekto', null]]) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
  }
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.current) return;
  const st = state.current;
  const artwork = [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }];
  if (st.logo) artwork.unshift({ src: st.logo, sizes: '256x256' });
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: st.name, artist: 'Česká rádia', artwork });
    applyTrackHandlers();
    navigator.mediaSession.playbackState = state.phase === 'playing' ? 'playing' : 'paused';
  } catch {}
}
if ('mediaSession' in navigator) {
  try {
    // ▶ na zamčené obrazovce = vždy nové připojení (klepnutí iOS povolí rozjet i zamrzlý stream)
    navigator.mediaSession.setActionHandler('play', () => resumeFromRemote(false));
    navigator.mediaSession.setActionHandler('pause', () => {
      if (state.current && !userPaused && !reallyPlaying()) {
        diag('⏸ ze zamčené obrazovky, ale nic nehrálo → spouštím znovu');
        return resumeFromRemote(true);
      }
      diag('⏸ ze zamčené obrazovky');
      softPause();
    });
    navigator.mediaSession.setActionHandler('stop', () => stop());
  } catch {}
  applyTrackHandlers();
}

// ---------- události ----------
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-genre]');
  if (!b) return;
  state.genre = b.dataset.genre;
  state.editOrder = false;
  store.set('genre', state.genre);
  renderChips(); renderList();
  window.scrollTo({ top: 0 });
});
$('list').addEventListener('click', (e) => {
  if (e.target.closest('[data-close-hint]')) { store.set('hint-closed', true); return renderList(); }
  if (e.target.closest('[data-edit-order]')) { state.editOrder = false; return renderList(); }
  const mv = e.target.closest('[data-move]');
  if (mv) {
    const id = mv.closest('.row').dataset.id, i = state.favs.indexOf(id), j = i + Number(mv.dataset.move);
    if (i < 0 || j < 0 || j >= state.favs.length) return;
    [state.favs[i], state.favs[j]] = [state.favs[j], state.favs[i]];
    saveFavs(); renderList();
    const row = $('list').querySelector(`.row[data-id="${CSS.escape(id)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  if (state.editOrder && state.genre === 'fav') return;
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
// přetahování oblíbených za úchyt ≡ (myš i prst)
function saveFavs() { store.set('favorites-v1', state.favs); }
let drag = null;
$('list').addEventListener('pointerdown', (e) => {
  const h = e.target.closest('[data-handle]');
  if (!h) return;
  e.preventDefault();
  drag = { row: h.closest('.row') };
  drag.row.classList.add('dragging');
  try { h.setPointerCapture(e.pointerId); } catch {}
});
$('list').addEventListener('pointermove', (e) => {
  if (!drag) return;
  e.preventDefault();
  const rows = [...$('list').querySelectorAll('.row')];
  const di = rows.indexOf(drag.row);
  for (let ri = 0; ri < rows.length; ri++) {
    if (ri === di) continue;
    const b = rows[ri].getBoundingClientRect(), mid = b.top + b.height / 2;
    if (ri < di && e.clientY < mid) { rows[ri].before(drag.row); break; }
    if (ri > di && e.clientY > mid) rows[ri].after(drag.row);
  }
  // u okraje obrazovky posouvat seznam
  if (e.clientY < 120) window.scrollBy(0, -12); else if (e.clientY > innerHeight - 140) window.scrollBy(0, 12);
});
const endDrag = () => {
  if (!drag) return;
  drag.row.classList.remove('dragging');
  state.favs = [...$('list').querySelectorAll('.row')].map((r) => r.dataset.id);
  drag = null;
  saveFavs(); renderList();
};
$('list').addEventListener('pointerup', endDrag);
$('list').addEventListener('pointercancel', endDrag);

$('gear').addEventListener('click', openSheet);
$('sheet').addEventListener('click', async (e) => {
  if (e.target === $('sheet') || e.target.closest('[data-close-sheet]')) return closeSheet();
  if (e.target.closest('[data-fav-export]')) return exportFavs();
  if (e.target.closest('[data-fav-import]')) { await askImport(); return renderSheet(); }
  if (e.target.closest('[data-edit-order]')) {
    closeSheet();
    state.genre = 'fav'; state.editOrder = true; state.q = ''; $('q').value = '';
    store.set('genre', 'fav');
    renderChips(); renderList(); window.scrollTo({ top: 0 });
    return;
  }
  if (e.target.closest('[data-diag-copy]')) {
    const text = 'Česká rádia – diagnostika\n' + navigator.userAgent + '\n\n' + diagLog.join('\n');
    try { await navigator.clipboard.writeText(text); syncMsg('Záznam zkopírován – můžeš ho vložit Claudovi.'); }
    catch { try { await navigator.share({ title: 'Diagnostika rádia', text }); } catch {} }
    return;
  }
  if (e.target.closest('[data-diag-clear]')) { diagLog = []; store.set(DIAG_KEY, []); return renderSheet(); }
  if (e.target.closest('[data-refresh]')) {
    syncMsg('Načítám katalog…');
    const res = await loadCatalog(true);
    state.stations = res.stations; state.offline = res.offline;
    renderAll();
    syncMsg(res.offline ? 'Katalog teď není dostupný.' : `Načteno ${res.stations.length} stanic.`);
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
