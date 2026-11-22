import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { GENRES, genreById, normalize } from './src/stations';
import { loadCatalog, reportClick, searchStream } from './src/catalog';

const C = {
  bg: '#0E1320',
  card: '#171E2E',
  cardActive: '#1F2A40',
  line: '#26304A',
  text: '#F3F5FA',
  sub: '#8C97B2',
  accent: '#F5A623',
  danger: '#FF6B6B',
};
const FAV_KEY = 'favorites-v1';
const LAST_KEY = 'last-station-v1';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RadioApp />
    </SafeAreaProvider>
  );
}

function RadioApp() {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [genre, setGenre] = useState('all');
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState([]);
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | tuning | playing | paused | error
  const [errorText, setErrorText] = useState('');

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const tuneTimer = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // --- start: audio režim, oblíbené, katalog ---
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
    (async () => {
      try {
        setFavs(JSON.parse((await AsyncStorage.getItem(FAV_KEY)) || '[]'));
        const last = JSON.parse((await AsyncStorage.getItem(LAST_KEY)) || 'null');
        if (last) setCurrent(last);
      } catch {}
    })();
    refresh(false);
  }, []);

  const refresh = useCallback(async (force) => {
    force ? setRefreshing(true) : setLoading(true);
    const res = await loadCatalog({ force });
    setStations(res.stations);
    setOffline(!!res.offline);
    setLoading(false);
    setRefreshing(false);
  }, []);

  // --- sledování stavu přehrávače ---
  useEffect(() => {
    if (status.playing) {
      setPhase('playing');
      clearTimeout(tuneTimer.current);
    }
  }, [status.playing]);

  const toggleFav = useCallback((id) => {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      AsyncStorage.setItem(FAV_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const playStation = useCallback(
    async (st) => {
      clearTimeout(tuneTimer.current);
      setCurrent(st);
      setErrorText('');
      setPhase('tuning');
      AsyncStorage.setItem(LAST_KEY, JSON.stringify(st)).catch(() => {});

      let target = st;
      if (!target.url) {
        try {
          const found = await searchStream(st.name);
          if (found) target = { ...st, url: found.url, uuid: found.uuid, logo: found.logo };
        } catch {}
      }
      if (!target.url) {
        setPhase('error');
        setErrorText('Stream se nepodařilo najít. Zkuste to později.');
        return;
      }
      try {
        player.replace({ uri: target.url });
        player.play();
        try {
          player.setActiveForLockScreen?.(true, {
            title: target.name,
            artist: 'Česká rádia',
            artworkUrl: target.logo || undefined,
          });
        } catch {}
        reportClick(target.uuid);
        tuneTimer.current = setTimeout(() => {
          if (phaseRef.current === 'tuning') {
            setErrorText('Stanice neodpovídá. Zkuste jinou nebo později.');
            setPhase('error');
            player.pause();
          }
        }, 15000);
      } catch (e) {
        setPhase('error');
        setErrorText('Přehrávání selhalo.');
      }
    },
    [player]
  );

  const togglePlay = useCallback(() => {
    if (!current) return;
    if (phase === 'playing' || phase === 'tuning') {
      player.pause();
      clearTimeout(tuneTimer.current);
      setPhase('paused');
    } else {
      // u živého streamu je lepší znovu připojit, ať nehraje zpožděně
      const st = stations.find((s) => s.id === current.id) || current;
      playStation(st);
    }
  }, [current, phase, player, playStation, stations]);

  // --- filtrování ---
  const counts = useMemo(() => {
    const c = { all: stations.length, fav: favs.length };
    for (const s of stations) if (s.genre) c[s.genre] = (c[s.genre] || 0) + 1;
    return c;
  }, [stations, favs]);

  const visible = useMemo(() => {
    const q = normalize(query);
    return stations.filter((s) => {
      if (genre === 'fav' && !favs.includes(s.id)) return false;
      if (genre !== 'all' && genre !== 'fav' && s.genre !== genre) return false;
      if (q && !normalize(s.name).includes(q)) return false;
      return true;
    });
  }, [stations, genre, query, favs]);

  const renderItem = useCallback(
    ({ item }) => (
      <StationRow
        st={item}
        active={current?.id === item.id}
        phase={phase}
        fav={favs.includes(item.id)}
        onPress={() => playStation(item)}
        onFav={() => toggleFav(item.id)}
      />
    ),
    [current, phase, favs, playStation, toggleFav]
  );

  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Text style={s.title}>Česká rádia</Text>
        <Text style={s.subtitle}>
          {loading ? 'Ladím katalog…' : `${stations.length} stanic${offline ? ' · offline' : ''}`}
        </Text>
      </View>

      <View style={s.searchWrap}>
        <Text style={s.searchIcon}>⌕</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Hledat stanici"
          placeholderTextColor={C.sub}
          style={s.search}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chips}
        >
          {GENRES.map((g) => {
            const on = g.id === genre;
            const n = counts[g.id] || 0;
            if (!n && g.id !== 'all' && g.id !== 'fav') return null;
            return (
              <Pressable
                key={g.id}
                onPress={() => setGenre(g.id)}
                style={[s.chip, on && { backgroundColor: g.color, borderColor: g.color }]}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>
                  {g.icon} {g.label}
                  <Text style={[s.chipCount, on && s.chipTextOn]}> {n}</Text>
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 130, paddingHorizontal: 16 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} tintColor={C.accent} />
          }
          ListEmptyComponent={
            <Text style={s.empty}>
              {genre === 'fav' ? 'Zatím žádné oblíbené. Klepněte na ☆ u stanice.' : 'Nic nenalezeno.'}
            </Text>
          }
        />
      )}

      {current && (
        <MiniPlayer st={current} phase={phase} error={errorText} buffering={status.isBuffering} onToggle={togglePlay} />
      )}
    </SafeAreaView>
  );
}

