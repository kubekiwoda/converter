export type Category = 'image' | 'video' | 'audio'

export type TargetId = 'png' | 'jpg' | 'webp' | 'gif' | 'mp3' | 'wav'

export interface TargetFormat {
  id: TargetId
  label: string
  ext: string
  mime: string
  /** Krótki opis pokazywany pod nazwą formatu, zależny od kategorii źródła. */
  hint: Partial<Record<Category, string>>
}

export const TARGETS: Record<TargetId, TargetFormat> = {
  png: { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png', hint: { image: 'Bezstratny, z przezroczystością' } },
  jpg: { id: 'jpg', label: 'JPG', ext: 'jpg', mime: 'image/jpeg', hint: { image: 'Mały plik, zdjęcia' } },
  webp: { id: 'webp', label: 'WEBP', ext: 'webp', mime: 'image/webp', hint: { image: 'Nowoczesny, najmniejszy' } },
  gif: {
    id: 'gif',
    label: 'GIF',
    ext: 'gif',
    mime: 'image/gif',
    hint: { image: 'Paleta 256 kolorów', video: 'Animacja z fragmentu' },
  },
  mp3: {
    id: 'mp3',
    label: 'MP3',
    ext: 'mp3',
    mime: 'audio/mpeg',
    hint: { video: 'Ścieżka audio, kompresja', audio: 'Uniwersalny, kompresja' },
  },
  wav: {
    id: 'wav',
    label: 'WAV',
    ext: 'wav',
    mime: 'audio/wav',
    hint: { video: 'Ścieżka audio, bezstratnie', audio: 'Bezstratny PCM 16-bit' },
  },
}

const CATEGORY_TARGETS: Record<Category, TargetId[]> = {
  image: ['png', 'jpg', 'webp', 'gif'],
  video: ['mp3', 'wav', 'gif'],
  audio: ['mp3', 'wav'],
}

const EXTENSIONS: Record<Category, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', '3gp', 'ogv', 'mpg', 'mpeg', 'ts', 'mts', 'flv', 'wmv'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba', 'wma'],
}

/** Rozszerzenia źródłowe, które odpowiadają formatowi docelowemu (żeby nie proponować PNG → PNG). */
const SAME_FORMAT: Partial<Record<string, TargetId>> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  jfif: 'jpg',
  webp: 'webp',
  gif: 'gif',
  mp3: 'mp3',
  wav: 'wav',
}

export const ACCEPT = Object.values(EXTENSIONS)
  .flat()
  .map((ext) => `.${ext}`)
  .join(',')

export interface DetectedFile {
  category: Category
  /** Rozpoznany format źródła, np. `png`, `mp4`, `mkv`. */
  format: string
  targets: TargetId[]
}

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end))

/** Rozpoznaje format po sygnaturze pliku (magic bytes). */
function sniff(bytes: Uint8Array): { category: Category; format: string } | null {
  const b = (i: number) => bytes[i] ?? -1

  if (b(0) === 0x89 && ascii(bytes, 1, 4) === 'PNG') return { category: 'image', format: 'png' }
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { category: 'image', format: 'jpg' }
  if (ascii(bytes, 0, 4) === 'GIF8') return { category: 'image', format: 'gif' }

  if (ascii(bytes, 0, 4) === 'RIFF') {
    const kind = ascii(bytes, 8, 12)
    if (kind === 'WEBP') return { category: 'image', format: 'webp' }
    if (kind === 'WAVE') return { category: 'audio', format: 'wav' }
    if (kind === 'AVI ') return { category: 'video', format: 'avi' }
  }

  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12)
    if (brand.startsWith('M4A') || brand.startsWith('M4B')) return { category: 'audio', format: 'm4a' }
    if (brand === 'qt  ') return { category: 'video', format: 'mov' }
    return { category: 'video', format: 'mp4' }
  }

  if (b(0) === 0x1a && b(1) === 0x45 && b(2) === 0xdf && b(3) === 0xa3) return { category: 'video', format: 'mkv' }
  if (ascii(bytes, 0, 4) === 'OggS') return { category: 'audio', format: 'ogg' }
  if (ascii(bytes, 0, 4) === 'fLaC') return { category: 'audio', format: 'flac' }
  if (ascii(bytes, 0, 3) === 'ID3') return { category: 'audio', format: 'mp3' }
  // Ramka MPEG audio / ADTS AAC: 11 bitów synchronizacji.
  if (b(0) === 0xff && (b(1) & 0xe0) === 0xe0) {
    return { category: 'audio', format: (b(1) & 0x06) === 0 ? 'aac' : 'mp3' }
  }
  return null
}

function categoryOfExtension(ext: string): Category | null {
  for (const [category, list] of Object.entries(EXTENSIONS) as [Category, string[]][]) {
    if (list.includes(ext)) return category
  }
  return null
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export async function detectFile(file: File): Promise<DetectedFile | null> {
  const ext = extensionOf(file.name)
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const sniffed = sniff(head)

  let category: Category | null
  let format = ext

  if (sniffed) {
    category = sniffed.category
    // Kontenery wspólne dla audio i wideo (MKV/WebM, Ogg, MP4) rozstrzygamy rozszerzeniem.
    const byExt = categoryOfExtension(ext)
    if (byExt && byExt !== 'image' && category !== 'image') category = byExt
    // Dla obrazów liczy się faktyczna zawartość, dla A/V rozszerzenie jest dokładniejsze (MOV vs MP4).
    format = category !== 'image' && byExt === category ? ext : sniffed.format
  } else {
    category = categoryOfExtension(ext)
    if (!category) {
      const mimeKind = file.type.split('/')[0]
      if (mimeKind === 'image' || mimeKind === 'video' || mimeKind === 'audio') {
        category = mimeKind
        format = file.type.split('/')[1] ?? ext
      }
    }
  }

  if (!category) return null
  const same = SAME_FORMAT[format]
  const targets = CATEGORY_TARGETS[category].filter((id) => id !== same)
  return { category, format: format || category, targets }
}
