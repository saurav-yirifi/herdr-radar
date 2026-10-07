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
  assert.deepEqual(at('8|role|executor'), { rank: '8', badge: 'executor', role: true });
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
  assert.deepEqual(fleet.view('working', '8|role|relay', 0), { rank: '8', badge: 'relay', role: true });
  assert.deepEqual(fleet.view('blocked', '9|test|w4:p6', 0), { rank: '9', badge: 'test' });
});

test('a role pane names its persona, listed or not; a note that is no name reads as a role', () => {
  assert.deepEqual(fleet.view('idle', '8|role|dispatcher', 0), { rank: '8', badge: 'dispatcher', role: true });
  // a persona added to the fleet after this release (the person, 2026-10-07)
  assert.deepEqual(fleet.view('idle', '8|role|compactor', 0), { rank: '8', badge: 'compactor', role: true });
  assert.deepEqual(fleet.view('blocked', '8|role|qa-lead', 0), { rank: '8', badge: 'qa-lead ask', role: true });
  // `ask-bot` behind an indent would contain the dialog's ` ask`
  for (const odd of ['8|role', '8|role|', '8|role|Two Words', '8|role|x;rm', `8|role|${'a'.repeat(30)}`, '8|role|ask-bot']) {
    assert.deepEqual(fleet.view('idle', odd, 0), { rank: '8', badge: 'role', role: true }, odd);
  }
});

