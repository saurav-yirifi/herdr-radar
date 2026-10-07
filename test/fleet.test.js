'use strict';

// The fleet view (lib/fleet.js): a fleet manager's `hm_fleet` pane token plus
// the plugin's own live state become a rank the `fleet` order sorts on and a
// badge word on the row. Off by default, and off must leave everything as it
// was — the sidebar block most of all, since Herdr rejects the whole config
// file over one bad row.

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const fleet = require('../lib/fleet');
const view = require('../lib/view');
const herdr = require('../lib/herdr');
const managed = require('../lib/managed-config');
const { Frame } = require('../lib/frame');

const MIN = 60000;

// config is one object for the whole process; each test puts it back.
function withFleet(t, on) {
  const was = config.fleetView;
  config.fleetView = on;
  t.after(() => {
    config.fleetView = was;
  });
}

test('the token parses to its kind and note, whatever rank the manager wrote', () => {
  assert.deepEqual(fleet.parse('1|ask'), { kind: 'ask', note: '' });
  assert.deepEqual(fleet.parse('2|owner|YIR-489'), { kind: 'owner', note: 'YIR-489' });
  assert.deepEqual(fleet.parse('7|tray|3'), { kind: 'tray', note: '3' });
  assert.deepEqual(fleet.parse('9|test|w4:p6'), { kind: 'test', note: 'w4:p6' });
});

test('a malformed token is no token', () => {
  for (const bad of [null, undefined, 3, '', 'ask', '1|', '1|bar', '1|ASK', '|']) {
    assert.equal(fleet.parse(bad), null, String(bad));
  }
});

test('each kind gets its rank and its word', () => {
  const at = (token, display = 'idle') => fleet.view(display, token, 150 * MIN);
  assert.deepEqual(at('1|ask'), { rank: '1', badge: 'ask 2h' });
  assert.deepEqual(at('2|owner|YIR-489'), { rank: '2', badge: 'owner' });
  assert.deepEqual(at('3|tray|3'), { rank: '3', badge: 'tray 3' });
  assert.deepEqual(at('4|use'), { rank: '4', badge: 'in use' });
  assert.deepEqual(at('5|idle'), { rank: '5', badge: 'idle 2h' });
  assert.deepEqual(at('8|role|executor'), { rank: '8', badge: 'executor' });
  assert.deepEqual(at('9|test|w4:p6'), { rank: '9', badge: 'test' });
});

test('live state outranks the manager: working now is working, a dialog is an ask', () => {
  for (const token of ['1|ask', '2|owner', '3|tray|3', '4|use', '5|idle']) {
    assert.deepEqual(fleet.view('working', token, 0), { rank: '4', badge: null }, token);
  }
  assert.deepEqual(fleet.view('blocked', null, 0), { rank: '1', badge: 'ask' });
  assert.deepEqual(fleet.view('blocked', '3|tray|2', 0), { rank: '1', badge: 'ask' });
});

test('a service stays a service even while it works', () => {
  assert.deepEqual(fleet.view('working', '8|role|relay', 0), { rank: '8', badge: 'relay' });
  assert.deepEqual(fleet.view('blocked', '9|test|w4:p6', 0), { rank: '9', badge: 'test' });
});

test('a role badge names the role; an unnamed or unknown role still reads as a role', () => {
  assert.deepEqual(fleet.view('idle', '8|role|dispatcher', 0), { rank: '8', badge: 'dispatcher' });
  assert.deepEqual(fleet.view('idle', '8|role', 0), { rank: '8', badge: 'role' });
  assert.deepEqual(fleet.view('idle', '8|role|compactor', 0), { rank: '8', badge: 'role' });
});

test('an ask carries how long it has waited, so a stale one stands out from a fresh one', () => {
  assert.deepEqual(fleet.view('blocked', null, 5 * MIN), { rank: '1', badge: 'ask' });
  assert.deepEqual(fleet.view('blocked', null, 25 * MIN), { rank: '1', badge: 'ask 20m' });
  assert.deepEqual(fleet.view('idle', '1|ask', 3 * 60 * MIN), { rank: '1', badge: 'ask 3h' });
});

