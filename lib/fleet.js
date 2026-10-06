'use strict';

// The fleet view (off unless `fleet_view = true`): lanes, needs-you first.
//
// A fleet manager (herdr-manager) knows things about a pane that nothing on
// the pane says — the session ended its turn on a plain-text question, its
// ticket waits on the owner, its lane has approved work nobody started, it is
// a service rather than work. It publishes them as ONE pane token,
//
//   hm_fleet = <rank>|<kind>[|<note>]      1|ask  2|owner|YIR-489  3|tray|3  5|idle  8|role|executor  9|test|w4:p6
//
// and this module turns that, together with what the plugin already knows
// live, into two tokens of our own: `fleet_rank`, which the `fleet` order
// sorts on, and `fleet_badge`, one word on the row. The manager's token is
// read, never written: the plugin reads nothing else of the manager's, and
// nothing about the manager's other tokens changes what the plugin does.
//
// Live state outranks the manager's word, which is at most one heartbeat old:
// a pane that is working NOW is working, whatever the token said, and a
// Herdr dialog (`blocked`) is an ask whether or not anyone stamped it.

// kind -> rank. `role` and `test` are services: they sort last and never
// read as work.
const RANKS = { ask: 1, owner: 2, tray: 3, idle: 5, role: 8, test: 9 };
const WORKING = 4;
const UNSTAMPED_IDLE = 5;

// The fleet's service roles, each with its own colour on the badge (lib/palette.js
// roleFor), so the manager's workspace reads as manager / builder / dispatcher
// at a glance instead of a column of grey `role`. A role this list does not
// know still badges as `role`, in the receding grey.
const ROLES = ['manager', 'builder', 'dispatcher', 'executor', 'relay'];

// `<rank>|<kind>[|<note>]` -> { kind, note } or null. The rank in the token is
// the manager's; the table above is what the plugin sorts by, so a token from
// a manager with other numbers still lands where its kind belongs.
function parse(value) {
  if (typeof value !== 'string') return null;
  const [, kind, ...rest] = value.split('|');
  if (!kind || !(kind in RANKS)) return null;
  return { kind, note: rest.join('|').trim() };
}

// How long ago, in the words the badge uses: nothing under ten minutes,
// tens of minutes under an hour, hours under two days, then days.
function age(ms) {
  if (typeof ms !== 'number' || !(ms >= 0)) return '';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 10) return '';
  if (minutes < 60) return `${Math.floor(minutes / 10) * 10}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// When the text `age` gives would next change, as an offset from `ms`.
function nextAgeChange(ms) {
  if (typeof ms !== 'number' || !(ms >= 0)) return null;
  const minutes = ms / 60000;
  const step = minutes < 60 ? 10 : minutes < 48 * 60 ? 60 : 24 * 60;
  const next = minutes < 10 ? 10 : (Math.floor(minutes / step) + 1) * step;
  return (next - minutes) * 60000;
}

// { rank, badge } for one pane: `display` is the plugin's own state for it,
// `token` the manager's hm_fleet, `idleMs` how long since it last worked.
function view(display, token, idleMs) {
  const fleet = parse(token);
  if (fleet && fleet.kind === 'role') {
    return { rank: String(RANKS.role), badge: ROLES.includes(fleet.note) ? fleet.note : 'role' };
  }
  if (fleet && fleet.kind === 'test') return { rank: String(RANKS.test), badge: 'test' };
  // An ask carries its wait, from ten minutes on (`age`): a fresh question and
  // one that has sat for an hour are different decisions for the person.
  const ask = () => {
    const ago = age(idleMs);
    return { rank: String(RANKS.ask), badge: ago ? `ask ${ago}` : 'ask' };
  };
  if (display === 'blocked') return ask();
  if (display === 'working') return { rank: String(WORKING), badge: null };
  if (!fleet) {
    const idle = display === 'idle_fresh' || display === 'idle' || display === 'idle_stale';
    return { rank: String(idle ? UNSTAMPED_IDLE : WORKING), badge: null };
  }
  if (fleet.kind === 'ask') return ask();
  if (fleet.kind === 'tray') return { rank: String(RANKS.tray), badge: fleet.note ? `tray ${fleet.note}` : 'tray' };
  if (fleet.kind === 'idle') {
    const ago = age(idleMs);
    return { rank: String(RANKS.idle), badge: ago ? `idle ${ago}` : 'idle' };
  }
  return { rank: String(RANKS[fleet.kind]), badge: fleet.kind };
}

// A minute key turned so that an ASCENDING sort puts the most recent first:
// the `fleet` order sorts every key ascending, rank first. A pane with no stamp
// ('000000000000') becomes the largest value and sorts last.
const inv = (minute) => String(999999999999 - Number(minute)).padStart(12, '0');

// The `fleet` order's two keys, grouped (YIR-551): a flat rank-then-activity
// list read as a list of agents with no project in it (the owner, 2026-09-27).
//
//   fleet_ws_key  places a workspace: its family by the family's most urgent
//                 row (min rank), then the family's most recent activity; a
//                 parent checkout ahead of its worktrees; the worktrees by
//                 their own min rank, then activity.
//   fleet_row_key places a pane inside its workspace: the workspace's head
//                 (its first pane in Herdr's layout order - the one the others
//                 were opened beside) first, the rest needs-you first, then by
//                 activity.
//
// `rows` is [{ pane, workspace, rank, minute }] in Herdr's list order, `rank`
// a fleet.view rank and `minute` a zero-padded minute key; `familyOf` maps a
// workspace to its family id (lib/frame.js sortKeys). Returns
// { wsKeys: ws -> key, rowKeys: pane -> key }, both for an ascending sort.
//
// `machine` goes after each id, never in front: workspace ids repeat across
// machines (both have a w4), so without it two machines' w4 rows interleave in
// a window attached to both, and in front it would group the list by machine
// - a block that jumped whenever one of its rows lit up (the owner, 2026-09-28).
// It follows a `-`, which sorts below every id character, so the tiebreak
// between ids is unchanged (w1 before w10).
function orderKeys(rows, familyOf, machine = '') {
  const wsRank = new Map();
  const wsBest = new Map();
  const famRank = new Map();
  const famBest = new Map();
  const head = new Map();
  const low = (map, key, value) => {
    if (!map.has(key) || value < map.get(key)) map.set(key, value);
  };
  const high = (map, key, value) => {
    if (!map.has(key) || value > map.get(key)) map.set(key, value);
  };
  for (const row of rows) {
    if (!row.workspace) continue;
    const family = familyOf(row.workspace);
    if (!head.has(row.workspace)) head.set(row.workspace, row.pane);
    low(wsRank, row.workspace, row.rank);
    high(wsBest, row.workspace, row.minute);
    low(famRank, family, row.rank);
    high(famBest, family, row.minute);
  }
  const wsKeys = new Map();
  for (const ws of head.keys()) {
    const family = familyOf(ws);
    wsKeys.set(
      ws,
      `${famRank.get(family)}-${inv(famBest.get(family))}-${family}-${machine}-${family === ws ? '0' : '1'}-` +
        `${wsRank.get(ws)}-${inv(wsBest.get(ws))}-${ws}-${machine}`,
    );
  }
  const rowKeys = new Map();
  for (const row of rows) {
    const first = row.workspace && head.get(row.workspace) === row.pane ? '0' : '1';
    rowKeys.set(row.pane, `${first}-${row.rank}-${inv(row.minute)}-${row.pane}`);
  }
  return { wsKeys, rowKeys };
}

module.exports = { parse, age, nextAgeChange, view, orderKeys, RANKS, ROLES, WORKING, UNSTAMPED_IDLE };
