/**
 * Magic-byte validation for uploads. The seed/snapshot routes hold uploaded
 * bytes in room memory, so an unvalidated upload lets a client pin arbitrary
 * bytes (MAX_ROOMS × MAX_UPLOAD_BYTES of RSS). Cheap leading-signature checks
 * reject the obvious garbage without unzipping anything server-side.
 */

/**
 * True when `buf` starts with a ZIP local-file / empty / spanned signature —
 * i.e. an OOXML container (.xlsx / .docx / .pptx are all zips).
 *   PK\x03\x04  local file header
 *   PK\x05\x06  empty archive
 *   PK\x07\x08  spanned archive
 */
export function isZipContainer(buf: Uint8Array): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 && // 'P'
    buf[1] === 0x4b && // 'K'
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
    (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)
  );
}

/** True when `buf` starts with the gzip magic (`1f 8b`). */
export function isGzip(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}
