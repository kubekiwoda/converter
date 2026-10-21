import './style.css'
import { DEFAULT_SETTINGS, GIF_MAX_DURATION, convert, gifClip, type ConversionResult, type Settings } from './lib/convert.ts'
import { currentMode, engineDownloaded, engineDownloadSize } from './lib/ffmpeg.ts'
import { ACCEPT, TARGETS, detectFile, type Category, type DetectedFile, type TargetId } from './lib/formats.ts'
import { canvasEncodesWebp } from './lib/image.ts'
import { initThemeToggle } from './lib/theme.ts'
import type { ProgressUpdate } from './lib/types.ts'
import { formatBytes, formatDuration, isAbort } from './lib/utils.ts'

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Brak elementu #${id}`)
  return element as T
}

const ui = {
  notice: $('error'),
  dropzone: $('dropzone'),
  fileInput: $<HTMLInputElement>('file-input'),
  workspace: $('workspace'),
  fileThumb: $('file-thumb'),
  fileName: $('file-name'),
  fileMeta: $('file-meta'),
  changeFile: $('change-file'),
  mediaPreview: $('media-preview'),
  targets: $('targets'),
  options: $('options'),
  convertBtn: $<HTMLButtonElement>('convert-btn'),
  cancelBtn: $<HTMLButtonElement>('cancel-btn'),
  progress: $('progress'),
  progressStage: $('progress-stage'),
  progressPercent: $('progress-percent'),
  progressTrack: $('progress-track'),
  progressBar: $('progress-bar'),
  progressDetail: $('progress-detail'),
  progressElapsed: $('progress-elapsed'),
  result: $('result'),
  resultName: $('result-name'),
  resultMeta: $('result-meta'),
  resultPreview: $('result-preview'),
  downloadBtn: $<HTMLAnchorElement>('download-btn'),
  engineStatus: $('engine-status'),
  dropOverlay: $('drop-overlay'),
  themeToggle: $<HTMLButtonElement>('theme-toggle'),
}

interface State {
  file: File | null
  detected: DetectedFile | null
  target: TargetId | null
  settings: Settings
  /** Długość nagrania z metadanych odtwarzacza (sekundy). */
  mediaDuration?: number
  media: HTMLVideoElement | HTMLAudioElement | null
  controller: AbortController | null
  previewURL: string | null
  resultURL: string | null
}

const state: State = {
  file: null,
  detected: null,
  target: null,
  settings: { ...DEFAULT_SETTINGS },
  media: null,
  controller: null,
  previewURL: null,
  resultURL: null,
}

const CATEGORY_LABEL: Record<Category, string> = { image: 'Obraz', video: 'Wideo', audio: 'Audio' }

const CATEGORY_ICON: Record<Category, { path: string; tone: string }> = {
  image: {
    tone: 'text-indigo-500',
    path: 'm2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
  },
  video: {
    tone: 'text-rose-500',
    path: 'm15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z',
  },
  audio: {
    tone: 'text-emerald-500',
    path: 'm9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z',
  },
}

const svgIcon = (path: string, className: string) =>
  `<svg class="${className}" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="${path}" /></svg>`

const ALERT_ICON =
  'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z'
const INFO_ICON =
  'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z'

/* ---------- Komunikaty ---------- */

function showNotice(message: string | null, tone: 'error' | 'info' = 'error') {
  if (!message) {
    ui.notice.classList.add('hidden')
    ui.notice.replaceChildren()
    return
  }
  const styles =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
      : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
  ui.notice.innerHTML = `<div class="flex gap-3 rounded-2xl border p-4 text-sm ${styles}">${svgIcon(
    tone === 'error' ? ALERT_ICON : INFO_ICON,
    'size-5 shrink-0',
  )}<p class="min-w-0 break-words"></p></div>`
  ui.notice.querySelector('p')!.textContent = message
  ui.notice.classList.remove('hidden')
}

/* ---------- Wczytywanie pliku ---------- */

function revoke(url: string | null) {
  if (url) URL.revokeObjectURL(url)
}