function Logo({ st, size = 46 }) {
  const [failed, setFailed] = useState(false);
  const g = genreById(st.genre || 'all');
  const initials = st.name
    .replace(/^(ČRo|Rádio|Radio)\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  if (st.logo && !failed && st.logo.startsWith('https')) {
    return (
      <Image
        source={{ uri: st.logo }}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: 12, backgroundColor: '#fff' }}
      />
    );
  }
  return (
    <View style={[s.badge, { width: size, height: size, backgroundColor: g.color + '33', borderColor: g.color }]}>
      <Text style={[s.badgeText, { color: g.color }]}>{initials || '♪'}</Text>
    </View>
  );
}

function StationRow({ st, active, phase, fav, onPress, onFav }) {
  const g = st.genre ? genreById(st.genre) : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, active && s.rowActive, pressed && { opacity: 0.7 }]}>
      <Logo st={st} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {st.name}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {g ? g.label : 'Ostatní'}
          {st.bitrate ? ` · ${st.bitrate} kbps` : ''}
          {active && phase === 'playing' ? '  ▶ hraje' : ''}
          {active && phase === 'tuning' ? '  … ladím' : ''}
        </Text>
      </View>
      <Pressable onPress={onFav} hitSlop={12} style={s.favBtn}>
        <Text style={[s.fav, fav && { color: '#FFD166' }]}>{fav ? '★' : '☆'}</Text>
      </Pressable>
    </Pressable>
  );
}

function MiniPlayer({ st, phase, error, buffering, onToggle }) {
  const playing = phase === 'playing' || phase === 'tuning';
  const label =
    phase === 'error'
      ? error
      : phase === 'tuning' || buffering
      ? 'Ladím…'
      : phase === 'playing'
      ? 'Živě'
      : 'Pozastaveno';
  return (
    <SafeAreaView edges={['bottom']} style={s.player}>
      <View style={s.playerInner}>
        <Logo st={st} size={44} />
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text style={s.playerTitle} numberOfLines={1}>
            {st.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {phase === 'playing' && !buffering && <View style={s.liveDot} />}
            <Text style={[s.playerSub, phase === 'error' && { color: C.danger }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
        <Pressable onPress={onToggle} style={s.playBtn} hitSlop={10}>
          {phase === 'tuning' ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <Text style={s.playIcon}>{playing ? '❚❚' : '▶'}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { color: C.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: C.sub, fontSize: 14, marginTop: 2 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    backgroundColor: C.card,
    borderRadius: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: C.line,
  },
  searchIcon: { color: C.sub, fontSize: 20, marginRight: 6 },
  search: { flex: 1, color: C.text, fontSize: 16, paddingVertical: Platform.OS === 'ios' ? 12 : 8 },
  chips: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  chipText: { color: C.text, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: '#0E1320' },
  chipCount: { color: C.sub, fontWeight: '500' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.sub, textAlign: 'center', marginTop: 40, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowActive: { backgroundColor: C.cardActive, borderColor: C.accent },
  rowTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  rowSub: { color: C.sub, fontSize: 13, marginTop: 3 },
  favBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  fav: { color: C.sub, fontSize: 24 },
  badge: { borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  badgeText: { fontWeight: '800', fontSize: 16 },
  player: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#121A2B',
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  playerInner: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  playerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  playerSub: { color: C.sub, fontSize: 13, marginTop: 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.danger, marginRight: 6, marginTop: 2 },
  playBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: C.bg, fontSize: 20, fontWeight: '900' },
});
