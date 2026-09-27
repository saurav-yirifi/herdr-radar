'use strict';

// The fleet view's groups (YIR-551 parts 2-5): the `fleet` order keeps the
// workspace groups of `grouped`, a workspace of several panes draws as a tree,
// a window attached to several machines keeps each machine's rows together,
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

// Two machines' rows as a window on the mini receives them: the tokens each
// machine's own radar wrote. MacBook 1's lane is more urgent than anything on
// the mini, and its keys fall between the mini's manager rows.
const MINI = [
  { pane: 'mini/w4:p1', machine_key: 'mini', on_mini: '1', fleet_ws_key: '4-a-w4', fleet_row_key: '0-4-x' },
  { pane: 'mini/w4:p6', machine_key: 'mini', on_mini: '1', fleet_ws_key: '4-a-w4', fleet_row_key: '1-4-x' },
  { pane: 'mini/w9:p1', machine_key: 'mini', on_mini: '1', fleet_ws_key: '5-b-w9', fleet_row_key: '0-5-x' },
];
const MAC1 = [
  { pane: 'mac1/w2:p1', machine_key: 'macbook', on_macbook: '1', fleet_ws_key: '1-a-w2', fleet_row_key: '0-1-x' },
  { pane: 'mac1/w4:p2', machine_key: 'macbook', on_macbook: '1', fleet_ws_key: '4-a-w4', fleet_row_key: '0-4-y' },
];

test('a window keeps each machine contiguous, its own machine first', (t) => {
  t.mock.property(config, 'machineKey', 'mini');
  const shown = herdrSort([MAC1[1], MINI[2], MAC1[0], MINI[1], MINI[0]], view.sortFor('fleet', true));
  assert.deepEqual(
    shown.map((r) => r.pane),
    ['mini/w4:p1', 'mini/w4:p6', 'mini/w9:p1', 'mac1/w2:p1', 'mac1/w4:p2'],
  );
});

test('a window on a third machine orders the other two by name, each contiguous', (t) => {
  t.mock.property(config, 'machineKey', 'mac_2');
  const shown = herdrSort([...MINI, ...MAC1], view.sortFor('grouped', true));
  assert.deepEqual(
    shown.map((r) => r.machine_key),
    ['macbook', 'macbook', 'mini', 'mini', 'mini'],
  );
});

test("with the fleet view off every order's sort is upstream's, no machine level", () => {
  for (const mode of ['grouped', 'recent']) assert.deepEqual(view.sortFor(mode, false), view.SORTS[mode].sort);
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