async function loadFile(file: File) {
  if (state.controller) return
  showNotice(null)

  const detected = await detectFile(file)
  if (!detected) {
    showNotice(
      `Nie rozpoznano formatu pliku „${file.name}”. Obsługiwane są obrazy (PNG, JPG, WEBP, GIF), wideo (MP4, MOV, WEBM, MKV, AVI…) oraz audio (MP3, WAV, M4A, FLAC, OGG…).`,
    )
    return
  }

  revoke(state.previewURL)
  state.file = file
  state.detected = detected
  state.target = detected.targets[0] ?? null
  state.mediaDuration = undefined
  state.media = null
  state.settings.gifStart = 0
  state.previewURL = URL.createObjectURL(file)

  hideResult()
  hideProgress()
  renderFile()
  renderTargets()
  renderOptions()

  ui.dropzone.classList.add('hidden')
  ui.workspace.classList.remove('hidden')
}

function setFileMeta(extra: string[] = []) {
  const { file, detected } = state
  if (!file || !detected) return
  ui.fileMeta.textContent = [
    `${CATEGORY_LABEL[detected.category]} ${detected.format.toUpperCase()}`,
    formatBytes(file.size),
    ...extra,
  ].join(' · ')
}

function renderFile() {
  const { file, detected, previewURL } = state
  if (!file || !detected || !previewURL) return

  ui.fileName.textContent = file.name
  ui.fileName.title = file.name
  setFileMeta()

  const icon = CATEGORY_ICON[detected.category]
  ui.fileThumb.innerHTML = svgIcon(icon.path, `size-8 ${icon.tone}`)
  ui.fileThumb.classList.toggle('checker', detected.category === 'image')
  ui.fileThumb.classList.toggle('bg-zinc-100', detected.category !== 'image')
  ui.fileThumb.classList.toggle('dark:bg-zinc-800', detected.category !== 'image')
  ui.mediaPreview.replaceChildren()
  ui.mediaPreview.classList.add('hidden')

  if (detected.category === 'image') {
    const img = new Image()
    img.alt = ''
    img.className = 'size-full object-contain'
    img.onload = () => {
      ui.fileThumb.replaceChildren(img)
      setFileMeta([`${img.naturalWidth}×${img.naturalHeight}`])
    }
    img.src = previewURL
    return
  }

  const media = document.createElement(detected.category === 'video' ? 'video' : 'audio')
  media.controls = true
  media.preload = 'metadata'
  media.className = detected.category === 'video' ? 'max-h-80 w-full rounded-xl bg-black' : 'w-full'
  if (media instanceof HTMLVideoElement) media.playsInline = true

  media.addEventListener('loadedmetadata', () => {
    const extra: string[] = []
    if (Number.isFinite(media.duration) && media.duration > 0) {
      state.mediaDuration = media.duration
      extra.push(formatDuration(media.duration))
    }
    if (media instanceof HTMLVideoElement && media.videoWidth) {
      extra.push(`${media.videoWidth}×${media.videoHeight}`)
    }
    setFileMeta(extra)
    renderOptions()
  })
  if (media instanceof HTMLVideoElement) {
    // Miniatura z pierwszej wyświetlonej klatki.
    media.addEventListener(
      'loadeddata',
      () => {
        if (!media.videoWidth || state.media !== media) return
        const canvas = document.createElement('canvas')
        const scale = 160 / Math.max(media.videoWidth, media.videoHeight)
        canvas.width = Math.round(media.videoWidth * scale)
        canvas.height = Math.round(media.videoHeight * scale)
        canvas.getContext('2d')?.drawImage(media, 0, 0, canvas.width, canvas.height)
        canvas.className = 'size-full object-cover'
        ui.fileThumb.replaceChildren(canvas)
      },
      { once: true },
    )
  }
  media.addEventListener('error', () => {
    // Przeglądarka nie odtwarza tego kodeka (np. AVI) – FFmpeg i tak sobie poradzi.
    state.media = null
    ui.mediaPreview.innerHTML =
      '<p class="note rounded-xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800/60">Podgląd niedostępny w tej przeglądarce – konwersja nadal zadziała.</p>'
    renderOptions()
  })

  // `#t=0.1` sprawia, że zamiast czarnego ekranu widać pierwszą klatkę.
  media.src = media instanceof HTMLVideoElement ? `${previewURL}#t=0.1` : previewURL
  state.media = media
  ui.mediaPreview.replaceChildren(media)
  ui.mediaPreview.classList.remove('hidden')
}