test('with the fleet view on, each role wears its own colour; off, no role rule is written', (t) => {
  withFleet(t, true);
  const on = managed.sidebarBlock('dark');
  for (const role of fleet.ROLES) {
    assert.match(on, new RegExp(`contains = "${role}", fg = "#[0-9a-f]{6}"`), role);
  }
  config.fleetView = false;
  for (const role of fleet.ROLES) assert.doesNotMatch(managed.sidebarBlock('dark'), new RegExp(`contains = "${role}"`));
});

test('with the fleet view on, the tab bar also shows the manager health line; off, it does not', (t) => {
  withFleet(t, true);
  assert.match(managed.block(), /fleet-health\.txt/);
  assert.doesNotThrow(() => managed.block());
  config.fleetView = false;
  assert.doesNotMatch(managed.block(), /fleet-health/);
});

test('a fleet-on block from before the role colours and health line is stale, so a start rewrites it', (t) => {
  withFleet(t, true);
  const current = managed.block() + managed.sidebarBlock('dark');
  assert.equal(managed.fleetStale(current, true), false);
  const older = current.replace(/\{ contains = "manager"[^}]*\},?/, '').replace(/.*fleet-health.*\n/, '');
  assert.equal(managed.fleetStale(older, true), true);
  assert.equal(managed.fleetStale(current.replace(/.*fleet-health.*\n/, ''), true), true);
  config.fleetView = false;
  const off = managed.block() + managed.sidebarBlock('dark');
  assert.equal(managed.fleetStale(off, false), false);
  assert.equal(managed.fleetStale(current, false), true);
  assert.equal(managed.fleetStale(off, true), true);
});

test('an unstamped pane ranks by what it is doing, with no badge', () => {
  assert.deepEqual(fleet.view('working', null, 0), { rank: '4', badge: null });
  assert.deepEqual(fleet.view('done', null, 0), { rank: '4', badge: null });
  assert.deepEqual(fleet.view('idle_stale', null, 0), { rank: '5', badge: null });
});

test('idle age reads in tens of minutes, then hours, then days', () => {
  assert.equal(fleet.age(9 * MIN), '');
  assert.equal(fleet.age(10 * MIN), '10m');
  assert.equal(fleet.age(59 * MIN), '50m');
  assert.equal(fleet.age(60 * MIN), '1h');
  assert.equal(fleet.age(47 * 60 * MIN), '47h');
  assert.equal(fleet.age(48 * 60 * MIN), '2d');
  assert.equal(fleet.age(undefined), '');
  assert.equal(fleet.view('idle', '5|idle', undefined).badge, 'idle');
});

test('the next change of an idle badge is when its word would change', () => {
  assert.equal(fleet.nextAgeChange(3 * MIN), 7 * MIN);
  assert.equal(fleet.nextAgeChange(25 * MIN), 5 * MIN);
  assert.equal(fleet.nextAgeChange(90 * MIN), 30 * MIN);
  assert.equal(fleet.age(90 * MIN + fleet.nextAgeChange(90 * MIN)), '2h');
});

test('the fleet order sorts on its workspace key, then its row key, both ascending', () => {
  assert.deepEqual(view.SORTS.fleet.sort, [
    { field: { token: 'fleet_ws_key' }, order: 'asc' },
    { field: { token: 'fleet_row_key' }, order: 'asc' },
  ]);
});

test("with the fleet view off, every transition is upstream's and none reaches fleet", () => {
  const r = (current, message) => view.resolve(current, message, false);
  assert.equal(r(null, { op: 'cycle' }), 'grouped');
  assert.equal(r('grouped', { op: 'cycle' }), 'recent');
  assert.equal(r('recent', { op: 'cycle' }), null);
  assert.equal(r('grouped', { op: 'flip' }), 'recent');
  assert.equal(r('recent', { op: 'flip' }), 'grouped');
  assert.equal(r(null, { op: 'native' }), 'grouped');
  assert.equal(r('grouped', { set: 'fleet' }), 'grouped');
  assert.deepEqual(view.available(false), ['grouped', 'recent']);
});

