'use strict';

// The fleet view (off unless `fleet_view = true`): lanes, needs-you first.
//
// A fleet manager (herdr-manager) knows things about a pane that nothing on
// the pane says — the session ended its turn on a plain-text question, its
// ticket waits on the owner, its lane has approved work nobody started, it is
// a service rather than work. It publishes them as ONE pane token,
//
//   hm_fleet = <rank>|<kind>[|<note>]      1|ask  2|owner|YIR-489  3|tray|3  4|use  5|idle  8|role|executor  9|test|w4:p6
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
// `use`: the person is in that session (the manager's in_use check), ranked with
// working, since someone is on it.
const RANKS = { ask: 1, owner: 2, tray: 3, use: 4, idle: 5, role: 8, test: 9 };
const WORKING = 4;
const UNSTAMPED_IDLE = 5;

// The fleet's service roles, each with its own colour on the badge (lib/palette.js
// roleFor), so the manager's workspace reads as manager / builder / dispatcher
// at a glance instead of a column of grey `role`. A role this list does not
// know still names its row (PERSONA below), in the plain ink.
const ROLES = ['manager', 'builder', 'dispatcher', 'executor', 'relay'];

// A role note that reads as a name is the role pane's word, listed above or not:
// a persona the fleet adds later (sb-herdr-manager agents/<name>/PERSONA.md,
// stamped 8|role|<name>) names its own row in the services group without a
// release here (the person, 2026-10-07: "ensure that when we add more named
// persona to the sb-herdr-manager they load under the services layer"). No
// space in it, so the ` ask` a dialog adds is the only space in the word - and
// none starting `ask`, which behind the row's indent would read as that dialog.
const PERSONA = /^(?!ask)[a-z][a-z0-9-]{0,23}$/;

// The role a pane's hm_fleet names, or null: `8|role|executor` -> 'executor'.
function roleOf(token) {
  const fleet = parse(token);
  return fleet?.kind === 'role' && ROLES.includes(fleet.note) ? fleet.note : null;
}

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
  // A role pane's badge is its one line's name (lib/frame.js fleetJobs writes it
  // as `fleet_role`): the role word, and `ask` beside it while a dialog holds it,
  // which the title's blocked red used to say before role panes lost their title.
  if (fleet && fleet.kind === 'role') {
    const word = PERSONA.test(fleet.note) ? fleet.note : 'role';
    return { rank: String(RANKS.role), badge: display === 'blocked' ? `${word} ask` : word, role: true };
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
  if (fleet.kind === 'use') return { rank: String(RANKS.use), badge: 'in use' };
  if (fleet.kind === 'tray') return { rank: String(RANKS.tray), badge: fleet.note ? `tray ${fleet.note}` : 'tray' };
  if (fleet.kind === 'idle') {
    const ago = age(idleMs);
    return { rank: String(RANKS.idle), badge: ago ? `idle ${ago}` : 'idle' };
  }
  // `owner` says nothing the lane's place does not: nearly every lane wore it.
  return { rank: String(RANKS[fleet.kind]), badge: fleet.kind === 'owner' ? null : fleet.kind };
}

// A project header's rollup (fleet view mockup, section 1): one glyph per state
// with its count, worst first, so a collapsed or scrolled-past project still
// says what is inside - `■1 ◐2 ✓3`. `agents` is [{ display, fleet }]; it counts
// what view() ranks, so live state wins as there: a working pane is `◐` whatever
// its stamp, and an ask or owner stamp on any other pane is needs-you `■`.
const ROLLUP = [['■', 'you'], ['◐', 'working'], ['○', 'waiting'], ['✓', 'done']];

function rollup(agents) {
  const counts = { you: 0, working: 0, waiting: 0, done: 0 };
  for (const agent of agents) {
    const { rank } = view(agent.display, agent.fleet);
    if (rank === String(RANKS.ask) || rank === String(RANKS.owner)) counts.you += 1;
    else if (agent.display === 'working') counts.working += 1;
    else if (agent.display === 'done') counts.done += 1;
    else counts.waiting += 1;
  }
  return ROLLUP.filter(([, kind]) => counts[kind] > 0)
    .map(([glyph, kind]) => `${glyph}${counts[kind]}`)
    .join(' ');
}

// The fleet's service workspaces (fleet view mockup, section 1: "services leave
// the manager's tree"): each one holding a pane the manager stamped
// `8|role|manager`. The manager runs beside the other roles, so its workspace
// IS the services group; the lanes cut from its checkout leave it for a header
// of their own repo. `entries` is [{ workspace, fleet }].
function services(entries) {
  return new Set(entries.filter((entry) => entry.workspace && roleOf(entry.fleet) === 'manager').map((entry) => entry.workspace));
}

// The services workspace draws as three headers, not one (the person, 2026-10-22:
// "all the builders are merged with the services ... a separate header called
// BUILDERS"): the single-instance personas under SERVICES, every `builder*` under
// BUILDERS, and the other numbered instances (`pmo-2`, `executor-1`) under CREW.
// A section is a virtual workspace, `<ws>` for the first and `<ws>~<suffix>` for
// the others, so grouping, sorting and tallies treat each as a project of its own.
const SECTIONS = [
  { suffix: '', title: 'SERVICES' },
  { suffix: '~crew', title: 'CREW' },
  { suffix: '~pmo', title: 'PMO' },
  { suffix: '~builders', title: 'BUILDERS' },
];

// The section a pane's hm_fleet puts it in: an index into SECTIONS.
function sectionOf(token) {
  const fleet = parse(token);
  if (fleet?.kind !== 'role') return 0;
  if (/^builder(-|$)/.test(fleet.note)) return 3;
  if (/^pmo(-|$)/.test(fleet.note)) return 2;
  return /-\d+$/.test(fleet.note) ? 1 : 0;
}

