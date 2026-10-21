import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg'
import coreStURL from '@ffmpeg/core?url'
import wasmStURL from '@ffmpeg/core/wasm?url'
import coreMtURL from '@ffmpeg/core-mt?url'
import wasmMtURL from '@ffmpeg/core-mt/wasm?url'
// Skrypt wątków (pthread) jako tekst: tworzymy z niego blob URL. Pobrany przez
// `?url` z serwera dev zostałby przetransformowany przez Vite i nie wystartuje
// jako klasyczny worker.
import workerMtSource from '@ffmpeg/core-mt/worker?raw'
import type { ProgressCallback } from './types.ts'
import { AbortedError, clamp, formatBytes, formatDuration } from './utils.ts'

export type EngineMode = 'mt' | 'st'

/**
 * Wersja wielowątkowa wymaga SharedArrayBuffer, czyli izolacji cross-origin.
 * Na GitHub Pages zapewnia ją coi-serviceworker (public/coi-serviceworker.js).
 */
export const preferredMode: EngineMode =
  window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' ? 'mt' : 'st'

const CORE_FILES = {
  st: { core: coreStURL, wasm: wasmStURL, worker: null, wasmSize: __FFMPEG_WASM_SIZE__.st },
  mt: { core: coreMtURL, wasm: wasmMtURL, worker: workerMtSource, wasmSize: __FFMPEG_WASM_SIZE__.mt },
} as const

/** Ile czekamy na start wątków rdzenia MT, zanim przejdziemy na wersję jednowątkową. */
const MT_START_TIMEOUT_MS = 30_000

interface LoadedEngine {
  ffmpeg: FFmpeg
  mode: EngineMode
}

let engine: LoadedEngine | null = null
/** Instancja w trakcie `load()` – żeby dało się ją przerwać. */
let starting: FFmpeg | null = null
let activeMode: EngineMode = preferredMode

/**
 * Pobrane pliki rdzenia jako blob URL-e. Po `terminate()` (anulowanie, błąd)
 * ponowne ładowanie nie pobiera ich drugi raz; równoległe żądania dzielą jedno pobieranie.
 */
const downloads = new Map<string, Promise<string>>()
const downloaded = new Set<string>()
let mtWorkerURL: string | undefined

type BytesCallback = (received: number, total: number) => void

