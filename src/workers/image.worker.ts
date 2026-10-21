import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import type { ImageJob, ImageWorkerMessage } from '../lib/types.ts'

const post = (message: ImageWorkerMessage) => self.postMessage(message)
const progress = (stage: string, ratio: number) => post({ type: 'progress', stage, ratio })

function encodeGif(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): Blob {
  const { data } = ctx.getImageData(0, 0, width, height)

  let hasAlpha = false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) {
      hasAlpha = true
      break
    }
  }

  progress('Budowanie palety 256 kolorów', 0.35)
  const format = hasAlpha ? 'rgba4444' : 'rgb565'
  const palette = quantize(data, 256, { format, oneBitAlpha: hasAlpha })

  progress('Mapowanie pikseli na paletę', 0.6)
  const index = applyPalette(data, palette, format)

  progress('Kodowanie GIF (LZW)', 0.8)
  const transparentIndex = hasAlpha ? palette.findIndex((color) => color[3] === 0) : -1
  const gif = GIFEncoder()
  gif.writeFrame(index, width, height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
  })
  gif.finish()
  return new Blob([gif.bytes()], { type: 'image/gif' })
}

async function convert({ file, mime, quality }: ImageJob): Promise<void> {
  progress('Dekodowanie obrazu', 0.05)
  // Dla GIF/WEBP animowanych przeglądarka zwraca pierwszą klatkę.
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap

  progress('Rysowanie na płótnie', 0.25)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: mime === 'image/gif' })
  if (!ctx) throw new Error('Przeglądarka nie udostępniła kontekstu 2D.')

  if (mime === 'image/jpeg') {
    // JPG nie ma kanału alfa – przezroczystość zamieniamy na białe tło.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  let blob: Blob
  if (mime === 'image/gif') {
    blob = encodeGif(ctx, width, height)
  } else {
    progress(`Kodowanie ${mime === 'image/jpeg' ? 'JPG' : mime.slice(6).toUpperCase()}`, 0.5)
    blob = await canvas.convertToBlob({ type: mime, quality })
    if (blob.type !== mime) {
      throw new Error(`Ta przeglądarka nie potrafi zakodować formatu ${mime}.`)
    }
  }

  progress('Gotowe', 1)
  post({ type: 'done', blob, width, height })
}

self.onmessage = (event: MessageEvent<ImageJob>) => {
  convert(event.data).catch((error: unknown) => {
    const message =
      error instanceof Error && error.name === 'InvalidStateError'
        ? 'Nie udało się zdekodować obrazu – plik jest uszkodzony lub w nieobsługiwanym formacie.'
        : error instanceof Error
          ? error.message
          : String(error)
    post({ type: 'error', message })
  })
}
