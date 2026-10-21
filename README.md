# Konwerter plików

Konwerter obrazów, wideo i audio działający w 100% w przeglądarce – bez backendu, bez wysyłania plików na serwer i bez limitów rozmiaru (ograniczeniem jest tylko pamięć urządzenia). Hostowany statycznie na GitHub Pages.

## Obsługiwane konwersje

| Źródło | Formaty docelowe | Silnik |
| --- | --- | --- |
| PNG, JPG, WEBP, GIF | PNG, JPG, WEBP, GIF (w każdą stronę) | `OffscreenCanvas` w Web Workerze + [`gifenc`](https://github.com/mattdesl/gifenc) |
| MP4, MOV, WEBM, MKV, AVI… | MP3, WAV, animowany GIF z fragmentu | [`ffmpeg.wasm`](https://github.com/ffmpegwasm/ffmpeg.wasm) |
| MP3, WAV, M4A, FLAC, OGG… | MP3, WAV | `ffmpeg.wasm` |

Typ pliku rozpoznawany jest po sygnaturze (magic bytes), a nie tylko po rozszerzeniu – interfejs pokazuje tylko te formaty, które mają sens dla danego pliku.

## Jak to działa

- **Obrazy** są dekodowane i kodowane w osobnym wątku (`src/workers/image.worker.ts`), więc UI się nie blokuje. GIF powstaje przez kwantyzację do palety 256 kolorów (z 1-bitową przezroczystością). Gdy przeglądarka nie potrafi zakodować WEBP w canvasie (Safari), używany jest `libwebp` z FFmpeg.
- **Audio/wideo** przetwarza `ffmpeg.wasm`. Plik wejściowy jest montowany przez `WORKERFS`, czyli czytany bezpośrednio z dysku – nie jest kopiowany w całości do pamięci WebAssembly. Rdzeń (~31 MB) pobierany jest dopiero przy pierwszej konwersji A/V, z paskiem postępu.
- **Wielowątkowość**: rdzeń `@ffmpeg/core-mt` wymaga `SharedArrayBuffer`, a ten – izolacji cross-origin (nagłówki COOP/COEP). GitHub Pages nie pozwala ustawić nagłówków, więc dokłada je [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) (`public/coi-serviceworker.js`, ładowany jako pierwszy skrypt w `index.html`; przy pierwszej wizycie strona przeładowuje się raz).
- **Bezpieczniki MT**: liczba wątków FFmpeg jest jawnie ograniczana (pula rdzenia MT ma 32 wątki – domyślne `threads=auto` potrafi ją wyczerpać i zawiesić pracę). Jeśli rdzeń MT nie wystartuje lub przestanie raportować postęp przez 30 s, zadanie jest automatycznie powtarzane na rdzeniu jednowątkowym. Bez izolacji (np. tryb prywatny Firefoksa) od razu używany jest rdzeń jednowątkowy.

## Rozwój

Wymagany Node.js ≥ 20.19 (zalecany 24 – patrz `.nvmrc`).

```bash
npm ci
npm run dev       # serwer deweloperski (z nagłówkami COOP/COEP)
npm run check     # typecheck (tsc -b) + ESLint
npm run build     # typecheck + build produkcyjny do dist/
npm run preview   # podgląd builda BEZ nagłówków – zachowuje się jak GitHub Pages
```

`base: './'` w `vite.config.ts` sprawia, że build działa w dowolnym podkatalogu (`https://<user>.github.io/<repo>/`).

## Deploy na GitHub Pages

Workflow `.github/workflows/deploy.yml` przy każdym pushu na `main` uruchamia lint, typecheck, build i publikuje `dist/` na GitHub Pages.

Jednorazowo w repozytorium: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Ograniczenia

- Z animowanych GIF/WEBP przy konwersji na inny format obrazu zapisywana jest pierwsza klatka.
- GIF z wideo: maksymalnie 30 s fragmentu (wszystkie klatki trafiają do pamięci przy liczeniu palety).
- Plik wynikowy powstaje w pamięci WebAssembly (limit rzędu 2 GB) – nie dotyczy to pliku wejściowego.
