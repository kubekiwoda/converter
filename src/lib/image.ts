import type { ImageJob, ImageWorkerMessage, ProgressCallback } from './types.ts'
import { AbortedError } from './utils.ts'

let webpEncoding: boolean | undefined

/** Safari (i starsze przeglądarki) nie kodują WEBP w canvasie – wtedy używamy FFmpeg (libwebp). */
export function canvasEncodesWebp(): boolean {
  if (webpEncoding === undefined) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    webpEncoding = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  }
  return webpEncoding
}

export interface ImageResult {
  blob: Blob
  width: number
  height: number
}

/** Konwertuje obraz w osobnym wątku (OffscreenCanvas + gifenc), żeby nie blokować interfejsu. */
export function convertImage(job: ImageJob, onProgress: ProgressCallback, signal: AbortSignal): Promise<ImageResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError())

    const worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module' })
    const finish = () => {
      worker.terminate()
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      finish()
      reject(new AbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = ({ data }: MessageEvent<ImageWorkerMessage>) => {
      if (data.type === 'progress') {
        onProgress({ stage: data.stage, ratio: data.ratio })
      } else if (data.type === 'done') {
        finish()
        resolve({ blob: data.blob, width: data.width, height: data.height })
      } else {
        finish()
        reject(new Error(data.message))
      }
    }
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'Wątek konwersji obrazu zakończył się błędem.'))
    }
    worker.postMessage(job)
  })
}
