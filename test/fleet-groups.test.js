'use strict';

// The fleet view's groups (YIR-551 parts 2-5): the `fleet` order keeps the
// workspace groups of `grouped`, a workspace of several panes draws as a tree,
// a window attached to several machines ranks them together without mixing
// two machines' same-id workspaces,
// and the spacer between groups is one row or none.

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const fleet = require('../lib/fleet');
const herdr = require('../lib/herdr');
const state = require('../lib/state');
const view = require('../lib/view');
const { Frame } = require('../lib/frame');

const minute = (m) => String(m).padStart(12, '0');
const own = (ws) => ws;

// Herdr's sort as radar predicts it everywhere else: each field in turn, a
// missing value last whatever the direction.
function herdrSort(rows, sort) {
  return [...rows].sort((a, b) => {
    for (const { field, order } of sort) {
      const x = a[field.token];
      const y = b[field.token];
      if (x === y) continue;
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return (x < y ? -1 : 1) * (order === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

function fleetOrder(rows, familyOf = own) {
  const keys = fleet.orderKeys(rows, familyOf);
  return Frame.prototype.fleetOrder(rows, keys).map((r) => r.pane);
}

test('an ask row in the second group lifts that whole group first', () => {
  const rows = [
    { pane: 'a1', workspace: 'A', rank: '4', minute: minute(100) },
    { pane: 'a2', workspace: 'A', rank: '5', minute: minute(90) },
    { pane: 'b1', workspace: 'B', rank: '5', minute: minute(50) },
    { pane: 'b2', workspace: 'B', rank: '1', minute: minute(40) },
  ];
  assert.deepEqual(fleetOrder(rows), ['b1', 'b2', 'a1', 'a2'], 'B leads, and each group stays together');
});

test('inside a group the head leads, then needs-you first, then activity; no stamp sinks', () => {
  const rows = [
    { pane: 'h', workspace: 'A', rank: '5', minute: minute(10) },
    { pane: 'late', workspace: 'A', rank: '4', minute: '000000000000' },
    { pane: 'recent', workspace: 'A', rank: '4', minute: minute(99) },
    { pane: 'asks', workspace: 'A', rank: '1', minute: minute(5) },
  ];
  assert.deepEqual(fleetOrder(rows), ['h', 'asks', 'recent', 'late']);
});

test('a worktree family stays together, the parent checkout first, placed by its most urgent member', () => {
  const rows = [
    { pane: 'p', workspace: 'P', rank: '5', minute: minute(10) },
    { pane: 'x', workspace: 'X', rank: '4', minute: minute(99) },
    { pane: 'c', workspace: 'C', rank: '1', minute: minute(20) },
  ];
  const familyOf = (ws) => (ws === 'C' ? 'P' : ws);
  assert.deepEqual(fleetOrder(rows, familyOf), ['p', 'c', 'x']);
});

test("the manager's workspace draws one header, the manager first, three nested rows", () => {
  // w4 in Herdr's layout order: the manager, then the trio's builder, the
  // executor and the dispatcher (role panes, rank 8); one other lane beside it.
  const entries = [
    { pane: 'w4:p1', workspace: 'w4', fleet: null, display: 'idle' },
    { pane: 'w4:p6', workspace: 'w4', fleet: null, display: 'working' },
    { pane: 'w4:p9', workspace: 'w4', fleet: '8|role|executor', display: 'idle' },
    { pane: 'w4:pB', workspace: 'w4', fleet: '8|role|dispatcher', display: 'idle' },
    { pane: 'w9:p1', workspace: 'w9', fleet: '5|idle', display: 'idle' },
  ];
  const minutes = { 'w4:p1': 90, 'w4:p6': 100, 'w4:p9': 80, 'w4:pB': 95, 'w9:p1': 10 };
  const rows = entries.map((e) => ({
    ...e,
    rank: fleet.view(e.display, e.fleet).rank,
    minute: minute(minutes[e.pane]),
  }));
  const shown = Frame.prototype.fleetOrder(rows, fleet.orderKeys(rows, own));
  assert.deepEqual(
    shown.map((e) => e.pane),
    ['w4:p1', 'w4:p6', 'w4:pB', 'w4:p9', 'w9:p1'],
  );
  const { heads } = state.groupBoundaries(shown);
  assert.deepEqual([...heads], ['w4:p1', 'w9:p1'], 'one header for w4, on the manager');
  assert.deepEqual(
    [...state.treeCorners(shown)],
    [
      ['w4:p6', '├─ '],
      ['w4:pB', '├─ '],
      ['w4:p9', '└─ '],
    ],
  );
});

test('a workspace of one pane gets no corner', () => {
  assert.equal(state.treeCorners([{ pane: 'w9:p1', workspace: 'w9' }]).size, 0);
});

// Two machines' rows as a window on the mini receives them: the keys each
// machine's own radar wrote. Both have a w4 at the same rank and minute, and
// MacBook 1's lane is the most urgent thing on either.
const MINI = [
  { pane: 'w4:p1', workspace: 'w4', rank: '4', minute: minute(100) },
  { pane: 'w4:p6', workspace: 'w4', rank: '4', minute: minute(90) },
  { pane: 'w9:p1', workspace: 'w9', rank: '5', minute: minute(80) },
];
const MAC1 = [
  { pane: 'w2:p1', workspace: 'w2', rank: '1', minute: minute(70) },
  { pane: 'w4:p2', workspace: 'w4', rank: '4', minute: minute(100) },
];
// Pane ids repeat across machines too, so each row keeps its machine as `m`.
const tokens = (rows, machine) => {
  const keys = fleet.orderKeys(rows, own, machine);
  return rows.map((r) => ({
    m: machine,
    pane: r.pane,
    fleet_ws_key: keys.wsKeys.get(r.workspace),
    fleet_row_key: keys.rowKeys.get(r.pane),
  }));
};

test("a window ranks every machine together, and two machines' w4 never interleave", () => {
  const shown = herdrSort([...tokens(MINI, 'mini'), ...tokens(MAC1, 'macbook')], view.sortFor('fleet'));
  assert.deepEqual(
    shown.map((r) => `${r.m}/${r.pane}`),
    ['macbook/w2:p1', 'macbook/w4:p2', 'mini/w4:p1', 'mini/w4:p6', 'mini/w9:p1'],
  );
});

test('no order sorts by machine first', () => {
  for (const mode of ['fleet', 'grouped', 'recent']) assert.deepEqual(view.sortFor(mode), view.SORTS[mode].sort);
});

test('the spacer between groups is one row, or none with group_gap = 0', async (t) => {
  const entries = [
    { pane: 'a1', workspace: 'A' },
    { pane: 'a2', workspace: 'A' },
    { pane: 'b1', workspace: 'B' },
  ];
  const writes = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.set(pane, tokens.gap);
    return true;
  });
  const saved = config.groupGap;
  t.after(() => {
    config.groupGap = saved;
  });
  const gaps = async (gap) => {
    config.groupGap = gap;
    writes.clear();
    await state.writeGroups('test', entries, new Map(), new Set());
    return Object.fromEntries(writes);
  };
  assert.deepEqual(await gaps(1), { a1: null, a2: '​', b1: '​' }, 'one zero-width row under each group');
  assert.deepEqual(await gaps(0), { a1: null, a2: null, b1: null });
});

test('group_gap reads 0 or false as no spacer, anything else as one row; machine_name names the machine', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const read = (toml) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-config-'));
    fs.writeFileSync(path.join(dir, 'config.toml'), toml);
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        "const c = require('./lib/config'); console.log(JSON.stringify([c.groupGap, c.machineKey, c.machineToken]))",
      ],
      { cwd: path.join(__dirname, '..'), env: { ...process.env, HERDR_PLUGIN_CONFIG_DIR: dir } },
    );
    fs.rmSync(dir, { recursive: true });
    return JSON.parse(out);
  };
  assert.equal(read('group_gap = 0\n')[0], 0);
  assert.equal(read('group_gap = false\n')[0], 0);
  assert.equal(read('group_gap = 1\n')[0], 1);
  assert.equal(read('')[0], 1);
  assert.equal(read('fleet_view = true\n')[0], 0, 'the fleet view drops the spacer unless asked for');
  assert.equal(read('fleet_view = true\ngroup_gap = 1\n')[0], 1);
  assert.deepEqual(read('machine_name = "Sauravs-Mac-mini.local"\n').slice(1), [
    'sauravs_mac_mini',
    'on_sauravs_mac_mini',
  ]);
});

