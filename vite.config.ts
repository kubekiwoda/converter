import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Rozmiary plików .wasm są potrzebne do paska postępu pobierania: GitHub Pages
// może serwować je skompresowane, a wtedy Content-Length nie odpowiada liczbie
// odebranych bajtów.
const wasmSize = (pkg: string) => statSync(fileURLToPath(import.meta.resolve(`${pkg}/wasm`))).size

// GitHub Pages nie pozwala ustawić nagłówków COOP/COEP – w produkcji robi to
// coi-serviceworker. W dev ustawiamy je bezpośrednio na serwerze Vite.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  define: {
    __FFMPEG_WASM_SIZE__: JSON.stringify({
      st: wasmSize('@ffmpeg/core'),
      mt: wasmSize('@ffmpeg/core-mt'),
    }),
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  worker: {
    format: 'es',
  },
  build: {
    // Pliki rdzenia FFmpeg muszą zostać osobnymi assetami (nie data: URL),
    // bo są ładowane w workerach.
    assetsInlineLimit: (filePath) => (filePath.includes('ffmpeg-core') ? false : undefined),
  },
  server: {
    headers: isolationHeaders,
  },
  // `vite preview` celowo bez nagłówków – zachowuje się jak GitHub Pages,
  // więc izolację musi zapewnić coi-serviceworker (tak jak na produkcji).
  preview: {
    headers: {},
  },
})
