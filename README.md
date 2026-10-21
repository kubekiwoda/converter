# Konwerter plików

**Darmowy konwerter obrazów, filmów i muzyki, który działa w całości w Twojej przeglądarce.**

👉 **Otwórz: https://kubekiwoda.github.io/converter/**

Nic nie instalujesz, nie zakładasz konta i nie wysyłasz plików na żaden serwer. Wszystko dzieje się na Twoim komputerze lub telefonie.

---

## Co potrafi?

### 🖼️ Obrazy

Zamienia obrazy między formatami **PNG, JPG, WEBP i GIF** – w dowolną stronę.

Przykłady: zdjęcie JPG → PNG, zrzut ekranu PNG → mniejszy WEBP, logo PNG → GIF.

### 🎬 Filmy

- **Wyciąga dźwięk z filmu** – np. z pliku MP4 zrobisz plik MP3 albo WAV.
- **Robi animowanego GIF-a z fragmentu filmu** – wybierasz, od której sekundy i jak długo.

Obsługiwane filmy: MP4, MOV, WEBM, MKV, AVI i inne popularne formaty.

### 🎵 Muzyka i dźwięk

Zamienia pliki audio (WAV, M4A, FLAC, OGG i inne) na **MP3** lub **WAV**.

---

## Jak tego używać?

1. Wejdź na stronę: **https://kubekiwoda.github.io/converter/**
2. **Przeciągnij plik** na stronę albo kliknij i wybierz go z dysku. Obrazek możesz też po prostu wkleić (Ctrl+V).
3. Strona sama rozpozna, co to za plik, i pokaże, na co można go zamienić. **Wybierz format.**
4. Kliknij **„Konwertuj”** i poczekaj, aż pasek postępu dojdzie do końca.
5. Kliknij **„Pobierz plik”** – gotowe!

---

## Najczęstsze pytania

**Czy moje pliki są bezpieczne?**
Tak. Pliki nigdy nie opuszczają Twojego urządzenia – nie są nigdzie wysyłane ani zapisywane. Strona pobiera z internetu tylko samą siebie (i raz „silnik” do filmów), a nie Twoje pliki.

**Czy są jakieś limity rozmiaru?**
Nie ma sztucznych limitów. Jedynym ograniczeniem jest pamięć Twojego komputera – bardzo duże filmy mogą się nie zmieścić na słabszym sprzęcie lub telefonie.

**Dlaczego pierwsza konwersja filmu trwa dłużej?**
Za pierwszym razem przeglądarka pobiera „silnik” do obróbki filmów i dźwięku (około 31 MB). Potem jest on zapamiętany i kolejne konwersje startują od razu.

**Przy pierwszym wejściu strona sama się odświeżyła. Czy to normalne?**
Tak. Strona robi to jeden raz, żeby włączyć szybszy, wielowątkowy tryb pracy.

**Czy to kosztuje?**
Nie. Projekt jest darmowy i otwarty (licencja MIT).

**Jaka przeglądarka?**
Najlepiej aktualny Chrome, Edge, Brave, Firefox lub Safari.

---

## Ograniczenia

- Jeśli zamieniasz **animowany** GIF lub WEBP na inny format obrazu, zapisze się tylko jego **pierwsza klatka**.
- GIF z filmu może mieć maksymalnie **30 sekund** (dłuższe GIF-y byłyby ogromne).
- Format JPG nie obsługuje przezroczystości – przezroczyste tło zamieni się na **białe**.

---

<details>
<summary><b>Dla programistów</b> – jak uruchomić projekt u siebie</summary>

Potrzebujesz [Node.js](https://nodejs.org/) w wersji 20.19 lub nowszej (zalecana 24).

```bash
npm ci            # instalacja zależności
npm run dev       # wersja deweloperska pod http://localhost:5173
npm run check     # sprawdzenie typów i lint
npm run build     # wersja produkcyjna do folderu dist/
npm run preview   # podgląd wersji produkcyjnej (zachowuje się jak GitHub Pages)
```

**Z czego jest zbudowany:** Vite, Tailwind CSS, TypeScript. Obrazy są przetwarzane przez `OffscreenCanvas` w osobnym wątku (GIF-y koduje [`gifenc`](https://github.com/mattdesl/gifenc)), a filmy i dźwięk przez [`ffmpeg.wasm`](https://github.com/ffmpegwasm/ffmpeg.wasm). Szybszy tryb wielowątkowy wymaga specjalnych nagłówków, których GitHub Pages nie pozwala ustawić – dodaje je [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker). Gdy to niemożliwe, aplikacja sama przełącza się na tryb jednowątkowy.

**Publikacja:** każdy push na gałąź `main` automatycznie buduje i publikuje stronę (`.github/workflows/deploy.yml`). W ustawieniach repozytorium musi być włączone **Settings → Pages → Source: GitHub Actions**.

</details>