test("with the fleet view on, a family's top header names its machine, a worktree under it does not", async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'machineLabel', 'mini-1');
  const writes = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.set(pane, tokens);
    return true;
  });
  const entries = [
    { pane: 'w1:p1', workspace: 'w1' },
    { pane: 'w2:p1', workspace: 'w2' },
    { pane: 'w3:p1', workspace: 'w3' },
  ];
  const labels = new Map([
    ['w1', 'sb-herdr-manager'],
    ['w2', 'feat-x'],
    ['w3', 'vedtara-app'],
  ]);
  await state.writeGroups('src', entries, labels, new Set(), {
    parentOf: new Map([['w2', 'w1']]),
    orphanRepo: new Map([['w3', 'vedtara-astro']]),
  });
  assert.equal(writes.get('w1:p1').group, 'sb-herdr-manager (mini-1)');
  assert.ok(!writes.get('w2:p1').group.includes('mini-1'), 'a worktree under a named header stays bare');
  assert.equal(writes.get('w3:p1').group_parent, 'vedtara-astro (mini-1)');
  assert.ok(!writes.get('w3:p1').group.includes('mini-1'), 'an orphan under its named repo row stays bare');
});

test("with the fleet view on, a family's top header carries its rollup and a worktree under it does not", async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'machineLabel', 'x1pro-1');
  const writes = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.set(pane, tokens);
    return true;
  });
  const entries = [
    { pane: 'w1:p1', workspace: 'w1' },
    { pane: 'w2:p1', workspace: 'w2' },
    { pane: 'w3:p1', workspace: 'w3' },
  ];
  const labels = new Map([
    ['w1', 'sb-herdr-manager'],
    ['w2', 'feat-x'],
    ['w3', 'vedtara-app'],
  ]);
  const parentOf = new Map([['w2', 'w1']]);
  const orphanRepo = new Map([['w3', 'vedtara-astro']]);
  const familyOf = (ws) => parentOf.get(ws) ?? (orphanRepo.has(ws) ? `repo:${orphanRepo.get(ws)}` : ws);
  await state.writeGroups('src', entries, labels, new Set(), {
    parentOf,
    orphanRepo,
    familyOf,
    rollups: new Map([
      ['w1', '■1 ◐1'],
      ['repo:vedtara-astro', '✓2'],
    ]),
  });
  assert.equal(writes.get('w1:p1').group, 'sb-herdr-manager (x1pro-1)  ■1 ◐1');
  assert.ok(!writes.get('w2:p1').group.includes('■'), 'a worktree under its header carries no rollup');
  assert.equal(writes.get('w3:p1').group_parent, 'vedtara-astro (x1pro-1)  ✓2');
});

