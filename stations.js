// Žánry a kurátorský výběr českých stanic.
// Streamy se nehardcodují (adresy se mění) – aplikace je dohledá
// v otevřeném katalogu Radio Browser podle `match` (normalizovaný název:
// malá písmena, bez diakritiky). Stačí, aby název obsahoval jednu z variant.
// `stream` = ověřená https adresa (má přednost před katalogem).

export const GENRES = [
  { id: 'all', label: 'Vše', icon: '📻', color: '#F5A623' },
  { id: 'fav', label: 'Oblíbené', icon: '★', color: '#FFD166' },
  { id: 'spoken', label: 'Povídky, hry & humor', icon: '🎭', color: '#E9C46A' },
  { id: 'news', label: 'Zprávy & slovo', icon: '🗞', color: '#4EA8DE' },
  { id: 'pop', label: 'Pop & hity', icon: '🎤', color: '#FF6B9A' },
  { id: 'rock', label: 'Rock & alternativa', icon: '🎸', color: '#E4572E' },
  { id: 'dance', label: 'Dance & elektro', icon: '🎧', color: '#9B5DE5' },
  { id: 'oldies', label: 'Oldies & retro', icon: '📼', color: '#F4A259' },
  { id: 'classic', label: 'Klasika & jazz', icon: '🎻', color: '#43AA8B' },
  { id: 'folk', label: 'Country, folk & dechovka', icon: '🪕', color: '#B5838D' },
  { id: 'kids', label: 'Pro děti', icon: '🧸', color: '#90BE6D' },
  { id: 'spirit', label: 'Duchovní', icon: '🕊', color: '#A0C4FF' },
];

