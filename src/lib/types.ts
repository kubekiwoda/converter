export interface ProgressUpdate {
  /** Nazwa etapu, np. „Dekodowanie obrazu”. */
  stage: string
  /** 0–1, albo `null` gdy postęp jest nieokreślony. */
  ratio: number | null
  /** Dodatkowa informacja, np. „12,3 / 31,0 MB”. */
  detail?: string
}

export type ProgressCallback = (update: ProgressUpdate) => void

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ImageJob {
  file: File
  mime: ImageMime
  /** Jakość 0–1 dla JPG/WEBP. */
  quality: number
}

export type ImageWorkerMessage =
  | { type: 'progress'; stage: string; ratio: number }
  | { type: 'done'; blob: Blob; width: number; height: number }
  | { type: 'error'; message: string }
