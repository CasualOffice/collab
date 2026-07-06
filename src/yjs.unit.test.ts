/**
 * Unit test for `anonymousJoinReadOnly` — the anonymous (no share-token)
 * privilege gate that `onAuthenticate` applies for `?role=` joins.
 *
 * Regression guard for the security bug where only `?role=view` was
 * gated, so a `?role=comment` link (handed out by the share dialog)
 * fell through to WRITE and a comment-link holder could edit. The gate
 * must mirror the authoritative token path (`resolveJoinRole`): anything
 * short of an explicit write role is read-only.
 *
 * Run with `bun run test`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { anonymousJoinReadOnly } from './yjs.js';

test('comment role is read-only, not write (security)', () => {
  assert.equal(anonymousJoinReadOnly('comment'), true);
});

test('view role is read-only', () => {
  assert.equal(anonymousJoinReadOnly('view'), true);
});

test('unknown / absent role defaults to read-only', () => {
  assert.equal(anonymousJoinReadOnly('reviewer'), true);
  assert.equal(anonymousJoinReadOnly(null), true);
  assert.equal(anonymousJoinReadOnly(undefined), true);
  assert.equal(anonymousJoinReadOnly(''), true);
});

test('explicit write roles grant write access', () => {
  assert.equal(anonymousJoinReadOnly('edit'), false);
  assert.equal(anonymousJoinReadOnly('write'), false);
});
