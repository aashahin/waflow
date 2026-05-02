// ---------------------------------------------------------------------------
// Media operation types
// ---------------------------------------------------------------------------

/** Input for uploading media to the provider */
export interface MediaUpload {
  /** File content as Uint8Array, Blob, or ReadableStream */
  file: Uint8Array | Blob | ReadableStream<Uint8Array>
  /** MIME type (e.g. "image/png", "application/pdf") */
  mimeType: string
  /** Optional filename */
  filename?: string
}

/** Result from a successful media upload */
export interface MediaUploadResult {
  /** Provider-assigned media ID */
  id: string
}

/** Result from getting a media URL */
export interface MediaUrlResult {
  /** Download URL */
  url: string
  /** MIME type (when available) */
  mimeType?: string
  /** SHA-256 hash (when available) */
  sha256?: string
  /** File size in bytes (when available) */
  fileSize?: number
  /** When this URL expires (when available) */
  expiresAt?: Date
}

/** Result from downloading media — stream-based for memory efficiency */
export interface MediaDownloadResult {
  /** ReadableStream for piping to storage (R2, S3, disk) */
  stream: ReadableStream<Uint8Array>
  /** MIME type of the downloaded content */
  mimeType: string
  /** Content length in bytes (when available from headers) */
  contentLength?: number
}