/* ---------- Wybór formatu ---------- */

function renderTargets() {
  const { detected } = state
  if (!detected) return

  const buttons = detected.targets.map((id) => {
    const target = TARGETS[id]
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'target'
    button.setAttribute('role', 'radio')
    button.dataset.target = id
    button.innerHTML = `<span class="text-base font-semibold">${target.label}</span><span class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">${target.hint[detected.category] ?? ''}</span>`
    button.addEventListener('click', () => selectTarget(id))
    return button
  })
  ui.targets.replaceChildren(...buttons)
  syncTargets()
}

function syncTargets() {
  for (const button of ui.targets.querySelectorAll<HTMLButtonElement>('[role="radio"]')) {
    const checked = button.dataset.target === state.target
    button.setAttribute('aria-checked', String(checked))
    button.tabIndex = checked ? 0 : -1
  }
  ui.convertBtn.textContent = state.target ? `Konwertuj do ${TARGETS[state.target].label}` : 'Konwertuj'
}

function selectTarget(id: TargetId) {
  if (state.controller || state.target === id) return
  state.target = id
  syncTargets()
  renderOptions()
}

// Strzałki przełączają format jak w natywnej grupie radio.
ui.targets.addEventListener('keydown', (event) => {
  const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
  const step = keys[event.key]
  const targets = state.detected?.targets
  if (!step || !targets || !state.target) return
  event.preventDefault()
  const next = targets[(targets.indexOf(state.target) + step + targets.length) % targets.length]!
  selectTarget(next)
  ui.targets.querySelector<HTMLButtonElement>(`[data-target="${next}"]`)?.focus()
})

/* ---------- Opcje ---------- */

const segmented = (name: string, label: string, values: number[], current: number, unit: string) =>
  `<div><span class="field-label" id="${name}-label">${label}</span><div class="segmented" role="group" aria-labelledby="${name}-label">${values
    .map((value) => `<button type="button" data-${name}="${value}" aria-pressed="${value === current}">${value}${unit}</button>`)
    .join('')}</div></div>`

const select = (id: string, label: string, values: number[], current: number, unit: string) =>
  `<label class="block"><span class="field-label">${label}</span><select id="${id}" class="field">${values
    .map((value) => `<option value="${value}"${value === current ? ' selected' : ''}>${value}${unit}</option>`)
    .join('')}</select></label>`

