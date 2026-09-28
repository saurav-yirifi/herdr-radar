'use strict';

// Grouping in the `grouped` order (YIR-551 part 1): worktrees of one repo whose
// parent checkout is not on the list ("orphans") are one family under ONE
// synthesised header. The fixture is the one the owner watched on the mini,
// 2026-09-27: two worktrees of axi-ai-wspace-app, the second the more recent,
// with an unrelated workspace whose activity falls between theirs.

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const herdr = require('../lib/herdr');
const state = require('../lib/state');
const { Frame } = require('../lib/frame');

const MIN = 60000;
const MARK = config.worktreeMark ? `${config.worktreeMark} ` : '';
const REPO = 'axi-ai-wspace-app';
const ENTRIES = [
  { pane: 'wD:p1', workspace: 'wD', tab: 'wD:t1' }, // feat-wspace-agents, older
  { pane: 'w9:p1', workspace: 'w9', tab: 'w9:t1' }, // an unrelated project, between
  { pane: 'wE:p1', workspace: 'wE', tab: 'wE:t1' }, // feat-view-trades, the most recent
];
const WORKTREES = new Map([
  ['wD', REPO],
  ['wE', REPO],
]);

function keysAt(now) {
  const frame = new Frame('test');
  frame.lastWorkingAt.set('wD:p1', now - 30 * MIN);
  frame.lastWorkingAt.set('w9:p1', now - 20 * MIN);
  frame.lastWorkingAt.set('wE:p1', now - 10 * MIN);
  return frame.sortKeys(ENTRIES, new Map(), WORKTREES);
}

test("two orphans of one repo rank as one family, contiguous, by the most recent one's activity", () => {
  const { wsKeys, orphanRepo } = keysAt(100_000 * MIN);
  const order = [...wsKeys].sort((a, b) => (a[1] > b[1] ? -1 : 1)).map(([ws]) => ws);
  assert.deepEqual(order, ['wE', 'wD', 'w9'], 'the unrelated project no longer sits between them');
  assert.deepEqual(
    [...orphanRepo],
    [
      ['wD', REPO],
      ['wE', REPO],
    ],
  );
});

test('two orphans of one repo draw ONE synthesised header, a tee then a corner', async (t) => {
  const writes = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.set(pane, tokens);
    return true;
  });
  const shown = [ENTRIES[2], ENTRIES[0], ENTRIES[1]]; // the order the panel draws
  const labels = new Map([
    ['wE', 'feat-view-trades'],
    ['wD', 'feat-wspace-agents'],
    ['w9', 'other'],
  ]);
  const { ok } = await state.writeGroups('test', shown, labels, new Set(), {
    parentOf: new Map(),
    orphanRepo: WORKTREES,
  });
  assert.equal(ok, true);
  const parents = [...writes]
    .filter(([, tokens]) => tokens.group_parent)
    .map(([pane, tokens]) => [pane, tokens.group_parent]);
  assert.deepEqual(parents, [['wE:p1', REPO]], 'one header, on the first worktree drawn');
  assert.equal(writes.get('wE:p1').group, `├─ ${MARK}feat-view-trades`);
  assert.equal(writes.get('wD:p1').group, `${state.INDENT}└─ ${MARK}feat-wspace-agents`);
  assert.equal(writes.get('wE:p1').gap, null, 'no spacer inside the family');
});

test('a lone orphan draws exactly as before: its repo row, then a corner', async (t) => {
  const writes = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.set(pane, tokens);
    return true;
  });
  await state.writeGroups('test', [ENTRIES[0]], new Map([['wD', 'feat-wspace-agents']]), new Set(), {
    parentOf: new Map(),
    orphanRepo: new Map([['wD', REPO]]),
  });
  assert.equal(writes.get('wD:p1').group_parent, REPO);
  assert.equal(writes.get('wD:p1').group, `└─ ${MARK}feat-wspace-agents`);
});