test('with the fleet view on, the cycle starts at fleet and flip is fleet <-> active', () => {
  const r = (current, message) => view.resolve(current, message, true);
  assert.equal(r(null, { op: 'cycle' }), 'fleet');
  assert.equal(r('fleet', { op: 'cycle' }), 'grouped');
  assert.equal(r('grouped', { op: 'cycle' }), 'recent');
  assert.equal(r('recent', { op: 'cycle' }), null);
  assert.equal(r('fleet', { op: 'flip' }), 'grouped');
  assert.equal(r('grouped', { op: 'flip' }), 'fleet');
  assert.equal(r('recent', { op: 'flip' }), 'fleet');
  assert.equal(r('grouped', { set: 'fleet' }), 'fleet');
  assert.equal(r(null, { op: 'native' }), 'fleet');
});

test('with the fleet view off, the sidebar block names no fleet token', (t) => {
  withFleet(t, false);
  for (const variant of ['light', 'dark']) {
    assert.doesNotMatch(managed.sidebarBlock(variant), /fleet/, variant);
  }
});

test("with the fleet view on, the badge is its own row under the title and every row stays within Herdr's 16 tokens", (t) => {
  withFleet(t, true);
  const on = managed.sidebarBlock('light');
  config.fleetView = false;
  const off = managed.sidebarBlock('light');
  // The badge is a row of its own (fleet view 6.7): in front of the title it
  // pushed the title off a narrow sidebar.
  const badge = on.match(/\[\{ token = "\$fleet_badge"[^\n]*?\] \}\], /g) ?? [];
  assert.ok(badge.length > 0, 'no badge row in the block');
  assert.equal(new Set(badge).size, 1, 'one badge row, the same on every entry');
  // The owner's glance (YIR-687) is its own row after the title row, one cell.
  const owner = on.match(/\[\{ token = "\$fleet_owner"[^\n]*?\}\], /g) ?? [];
  assert.ok(owner.length > 0, 'no owner row in the block');
  assert.equal(new Set(owner).size, 1, 'one owner row, the same on every entry');
  const agentRow = on.split('\n').find((l) => l.startsWith('rows = ['));
  assert.ok(agentRow.indexOf(badge[0]) > agentRow.indexOf('$title_unknown'), 'the badge row comes after the title row');
  assert.ok(agentRow.indexOf(owner[0]) > agentRow.indexOf(badge[0]), 'the owner row after the badge row');
  assert.ok(agentRow.indexOf(owner[0]) < agentRow.indexOf('["$gap"]'), 'and before the gap');
  // and a role pane's working title (title_role), one per vendor row
  const roleTitle = /, \{ token = "\$title_role"[^\]]*\] \}/g;
  // and the Spaces panel's third row, the lane's hold (fleet view row 10)
  const hold = /,\n {2}\[\n {4}\{ token = "\$lane_hold"[^\n]*\}\n {2}\]/;
  assert.match(on.slice(on.indexOf('[ui.sidebar.spaces]')), hold, 'no hold row in the Spaces block');
  assert.match(on, /\$lane_hold", [^\n]*\}, \{ token = "\$lane_drift"/, 'no drift cell beside the hold');
  // and the machine tint on every group header (row 7): mini-1 amber, the Macs violet
  const tint = /, rules = \[(\{ contains = "[^"]+", fg = "[^"]+" \}(, )?){4}\]/g;
  const groupCell = on.match(/\{ token = "\$group", [^\n]*?\] \}/)?.[0] ?? '';
  const tinted = (header) => [...groupCell.matchAll(/contains = "([^"]+)"/g)].some(([, c]) => header.includes(c));
  assert.ok(tinted('sb-herdr-manager (mini-1)') && tinted('SERVICES · mini-1'), 'mini-1 is not tinted');
  assert.ok(tinted('revoxy (mac-1)') && tinted('SERVICES · mac-2'), 'a Mac is not tinted');
  assert.ok(!tinted('mac-notes (x1pro-1)') && !tinted('SERVICES · x1pro-1'), 'x1pro-1 is tinted');
  assert.equal(
    on.split(badge[0]).join('').split(owner[0]).join('').replace(roleTitle, '').replace(hold, '').replace(tint, ''),
    off,
    'the badge row, the owner row, the role title, the hold row and the machine tint are the only differences',
  );
  // sidebarBlock throws when a row passes the limit; this is the count it checks.
  const count = (block) => {
    const row = block.split('\n').find((line) => line.startsWith('rows = ['));
    return (row.split('], [')[2].match(/token = "/g) ?? []).length;
  };
  assert.equal(count(on), count(off) + 1); // the role title; the badge left the title row
  assert.ok(count(on) <= 16, `${count(on)} tokens on the agent row`);
});