function optionsMarkup(category: Category, target: TargetId): string {
  const { settings } = state
  const parts: string[] = []
  const usesFFmpeg = category !== 'image' || (target === 'webp' && !canvasEncodesWebp())

  if (category === 'image') {
    if (target === 'jpg' || target === 'webp') {
      parts.push(`<div>
        <div class="flex items-center justify-between"><label for="opt-quality" class="field-label">Jakość</label><output id="opt-quality-out" for="opt-quality" class="text-sm font-semibold tabular-nums">${settings.quality}</output></div>
        <input id="opt-quality" type="range" min="10" max="100" step="1" value="${settings.quality}" class="mt-2 w-full accent-indigo-600" />
        <div class="flex justify-between text-xs text-zinc-400 dark:text-zinc-500"><span>mniejszy plik</span><span>lepsza jakość</span></div>
      </div>`)
    }
    if (target === 'jpg') parts.push('<p class="note">JPG nie obsługuje przezroczystości – zostanie zastąpiona białym tłem.</p>')
    if (target === 'png') parts.push('<p class="note">Kompresja bezstratna, przezroczystość zostaje zachowana.</p>')
    if (target === 'gif') parts.push('<p class="note">GIF ma paletę maks. 256 kolorów i 1-bitową przezroczystość – najlepiej sprawdza się przy grafikach i ikonach.</p>')
    if (state.detected?.format === 'gif' || state.detected?.format === 'webp') {
      parts.push('<p class="note">Jeśli obraz jest animowany, zapisana zostanie jego pierwsza klatka.</p>')
    }
  } else if (target === 'mp3') {
    parts.push(segmented('bitrate', 'Bitrate MP3', [128, 192, 256, 320], settings.bitrate, ' kb/s'))
    parts.push('<p class="note">192 kb/s to dobry kompromis, 320 kb/s – maksymalna jakość MP3.</p>')
  } else if (target === 'wav') {
    const estimate = state.mediaDuration ? ` Szacowany rozmiar: ~${formatBytes(state.mediaDuration * 48_000 * 4)}.` : ''
    parts.push(`<p class="note">Bezstratny PCM 16-bit (ok. 10 MB na minutę stereo).${estimate}</p>`)
  } else if (target === 'gif') {
    parts.push(`<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <label class="block"><span class="field-label">Początek (s)</span><input id="opt-gif-start" type="number" inputmode="decimal" min="0" step="0.1" value="${settings.gifStart}" class="field" /></label>
      <label class="block"><span class="field-label">Długość (s)</span><input id="opt-gif-duration" type="number" inputmode="decimal" min="0.5" max="${GIF_MAX_DURATION}" step="0.5" value="${settings.gifDuration}" class="field" /></label>
      ${select('opt-gif-fps', 'Klatki/s', [8, 10, 12, 15, 20, 24], settings.gifFps, '')}
      ${select('opt-gif-width', 'Szerokość', [240, 320, 480, 640, 800], settings.gifWidth, ' px')}
    </div>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p id="gif-summary" class="note"></p>
      ${state.media instanceof HTMLVideoElement ? '<button type="button" id="opt-gif-from-player" class="btn-secondary py-1.5">Początek = pozycja odtwarzacza</button>' : ''}
    </div>`)
  }

  if (usesFFmpeg && !engineDownloaded()) {
    parts.push(
      `<p class="note">Przy pierwszej konwersji przeglądarka pobierze silnik FFmpeg (~${formatBytes(
        engineDownloadSize(),
      )}); kolejne korzystają z pamięci podręcznej.</p>`,
    )
  }
  return parts.join('')
}

function updateGifSummary() {
  const summary = ui.options.querySelector('#gif-summary')
  if (!summary) return
  const { start, length } = gifClip(state.settings, state.mediaDuration)
  if (length <= 0) {
    summary.className = 'note text-red-600 dark:text-red-400'
    summary.textContent = `Początek wypada za końcem nagrania (${formatDuration(state.mediaDuration ?? 0)}).`
    return
  }
  summary.className = 'note'
  const frames = Math.round(length * state.settings.gifFps)
  summary.textContent = `Fragment ${formatDuration(start)}–${formatDuration(start + length)} (${length.toFixed(1).replace('.', ',')} s) · ok. ${frames} klatek`
}

