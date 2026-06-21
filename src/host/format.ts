/**
 * File-format configuration for the storage + WOPI layer.
 *
 * The collab server is product-agnostic: it stores opaque OOXML bytes
 * and relays Yjs updates. The only product-specific detail is the file
 * format, which each deployment selects via env so storage keys,
 * download Content-Types, and default filenames match the product:
 *
 *   docs   → CASUAL_FILE_EXT=.docx  (wordprocessingml.document)
 *   sheets → CASUAL_FILE_EXT=.xlsx  (spreadsheetml.sheet)  [default]
 *
 * Override the MIME explicitly with CASUAL_FILE_CONTENT_TYPE if needed.
 */
export interface FileFormat {
  /** File extension including the leading dot, e.g. ".docx". */
  ext: string;
  /** OOXML MIME type used for storage + download Content-Type. */
  contentType: string;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const DEFAULT_EXT = '.xlsx';

/** Resolve the active file format from the environment (read on demand). */
export function fileFormat(): FileFormat {
  const raw = (process.env.CASUAL_FILE_EXT ?? DEFAULT_EXT).trim().toLowerCase();
  const ext = raw.startsWith('.') ? raw : `.${raw}`;
  const contentType =
    process.env.CASUAL_FILE_CONTENT_TYPE ??
    CONTENT_TYPE_BY_EXT[ext] ??
    CONTENT_TYPE_BY_EXT[DEFAULT_EXT];
  return { ext, contentType };
}
