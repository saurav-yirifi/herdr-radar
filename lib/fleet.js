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
  if (fleet && (fleet.kind === 'role' || fleet.kind === 'test')) {
    return { rank: String(RANKS[fleet.kind]), badge: fleet.kind };
  }
  if (display === 'blocked') return { rank: String(RANKS.ask), badge: 'ask' };
  if (display === 'working') return { rank: String(WORKING), badge: null };
  if (!fleet) {
    const idle = display === 'idle_fresh' || display === 'idle' || display === 'idle_stale';
    return { rank: String(idle ? UNSTAMPED_IDLE : WORKING), badge: null };
  }
  if (fleet.kind === 'tray') return { rank: String(RANKS.tray), badge: fleet.note ? `tray ${fleet.note}` : 'tray' };
  if (fleet.kind === 'idle') {
    const ago = age(idleMs);
    return { rank: String(RANKS.idle), badge: ago ? `idle ${ago}` : 'idle' };
  }
  return { rank: String(RANKS[fleet.kind]), badge: fleet.kind };
}

module.exports = { parse, age, nextAgeChange, view, RANKS, WORKING, UNSTAMPED_IDLE };
