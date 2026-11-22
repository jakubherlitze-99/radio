# Česká rádia 📻

Jednoduchá aplikace pro iPhone a Android (Expo / React Native) na poslech českých
internetových rádií, rozdělených podle žánrů.

## Co umí
- **Žánry:** Zprávy & slovo, Pop & hity, Rock & alternativa, Dance & elektro,
  Oldies & retro, Klasika & jazz, Country/folk/dechovka, Pro děti, Duchovní + Vše a Oblíbené.
- **Kurátorský výběr** ~30 známých stanic (ČRo, Evropa 2, Frekvence 1, Impuls, Kiss,
  Rock Radio, Beat, Blaník, Country Radio, Proglas…) nahoře, pod nimi další české
  stanice z otevřeného katalogu [Radio Browser](https://www.radio-browser.info),
  zařazené podle tagů.
- Adresy streamů se **dohledávají živě** z katalogu (cache 24 h, potažením seznamu
  dolů se obnoví) – když stanice změní stream, aplikace si poradí sama.
- Hledání, oblíbené (★), zapamatování poslední stanice.
- Přehrávání na pozadí a ovládání ze zamčené obrazovky (ve vlastním buildu).

## Spuštění na telefonu (nejrychleji – Expo Go)
1. Do telefonu nainstaluj **Expo Go** (App Store / Google Play).
2. Na počítači (Node.js 20+):
   ```bash
   cd ceska-radia
   npm install
   npx expo start
   ```
3. Naskenuj QR kód (iPhone: aplikací Fotoaparát, Android: v Expo Go).
   Telefon a počítač musí být ve stejné Wi-Fi (jinak `npx expo start --tunnel`).

> V Expo Go hraje rádio jen s aplikací v popředí. Pro hraní na pozadí a ovládání
> ze zamčené obrazovky je potřeba vlastní build (níže).

## Vlastní instalovatelná aplikace
```bash
npm install -g eas-cli
eas login
eas build:configure
eas build -p android --profile preview   # APK ke stažení a instalaci
eas build -p ios                          # vyžaduje Apple Developer účet (99 USD/rok)
```
Android APK lze nainstalovat přímo. Na iPhone bez placeného účtu jen přes Expo Go,
nebo lokálně přes Xcode na Macu (`npx expo run:ios --device`, platí 7 dní).

## Struktura
- `App.js` – UI (žánry, seznam, mini‑přehrávač)
- `src/stations.js` – žánry, kurátorský seznam a pravidla pro třídění tagů
- `src/catalog.js` – načítání katalogu a párování stanic

Přidání stanice: do `CURATED` v `src/stations.js` přidej řádek s názvem,
žánrem a slovy, podle kterých se má v katalogu najít.