// `entries` with the service workspaces split into their sections: a copy per
// service pane whose `workspace` is the section's virtual id (`realWorkspace`
// keeps the real one, which the Spaces list still wants). Returns
// { entries, services: virtual ids, titles: virtual id -> header word,
//   flat: the sections with no lead row - every pane hangs off the header }.
function sections(entries) {
  const real = services(entries);
  const found = new Set();
  const split = entries.map((entry) => {
    if (!real.has(entry.workspace)) return entry;
    const suffix = SECTIONS[sectionOf(entry.fleet)].suffix;
    found.add(entry.workspace + suffix);
    return { ...entry, workspace: entry.workspace + suffix, realWorkspace: entry.workspace };
  });
  const titles = new Map();
  const flat = new Set();
  for (const id of found) {
    const hit = SECTIONS.find((section) => section.suffix && id.endsWith(section.suffix));
    titles.set(id, hit ? hit.title : SECTIONS[0].title);
    if (hit) flat.add(id);
  }
  return { entries: split, services: found, titles, flat };
}

// The lanes that need the person pin to one NEEDS YOU section at the top, one
// row each, the verb leading (the person, 2026-10-22: "group by what he must do").
// A virtual workspace like the services sections, spanning every real workspace.
const NEEDS = '~you';

// A report that names someone else to wait on is not the person's to act on:
// `waiting on: the manager ...`, `waiting on: backend team ...`. One that names
// the person, or no one, is (an agent's free text, so the unrecognised stays in).
const WAITS_ON_PERSON = /\b(ceo|owner|you|person)\b/i;

// The verb of a lane that needs the person, or null. `status` is Herdr's own
// (a live dialog is an ask; a working pane is working whatever it was stamped),
// `token` the manager's hm_fleet, `title` the lane's own last report.
function needVerb(status, token, title) {
  if (status === 'working') return null;
  if (status === 'blocked') return 'ASK';
  const fleet = parse(token);
  if (fleet?.kind === 'ask') return 'ASK';
  if (fleet?.kind !== 'owner') return null;
  const text = typeof title === 'string' ? title : '';
  const waits = /^\s*waiting on\b:?\s*(.*)/i.exec(text);
  if (waits && !WAITS_ON_PERSON.test(waits[1])) return null;
  if (/^\s*asks?:/i.test(text)) return 'ASK';
  if (/^\s*blocked:/i.test(text)) return 'BLOCKED';
  return 'YOU';
}

// `entries` with each lane that needs the person moved into the NEEDS section: a
// copy with `workspace` the section's id, `realWorkspace` the one it came from,
// `need` its verb and `project` the name the row carries. `labels` is real
// workspace -> name; `statusOf` is the status the frame will draw (grace and hold
// applied), so a lane does not flip in and out on a one-tick blip. Returns { entries, any }.
function needsYou(entries, labels, statusOf = (entry) => entry.status) {
  let any = false;
  const moved = entries.map((entry) => {
    const verb = needVerb(statusOf(entry), entry.fleet, entry.title);
    if (!verb) return entry;
    any = true;
    const real = entry.realWorkspace ?? entry.workspace;
    return { ...entry, workspace: NEEDS, realWorkspace: real, need: verb, project: labels.get(real) ?? real };
  });
  return { entries: moved, any };
}

// The word a NEEDS row leads with: the glyph the header rollup uses for the same
// thing (the one rule that colours it), the verb, the project, how long it has waited.
function needWord(verb, project, idleMs) {
  const ago = age(idleMs);
  return `■ ${verb} ${project}${ago ? ` ${ago}` : ''}`;
}

// The header a project block sits under, from its lanes' own state (`agents` is
// [{ display, fleet }]): WAITING for a lane the manager stamped to the owner whose
// report names someone else (the ones left once NEEDS YOU took the person's own),
// IDLE for a block whose every lane has gone stale, WORKING for the rest. Judged
// on the same rank the order sorts on, so each is one contiguous run.
const LANE_SECTIONS = ['WAITING', 'WORKING', 'IDLE'];

function laneSection(agents) {
  const ranks = agents.map((agent) => Number(view(agent.display, agent.fleet).rank));
  const best = Math.min(...ranks);
  if (best <= RANKS.owner) return 'WAITING';
  if (best >= RANKS.idle && agents.every((agent) => agent.display === 'idle_stale')) return 'IDLE';
  return 'WORKING';
}

// The rank a row sorts on in the `fleet` order: every row of the services group
// ranks as a role, stamped or not, so the group sorts below all work; the digit
// after it keeps the sections in SECTIONS' order.
function orderRank(display, token, service, need = null) {
  if (need) return String(need === 'YOU' ? RANKS.owner : RANKS.ask);
  return service ? `${RANKS.role}${sectionOf(token)}` : view(display, token).rank;
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
function orderKeys(rows, familyOf, machine = '', waiting = new Set()) {
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
    // A `waiting` workspace (NEEDS YOU) has no lead and runs oldest first.
    const wait = waiting.has(row.workspace);
    const first = !wait && row.workspace && head.get(row.workspace) === row.pane ? '0' : '1';
    rowKeys.set(row.pane, `${first}-${row.rank}-${wait ? row.minute : inv(row.minute)}-${row.pane}`);
  }
  return { wsKeys, rowKeys };
}

module.exports = {
  parse,
  age,
  nextAgeChange,
  view,
  orderKeys,
  rollup,
  roleOf,
  services,
  sections,
  sectionOf,
  needsYou,
  needWord,
  laneSection,
  LANE_SECTIONS,
  needVerb,
  NEEDS,
  orderRank,
  RANKS,
  ROLES,
  PERSONA,
  WORKING,
  UNSTAMPED_IDLE,
};
