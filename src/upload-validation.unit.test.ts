import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isZipContainer, isGzip } from './upload-validation.js';

test('isZipContainer accepts OOXML/zip signatures', () => {
  assert.equal(isZipContainer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])), true); // local file
  assert.equal(isZipContainer(new Uint8Array([0x50, 0x4b, 0x05, 0x06])), true); // empty archive
  assert.equal(isZipContainer(new Uint8Array([0x50, 0x4b, 0x07, 0x08])), true); // spanned
});

test('isZipContainer rejects non-zip / short / garbage bytes', () => {
  assert.equal(isZipContainer(new Uint8Array([0x00, 0x01, 0x02, 0x03])), false);
  assert.equal(isZipContainer(new Uint8Array([0x50, 0x4b])), false); // too short
  assert.equal(isZipContainer(new Uint8Array([0x50, 0x4b, 0x01, 0x02])), false); // central dir, not a file start
  assert.equal(isZipContainer(new Uint8Array(0)), false);
});

test('isGzip accepts the gzip magic and rejects others', () => {
  assert.equal(isGzip(new Uint8Array([0x1f, 0x8b, 0x08])), true);
  assert.equal(isGzip(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), false);
  assert.equal(isGzip(new Uint8Array([0x1f])), false);
});
