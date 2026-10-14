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

test('at home a header drops the machine and carries the account; elsewhere it keeps the machine', async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'fleetHome', 'x1pro-1');
  const entries = [
    { pane: 'w1:p1', workspace: 'w1', acct: 'cw' },
    { pane: 'w2:p1', workspace: 'w2', acct: 'cl' },
    { pane: 'w2:p2', workspace: 'w2', acct: 'cw2' },
  ];
  const labels = new Map([['w1', 'axi-onboarding'], ['w2', 'revoxy']]);
  for (const [machine, host] of [['x1pro-1', ''], ['mini-1', ' (mini-1)']]) {
    t.mock.property(config, 'machineLabel', machine);
    const writes = capture(t);
    await state.writeGroups('src', entries, labels, new Set(), {
      rollups: new Map([['w1', '■1']]),
      familyOf: (ws) => ws,
    });
    assert.equal(writes.get('w1:p1').group, `axi-onboarding cw${host}  ■1`);
    assert.equal(writes.get('w2:p1').group, `revoxy cl${host}`);
    // the header carries the head's account; line 2 carries it only where no header does
    assert.equal(writes.get('w1:p1').acct_row, null);
    assert.equal(writes.get('w2:p2').acct_row, 'cw2');
    t.mock.restoreAll();
  }
});

test("the services header carries no account, so each role row keeps its own on line 2", async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'machineLabel', 'x1pro-1');
  t.mock.property(config, 'fleetHome', 'x1pro-1');
  const writes = capture(t);
  await state.writeGroups('src', [{ pane: 'w5:p1', workspace: 'w5', acct: 'cl' }], new Map([['w5', 'mgr']]), new Set(), {
    services: new Set(['w5']),
  });
  assert.equal(writes.get('w5:p1').group, 'SERVICES · x1pro-1');
  assert.equal(writes.get('w5:p1').acct_row, 'cl');
});

test('a worktree header carries its account too; its branch tag rides the work row', async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'machineLabel', 'x1pro-1');
  t.mock.property(config, 'fleetHome', 'x1pro-1');
  t.mock.property(config, 'worktreeMark', '⑂');
  const writes = capture(t);
  await state.writeGroups(
    'src',
    [
      { pane: 'w1:p1', workspace: 'w1', acct: 'cl' },
      { pane: 'w2:p1', workspace: 'w2', acct: 'cw', branchTag: '⑂ fix/radar' },
    ],
    new Map([['w1', 'sb-herdr-manager'], ['w2', 'feat-x']]),
    new Set(),
    { parentOf: new Map([['w2', 'w1']]) },
  );
  assert.ok(writes.get('w2:p1').group.endsWith('feat-x cw'), writes.get('w2:p1').group);
  assert.equal(writes.get('w2:p1').work_branch, '⑂ fix/radar');
  assert.equal(writes.get('w1:p1').work_branch, null);
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

test('a branch tag only for a session with work on its row and off main, cut to 12', async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'worktreeMark', '⑂');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-rows-'));
  fs.mkdirSync(path.join(repo, '.git'));
  const head = (ref) => fs.writeFileSync(path.join(repo, '.git', 'HEAD'), `ref: refs/heads/${ref}\n`);
  const tagOf = async (tokens) => {
    t.mock.method(herdr, 'agentsAsync', async () => [agent(tokens, { cwd: repo, foreground_cwd: repo })]);
    const [entry] = await state.snapshot();
    return entry.branchTag;
  };
  head('feat/radar-agent-rows');
  assert.equal(await tagOf({ work_ok: 'YIR-1 · no PR', acct: 'cw' }), '⑂ feat/radar-…');
  assert.equal(await tagOf({}), null, 'no ticket, no line 3: no tag');
  head('fix/radar');
  assert.equal(await tagOf({ work_red: 'YIR-1 · PR #2 · CI ✗' }), '⑂ fix/radar');
  head('main');
  assert.equal(await tagOf({ work_ok: 'YIR-1 · no PR' }), null);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('the managed block: the account cell is the row cell, the work row has the branch, an old block is stale', () => {
  const block = managed.sidebarBlock('dark');
  assert.ok(block.includes('"$acct_row"'));
  assert.ok(!block.includes('"$acct"'));
  assert.ok(block.includes('"$work_branch"'));
  assert.equal(managed.fleetStale(block.replaceAll('$acct_row', '$acct'), true), true);
});