test('a role pane held by a dialog says ask beside its role, still ranked a service', () => {
  // its title's blocked red said so until role panes lost their title
  assert.deepEqual(fleet.view('blocked', '8|role|manager', 0), { rank: '8', badge: 'manager ask', role: true });
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
  // and one from before the context gauge (row 4)
  assert.equal(managed.fleetStale(current.replace(/, \{ token = "\$ctx_ok"[^}]*\}/g, ''), true), true);
  // and one with the older gauge row of its own (a row that starts at the size)
  assert.equal(managed.fleetStale(current.replace(/, \{ token = "\$ctx_ok"/g, '], [{ token = "$ctx_ok"'), true), true);
  // and one from before the work cells (row 9)
  assert.equal(managed.fleetStale(current.replace(/, \{ token = "\$work_ok".*?\}\], /g, '], '), true), true);
  // and one with the work on a row of its own, under the badge's
  assert.equal(managed.fleetStale(current.replace(/, \{ token = "\$work_ok"/g, '], [{ token = "$work_ok"'), true), true);
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

test("with the fleet view on, the badge and the work share one row under the title and every row stays within Herdr's 16 tokens", (t) => {
  withFleet(t, true);
  const on = managed.sidebarBlock('light');
  config.fleetView = false;
  const off = managed.sidebarBlock('light');
  // The badge is not in the title row (fleet view 6.7): in front of the title
  // it pushed the title off a narrow sidebar. It opens a row the work shares.
  const badge = on.match(/\[\{ token = "\$fleet_badge"[^\n]*?"\$work_red"[^\n]*?\}\], /g) ?? [];
  assert.ok(badge.length > 0, 'no badge row in the block');
  assert.equal(new Set(badge).size, 1, 'one badge row, the same on every entry');
  // The owner's glance has no row: the tab bar's health line carries it (the person,
  // 2026-10-07: "this can also be removed the owner queue is on the top herdr bar").
  assert.doesNotMatch(on, /fleet_owner/);
  const agentRow = on.split('\n').find((l) => l.startsWith('rows = ['));
  assert.ok(agentRow.indexOf(badge[0]) > agentRow.indexOf('$title_unknown'), 'the badge row comes after the title row');
  // The context size (row 4): three tier cells inside the title row, in front of the title,
  // never a row of its own (the person, 2026-10-07: the bar's row wasted a line).
  const ctx = on.match(/, \{ token = "\$ctx_ok"[^}]*\}, \{ token = "\$ctx_near"[^}]*\}, \{ token = "\$ctx_over"[^}]*\}/g) ?? [];
  assert.ok(ctx.length > 0, 'no context cells in the block');
  assert.equal(new Set(ctx).size, 1, 'the same context cells on every entry');
  assert.ok(!/\[\{ token = "\$ctx_/.test(on), 'no row starts at the context size');
  const title = on.split('\n').find((l) => l.includes(ctx[0]));
  assert.ok(title.indexOf(ctx[0]) > title.indexOf('$logo_stale') && title.indexOf(ctx[0]) < title.indexOf('$title_working'),
    'the size sits after the logo and in front of the title');
  const palette = require('../lib/palette');
  const fg = (tier) => ctx[0].match(new RegExp(`"\\$ctx_${tier}", fg = "([^"]+)"`))[1];
  assert.deepEqual([fg('ok'), fg('near'), fg('over')],
    [palette.stateFor('light').done, palette.brand.other, palette.stateFor('light').blocked], 'each tier in its own colour');
  assert.match(ctx[0], /"\$ctx_over", fg = "[^"]+", bold = true/, 'over is bold');
  // The lane's work (row 9): ticket, PR and CI, three CI tiers, on the badge's row after the
  // badge (the person, 2026-10-07: a row each was "wasting lines").
  const work = badge[0].match(/, \{ token = "\$work_ok"[^\n]*?"\$work_wait"[^\n]*?"\$work_red"[^\n]*?\}/g) ?? [];
  assert.equal(work.length, 1, 'no work cells after the badge');
  assert.ok(badge[0].indexOf('$fleet_badge') < badge[0].indexOf('$work_ok'), 'the badge before the work');
  const wfg = (tier) => work[0].match(new RegExp(`"\\$work_${tier}", fg = "([^"]+)"`))[1];
  assert.deepEqual([wfg('ok'), wfg('wait'), wfg('red')],
    [palette.stateFor('light').idleNormal, palette.brand.other, palette.stateFor('light').blocked], 'each CI tier in its own colour');
  assert.match(work[0], /"\$work_red", fg = "[^"]+", bold = true/, 'failing CI is bold');
  assert.ok(agentRow.indexOf(badge[0]) < agentRow.indexOf('["$gap"]'), 'and before the gap');
  // A role pane's word leads its title row, after the tree corner and before the logo.
  const role = on.match(/, \{ token = "\$fleet_role"[^\n]*?\] \}/g) ?? [];
  assert.ok(role.length > 0, 'no role word in the block');
  assert.equal(new Set(role).size, 1, 'the same role cell on every entry');
  assert.ok(title.indexOf(role[0]) > title.indexOf('$split_mark') && title.indexOf(role[0]) < title.indexOf('"$logo"'),
    'the role word sits after the corner and in front of the logo');
  assert.doesNotMatch(on, /title_role/);
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
    on.split(badge[0]).join('').split(ctx[0]).join('').split(role[0]).join('').replace(hold, '').replace(tint, ''),
    off,
    'the badge and work row, the context cells, the role word, the hold row and the machine tint are the only differences',
  );
  // sidebarBlock throws when a row passes the limit; this is the count it checks.
  const count = (block) => {
    const row = block.split('\n').find((line) => line.startsWith('rows = ['));
    return (row.split('], [')[2].match(/token = "/g) ?? []).length;
  };
  assert.equal(count(on), count(off) + 4); // the role word and the three context tiers; the badge left the title row
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
  const none = { fleet_role: null, fleet_ws_key: null, fleet_row_key: null };
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

test('a role pane carries no title in any state; a lane keeps its title', () => {
  const state = require('../lib/state');
  const line = { mark: '⣟', split: '', logo: '✳', titlePrefix: '' };
  for (const display of ['working', 'done', 'blocked', 'idle', 'idle_stale']) {
    const role = state.stateTokens(display, line, 'X1 Pro manager handover', 'manager');
    const titles = Object.entries(role).filter(([name, value]) => name.startsWith('title_') && value !== null);
    assert.deepEqual(titles, [], display);
    assert.equal(role.logo_working ?? role.logo ?? role.logo_stale, '✳', `${display} keeps its logo`);
  }
  const lane = state.stateTokens('working', line, 'Implement OAuth scopes', null);
  assert.equal(lane.title_working, 'Implement OAuth scopes');
  assert.equal(lane.title_role, null);
});

test('the frame writes a role pane its word as fleet_role and no badge; a lane its badge', async (t) => {
  withFleet(t, true);
  const writes = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.push(tokens);
    return true;
  });
  const frame = new Frame('test');
  const run = async (entry, display) => {
    const jobs = [];
    frame.fleetJobs(entry, display, 1000, [], jobs);
    await Promise.all(jobs);
  };
  await run({ pane: 'w5:p1', fleet: '8|role|manager' }, 'idle');
  await run({ pane: 'w5:p1', fleet: '8|role|manager' }, 'blocked');
  await run({ pane: 'w4:p1', fleet: '2|owner|YIR-489' }, 'idle');
  const pick = ({ fleet_badge, fleet_role }) => ({ fleet_badge, fleet_role });
  assert.deepEqual(writes.map(pick), [
    { fleet_badge: null, fleet_role: 'manager' },
    { fleet_badge: null, fleet_role: 'manager ask' },
    { fleet_badge: 'owner', fleet_role: null },
  ]);
});

test('roleOf names only a known role from a role token', () => {
  assert.equal(fleet.roleOf('8|role|manager'), 'manager');
  assert.equal(fleet.roleOf('8|role|janitor'), null);
  assert.equal(fleet.roleOf('1|ask'), null);
  assert.equal(fleet.roleOf(undefined), null);
});

test('a role pane at its tree depth: the word takes the indent the logo carried, unless a corner leads', async (t) => {
  withFleet(t, true);
  const state = require('../lib/state');
  const writes = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => {
    writes.push(tokens.fleet_role);
    return true;
  });
  const frame = new Frame('test');
  const entry = { pane: 'w5:p1', name: 'claude', title: 'T', fleet: '8|role|manager' };
  const indent = state.INDENTS[1];
  assert.ok(indent, 'the fixture needs a non-empty indent');
  // the group's head: no corner, so the indent is the first cell's
  const head = state.composeLine(entry, 'idle', '', indent, 0, '');
  assert.ok(head.logo.startsWith(indent), 'a lane keeps the indent on its logo');
  const logo = state.stateTokens('idle', head, 'T', 'manager').logo;
  assert.ok(logo && !logo.startsWith(indent), 'the role pane logo gives it up');
  assert.equal(state.stateTokens('idle', head, 'T', null).logo, head.logo, 'a lane keeps it');
  let jobs = [];
  frame.fleetJobs(entry, 'idle', 1000, [], jobs, undefined, head.margin);
  await Promise.all(jobs);
  // a member: the corner leads and carries the indent, the word none
  const member = state.composeLine(entry, 'idle', '', indent, 0, '├─ ');
  assert.equal(state.stateTokens('idle', member, 'T', 'manager').logo, member.logo);
  jobs = [];
  frame.fleetJobs({ ...entry, pane: 'w5:p2' }, 'idle', 1000, [], jobs, undefined, member.margin);
  await Promise.all(jobs);
  assert.deepEqual(writes, [`${indent}manager`, 'manager']);
});

test('a role note the plugin does not know is still a role pane: no title, the word takes the indent', async (t) => {
  withFleet(t, true);
  const state = require('../lib/state');
  const sent = {};
  t.mock.method(state, 'writeTokens', async (src, pane, tokens) => Object.assign(sent, tokens) && true);
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, src, tokens) => Object.assign(sent, tokens) && true);
  const frame = new Frame('test');
  const indent = state.INDENTS[1];
  const keys = { minuteKey: () => '000000000001', wsKeys: new Map(), tabKeys: new Map(), fleet: undefined };
  const jobs = [];
  const entry = { pane: 'w5:p4', name: 'claude', title: 'Janitor sweep', fleet: '8|role|Janitor' };
  frame.paneJobs(entry, 'idle', { tabs: new Map(), keys, indent, spinStep: 0 }, 1000, [], jobs);
  await Promise.all(jobs);
  assert.equal(sent.fleet_role, `${indent}role`);
  assert.equal(sent.title_idle, null);
  assert.ok(sent.logo && !sent.logo.startsWith(indent), 'the logo gave its indent to the word');
});