export const CURATED = [
  // Povídky, rozhlasové hry & humor (also = zobrazit i v dalším žánru)
  { id: 'povidka', name: 'Rádio Povídka', genre: 'spoken', stream: 'https://ice3.abradio.cz/povidka128.mp3', match: ['povidka'] },
  { id: 'humor', name: 'Rádio Humor', genre: 'spoken', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIO_HUMOR.aac', match: ['radio humor', 'humor 2'] },
  { id: 'diana', name: 'Comedy Club Rádio Diana', genre: 'spoken', stream: 'https://westradio.cz/listen/comedy_club/radio.mp3', alt: ['https://westradio.cz/radio/8010/radio.mp3'], match: ['comedy club'] },

  // Zprávy & mluvené slovo
  { id: 'cro-radiozurnal', name: 'ČRo Radiožurnál', genre: 'news', stream: 'https://rozhlas.stream/radiozurnal_mp3_128.mp3', match: ['radiozurnal'], exclude: ['sport'] },
  { id: 'cro-plus', name: 'ČRo Plus', genre: 'news', stream: 'https://rozhlas.stream/plus_mp3_128.mp3', match: ['cro plus', 'rozhlas plus'] },
  { id: 'cro-dvojka', name: 'ČRo Dvojka', genre: 'news', also: ['spoken'], stream: 'https://rozhlas.stream/dvojka_mp3_128.mp3', match: ['dvojka'] },
  { id: 'cro-rzsport', name: 'ČRo Radiožurnál Sport', genre: 'news', match: ['radiozurnal sport'] },

  // Pop & hity
  { id: 'evropa2', name: 'Evropa 2', genre: 'pop', match: ['evropa 2'] },
  { id: 'frekvence1', name: 'Frekvence 1', genre: 'pop', match: ['frekvence 1'] },
  { id: 'impuls', name: 'Rádio Impuls', genre: 'pop', match: ['radio impuls', 'impuls'] },
  { id: 'kiss', name: 'Kiss', genre: 'pop', match: ['kiss'] },
  { id: 'hitradio', name: 'Hitrádio', genre: 'pop', match: ['hitradio'] },
  { id: 'fajn', name: 'Fajn Rádio', genre: 'pop', match: ['fajn'] },
  { id: 'krokodyl', name: 'Rádio Krokodýl', genre: 'pop', stream: 'https://icecast-u2.play.cz/krokodyl128.mp3', match: ['krokodyl'] },
  { id: 'cas', name: 'Rádio Čas', genre: 'pop', match: ['radio cas'], exclude: ['rock'] },

  // Rock & alternativa
  { id: 'rockradio', name: 'Rock Radio', genre: 'rock', match: ['rock radio'] },
  { id: 'beat', name: 'Radio Beat', genre: 'rock', stream: 'https://icecast2.play.cz/beat128aac', match: ['radio beat'] },
  { id: 'radio1', name: 'Radio 1', genre: 'rock', match: ['radio 1'], exclude: ['radio 10', 'radio 11'] },
  { id: 'wave', name: 'ČRo Radio Wave', genre: 'rock', stream: 'https://rozhlas.stream/wave_mp3_128.mp3', match: ['radio wave', 'cro wave'] },
  { id: 'cas-rock', name: 'Rádio Čas Rock', genre: 'rock', match: ['cas rock'] },

  // Dance & elektro
  { id: 'dance', name: 'Dance Radio', genre: 'dance', match: ['dance radio'] },
  { id: 'spin', name: 'Rádio Spin', genre: 'dance', stream: 'https://icecast4.play.cz/spin128.mp3', match: ['spin'] },

  // Oldies & retro
  { id: 'blanik', name: 'Rádio Blaník', genre: 'oldies', match: ['blanik'] },
  { id: 'retro-diana', name: 'Retro Club Rádio Diana', genre: 'oldies', stream: 'https://westradio.cz/listen/retro_club/radio.mp3', match: ['retro club'] },
  { id: 'oldies', name: 'Oldies Rádio', genre: 'oldies', match: ['oldies radio', 'oldiesradio'] },
  { id: 'cro-pohoda', name: 'ČRo Pohoda', genre: 'oldies', stream: 'https://rozhlas.stream/pohoda.mp3', match: ['pohoda'] },

  // Klasika & jazz
  { id: 'cro-vltava', name: 'ČRo Vltava', genre: 'classic', also: ['spoken'], stream: 'https://rozhlas.stream/vltava_mp3_128.mp3', match: ['vltava'] },
  { id: 'cro-ddur', name: 'ČRo D-dur', genre: 'classic', match: ['d dur'] },
  { id: 'cro-jazz', name: 'ČRo Jazz', genre: 'classic', stream: 'https://rozhlas.stream/jazz.mp3', match: ['cro jazz', 'rozhlas jazz'] },
  { id: 'classic-praha', name: 'Classic Praha', genre: 'classic', stream: 'https://icecast8.play.cz/classic128.mp3', match: ['classic praha', 'classic fm'] },

  // Country, folk & dechovka
  { id: 'country', name: 'Country Radio', genre: 'folk', stream: 'https://icecast4.play.cz/country128.mp3', match: ['country radio'] },

  // Pro děti
  { id: 'pohadka', name: 'Rádio Pohádka', genre: 'kids', stream: 'https://ice3.radia.cz/pohadka128.mp3', match: ['pohadka'] },
  { id: 'cro-junior', name: 'Rádio Junior', genre: 'kids', stream: 'https://rozhlas.stream/radio_junior.mp3', match: ['junior'] },

  // Duchovní
  { id: 'proglas', name: 'Rádio Proglas', genre: 'spirit', stream: 'https://icecast2.play.cz/proglas128', match: ['proglas'] },
  { id: 'radio7', name: 'Rádio 7', genre: 'spirit', stream: 'https://icecast8.play.cz/radio7-128.mp3', match: ['radio 7'], exclude: ['radio 70'] },
];

// Mapování tagů z katalogu na žánry (pro stanice mimo kurátorský výběr).
export const TAG_RULES = [
  ['kids', ['child', 'kids', 'deti', 'pohadk']],
  ['spoken', ['comedy', 'humor', 'stories', 'audiobook', 'drama', 'povid', 'spoken word']],
  ['spirit', ['christian', 'krestan', 'religio', 'catholic', 'gospel']],
  ['news', ['news', 'talk', 'zpravy', 'publicservice', 'public radio', 'information', 'sport']],
  ['classic', ['classical', 'klasick', 'jazz', 'blues', 'opera', 'swing']],
  ['folk', ['country', 'folk', 'dechov', 'trampsk', 'polka', 'bluegrass']],
  ['dance', ['dance', 'electro', 'techno', 'house', 'trance', 'edm', 'dnb', 'drum and bass', 'club']],
  ['rock', ['rock', 'metal', 'punk', 'alternative', 'indie', 'grunge']],
  ['oldies', ['oldies', 'retro', '60s', '70s', '80s', '90s', 'classic hits', 'evergreen', 'disco']],
  ['pop', ['pop', 'hits', 'top 40', 'chart', 'contemporary']],
];

export const normalize = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function genreFromTags(tags = '', name = '') {
  const hay = normalize(tags + ' ' + name);
  for (const [genre, words] of TAG_RULES) {
    if (words.some((w) => hay.includes(normalize(w)))) return genre;
  }
  return null;
}

export const genreById = (id) => GENRES.find((g) => g.id === id) || GENRES[0];
