// Načtení českých stanic z otevřeného katalogu Radio Browser
// (https://www.radio-browser.info) + spárování s kurátorským výběrem.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURATED, normalize, genreFromTags } from './stations';

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];
const CACHE_KEY = 'catalog-cz-v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 1 den
const HEADERS = { 'User-Agent': 'CeskaRadia/1.0', Accept: 'application/json' };

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function apiGet(path) {
  let lastErr;
  for (const base of MIRRORS) {
    try {
      return await fetchWithTimeout(base + path);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Katalog nedostupný');
}

const hasWord = (name, phrase) => (' ' + name + ' ').includes(' ' + phrase + ' ');

function pickBest(raw, item) {
  const hits = raw.filter((s) => {
    const n = normalize(s.name);
    if (!item.match.some((m) => hasWord(n, normalize(m)))) return false;
    if (item.exclude && item.exclude.some((x) => hasWord(n, normalize(x)))) return false;
    return true;
  });
  hits.sort((a, b) => {
    // preferuj https a vyšší popularitu
    const sa = (a.url_resolved || '').startsWith('https') ? 1 : 0;
    const sb = (b.url_resolved || '').startsWith('https') ? 1 : 0;
    return sb - sa || (b.clickcount || 0) - (a.clickcount || 0);
  });
  return hits[0];
}

const toStation = (s, extra = {}) => ({
  id: s.stationuuid,
  uuid: s.stationuuid,
  name: (s.name || '').trim(),
  url: s.url_resolved || s.url,
  logo: s.favicon || null,
  bitrate: s.bitrate || 0,
  codec: s.codec || '',
  ...extra,
});

/** Vrátí { stations, fromCache } – kurátorské stanice první, pak zbytek katalogu. */
export async function loadCatalog({ force = false } = {}) {
  let raw = null;
  let fromCache = false;
  try {
    const cached = JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) || 'null');
    if (cached && !force && Date.now() - cached.at < CACHE_TTL) {
      raw = cached.raw;
      fromCache = true;
    }
  } catch {}

  if (!raw) {
    try {
      raw = await apiGet(
        '/json/stations/bycountrycodeexact/CZ?hidebroken=true&order=clickcount&reverse=true&limit=600'
      );
      raw = raw.filter((s) => s.lastcheckok === 1 || s.lastcheckok === undefined);
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), raw })).catch(() => {});
    } catch (e) {
      // offline a bez cache → aspoň kurátorský seznam bez adres
      const cached = JSON.parse((await AsyncStorage.getItem(CACHE_KEY).catch(() => null)) || 'null');
      if (cached) {
        raw = cached.raw;
        fromCache = true;
      } else {
        return {
          stations: CURATED.map((c) => ({ ...c, curated: true, url: null })),
          fromCache: false,
          offline: true,
        };
      }
    }
  }

  const used = new Set();
  const curated = CURATED.map((c) => {
    const best = pickBest(raw, c);
    if (best) used.add(best.stationuuid);
    return best
      ? toStation(best, { id: c.id, name: c.name, genre: c.genre, curated: true })
      : { ...c, curated: true, url: null };
  });

  const seenNames = new Set(curated.map((c) => normalize(c.name)));
  const rest = [];
  for (const s of raw) {
    if (used.has(s.stationuuid) || !(s.url_resolved || s.url)) continue;
    const key = normalize(s.name);
    if (!key || seenNames.has(key)) continue;
    seenNames.add(key);
    rest.push(toStation(s, { genre: genreFromTags(s.tags, s.name), curated: false }));
  }

  return { stations: [...curated, ...rest], fromCache, offline: false };
}

/** Záložní dohledání streamu podle názvu (když stanice nebyla v katalogu). */
export async function searchStream(name) {
  const list = await apiGet(
    '/json/stations/search?countrycode=CZ&hidebroken=true&order=clickcount&reverse=true&limit=5&name=' +
      encodeURIComponent(name)
  );
  const s = list.find((x) => x.url_resolved || x.url);
  return s ? toStation(s) : null;
}

/** Nahlásí přehrání katalogu (doporučeno provozovatelem API). */
export function reportClick(uuid) {
  if (!uuid) return;
  apiGet('/json/url/' + uuid).catch(() => {});
}
