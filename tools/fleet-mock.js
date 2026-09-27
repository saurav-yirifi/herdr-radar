#!/usr/bin/env node
'use strict';

// A rendered MOCK of the fleet view (lib/fleet.js), for review without a
// Herdr server: fixture panes -> fleet.view -> the `fleet` order's keys
// (fleet.orderKeys, the same builder the daemon writes from) -> the group
// headers and the tree inside a workspace (lib/state.js) -> one line per row,
// the badge coloured by the same rules the sidebar block writes. Then a window
// attached to two machines, sorted by view.sortFor, and the spacer at
// group_gap 1 and 0, with the machine header over each machine's block. It
// is not Herdr drawing the panel; the real one comes from installing the
// plugin. `--plain` drops the colour.
//
//   node tools/fleet-mock.js [--plain]

const config = require('../lib/config');
const fleet = require('../lib/fleet');
const palette = require('../lib/palette');
const state = require('../lib/state');
const view = require('../lib/view');
const { Frame } = require('../lib/frame');

config.fleetView = true;
const MIN = 60000;
const plain = process.argv.includes('--plain');

// One pane per case the view distinguishes, in Herdr's layout order: ws the
// workspace, display the plugin's own state, token the manager's hm_fleet,
// idle the time since the last turn, sort the activity minute (higher = more
// recent). sb-herdr-manager is the manager's workspace: the manager, the
// trio's builder, and two role panes.
const PANES = [
  { ws: 'sb-herdr-manager', title: 'herdr-fleet-manager', display: 'idle', token: null, idle: 4 * MIN, sort: 88, owner: 'you: 52 · oldest 83h' },
  { ws: 'sb-herdr-manager', title: 'builder: YIR-551', display: 'working', token: null, idle: 0, sort: 96 },
  { ws: 'sb-herdr-manager', title: 'executor', display: 'idle', token: '8|role|executor', idle: 5 * MIN, sort: 50 },
  { ws: 'sb-herdr-manager', title: 'dispatcher', display: 'idle', token: '8|role|dispatcher', idle: 2 * MIN, sort: 60 },
  { ws: 'axi-view-trades', title: 'FX reopen check', display: 'working', token: '5|idle', idle: 0, sort: 90 },
  { ws: 'axi-view-trades', title: 'PR #88 ready - merge?', display: 'done', token: '1|ask', idle: 3 * MIN, sort: 80 },
  { ws: 'devops', title: 'which env file?', display: 'blocked', token: null, idle: 0, sort: 40 },
  {
    ws: 'dispatch-queue',
    title: 'row 4 needs the owner',
    display: 'idle',
    token: '2|owner|YIR-489',
    idle: 40 * MIN,
    sort: 61,
  },
  {
    ws: 'axi-desk-agents',
    title: 'axi-desk-agents',
    display: 'idle_fresh',
    token: '3|tray|3',
    idle: 12 * MIN,
    sort: 70,
  },
  { ws: 'billing', title: 'nothing queued', display: 'idle_stale', token: '5|idle', idle: 150 * MIN, sort: 10 },
  { ws: 'hmt6', title: 'proof session', display: 'working', token: '9|test|w4:p6', idle: 0, sort: 95 },
];

const ink = palette.stateFor('light');
const COLOURS = [
  ['ask', ink.blocked],
  ['owner', ink.unknown],
  ['tray', ink.subtle],
  ['idle', ink.idleStale],
  ['role', ink.idleStale],
  ['test', ink.idleStale],
];

function paint(text, hex) {
  if (plain || !text) return text;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

const rows = PANES.map((p, i) => ({
  ...p,
  pane: `p${i}`,
  workspace: p.ws,
  ...fleet.view(p.display, p.token, p.idle),
  minute: String(p.sort).padStart(12, '0'),
}));
const shown = Frame.prototype.fleetOrder(
  rows,
  fleet.orderKeys(rows, (ws) => ws),
);
const { heads, tails } = state.groupBoundaries(shown);
const tree = state.treeCorners(shown);

// The machine header (YIR-657) heads the block; every group sits under it.
config.machineLabel = 'mini-1';
console.log('MOCK - fleet view (fleet_view = true), order: fleet');
console.log(paint(config.machineLabel, ink.idleStale));
for (const row of shown) {
  if (heads.has(row.pane)) console.log(`  ${paint(row.ws, ink.subtle)}`);
  const colour = COLOURS.find(([word]) => row.badge?.includes(word))?.[1];
  const badge = row.badge ? paint(row.badge.padEnd(9), colour) : ' '.repeat(9);
  const corner = (tree.get(row.pane) ?? '').padEnd(3);
  console.log(`    ${corner}${row.rank}  ${badge} ${row.display.padEnd(10)} ${row.title}`);
  // The owner's glance (YIR-687): the manager's fleet_owner token, its own row.
  if (row.owner) console.log(`    ${' '.repeat(3)}   ${' '.repeat(9)} ${paint(row.owner, ink.blocked)}`);
  if (tails.has(row.pane)) console.log('');
}

// A window on the mini attached to MacBook 1: each machine's rows carry the
// keys ITS radar wrote, and workspace ids repeat across machines - both have a
// w4 - so without a machine level MacBook 1's w4 row sorts into the middle of
// the mini's (the owner's MacBook 2 window, 2026-09-27).
const LABELS = { mini: 'mini-1', macbook: 'mac-1' };
const WINDOW = [
  { m: 'mini', id: 'w4', ws: 'sb-herdr-manager', title: 'herdr-fleet-manager', key: '4-a', row: '0-4' },
  { m: 'macbook', id: 'w4', ws: 'yirifi-ops-refinery', title: 'ops-refinery', key: '4-a', row: '0-5' },
  { m: 'mini', id: 'w4', ws: 'sb-herdr-manager', title: 'builder', key: '4-a', row: '1-4' },
  { m: 'mini', id: 'w9', ws: 'billing', title: 'nothing queued', key: '5-b', row: '0-5' },
  { m: 'macbook', id: 'w2', ws: 'devops', title: 'which env file?', key: '1-c', row: '0-1' },
].map((r) => ({
  ...r,
  machine_key: r.m,
  [`on_${r.m}`]: '1',
  fleet_ws_key: `${r.key}-${r.id}`,
  fleet_row_key: r.row,
}));

function herdrSort(list, sort) {
  return [...list].sort((a, b) => {
    for (const { field, order } of sort) {
      const [x, y] = [a[field.token], b[field.token]];
      if (x === y) continue;
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return (x < y ? -1 : 1) * (order === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

config.machineKey = 'mini';
for (const [label, sort] of [
  ['without a machine level', view.SORTS.fleet.sort],
  ['machine first (this window: mini)', view.sortFor('fleet')],
]) {
  console.log(`MOCK - a window on the mini attached to MacBook 1, ${label}`);
  // Each machine's radar writes the header on its own first row in this order,
  // so it heads that machine's block (fleet_machine, lib/state.js writeGroups).
  let machine = null;
  for (const r of herdrSort(WINDOW, sort)) {
    if (r.m !== machine) console.log(paint(LABELS[r.m], ink.idleStale));
    machine = r.m;
    console.log(`  ${r.ws.padEnd(20)} ${r.title}`);
  }
  console.log('');
}

for (const gap of [1, 0]) {
  console.log(`MOCK - the spacer at group_gap = ${gap}`);
  for (const ws of ['sb-herdr-manager', 'axi-view-trades']) {
    console.log(`  ${ws}\n    a session`);
    if (gap) console.log('');
  }
}