function renderOptions() {
  const { detected, target, settings } = state
  if (!detected || !target) {
    ui.options.replaceChildren()
    return
  }
  ui.options.innerHTML = optionsMarkup(detected.category, target)

  const quality = ui.options.querySelector<HTMLInputElement>('#opt-quality')
  quality?.addEventListener('input', () => {
    settings.quality = Number(quality.value)
    ui.options.querySelector('#opt-quality-out')!.textContent = quality.value
  })

  for (const button of ui.options.querySelectorAll<HTMLButtonElement>('[data-bitrate]')) {
    button.addEventListener('click', () => {
      settings.bitrate = Number(button.dataset.bitrate)
      for (const other of ui.options.querySelectorAll('[data-bitrate]')) {
        other.setAttribute('aria-pressed', String(other === button))
      }
    })
  }

  const numberInput = (id: string, apply: (value: number) => void) => {
    const input = ui.options.querySelector<HTMLInputElement>(id)
    input?.addEventListener('input', () => {
      const value = input.valueAsNumber
      if (Number.isFinite(value)) apply(value)
      updateGifSummary()
    })
    return input
  }
  const startInput = numberInput('#opt-gif-start', (value) => (settings.gifStart = Math.max(0, value)))
  numberInput('#opt-gif-duration', (value) => (settings.gifDuration = Math.min(GIF_MAX_DURATION, Math.max(0.5, value))))
  for (const id of ['#opt-gif-fps', '#opt-gif-width']) {
    const field = ui.options.querySelector<HTMLSelectElement>(id)
    field?.addEventListener('change', () => {
      if (id === '#opt-gif-fps') settings.gifFps = Number(field.value)
      else settings.gifWidth = Number(field.value)
      updateGifSummary()
    })
  }

  ui.options.querySelector('#opt-gif-from-player')?.addEventListener('click', () => {
    if (!state.media || !startInput) return
    settings.gifStart = Math.round(state.media.currentTime * 10) / 10
    startInput.value = String(settings.gifStart)
    updateGifSummary()
  })

  updateGifSummary()
  setControlsDisabled(state.controller !== null)
}

/* ---------- Postęp ---------- */

let elapsedTimer = 0

function showProgress({ stage, ratio, detail }: ProgressUpdate) {
  ui.progress.classList.remove('hidden')
  ui.progressStage.textContent = stage
  ui.progressDetail.textContent = detail ?? ''

  if (ratio === null) {
    ui.progressBar.classList.add('indeterminate')
    ui.progressPercent.textContent = ''
    ui.progressTrack.removeAttribute('aria-valuenow')
  } else {
    const percent = Math.round(ratio * 100)
    ui.progressBar.classList.remove('indeterminate')
    ui.progressBar.style.width = `${ratio * 100}%`
    ui.progressPercent.textContent = `${percent}%`
    ui.progressTrack.setAttribute('aria-valuenow', String(percent))
  }
}

function hideProgress() {
  ui.progress.classList.add('hidden')
  ui.progressBar.style.width = '0'
  ui.progressBar.classList.remove('indeterminate')
}

function startElapsed(startedAt: number) {
  const tick = () => {
    ui.progressElapsed.textContent = `${formatDuration((performance.now() - startedAt) / 1000)}`
  }
  tick()
  elapsedTimer = window.setInterval(tick, 500)
}

/* ---------- Konwersja ---------- */

function setControlsDisabled(disabled: boolean) {
  for (const element of ui.targets.querySelectorAll('button')) element.disabled = disabled
  for (const element of ui.options.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')) {
    element.disabled = disabled
  }
}

function setBusy(busy: boolean) {
  setControlsDisabled(busy)
  ui.convertBtn.disabled = busy
  ui.cancelBtn.classList.toggle('hidden', !busy)
  ui.changeFile.classList.toggle('pointer-events-none', busy)
  ui.changeFile.classList.toggle('opacity-50', busy)
  ui.fileInput.disabled = busy
}

function hideResult() {
  ui.result.classList.add('hidden')
  ui.resultPreview.replaceChildren()
  revoke(state.resultURL)
  state.resultURL = null
}

