#!/usr/bin/env node
'use strict';

// A rendered MOCK of the fleet view (lib/fleet.js), for review without a
// Herdr server: fixture panes -> fleet.view -> the `fleet` order's sort ->
// one line per row, the badge coloured by the same rules the sidebar block
// writes. It is not Herdr drawing the panel; the real one comes from
// installing the plugin. `--plain` drops the colour.
//
//   node tools/fleet-mock.js [--plain]

const config = require('../lib/config');
const fleet = require('../lib/fleet');
const palette = require('../lib/palette');

config.fleetView = true;
const MIN = 60000;
const plain = process.argv.includes('--plain');

// One pane per case the view distinguishes: display is the plugin's own
// state, token the manager's hm_fleet, idle the time since the last turn,
// sort the activity key (higher = more recent).
const PANES = [
  { title: 'axi-view-trades: FX reopen check', display: 'working', token: '5|idle', idle: 0, sort: 90 },
  { title: 'devops: which env file?', display: 'blocked', token: null, idle: 0, sort: 40 },
  { title: 'aihub: PR #88 ready - merge?', display: 'done', token: '1|ask', idle: 3 * MIN, sort: 80 },
  { title: 'dispatcher: row 4 needs the owner', display: 'idle', token: '2|owner|YIR-489', idle: 40 * MIN, sort: 60 },
  { title: 'axi-desk-agents', display: 'idle_fresh', token: '3|tray|3', idle: 12 * MIN, sort: 70 },
  { title: 'billing: nothing queued', display: 'idle_stale', token: '5|idle', idle: 150 * MIN, sort: 10 },
  { title: 'scratch shell agent', display: 'idle', token: null, idle: 30 * MIN, sort: 20 },
  { title: 'executor', display: 'idle', token: '8|role|executor', idle: 5 * MIN, sort: 50 },
  { title: 'hmt6 proof session', display: 'working', token: '9|test|w4:p6', idle: 0, sort: 95 },
];

const state = palette.stateFor('light');
const COLOURS = [
  ['ask', state.blocked],
  ['owner', state.unknown],
  ['tray', state.subtle],
  ['idle', state.idleStale],
  ['role', state.idleStale],
  ['test', state.idleStale],
];

function paint(text, hex) {
  if (plain || !text) return text;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

const rows = PANES.map((p) => ({ ...p, ...fleet.view(p.display, p.token, p.idle) }));
// The `fleet` sort: fleet_rank ascending, then sort_key descending.
rows.sort((a, b) => a.rank.localeCompare(b.rank) || b.sort - a.sort);

console.log('MOCK - fleet view (fleet_view = true), order: fleet');
for (const row of rows) {
  const colour = COLOURS.find(([word]) => row.badge?.includes(word))?.[1];
  const badge = row.badge ? paint(row.badge.padEnd(9), colour) : ' '.repeat(9);
  console.log(`  ${row.rank}  ${badge} ${row.display.padEnd(10)} ${row.title}`);
}