test('the frame writes the rank and badge once, and again only when they change', async (t) => {
  withFleet(t, true);
  const writes = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.push([pane, tokens]);
    return true;
  });
  const frame = new Frame('test');
  const entry = { pane: 'w5:p1', fleet: '2|owner|YIR-489' };
  const run = async (display, now = 1000) => {
    const jobs = [];
    frame.fleetJobs(entry, display, now, [], jobs);
    await Promise.all(jobs);
  };
  await run('idle');
  await run('idle');
  await run('working');
  const none = { fleet_ws_key: null, fleet_row_key: null };
  assert.deepEqual(writes, [
    ['w5:p1', { fleet_rank: '2', fleet_badge: 'owner', ...none }],
    ['w5:p1', { fleet_rank: '4', fleet_badge: null, ...none }],
  ]);
});

test('an idle badge wakes the frame when its age word changes', (t) => {
  withFleet(t, true);
  t.mock.method(herdr, 'reportMetadataAsync', async () => true);
  const frame = new Frame('test');
  const now = 10_000_000;
  frame.lastWorkingAt.set('w5:p2', now - 25 * MIN);
  const deadlines = [];
  frame.fleetJobs({ pane: 'w5:p2', fleet: '5|idle' }, 'idle', now, deadlines, []);
  assert.deepEqual(deadlines, [now + 5 * MIN]);
});

test('a role pane working goes out as title_role behind its mark; a lane keeps title_working', () => {
  const state = require('../lib/state');
  const line = { mark: '⣟', split: '', logo: '✳', titlePrefix: '' };
  const role = state.stateTokens('working', line, 'Executor persona setup', 'executor');
  assert.equal(role.title_role, `${fleet.ROLE_MARKS.executor}Executor persona setup`);
  assert.equal(role.title_working, null);
  const lane = state.stateTokens('working', line, 'Implement OAuth scopes', null);
  assert.equal(lane.title_working, 'Implement OAuth scopes');
  assert.equal(lane.title_role, null);
  // a role pane that stops working leaves title_role for its state's own title
  const idle = state.stateTokens('idle', line, 'Executor persona setup', 'executor');
  assert.equal(idle.title_role, null);
  assert.equal(idle.title_idle, 'Executor persona setup');
});

test('roleOf names only a known role from a role token', () => {
  assert.equal(fleet.roleOf('8|role|manager'), 'manager');
  assert.equal(fleet.roleOf('8|role|janitor'), null);
  assert.equal(fleet.roleOf('1|ask'), null);
  assert.equal(fleet.roleOf(undefined), null);
});

test('with the fleet view on, the title_role cell colours each role mark; off, there is no cell', (t) => {
  withFleet(t, true);
  const on = managed.sidebarBlock('dark');
  const cellText = on.match(/\{ token = "\$title_role"[^\]]*\]/)[0];
  for (const role of fleet.ROLES) {
    const code = fleet.ROLE_MARKS[role].codePointAt(0).toString(16).padStart(4, '0');
    assert.match(cellText, new RegExp(`contains = "\\\\u${code}", fg = "#[0-9a-f]{6}"`), role);
  }
  config.fleetView = false;
  assert.doesNotMatch(managed.sidebarBlock('dark'), /title_role/);
});

test('a pane that stops being a role pane mid-work is rewritten, and a stray mark in a title is dropped', () => {
  const state = require('../lib/state');
  const line = { mark: '⣟', split: '', logo: '✳', titlePrefix: '' };
  assert.notEqual(state.lineKey('working', line, 'T', 'executor'), state.lineKey('working', line, 'T', null));
  const odd = state.stateTokens('working', line, `T${fleet.ROLE_MARKS.manager}`, 'relay');
  assert.equal(odd.title_role, `${fleet.ROLE_MARKS.relay}T`);
});

test("a fleet-on block with the badge still in the title row is stale, so a start rewrites it", (t) => {
  withFleet(t, true);
  const block = `${managed.sidebarBlock('dark')}\nfleet-health.txt`;
  assert.equal(managed.fleetStale(block, true), false);
  const older = block.split('[{ token = "$fleet_badge"').join('{ token = "$fleet_badge"');
  assert.equal(managed.fleetStale(older, true), true);
});