function showResult({ blob, name }: ConversionResult, elapsedMs: number) {
  hideResult()
  const url = URL.createObjectURL(blob)
  state.resultURL = url

  ui.resultName.textContent = name
  ui.resultName.title = name
  const original = state.file?.size ?? 0
  const change = original ? Math.round((blob.size / original - 1) * 100) : 0
  const changeText = change === 0 ? 'tyle co oryginał' : change < 0 ? `${-change}% mniej niż oryginał` : `${change}% więcej niż oryginał`
  ui.resultMeta.textContent = `${formatBytes(blob.size)} · ${changeText} · ${(elapsedMs / 1000).toFixed(1).replace('.', ',')} s`

  if (blob.type.startsWith('image/')) {
    const img = new Image()
    img.src = url
    img.alt = `Podgląd: ${name}`
    img.className = 'mx-auto max-h-80 rounded-lg object-contain'
    const frame = document.createElement('div')
    frame.className = 'checker rounded-xl p-3'
    frame.append(img)
    ui.resultPreview.replaceChildren(frame)
  } else if (blob.type.startsWith('audio/')) {
    const audio = document.createElement('audio')
    audio.controls = true
    audio.src = url
    audio.className = 'w-full'
    ui.resultPreview.replaceChildren(audio)
  }

  ui.downloadBtn.href = url
  ui.downloadBtn.download = name
  ui.result.classList.remove('hidden')
  ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

async function startConversion() {
  const { file, detected, target } = state
  if (!file || !detected || !target || state.controller) return

  showNotice(null)
  hideResult()
  const controller = new AbortController()
  state.controller = controller
  setBusy(true)
  const startedAt = performance.now()
  startElapsed(startedAt)
  showProgress({ stage: 'Przygotowanie', ratio: null })

  try {
    const result = await convert({
      file,
      detected,
      target,
      settings: { ...state.settings },
      mediaDuration: state.mediaDuration,
      onProgress: showProgress,
      signal: controller.signal,
    })
    if (state.file === file) showResult(result, performance.now() - startedAt)
  } catch (error) {
    if (isAbort(error)) showNotice('Konwersja została przerwana.', 'info')
    else showNotice(error instanceof Error ? error.message : String(error))
    console.error(error)
  } finally {
    window.clearInterval(elapsedTimer)
    state.controller = null
    setBusy(false)
    hideProgress()
    updateEngineStatus()
    renderOptions()
  }
}

ui.convertBtn.addEventListener('click', () => void startConversion())
ui.cancelBtn.addEventListener('click', () => state.controller?.abort())

/* ---------- Drag & drop, wybór pliku, schowek ---------- */

ui.fileInput.accept = `${ACCEPT},image/*,video/*,audio/*`
ui.fileInput.addEventListener('change', () => {
  const file = ui.fileInput.files?.[0]
  ui.fileInput.value = ''
  if (file) void loadFile(file)
})

ui.dropzone.tabIndex = 0
ui.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    ui.fileInput.click()
  }
})

let dragDepth = 0
const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false

function setDragActive(active: boolean) {
  const workspaceVisible = !ui.workspace.classList.contains('hidden')
  ui.dropOverlay.classList.toggle('hidden', !(active && workspaceVisible))
  ui.dropOverlay.classList.toggle('grid', active && workspaceVisible)
  ui.dropzone.toggleAttribute('data-active', active && !workspaceVisible)
}

window.addEventListener('dragenter', (event) => {
  if (!carriesFiles(event) || state.controller) return
  event.preventDefault()
  dragDepth++
  setDragActive(true)
})
window.addEventListener('dragover', (event) => {
  if (!carriesFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = state.controller ? 'none' : 'copy'
})
window.addEventListener('dragleave', (event) => {
  if (!carriesFiles(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) setDragActive(false)
})
window.addEventListener('drop', (event) => {
  if (!carriesFiles(event)) return
  event.preventDefault()
  dragDepth = 0
  setDragActive(false)
  const file = event.dataTransfer?.files[0]
  if (file) void loadFile(file)
})

window.addEventListener('paste', (event) => {
  const file = event.clipboardData?.files[0]
  if (!file) return
  event.preventDefault()
  void loadFile(file)
})

/* ---------- Status silnika i motyw ---------- */

function updateEngineStatus() {
  ui.engineStatus.textContent =
    currentMode() === 'mt'
      ? `Tryb wielowątkowy (${navigator.hardwareConcurrency || '?'} wątków, SharedArrayBuffer aktywny).`
      : window.crossOriginIsolated
        ? 'Tryb jednowątkowy.'
        : 'Tryb jednowątkowy – brak izolacji cross-origin.'
}

updateEngineStatus()
initThemeToggle(ui.themeToggle)