test('the role cell reads only a dialog and the role names, so no persona name trips a badge word', (t) => {
  withFleet(t, true);
  const palette = require('../lib/palette');
  const roleCell = managed.sidebarBlock('dark').match(/\{ token = "\$fleet_role"[^\n]*?\] \}/)[0];
  const rules = [...roleCell.matchAll(/contains = "([^"]+)", fg = "([^"]+)"/g)].map(([, word, fg]) => [word, fg]);
  // a dialog first, in the blocked red, matched with its space so `taskmaster` stays plain
  assert.deepEqual(rules[0], [' ask', palette.stateFor('dark').blocked]);
  assert.deepEqual(rules.slice(1).map(([word]) => word), fleet.ROLES);
  const fires = (name) => rules.filter(([word]) => name.includes(word)).map(([word]) => word);
  for (const name of ['compactor', 'controller', 'tester', 'taskmaster', 'idler', 'owner-desk', 'tray-bot']) {
    assert.deepEqual(fires(name), [], name);
  }
  assert.deepEqual(fires('compactor ask'), [' ask']);
  // a persona with no colour of its own reads in the plain ink
  assert.ok(roleCell.startsWith(`{ token = "$fleet_role", fg = "${palette.inkFor('dark')}"`));
});

test('a pane that stops being a role pane is rewritten', () => {
  const state = require('../lib/state');
  const line = { mark: '⣟', split: '', logo: '✳', titlePrefix: '' };
  assert.notEqual(state.lineKey('working', line, 'T', 'executor'), state.lineKey('working', line, 'T', null));
});

test('a fleet-on block from before the role line (role title, owner row) is stale', (t) => {
  withFleet(t, true);
  const block = `${managed.sidebarBlock('dark')}\nfleet-health.txt`;
  assert.equal(managed.fleetStale(block, true), false);
  assert.equal(managed.fleetStale(block.split('$fleet_role').join('$title_role'), true), true);
  // and one from before any persona named its row, whose role cell carried the badge's rules
  assert.equal(managed.fleetStale(block.split('contains = " ask"').join('contains = "ask"'), true), true);
});

test("a fleet-on block with the badge still in the title row is stale, so a start rewrites it", (t) => {
  withFleet(t, true);
  const block = `${managed.sidebarBlock('dark')}\nfleet-health.txt`;
  assert.equal(managed.fleetStale(block, true), false);
  const older = block.split('[{ token = "$fleet_badge"').join('{ token = "$fleet_badge"');
  assert.equal(managed.fleetStale(older, true), true);
});