test('rollup counts needs-you, working, waiting and done, worst first; an owner stamp outranks done', () => {
  assert.equal(
    fleet.rollup([
      { display: 'done', fleet: '2|owner|YIR-1' },
      { display: 'working' },
      { display: 'done' },
      { display: 'done' },
      { display: 'idle_stale' },
      { display: 'blocked' },
    ]),
    '■2 ◐1 ○1 ✓2',
  );
  assert.equal(fleet.rollup([{ display: 'working' }]), '◐1');
  assert.equal(fleet.rollup([]), '');
});

test('a rollup that moves rewrites only the head rows of its family; an unchanged one writes nothing', async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'machineLabel', 'x1pro-1');
  const { Frame } = require('../lib/frame');
  const writes = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.push([pane, tokens]);
    return true;
  });
  t.mock.method(state, 'sweepOrphans', async () => true);
  const entries = [
    { pane: 'w1:p1', workspace: 'w1' },
    { pane: 'w1:p2', workspace: 'w1' },
    { pane: 'w3:p1', workspace: 'w3' },
  ];
  const labels = new Map([
    ['w1', 'sb-herdr-manager'],
    ['w3', 'vedtara-app'],
  ]);
  const keys = { parentOf: new Map(), orphanRepo: new Map(), familyOf: (ws) => ws, services: new Set() };
  const frame = new Frame('test');
  const run = (w1) =>
    frame.groupJobs(entries, entries, 'fleet', true, new Map([['w1', w1], ['w3', [{ display: 'done' }]]]), labels, keys, 0, []);
  await run([{ display: 'working' }, { display: 'idle' }]);
  assert.equal(writes.length, 3, 'the first layout writes every row');
  assert.equal(writes[0][1].group, 'sb-herdr-manager (x1pro-1)  ◐1 ○1');
  writes.length = 0;
  await run([{ display: 'idle_fresh' }, { display: 'working' }]);
  assert.equal(writes.length, 0, 'same counts, nothing written');
  await run([{ display: 'working' }, { display: 'working' }]);
  assert.deepEqual(
    writes.map(([pane, tokens]) => [pane, tokens.group]),
    [['w1:p1', 'sb-herdr-manager (x1pro-1)  ◐2']],
    "only w1's head row is rewritten",
  );
});

