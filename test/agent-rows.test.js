'use strict';

// The fleet view's agent rows, round 2 (the CEO, 2026-10-14 ~07:14Z, to the
// manager's proposals: "1. agree 2. ok 3. ok 4. ok 5. ok 6. no ... 7. skip"):
// no machine name at home, the account on the header, the agent's own report
// for a title, and a branch tag on the work row of a session off main.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require('../lib/config');
const herdr = require('../lib/herdr');
const state = require('../lib/state');
const managed = require('../lib/managed-config');

function capture(t) {
  const writes = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.set(pane, { ...(writes.get(pane) ?? {}), ...tokens });
    return true;
  });
  return writes;
}

test('at home a header drops the machine and carries the ticket; elsewhere it keeps the machine', async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'fleetHome', 'x1pro-1');
  const entries = [
    { pane: 'w1:p1', workspace: 'w1', work: { tier: 'ok', key: 'YIR-1', rest: '' } },
    { pane: 'w2:p1', workspace: 'w2', work: { tier: 'ok', key: 'YIR-2', rest: 'PR #3 · CI ✓' } },
    { pane: 'w2:p2', workspace: 'w2', work: null },
  ];
  const labels = new Map([['w1', 'axi-onboarding'], ['w2', 'revoxy']]);
  for (const [machine, host] of [['x1pro-1', ''], ['mini-1', ' (mini-1)']]) {
    t.mock.property(config, 'machineLabel', machine);
    const writes = capture(t);
    await state.writeGroups('src', entries, labels, new Set(), {
      rollups: new Map([['w1', '■1']]),
      familyOf: (ws) => ws,
    });
    assert.equal(writes.get('w1:p1').group, `axi-onboarding YIR-1${host}  ■1`);
    assert.equal(writes.get('w2:p1').group, `revoxy YIR-2${host}`);
    // line 2's account is the frame's (fleetJobs), not the header writer's
    assert.ok(!('acct_row' in writes.get('w1:p1')));
    t.mock.restoreAll();
  }
});

test('the services header carries no account', async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'machineLabel', 'x1pro-1');
  t.mock.property(config, 'fleetHome', 'x1pro-1');
  const writes = capture(t);
  await state.writeGroups('src', [{ pane: 'w5:p1', workspace: 'w5', acct: 'cl' }], new Map([['w5', 'mgr']]), new Set(), {
    services: new Set(['w5']),
  });
  assert.equal(writes.get('w5:p1').group, 'SERVICES · x1pro-1');
});

test('a worktree header carries its ticket; the PR and CI ride the work row, and `no PR` draws nothing', async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'machineLabel', 'x1pro-1');
  t.mock.property(config, 'fleetHome', 'x1pro-1');
  t.mock.property(config, 'worktreeMark', '⑂');
  const writes = capture(t);
  await state.writeGroups(
    'src',
    [
      { pane: 'w1:p1', workspace: 'w1', work: { tier: 'ok', key: 'YIR-1', rest: '' } },
      { pane: 'w2:p1', workspace: 'w2', work: { tier: 'red', key: 'YIR-2', rest: 'PR #3 · CI ✗' } },
    ],
    new Map([['w1', 'sb-herdr-manager'], ['w2', 'feat-x']]),
    new Set(),
    { parentOf: new Map([['w2', 'w1']]) },
  );
  assert.ok(writes.get('w2:p1').group.endsWith('feat-x YIR-2'), writes.get('w2:p1').group);
  assert.deepEqual(
    [writes.get('w2:p1').pr_ok, writes.get('w2:p1').pr_wait, writes.get('w2:p1').pr_red],
    [null, null, 'PR #3 · CI ✗'],
  );
  assert.deepEqual([writes.get('w1:p1').pr_ok, writes.get('w1:p1').pr_wait, writes.get('w1:p1').pr_red], [null, null, null]);
  assert.ok(!('work_branch' in writes.get('w2:p1')));
});

test('without the fleet view the header is upstream: no account, no machine, nothing new written', async (t) => {
  t.mock.property(config, 'fleetView', false);
  const writes = capture(t);
  await state.writeGroups('src', [{ pane: 'w1:p1', workspace: 'w1', acct: 'cw' }], new Map([['w1', 'repo']]));
  assert.equal(writes.get('w1:p1').group, 'repo');
  assert.ok(!('acct_row' in writes.get('w1:p1')));
});

function agent(tokens, extra = {}) {
  return {
    pane_id: 'w1:p1',
    agent_status: 'idle',
    agent: 'claude',
    terminal_title_stripped: 'Auto title',
    tokens,
    ...extra,
  };
}

test("the title is the agent's report, else its ticket's title, else the terminal's", async (t) => {
  t.mock.property(config, 'fleetView', true);
  for (const [tokens, want] of [
    [{ hm_report: 'waiting on CEO: UPS', work_title: 'Rotate the key' }, 'waiting on CEO: UPS'],
    [{ work_title: 'Rotate the key' }, 'Rotate the key'],
    [{}, 'Auto title'],
  ]) {
    t.mock.method(herdr, 'agentsAsync', async () => [agent(tokens)]);
    const [entry] = await state.snapshot();
    assert.equal(entry.title, want);
    assert.equal(entry.acct, null);
    t.mock.restoreAll();
    t.mock.property(config, 'fleetView', true);
  }
});