async function download(url: string, type: string, expectedSize: number, onBytes?: BytesCallback): Promise<string> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Nie udało się pobrać silnika FFmpeg (HTTP ${response.status}).`)
  }
  // Przy kompresji (gzip/br) Content-Length to rozmiar skompresowany – wtedy
  // korzystamy z rozmiaru znanego w czasie budowania.
  const length = Number(response.headers.get('Content-Length'))
  const total = response.headers.get('Content-Encoding') || !length ? expectedSize : length

  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onBytes?.(received, Math.max(total, received))
  }
  return URL.createObjectURL(new Blob(chunks, { type }))
}

function fetchToBlobURL(url: string, type: string, expectedSize = 0, onBytes?: BytesCallback): Promise<string> {
  let pending = downloads.get(url)
  if (!pending) {
    pending = download(url, type, expectedSize, onBytes)
    downloads.set(url, pending)
    pending.then(
      () => downloaded.add(url),
      () => downloads.delete(url),
    )
  }
  return pending
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer))
}

async function loadEngine(mode: EngineMode, onProgress: ProgressCallback, signal: AbortSignal): Promise<FFmpeg> {
  const files = CORE_FILES[mode]
  const label = mode === 'mt' ? 'wielowątkowego' : 'jednowątkowego'
  const report = (received: number, total: number) =>
    onProgress({
      stage: `Pobieranie silnika FFmpeg (${label})`,
      ratio: received / total,
      detail: `${formatBytes(received)} / ${formatBytes(total)}`,
    })

  const absolute = (url: string) => new URL(url, document.baseURI).href
  const wasmHref = absolute(files.wasm)
  if (!downloaded.has(wasmHref)) report(0, files.wasmSize)

  const [coreURL, wasmURL] = await Promise.all([
    fetchToBlobURL(absolute(files.core), 'text/javascript'),
    fetchToBlobURL(wasmHref, 'application/wasm', files.wasmSize, report),
  ])
  if (files.worker && !mtWorkerURL) {
    mtWorkerURL = URL.createObjectURL(new Blob([files.worker], { type: 'text/javascript' }))
  }
  const workerURL = files.worker ? mtWorkerURL : undefined
  if (signal.aborted) throw new AbortedError()

  onProgress({ stage: 'Uruchamianie silnika FFmpeg', ratio: null })
  const ffmpeg = new FFmpeg()
  starting = ffmpeg
  try {
    const loading = ffmpeg.load({ coreURL, wasmURL, workerURL })
    await (mode === 'mt'
      ? withTimeout(loading, MT_START_TIMEOUT_MS, 'Wątki FFmpeg nie wystartowały w wyznaczonym czasie.')
      : loading)
  } catch (error) {
    ffmpeg.terminate()
    throw signal.aborted ? new AbortedError() : error
  } finally {
    if (starting === ffmpeg) starting = null
  }
  return ffmpeg
}

async function getEngine(onProgress: ProgressCallback, signal: AbortSignal): Promise<LoadedEngine> {
  if (engine) return engine
  try {
    engine = { ffmpeg: await loadEngine(activeMode, onProgress, signal), mode: activeMode }
  } catch (error) {
    if (activeMode !== 'mt' || signal.aborted) throw error
    // Rdzeń wielowątkowy nie wystartował – wracamy do jednowątkowego.
    console.warn('FFmpeg MT nie wystartował, przełączam na wersję jednowątkową.', error)
    activeMode = 'st'
    engine = { ffmpeg: await loadEngine('st', onProgress, signal), mode: 'st' }
  }
  return engine
}

export const currentMode = (): EngineMode => activeMode

/** Czy rdzeń FFmpeg jest już pobrany (kolejne użycia nie wymagają ~31 MB transferu). */
export const engineDownloaded = (): boolean => downloaded.has(new URL(CORE_FILES[activeMode].wasm, document.baseURI).href)

/** Rozmiar pliku .wasm rdzenia, który zostanie pobrany przy pierwszym użyciu. */
export const engineDownloadSize = (): number => CORE_FILES[activeMode].wasmSize

function resetEngine() {
  engine?.ffmpeg.terminate()
  engine = null
  starting?.terminate()
  starting = null
}

const TIME_RE = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/
const FRAME_RE = /frame=\s*(\d+)/
const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/

const toSeconds = (match: RegExpMatchArray) =>
  Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])

function explainFailure(logs: string[], code: number): string {
  const text = logs.join('\n')
  if (/matches no streams|does not contain any stream|Output file .* does not contain any stream/i.test(text)) {
    return 'Ten plik nie zawiera ścieżki audio, którą można by wyodrębnić.'
  }
  if (/Invalid data found when processing input|could not find codec parameters|moov atom not found/i.test(text)) {
    return 'Nie udało się odczytać pliku – jest uszkodzony albo zapisany w nieobsługiwanym formacie.'
  }
  if (/Cannot allocate memory|out of memory|OOM/i.test(text)) {
    return 'Zabrakło pamięci przeglądarki. Spróbuj krótszego fragmentu lub mniejszej rozdzielczości.'
  }
  const lastError = [...logs].reverse().find((line) => /error|invalid|failed|unsupported/i.test(line))
  return `FFmpeg zakończył pracę z błędem (kod ${code})${lastError ? `: ${lastError.trim()}` : '.'}`
}

export interface FFmpegJob {
  file: File
  /** Buduje argumenty FFmpeg dla podanych ścieżek wejścia i wyjścia. */
  args: (input: string, output: string) => string[]
  /** Nazwa pliku wynikowego w wirtualnym FS (rozszerzenie wybiera muxer). */
  output: string
  mime: string
  /** Oczekiwana długość wyniku w sekundach – do wyliczania postępu. */
  duration?: number
  /**
   * Oczekiwana liczba klatek pierwszego wyjścia. Gdy podana, postęp liczony jest
   * głównie z licznika `frame=` – przy GIF-ie czas wejścia kończy się dużo wcześniej
   * niż kodowanie z paletą.
   */
  frames?: number
  stage: string
  onProgress: ProgressCallback
  signal: AbortSignal
}

/**
 * Rdzeń MT ma stałą pulę 32 wątków. Domyślne `threads=auto` (osobno dla dekodera
 * i każdego grafu filtrów) potrafi ją wyczerpać na wielordzeniowych CPU, a wtedy
 * FFmpeg zawiesza się na zawsze – dlatego ograniczamy liczbę wątków jawnie.
 */
const MT_THREAD_ARGS = [
  '-threads', String(clamp(navigator.hardwareConcurrency || 4, 2, 8)),
  '-filter_threads', '2',
  '-filter_complex_threads', '2',
]

/** Brak jakiegokolwiek logu przez tyle czasu w trybie MT traktujemy jako zakleszczenie. */
const MT_STALL_TIMEOUT_MS = 30_000

class StallError extends Error {
  constructor() {
    super('FFmpeg przestał odpowiadać.')
    this.name = 'StallError'
  }
}

let jobCounter = 0

export async function runFFmpeg(job: FFmpegJob): Promise<Blob> {
  try {
    return await runOnce(job)
  } catch (error) {
    if (!(error instanceof StallError) || job.signal.aborted) throw error
    // Zakleszczenie wątków – powtarzamy całe zadanie na rdzeniu jednowątkowym.
    console.warn('FFmpeg MT zablokował się, ponawiam w trybie jednowątkowym.')
    activeMode = 'st'
    job.onProgress({ stage: 'Wątki FFmpeg nie odpowiadają – ponawiam w trybie jednowątkowym', ratio: null })
    return runOnce(job)
  }
}

async function runOnce(job: FFmpegJob): Promise<Blob> {
  const { file, onProgress, signal } = job
  if (signal.aborted) throw new AbortedError()

  // Przerwanie = zabicie workera FFmpeg; kolejne zadanie załaduje rdzeń ponownie (z pamięci podręcznej).
  let rejectAbort: (error: Error) => void = () => undefined
  const abortPromise = new Promise<never>((_, reject) => (rejectAbort = reject))
  const onAbort = () => {
    resetEngine()
    rejectAbort(new AbortedError())
  }
  signal.addEventListener('abort', onAbort, { once: true })

  let loaded: LoadedEngine
  try {
    loaded = await Promise.race([getEngine(onProgress, signal), abortPromise])
  } catch (error) {
    signal.removeEventListener('abort', onAbort)
    throw error
  }
  const { ffmpeg, mode } = loaded

  const dir = `/job${++jobCounter}`
  let inputPath = `${dir}/${file.name}`
  let mounted = false
  const logs: string[] = []
  let total = job.duration && job.duration > 0 ? job.duration : 0
  let lastActivity = performance.now()
  let watchdog = 0
  let stalled = false

  const onLog = ({ message }: { message: string }) => {
    lastActivity = performance.now()
    logs.push(message)
    if (logs.length > 200) logs.shift()

    const duration = message.match(DURATION_RE)
    if (duration && !total) total = toSeconds(duration)

    const time = message.match(TIME_RE)
    if (!time) return
    const done = toSeconds(time)
    const timeRatio = total ? clamp(done / total, 0, 1) : null
    const frame = job.frames ? message.match(FRAME_RE) : null
    if (frame && job.frames) {
      const frames = Number(frame[1])
      onProgress({
        stage: job.stage,
        ratio: 0.25 * (timeRatio ?? 0) + 0.75 * clamp(frames / job.frames, 0, 1),
        detail: `klatka ${Math.min(frames, job.frames)} / ${job.frames}`,
      })
    } else {
      onProgress({
        stage: job.stage,
        ratio: timeRatio,
        detail: total ? `${formatDuration(done)} / ${formatDuration(total)}` : formatDuration(done),
      })
    }
  }

  try {
    onProgress({ stage: 'Przygotowanie pliku', ratio: null })
    await ffmpeg.createDir(dir)
    try {
      // WORKERFS czyta plik bezpośrednio z dysku – bez kopiowania całości do pamięci WASM.
      mounted = await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, dir)
    } catch {
      mounted = false
    }
    if (!mounted) {
      inputPath = `${dir}/input.${file.name.split('.').pop() ?? 'bin'}`
      await ffmpeg.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()))
    }

    ffmpeg.on('log', onLog)
    onProgress({ stage: job.stage, ratio: total ? 0 : null })
    const output = `/${job.output}`
    const args = [...(mode === 'mt' ? MT_THREAD_ARGS : []), ...job.args(inputPath, output)]

    const stallPromise = new Promise<never>((_, reject) => {
      if (mode !== 'mt') return
      lastActivity = performance.now()
      watchdog = window.setInterval(() => {
        if (performance.now() - lastActivity < MT_STALL_TIMEOUT_MS) return
        stalled = true
        reject(new StallError())
        resetEngine()
      }, 1000)
    })
    const code = await Promise.race([ffmpeg.exec(args), abortPromise, stallPromise])
    window.clearInterval(watchdog)
    if (code !== 0) throw new Error(explainFailure(logs, code))

    onProgress({ stage: 'Zapisywanie wyniku', ratio: 1 })
    const data = await ffmpeg.readFile(output)
    await ffmpeg.deleteFile(output).catch(() => undefined)
    if (typeof data === 'string' || data.byteLength === 0) {
      throw new Error(explainFailure(logs, code))
    }
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: job.mime })
  } catch (error) {
    if (signal.aborted) throw new AbortedError()
    if (stalled) throw new StallError()
    // Worker FFmpeg zgłasza wyjątki z wnętrza WASM (np. brak pamięci) jako tekst –
    // rdzeń zostaje wtedy w nieokreślonym stanie, więc go restartujemy.
    if (typeof error === 'string') {
      resetEngine()
      throw new Error(explainFailure([...logs, error], -1), { cause: error })
    }
    throw error
  } finally {
    window.clearInterval(watchdog)
    signal.removeEventListener('abort', onAbort)
    ffmpeg.off('log', onLog)
    if (engine?.ffmpeg === ffmpeg) {
      if (mounted) await ffmpeg.unmount(dir).catch(() => undefined)
      else await ffmpeg.deleteFile(inputPath).catch(() => undefined)
      await ffmpeg.deleteDir(dir).catch(() => undefined)
    }
  }
}