test("the manager's workspace is the services group; a workspace without the manager is not", () => {
  const found = fleet.services([
    { pane: 'w5:p1', workspace: 'w5', fleet: '8|role|manager' },
    { pane: 'w5:p2', workspace: 'w5', fleet: null },
    { pane: 'w7:p1', workspace: 'w7', fleet: '8|role|executor' },
    { pane: 'w8:p1', workspace: 'w8', fleet: '2|owner|YIR-1' },
  ]);
  assert.deepEqual([...found], ['w5']);
});

test("the services group's lanes leave its tree for their repo's header, and the group sorts below all work", () => {
  const frame = new Frame('test');
  const entries = [
    { pane: 'w5:p1', workspace: 'w5', tab: 'w5:t1', fleet: '8|role|manager' },
    { pane: 'w5:p2', workspace: 'w5', tab: 'w5:t1', fleet: null },
    { pane: 'wQ:p1', workspace: 'wQ', tab: 'wQ:t1', fleet: '2|owner|YIR-1609' },
    { pane: 'w9:p1', workspace: 'w9', tab: 'w9:t1', fleet: '5|idle' },
  ];
  const parents = new Map([['wQ', 'w5']]);
  const worktrees = new Map([['wQ', 'sb-herdr-manager']]);
  const keys = frame.sortKeys(entries, parents, worktrees, fleet.services(entries));
  assert.deepEqual([...keys.parentOf], [], 'the lane no longer hangs off the services group');
  assert.deepEqual([...keys.orphanRepo], [['wQ', 'sb-herdr-manager']], 'it hangs under its own repo instead');
  assert.equal(keys.familyOf('wQ'), 'repo:sb-herdr-manager');
  // As render ranks them: w5:p2 carries no stamp, and idle unstamped is work's rank.
  const rows = entries.map((entry) => ({
    pane: entry.pane,
    workspace: entry.workspace,
    rank: fleet.orderRank('idle', entry.fleet, keys.services.has(entry.workspace)),
    minute: minute(9),
  }));
  const shown = frame.fleetOrder(entries, fleet.orderKeys(rows, keys.familyOf));
  assert.deepEqual(
    shown.map((entry) => entry.pane),
    ['wQ:p1', 'w9:p1', 'w5:p1', 'w5:p2'],
    'needs-you lane first, idle work next, services last',
  );
});

test('the services head reads SERVICES with its machine and rollup; its old lane sits under its repo', async (t) => {
  t.mock.property(config, 'fleetView', true);
  t.mock.property(config, 'machineLabel', 'x1pro-1');
  const writes = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.set(pane, tokens);
    return true;
  });
  const entries = [
    { pane: 'wQ:p1', workspace: 'wQ' },
    { pane: 'w5:p1', workspace: 'w5' },
    { pane: 'w5:p2', workspace: 'w5' },
  ];
  const orphanRepo = new Map([['wQ', 'sb-herdr-manager']]);
  const familyOf = (ws) => (orphanRepo.has(ws) ? `repo:${orphanRepo.get(ws)}` : ws);
  await state.writeGroups('src', entries, new Map([['w5', 'manager'], ['wQ', 'herdr-tracker-cutover']]), new Set(), {
    parentOf: new Map(),
    orphanRepo,
    familyOf,
    services: new Set(['w5']),
    rollups: new Map([
      ['w5', '◐1 ○1'],
      ['repo:sb-herdr-manager', '■1'],
    ]),
  });
  assert.equal(writes.get('w5:p1').group, 'SERVICES · x1pro-1  ◐1 ○1');
  assert.equal(writes.get('wQ:p1').group_parent, 'sb-herdr-manager (x1pro-1)  ■1');
  assert.equal(writes.get('w5:p2').group, null, 'a member row carries no header');
});
