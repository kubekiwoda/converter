import { runFFmpeg } from './ffmpeg.ts'
import { TARGETS, baseName, type DetectedFile, type TargetId } from './formats.ts'
import { canvasEncodesWebp, convertImage } from './image.ts'
import type { ImageMime, ProgressCallback } from './types.ts'
import { clamp } from './utils.ts'

export interface Settings {
  /** Jakość JPG/WEBP, 1–100. */
  quality: number
  /** Bitrate MP3 w kb/s. */
  bitrate: number
  gifStart: number
  gifDuration: number
  gifFps: number
  gifWidth: number
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 90,
  bitrate: 192,
  gifStart: 0,
  gifDuration: 5,
  gifFps: 12,
  gifWidth: 480,
}

export const GIF_MAX_DURATION = 30

export interface ConversionRequest {
  file: File
  detected: DetectedFile
  target: TargetId
  settings: Settings
  /** Długość nagrania w sekundach (z metadanych elementu <video>/<audio>), jeśli znana. */
  mediaDuration?: number
  onProgress: ProgressCallback
  signal: AbortSignal
}

export interface ConversionResult {
  blob: Blob
  name: string
}

/** Okno fragmentu do GIF-a, przycięte do długości nagrania. */
export function gifClip(settings: Settings, mediaDuration?: number): { start: number; length: number } {
  const start = Math.max(0, settings.gifStart)
  let length = clamp(settings.gifDuration, 0.5, GIF_MAX_DURATION)
  if (mediaDuration && Number.isFinite(mediaDuration)) length = Math.min(length, mediaDuration - start)
  return { start, length }
}

const seconds = (value: number) => value.toFixed(3)

export async function convert(request: ConversionRequest): Promise<ConversionResult> {
  const { file, detected, target, settings, onProgress, signal } = request
  const format = TARGETS[target]
  const name = `${baseName(file.name)}.${format.ext}`

  if (detected.category === 'image') {
    if (target === 'webp' && !canvasEncodesWebp()) {
      const blob = await runFFmpeg({
        file,
        args: (input, output) => ['-i', input, '-frames:v', '1', '-c:v', 'libwebp', '-quality', String(settings.quality), output],
        output: 'out.webp',
        mime: format.mime,
        stage: 'Kodowanie WEBP (libwebp)',
        onProgress,
        signal,
      })
      return { blob, name }
    }
    const { blob } = await convertImage(
      { file, mime: format.mime as ImageMime, quality: settings.quality / 100 },
      onProgress,
      signal,
    )
    return { blob, name }
  }

  if (target === 'gif') {
    const { start, length } = gifClip(settings, request.mediaDuration)
    if (length <= 0) throw new Error('Początek fragmentu wypada za końcem nagrania.')

    const width = Math.round(settings.gifWidth)
    const fps = clamp(Math.round(settings.gifFps), 1, 30)
    // Paleta liczona z całego fragmentu (palettegen) daje dużo lepszą jakość niż stała paleta.
    // Trzecia gałąź [c] trafia do wyjścia „null” – dzięki niej FFmpeg raportuje postęp
    // już w trakcie analizy klatek, a nie dopiero przy zapisie GIF-a.
    const graph = [
      `[0:v]fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split=3[a][b][c]`,
      '[a]palettegen=stats_mode=diff[p]',
      '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[g]',
    ].join(';')

    const blob = await runFFmpeg({
      file,
      args: (input, output) => [
        '-ss', seconds(start),
        '-t', seconds(length),
        '-i', input,
        '-filter_complex', graph,
        '-map', '[g]', '-loop', '0', output,
        '-map', '[c]', '-f', 'null', '-',
      ],
      output: 'out.gif',
      mime: format.mime,
      duration: length,
      frames: Math.max(1, Math.round(length * fps)),
      stage: 'Generowanie animacji GIF',
      onProgress,
      signal,
    })
    return { blob, name }
  }

  const codec =
    target === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', `${settings.bitrate}k`] : ['-c:a', 'pcm_s16le']
  const blob = await runFFmpeg({
    file,
    args: (input, output) => ['-i', input, '-map', '0:a:0', '-vn', ...codec, output],
    output: `out.${format.ext}`,
    mime: format.mime,
    duration: request.mediaDuration,
    stage: detected.category === 'video' ? `Wyodrębnianie audio do ${format.label}` : `Konwersja audio do ${format.label}`,
    onProgress,
    signal,
  })
  return { blob, name }
}