test('the snapshot splits the lane work into its ticket and what is left, `no PR` being nothing', async (t) => {
  t.mock.property(config, 'fleetView', true);
  const workOf = async (tokens) => {
    t.mock.method(herdr, 'agentsAsync', async () => [agent(tokens)]);
    const [entry] = await state.snapshot();
    t.mock.restoreAll();
    t.mock.property(config, 'fleetView', true);
    return entry.work;
  };
  assert.deepEqual(await workOf({ work_ok: 'YIR-1 · no PR', acct: 'cw' }), { tier: 'ok', key: 'YIR-1', rest: '' });
  assert.deepEqual(await workOf({ work_wait: 'YIR-1 · PR #2 draft · CI …' }), { tier: 'wait', key: 'YIR-1', rest: 'PR #2 draft · CI …' });
  assert.deepEqual(await workOf({ work_red: 'YIR-1 · PR #2 · CI ✗' }), { tier: 'red', key: 'YIR-1', rest: 'PR #2 · CI ✗' });
  assert.equal(await workOf({}), null, 'no ticket, no work');
});

test('the managed block: the account cell is the row cell, the work row has the PR and CI and no branch, an old block is stale', () => {
  const block = managed.sidebarBlock('dark');
  assert.ok(block.includes('"$acct_row"'));
  for (const tier of ['ok', 'near', 'over']) {
    assert.ok(block.includes(`"$size_${tier}"`), tier);
    assert.ok(!block.includes(`"$ctx_${tier}"`), tier);
  }
  assert.equal(managed.fleetStale(block.replaceAll('$size_', '$ctx_'), true), true, 'a block from before the packing is stale');
  assert.ok(!block.includes('"$acct"'));
  assert.ok(block.includes('"$pr_ok"') && !block.includes('$work_branch'));
  assert.equal(managed.fleetStale(block.replaceAll('$acct_row', '$acct'), true), true);
});

// Item 8 (the CEO, 2026-10-14 ~08:1xZ, manager pane: "item8 b"): the size and the
// account share one cell, so Herdr draws no ` · ` between them.
test("the snapshot reads the size and its tier from the supervisor's ctx names", async (t) => {
  t.mock.property(config, 'fleetView', true);
  for (const [tokens, want] of [
    [{ ctx_near: '186k' }, { tier: 'near', size: '186k' }],
    [{ ctx_over: '240k', ctx_ok: '' }, { tier: 'over', size: '240k' }],
    [{}, null],
  ]) {
    t.mock.method(herdr, 'agentsAsync', async () => [agent(tokens)]);
    const [entry] = await state.snapshot();
    assert.deepEqual(entry.ctx, want);
  }
});

test('the size cell packs the account where no header carries it; with no size the account stands alone', () => {
  const sized = { acct: 'cl', ctx: { tier: 'near', size: '186k' } };
  assert.deepEqual(state.sizeTokens(sized, true), { acct_row: null, size_ok: null, size_near: '186k cl', size_over: null });
  assert.deepEqual(state.sizeTokens(sized, false), { acct_row: null, size_ok: null, size_near: '186k', size_over: null });
  assert.deepEqual(state.sizeTokens({ acct: 'cw2', ctx: null }, true), { acct_row: 'cw2', size_ok: null, size_near: null, size_over: null });
  assert.deepEqual(state.sizeTokens({ acct: 'cw2', ctx: null }, false).acct_row, null);
  assert.deepEqual(state.sizeTokens({ acct: null, ctx: { tier: 'ok', size: '40k' } }, true).size_ok, '40k');
});

test('fleetJobs writes the packed cell, and rewrites it when the size moves', async (t) => {
  t.mock.property(config, 'fleetView', true);
  const { Frame } = require('../lib/frame');
  const frame = new Frame('test');
  const writes = capture(t);
  const entry = { pane: 'w5:p2', workspace: 'w5', fleet: '8|role|builder', acct: 'cw2', ctx: { tier: 'ok', size: '90k' } };
  const run = async (withAcct) => {
    const jobs = [];
    frame.fleetJobs(entry, 'idle', Date.now(), [], jobs, null, '', withAcct);
    await Promise.all(jobs);
    return jobs.length;
  };
  await run(true);
  assert.equal(writes.get('w5:p2').size_ok, '90k cw2');
  assert.equal(writes.get('w5:p2').acct_row, null);
  assert.equal(await run(true), 0, 'nothing moved, nothing written');
  entry.ctx = { tier: 'over', size: '235k' };
  await run(true);
  assert.equal(writes.get('w5:p2').size_ok, null);
  assert.equal(writes.get('w5:p2').size_over, '235k cw2');
});
