/* Signoff PL People & access: shared made-up data, access rules, the change planner, and small UI helpers.
   Made-up data only (the suite's Smart Thermostat demo for "Acme Climate"). Nothing here talks to GitHub.

   The access model, per person per PL project:
     system   whole system: the PL project and every linked review (no scopes entry in PL's users.json)
     project  the PL project plus chosen Parts (scopes[projectId] = 'project')
     parts    not on the PL project; chosen Parts only, recorded in each tool's own users.json
   FTEs see everything; their status comes from Signoff EE's roster and isn't edited here. */
(function () {
  'use strict';

  var TOOLS = {
    pl:   { label: 'PL',        name: 'Signoff PL', prefix: 'review-pl-',   data: 'signoff_pl_data' },
    ee:   { label: 'EE',        name: 'Signoff EE', prefix: 'review-ee-',   data: 'ee_design_review_data' },
    me:   { label: 'ME',        name: 'Signoff ME', prefix: 'review-me-',   data: 'me_design_review_data' },
    fw:   { label: 'FW',        name: 'Signoff FW', prefix: 'review-fw-',   data: 'fw_design_review_data' },
    loom: { label: 'Loom',      name: 'Loom',       prefix: 'review-loom-', data: 'loom_data' },
    buy:  { label: 'Purchased', name: '',           prefix: '',             data: '' }
  };

  function slug(s) { return s.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  // shared: true when the review already lives in its own review-<tool>-<slug> repo.
  var PROJECTS = [
    { id: 'pldemo', name: 'Smart Thermostat', client: 'Acme Climate', kind: 'project', tool: 'pl', shared: true, kids: [
      { id: 'asm-elec', name: 'Electronics', kind: 'asm', kids: [
        { id: 'pdemo7', name: 'Main PCBA', tool: 'ee', pn: 'ACM-2001-300', shared: true },
        { id: 'pdemo11', name: 'Display & Sensor Board', tool: 'ee', pn: 'ACM-2002-300', shared: true },
        { id: 'fdemo3', name: 'Thermostat Firmware', tool: 'fw', pn: 'ACM-2090-001', shared: true },
        { id: 'ldemo2', name: 'Display Ribbon Harness', tool: 'loom', pn: 'ACM-2050-100', shared: true, note: 'Linked after the project was shared' },
        { id: 'buy-tb', name: 'Terminal block, 5-pos', tool: 'buy', pn: 'Purchased' }
      ] },
      { id: 'asm-housing', name: 'Housing', kind: 'asm', kids: [
        { id: 'mdemo5', name: 'Enclosure', tool: 'me', pn: 'ACM-2010-100', shared: true },
        { id: 'mdemo13', name: 'Wall Bracket', tool: 'me', pn: 'ACM-2011-100', shared: false, note: 'Linked after the project was shared' },
        { id: 'buy-pipe', name: 'Light pipe, 3 mm', tool: 'buy', pn: 'Purchased' },
        { id: 'buy-m3', name: 'Screw, M3 × 8 mm (×4)', tool: 'buy', pn: 'Purchased' }
      ] }
    ] },
    { id: 'pldemo-aq', name: 'Air Quality Sensor', client: 'Acme Climate', kind: 'project', tool: 'pl', shared: false, kids: [
      { id: 'asm-aq', name: 'Sensor module', kind: 'asm', kids: [
        { id: 'pdemo21', name: 'Sensor PCBA', tool: 'ee', pn: 'ACM-3001-300', shared: false },
        { id: 'mdemo22', name: 'AQ Housing', tool: 'me', pn: 'ACM-3010-100', shared: true },
        { id: 'buy-fan', name: 'Fan, 30 mm, 5 V', tool: 'buy', pn: 'Purchased' }
      ] }
    ] }
  ];

  var PEOPLE = [
    // home: the tool whose People page added them. PL lists everyone on every tool's roster (Chris, 2026-11-07).
    { login: 'sam-rivera', name: 'Sam Rivera', role: 'fte', hue: 186, home: 'ee' },
    { login: 'priya-nair', name: 'Priya Nair', role: 'fte', hue: 262, home: 'ee' },
    // Clients carry a company (users[login].company); a company will often have many clients (Chris, 2026-11-07).
    { login: 'morgan-hale-acme', name: 'Morgan Hale', role: 'client', company: 'Acme Climate', hue: 28, note: 'Program manager', home: 'pl' },
    { login: 'dana-ortiz-acme', name: 'Dana Ortiz', role: 'client', company: 'Acme Climate', hue: 352, note: 'Quality engineer', home: 'me' },
    { login: 'lee-wong-acme', name: 'Lee Wong', role: 'client', company: 'Acme Climate', hue: 200, note: 'Firmware lead', home: 'fw' },
    { login: 'ari-shah-nwr', name: 'Ari Shah', role: 'client', company: 'Northwind Retail', hue: 48, note: 'Buyer', home: 'pl' },
    { login: 'jordan-lee-ext', name: 'Jordan Lee', role: 'contractor', hue: 140, note: 'EE contractor', home: 'ee' },
    { login: 'alex-kim-ext', name: 'Alex Kim', role: 'contractor', hue: 320, note: 'ME contractor', home: 'me' },
    { login: 'casey-wu-ext', name: 'Casey Wu', role: 'contractor', hue: 220, note: 'FW contractor', home: 'fw' },
    { login: 'riley-park-ext', name: 'Riley Park', role: 'contractor', hue: 96, note: 'ME contractor, tooling', home: 'me' }
  ];

  // Access as stored today. proj: the PL project ('yes' | 'pending'); parts: explicit grants; in system
  // mode, parts only carries invites still pending.
  var BASE = {
    'pldemo': {
      'morgan-hale-acme': { mode: 'system', proj: 'yes', parts: { ldemo2: 'pending' } },
      'jordan-lee-ext': { mode: 'parts', parts: { pdemo7: 'yes', pdemo11: 'pending' } },
      'alex-kim-ext': { mode: 'project', proj: 'yes', parts: { mdemo5: 'yes' } },
      'casey-wu-ext': { mode: 'project', proj: 'pending', parts: { fdemo3: 'pending' } },
      'dana-ortiz-acme': { mode: 'parts', parts: { mdemo5: 'yes' } },
      'lee-wong-acme': { mode: 'project', proj: 'yes', parts: { fdemo3: 'yes' } }
    },
    'pldemo-aq': {
      'alex-kim-ext': { mode: 'parts', parts: { mdemo22: 'yes' } }
    }
  };
  // One change staged at load, so each tab shows a "not shared yet" cell and a plan.
  function seed(d) { acc(d, 'pldemo', 'alex-kim-ext').parts.mdemo13 = 'yes'; }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var draft = clone(BASE); seed(draft);
  var listeners = [], applied = null;
  // Any edit clears the "Applied" note, so the footer only ever says one true thing.
  function changed(keepApplied) { if (!keepApplied) applied = null; listeners.forEach(function (f) { f(); }); }

  function acc(store, pid, login) {
    var p = store[pid] || (store[pid] = {});
    return p[login] || (p[login] = { mode: 'parts', parts: {} });
  }
  function peek(store, pid, login) { return (store[pid] && store[pid][login]) || { mode: 'parts', parts: {} }; }

  var NODES = {}, PARENT = {}, PROJ_OF = {};
  function index(n, parent, proj) {
    NODES[n.id] = n; PARENT[n.id] = parent ? parent.id : null; PROJ_OF[n.id] = proj.id;
    if (!n.kind) n.kind = 'part';
    (n.kids || []).forEach(function (k) { index(k, n, proj); });
  }
  PROJECTS.forEach(function (p) { index(p, null, p); });

  function person(login) { return PEOPLE.filter(function (p) { return p.login === login; })[0]; }
  function isFte(login) { var p = person(login); return p && p.role === 'fte'; }
  function leaves(n) {
    if (n.kind === 'part') return [n];
    return (n.kids || []).reduce(function (a, k) { return a.concat(leaves(k)); }, []);
  }
  function toolLeaves(n) { return leaves(n).filter(function (x) { return x.tool !== 'buy'; }); }
  function walk(n, fn, depth) { fn(n, depth || 0); (n.kids || []).forEach(function (k) { walk(k, fn, (depth || 0) + 1); }); }

  // Where a node's data lives now, and where it would live once shared.
  function repoOf(n) {
    var t = TOOLS[n.tool];
    if (n.kind === 'asm') return null;
    if (n.tool === 'buy') { var p = NODES[PROJ_OF[n.id]]; return { name: repoOf(p).name, fteOnly: !p.shared, inPl: true }; }
    if (n.shared) return { name: t.prefix + slug(n.name), fteOnly: false };
    return { name: t.data, fteOnly: true, future: t.prefix + slug(n.name) };
  }

  function onPl(a) { return a.mode === 'system' || a.mode === 'project'; }
  function holds(a, n) {
    if (n.kind === 'project') return onPl(a) ? (a.proj || 'yes') : null;
    if (n.tool === 'buy') return onPl(a) ? 'yes' : null;
    if (a.mode === 'system') return a.parts[n.id] || 'yes';
    return a.parts[n.id] || null;
  }

  /* The state of one cell. s is one of:
     fte, yes, pending, new (needs a new private repo), add (invite to an existing repo), remove, none,
     with-pl (purchased; comes with the PL project), na (purchased; nothing to share),
     and for assemblies: all, some, none, na. inherited: true when it comes from Whole system. */
  function cell(pid, login, nodeOrId) {
    var n = typeof nodeOrId === 'string' ? NODES[nodeOrId] : nodeOrId;
    if (isFte(login)) return { s: 'fte' };
    var a = peek(draft, pid, login), b = peek(BASE, pid, login);
    if (n.kind === 'asm') {
      var ls = toolLeaves(n); if (!ls.length) return { s: 'na' };
      var k = ls.filter(function (x) { return holds(a, x); }).length;
      return { s: k === ls.length ? 'all' : k ? 'some' : 'none', n: k, of: ls.length, inherited: a.mode === 'system' };
    }
    var now = holds(a, n), was = holds(b, n);
    var inherited = n.kind !== 'project' && a.mode === 'system';
    if (n.tool === 'buy') return { s: now ? 'with-pl' : 'na', inherited: !!now };
    if (now && was) return { s: !n.shared && n.kind !== 'project' ? 'new' : was === 'pending' ? 'pending' : 'yes', inherited: inherited };
    if (now) return { s: n.shared ? 'add' : 'new', inherited: inherited };
    if (was) return { s: 'remove' };
    return { s: 'none', unshared: !n.shared };
  }
  function granted(st) { return /^(fte|yes|pending|new|add|with-pl|all)$/.test(st.s); }

  // ── Edits ──
  function setMode(pid, login, mode) {
    if (isFte(login)) return;
    var a = acc(draft, pid, login), b = peek(BASE, pid, login);
    if (a.mode === 'system' && mode !== 'system') {
      // Leaving Whole system keeps what the person can open now as explicit grants, so nothing is lost silently.
      toolLeaves(NODES[pid]).forEach(function (x) { if (!a.parts[x.id] || a.parts[x.id] === 'pending') a.parts[x.id] = a.parts[x.id] || 'yes'; });
    }
    if (mode === 'system') toolLeaves(NODES[pid]).forEach(function (x) { if (a.parts[x.id] !== 'pending') delete a.parts[x.id]; });
    a.mode = mode;
    if (onPl(a)) a.proj = b.proj && onPl(b) ? b.proj : 'yes'; else delete a.proj;
    changed();
  }
  function grant(pid, login, n, on) {
    var a = acc(draft, pid, login), b = peek(BASE, pid, login);
    if (n.kind === 'project') { setMode(pid, login, on ? (a.mode === 'parts' ? 'project' : a.mode) : 'parts'); return; }
    var ls = toolLeaves(n); if (!ls.length) return;
    if (a.mode === 'system' && !on) setMode(pid, login, 'project');
    ls.forEach(function (x) {
      if (on) a.parts[x.id] = holds(b, x) || 'yes';
      else delete a.parts[x.id];
    });
    changed();
  }
  function toggle(pid, login, nodeOrId) {
    var n = typeof nodeOrId === 'string' ? NODES[nodeOrId] : nodeOrId;
    if (isFte(login) || n.tool === 'buy') return;
    var st = cell(pid, login, n);
    if (n.kind === 'project') { setMode(pid, login, peek(draft, pid, login).mode === 'system' ? 'project' : 'system'); return; }
    grant(pid, login, n, !(st.s === 'all' || (n.kind !== 'asm' && granted(st))));
  }
  function removeAll(pid, login) { var a = acc(draft, pid, login); a.mode = 'parts'; a.parts = {}; delete a.proj; changed(); }
  function reset(withSeed) { draft = clone(BASE); if (withSeed) seed(draft); changed(); }
  function mode(pid, login) { return isFte(login) ? 'fte' : peek(draft, pid, login).mode; }
  function baseMode(pid, login) { return isFte(login) ? 'fte' : peek(BASE, pid, login).mode; }
  function members(pid) {
    return PEOPLE.filter(function (p) {
      if (p.role === 'fte') return true;
      var a = peek(draft, pid, p.login), b = peek(BASE, pid, p.login);
      return onPl(a) || onPl(b) || Object.keys(a.parts).length || Object.keys(b.parts).length;
    });
  }

  // ── Apply (simulated in the page) ──
  function apply() {
    var items = plan(); if (!items.length) return;
    var next = clone(draft);
    PROJECTS.forEach(function (p) {
      PEOPLE.forEach(function (who) {
        if (who.role === 'fte' || !next[p.id] || !next[p.id][who.login]) return;
        var a = next[p.id][who.login], b = peek(BASE, p.id, who.login);
        if (onPl(a) && !onPl(b)) a.proj = 'pending';
        toolLeaves(p).forEach(function (x) { if (holds(a, x) && (!holds(b, x) || !x.shared)) a.parts[x.id] = 'pending'; });
      });
    });
    var made = items.filter(function (x) { return x.k === 'create'; }).map(function (x) { return x.repo; });
    Object.keys(NODES).forEach(function (id) {
      var n = NODES[id], r = n.kind !== 'asm' && n.tool !== 'buy' ? repoOf(n) : null;
      if (r && (made.indexOf(r.future) >= 0 || (n.kind === 'project' && made.indexOf(TOOLS.pl.prefix + slug(n.name)) >= 0))) n.shared = true;
    });
    BASE = next; draft = clone(next); applied = items;
    changed(true);
  }

  // Which tools' people lists someone is on: where they were added, plus every roster a grant wrote.
  var ROSTER_ORDER = ['pl', 'ee', 'me', 'fw', 'loom'];
  function rosters(login) {
    var p = person(login);
    if (p.role === 'fte') return ROSTER_ORDER.slice();
    var on = {}; on[p.home] = true;
    PROJECTS.forEach(function (pr) {
      var b = peek(BASE, pr.id, login);
      if (onPl(b)) on.pl = true;
      toolLeaves(pr).forEach(function (x) { if (holds(b, x)) on[x.tool] = true; });
    });
    return ROSTER_ORDER.filter(function (k) { return on[k]; });
  }
  function rosterTags(login) {
    var r = rosters(login), p = person(login);
    return '<span class="rosters" title="' + esc(p.role === 'fte' ? 'FTE: on every tool' : 'On the people list of ' + r.map(function (k) { return TOOLS[k].name; }).join(', ') + '; added in ' + TOOLS[p.home].name) + '">' +
      r.map(function (k) { return '<span class="src ' + k + (k === p.home ? ' home' : '') + '">' + TOOLS[k].label + '</span>'; }).join('') + '</span>';
  }

  // Taking someone off a PL project asks whether their Parts go too (Chris, 2026-11-07).
  function changeMode(pid, login, m) {
    if (m === 'parts' && onPl(peek(draft, pid, login))) askRemove([pid], login); else setMode(pid, login, m);
  }
  function askRemove(pids, login) {
    var p = person(login), keep = [], repos = [];
    pids.forEach(function (pid) {
      var a = peek(draft, pid, login);
      toolLeaves(NODES[pid]).forEach(function (x) { if (holds(a, x)) { keep.push(x.name); var r = repoOf(x); repos.push(r.future || r.name); } });
    });
    var onAny = pids.some(function (pid) { return onPl(peek(draft, pid, login)); });
    var where = pids.length > 1 ? 'every PL project' : NODES[pids[0]].name;
    var scrim = document.createElement('div');
    scrim.className = 'dlg-scrim';
    scrim.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" aria-label="Remove ' + esc(p.name) + '">' +
      '<h3>Remove ' + esc(p.name) + ' from ' + esc(where) + '?</h3>' +
      (onAny ? '<button type="button" class="dlg-opt" data-rm="pl"><b>Only the PL project</b><span>' +
        (keep.length ? 'They keep ' + keep.length + ' Part' + (keep.length > 1 ? 's' : '') + ': ' + esc(keep.join(', ')) + '. Those stay in each tool’s people list, where that tool manages them.' : 'They have no Parts here, so this is the same as removing everything.') + '</span></button>' : '') +
      '<button type="button" class="dlg-opt" data-rm="all"><b>' + (onAny ? 'The PL project and its Parts' : 'Every Part here') + '</b><span>' +
        (repos.length ? 'Also takes them off ' + esc(repos.join(', ')) + '.' : 'Takes them off the PL project’s repo.') + '</span></button>' +
      '<div class="dlg-foot"><span class="muted">' + icon('clock') + 'Staged only. Nothing changes on GitHub until Apply.</span><button type="button" class="btn" data-rm="cancel">Cancel</button></div></div>';
    document.body.appendChild(scrim);
    var first = scrim.querySelector('.dlg-opt'); if (first) first.focus();
    function close() { scrim.remove(); document.removeEventListener('keydown', esc_); }
    function esc_(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc_);
    scrim.addEventListener('click', function (e) {
      if (e.target === scrim) { close(); return; }
      var b = e.target.closest('[data-rm]'); if (!b) return;
      var how = b.getAttribute('data-rm');
      close();
      if (how === 'pl') pids.forEach(function (pid) { if (onPl(peek(draft, pid, login))) setMode(pid, login, 'parts'); });
      if (how === 'all') pids.forEach(function (pid) { removeAll(pid, login); });
    });
  }

  // ── What Apply would do ──
  function plan() {
    var creates = {}, invites = {}, removes = {}, rosters = {};
    function add(map, key, v) { (map[key] = map[key] || []).indexOf(v) < 0 && map[key].push(v); }
    PROJECTS.forEach(function (p) {
      PEOPLE.forEach(function (who) {
        if (who.role === 'fte') return;
        var a = peek(draft, p.id, who.login), b = peek(BASE, p.id, who.login);
        if (a.mode !== b.mode && (onPl(a) || onPl(b))) {
          add(rosters, 'PL users.json', who.login + ': ' + (a.mode === 'system' ? 'whole system on ' + p.name : a.mode === 'project' ? 'scope “project” on ' + p.name : 'off ' + p.name));
        }
        if (onPl(a) && !onPl(b)) {
          var pr = repoOf(p);
          if (!p.shared) creates[TOOLS.pl.prefix + slug(p.name)] = p.name + ' (from ' + pr.name + ')';
          add(invites, p.shared ? pr.name : TOOLS.pl.prefix + slug(p.name), who.login);
        }
        if (!onPl(a) && onPl(b)) add(removes, repoOf(p).name, who.login);
        toolLeaves(p).forEach(function (x) {
          var now = holds(a, x), was = holds(b, x), r = repoOf(x), t = TOOLS[x.tool];
          var target = r.future || r.name;
          if (now && (!was || !x.shared)) {
            if (!x.shared) creates[target] = x.name + ' (from ' + r.name + ')';
            add(invites, target, who.login);
            add(rosters, t.label + ' users.json', who.login + ' + ' + x.name);
          } else if (!now && was) {
            add(removes, target, who.login);
            add(rosters, t.label + ' users.json', who.login + ' − ' + x.name);
          }
        });
      });
    });
    var out = [];
    Object.keys(creates).forEach(function (r) { out.push({ k: 'create', repo: r, text: 'Create private repo', detail: 'moves ' + creates[r] + '; FTEs invited' }); });
    Object.keys(invites).forEach(function (r) { out.push({ k: 'invite', repo: r, text: 'Invite ' + invites[r].join(', ') }); });
    Object.keys(removes).forEach(function (r) { out.push({ k: 'remove', repo: r, text: 'Remove ' + removes[r].join(', ') }); });
    Object.keys(rosters).forEach(function (r) { out.push({ k: 'roster', repo: r, text: rosters[r].join('; ') }); });
    return out;
  }

  // ── UI helpers ──
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var I = {
    check: '<path d="M3.5 8.5l3 3 6-7"/>',
    clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9"/>',
    newrepo: '<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke-dasharray="2.2 1.6"/><path d="M8 5.5v5M5.5 8h5"/>',
    minus: '<path d="M3.5 8h9"/><path d="M4 4l8 8" opacity=".55"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7"/>',
    dash: '<path d="M5 8h6"/>',
    box: '<path d="M2.8 5.2L8 2.8l5.2 2.4v5.6L8 13.2l-5.2-2.4z"/><path d="M2.8 5.2L8 7.6l5.2-2.4M8 7.6v5.6"/>',
    ring: '<circle cx="8" cy="8" r="4.5"/>',
    half: '<circle cx="8" cy="8" r="5"/><path d="M8 3a5 5 0 010 10z" fill="currentColor"/>',
    caret: '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
    repo: '<path d="M4 2.5h7.5v10H5a1 1 0 01-1-1z"/><path d="M4 11.5a1 1 0 011-1h6.5"/>',
    via: '<path d="M4 3v5.5a1.5 1.5 0 001.5 1.5H12"/><path d="M9.5 7.5L12 10l-2.5 2.5"/>',
    x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
    building: '<path d="M3 13.5V3h6.5v10.5M9.5 6.5H13v7M2 13.5h12"/><path d="M5.2 5.5h2M5.2 8h2M5.2 10.5h2"/>',
    wrench: '<path d="M10.6 2.6a3 3 0 00-3 3.9l-4.9 4.9a1.2 1.2 0 001.7 1.7l4.9-4.9a3 3 0 003.9-3l-1.8 1.8-1.7-.4-.4-1.7z"/>',
    person: '<circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>'
  };
  function icon(name, cls) { return '<svg class="pi ' + (cls || '') + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[name] + '</svg>'; }

  var STATE = {
    fte:      { icon: 'lock', label: 'FTE', long: 'FTE: sees everything (Signoff EE roster)' },
    yes:      { icon: 'check', label: 'Access', long: 'Has access' },
    pending:  { icon: 'clock', label: 'Invited', long: 'Invite pending: not accepted on GitHub yet' },
    'new':    { icon: 'newrepo', label: 'New repo', long: 'Not shared yet: Apply creates a private repo and invites' },
    add:      { icon: 'plus', label: 'Invite', long: 'Apply invites them to the existing repo' },
    remove:   { icon: 'minus', label: 'Remove', long: 'Apply removes their access' },
    none:     { icon: 'ring', label: '', long: 'No access' },
    'with-pl':{ icon: 'box', label: 'With PL', long: 'Purchased: no Signoff tool, comes with the PL project' },
    na:       { icon: 'dash', label: 'No tool', long: 'Purchased: no Signoff tool, nothing to share' },
    all:      { icon: 'check', label: 'All', long: 'Every Part below' },
    some:     { icon: 'half', label: 'Some', long: 'Some Parts below' }
  };
  // A state pill: icon + short text, patterned per state so nothing depends on hue.
  function pill(st, opts) {
    opts = opts || {};
    var d = STATE[st.s] || STATE.none;
    var label = opts.label || (st.s === 'some' ? st.n + ' of ' + st.of : st.s === 'all' && st.of ? 'All ' + st.of : d.label);
    var tip = d.long + (st.inherited ? ' (via Whole system)' : '') + (st.s === 'none' && st.unshared ? '. Not shared yet: granting creates a private repo' : '');
    return '<span class="pst s-' + st.s + (st.inherited ? ' inh' : '') + (opts.compact ? ' compact' : '') + '" title="' + esc(tip) + '">' +
      icon(st.inherited && st.s === 'yes' ? 'via' : d.icon) + (opts.compact || !label ? '' : '<span>' + esc(label) + '</span>') + '</span>';
  }
  // The legend: one compact strip of labeled groups. Each sample's full meaning is in its tooltip.
  var LEGEND = [
    ['Access', [['yes'], ['yes', true, 'Inherited'], ['pending']]],
    ['On Apply', [['new'], ['add'], ['remove']]],
    ['Purchased', [['with-pl'], ['na']]]
  ];
  function legend(opts) {
    opts = opts || {};
    return '<div class="legend" aria-label="Legend">' + LEGEND.map(function (g) {
      return '<div class="lg"><span class="lg-h">' + esc(g[0]) + '</span><span class="lg-items">' + (opts[g[0]] || g[1].map(function (x) {
        return pill({ s: x[0], inherited: !!x[1] }, { label: x[2] });
      }).join('')) + '</span></div>';
    }).join('') + '<div class="lg"><span class="lg-h">Roles</span><span class="lg-items">' + ROLE_ORDER.map(function (k) {
      var r = ROLES[k]; return '<span class="rtag r-' + k + '" title="' + esc(r.label + ': ' + r.about) + '">' + icon(r.icon) + esc(r.label) + '</span>';
    }).join('') + '</span></div></div>';
  }
  function tool(n) { var t = TOOLS[n.tool]; return t ? '<span class="src ' + n.tool + '">' + t.label + '</span>' : ''; }
  function repo(n, opts) {
    var r = repoOf(n); if (!r) return '';
    opts = opts || {};
    if (r.inPl) return '<span class="repo" title="Lives in the PL project’s repo">' + icon('repo') + 'in ' + esc(r.name) + '</span>';
    return '<span class="repo' + (r.fteOnly ? ' fte-only' : '') + '" title="' + esc(r.fteOnly ? 'FTE-only data repo. Sharing moves it into ' + (r.future || 'its own repo') : 'Private repo for this item') + '">' +
      icon('repo') + esc(r.name) + (r.fteOnly ? ' · FTE only' : '') + (opts.future && r.future ? ' → ' + esc(r.future) : '') + '</span>';
  }
  function initials(p) { return p.name.split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2); }
  function avatar(p, extra) {
    return '<span class="pav ' + (extra || '') + '" style="--h:' + p.hue + '" title="' + esc(p.login ? p.name + ' (' + p.login + ')' : p.name) + '">' + esc(initials(p)) + '</span>';
  }
  // Three roles (Chris, 2026-11-07): FTE, Client and Contractor. Clients and contractors get the same kind of
  // access (only what's shared with them; M.isOutside), but are labeled apart: an icon and a word, never hue.
  var ROLES = {
    fte: { icon: 'lock', label: 'FTE', long: 'FTE · from Signoff EE', group: 'FTEs', about: 'See everything; set in Signoff EE’s roster' },
    client: { icon: 'building', label: 'Client', long: 'Client', group: 'Clients', about: 'The client’s people: only what’s shared with them' },
    contractor: { icon: 'wrench', label: 'Contractor', long: 'Contractor', group: 'Contractors', about: 'Outside help: only what’s shared with them' }
  };
  var ROLE_ORDER = ['fte', 'client', 'contractor'];
  function role(p) { var r = ROLES[p.role]; return '<span class="role r-' + p.role + '">' + icon(r.icon) + esc(r.long + (p.company ? ' · ' + p.company : '')) + '</span>'; }
  // Clients split by company, companies in name order.
  function byCompany(list) {
    var names = [];
    list.forEach(function (p) { if (names.indexOf(p.company || '') < 0) names.push(p.company || ''); });
    return names.sort().map(function (c) { return { company: c, people: list.filter(function (p) { return (p.company || '') === c; }) }; });
  }
  function roleTag(p, short) { var r = ROLES[p.role]; return '<span class="rtag r-' + p.role + '" title="' + esc(r.label + ': ' + r.about) + '">' + icon(r.icon) + (short ? '' : esc(r.label)) + '</span>'; }
  function byRole(list) {
    return ROLE_ORDER.map(function (k) { return { role: k, info: ROLES[k], people: list.filter(function (p) { return p.role === k; }) }; })
      .filter(function (g) { return g.people.length; });
  }
  var MODES = [['system', 'Whole system', 'The PL project and every linked review, now and later'],
    ['project', 'PL + chosen Parts', 'The PL project, plus only the Parts ticked. Coming from Whole system, what they can open now stays ticked'],
    ['parts', 'Parts only', 'Not on the PL project: only the reviews ticked, from each tool']];
  function modeSeg(pid, login, small) {
    if (isFte(login)) return '<span class="mode-lock">' + icon('lock') + 'Sees everything</span>';
    var m = mode(pid, login), b = baseMode(pid, login);
    return '<div class="seg mode-seg' + (small ? ' small' : '') + '" role="radiogroup" aria-label="Access for ' + esc(person(login).name) + '">' + MODES.map(function (x) {
      return '<button type="button" role="radio" aria-checked="' + (m === x[0]) + '" class="' + (m === x[0] ? 'on' : '') + (m === x[0] && b !== x[0] ? ' changed' : '') +
        '" data-mode="' + x[0] + '" data-login="' + esc(login) + '" title="' + esc(x[2]) + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
  }

  // Page chrome: the two tabs, theme toggle, the plan footer.
  var PAGES = [['people.html', 'Person first'], ['chips.html', 'Tree with people']];
  var THEME_KEY = 'signoff.lab.permTheme';
  function theme(t) {
    if (t) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* storage blocked */ } }
    else { try { t = localStorage.getItem(THEME_KEY) || ''; } catch (e) { t = ''; } }
    if (!t) { try { t = (JSON.parse(localStorage.getItem('signoff.v1.settings') || '{}').theme) || 'auto'; } catch (e) { t = 'auto'; } }
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    return t;
  }
  function chrome(here, title, sub) {
    var t = theme();
    var head = document.createElement('header');
    head.className = 'lab-head';
    head.innerHTML = '<div class="lab-top"><a class="lab-back" href="index.html">Signoff PL · Settings</a>' +
      '<nav class="seg lab-nav">' + PAGES.map(function (p) { return '<a class="' + (p[0] === here ? 'on' : '') + '" href="' + p[0] + '">' + esc(p[1]) + '</a>'; }).join('') + '</nav>' +
      '<div class="seg lab-theme">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (x) {
        return '<button type="button" data-theme-set="' + x[0] + '" class="' + (t === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="lab-title"><div class="eyebrow">Signoff PL settings · People &amp; access</div><h1 class="page-title">' + esc(title) + '</h1><p class="lab-sub">' + sub + '</p>' +
      '<p class="lab-scope">' + icon('lock') + '<span>This is Signoff PL’s People &amp; access only. Signoff EE, ME, and FW keep their own people pages as they are, each managing its own people.</span></p></div>';
    document.body.insertBefore(head, document.body.firstChild);
    head.addEventListener('click', function (e) {
      var b = e.target.closest('[data-theme-set]'); if (!b) return;
      theme(b.getAttribute('data-theme-set'));
      head.querySelectorAll('[data-theme-set]').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    var foot = document.createElement('footer');
    foot.className = 'plan';
    document.body.appendChild(foot);
    function draw() {
      var items = plan(), done = !items.length && applied, shown = items.length ? items : done || [];
      var counts = { create: 0, invite: 0, remove: 0, roster: 0 };
      shown.forEach(function (x) { counts[x.k]++; });
      var KIND = { create: ['newrepo', 'New repo'], invite: ['plus', 'Invite'], remove: ['minus', 'Remove'], roster: ['person', 'Roster'] };
      foot.classList.toggle('staged', !!items.length);
      foot.classList.toggle('done', !!done);
      foot.innerHTML = '<div class="plan-bar"><button type="button" class="plan-toggle" aria-expanded="' + foot.classList.contains('open') + '">' + icon('caret') +
        (items.length ? '<span class="plan-flag f-staged">' + icon('clock') + 'Staged</span><b>' + items.length + ' change' + (items.length > 1 ? 's' : '') + ' not applied</b><span class="plan-note">Nothing has changed on GitHub yet</span>' :
          done ? '<span class="plan-flag f-done">' + icon('check') + 'Applied</span><b>' + done.length + ' change' + (done.length > 1 ? 's' : '') + ' done just now</b><span class="plan-note">New invites show as Invited until accepted on GitHub</span>' :
          '<span class="plan-flag f-live">' + icon('check') + 'Live</span><b>No staged changes</b><span class="plan-note">Everything shown is what GitHub has</span>') +
        (shown.length ? '<span class="plan-counts">' + ['create', 'invite', 'remove', 'roster'].filter(function (k) { return counts[k]; }).map(function (k) {
          return '<span class="pk k-' + k + '">' + icon(KIND[k][0]) + counts[k] + ' ' + KIND[k][1].toLowerCase() + (counts[k] > 1 && k !== 'roster' ? (k === 'create' ? 's' : 's') : k === 'roster' && counts[k] > 1 ? 's' : '') + '</span>';
        }).join('') + '</span>' : '') + '</button>' +
        '<span class="plan-acts"><button type="button" class="btn" data-plan="reset"' + (items.length ? '' : ' disabled') + '>Discard</button>' +
        '<button type="button" class="btn btn-primary" data-plan="apply"' + (items.length ? '' : ' disabled') + '>Apply</button></span></div>' +
        '<ul class="plan-list">' + shown.map(function (x) {
          return '<li class="pk-row k-' + x.k + '">' + '<span class="pk k-' + x.k + '">' + icon(done ? 'check' : KIND[x.k][0]) + KIND[x.k][1] + (done ? ' ✓' : '') + '</span><code>' + esc(x.repo) + '</code><span>' + esc(x.text) + (x.detail ? ' <span class="muted">(' + esc(x.detail) + ')</span>' : '') + '</span></li>';
        }).join('') + '</ul>';
    }
    foot.addEventListener('click', function (e) {
      if (e.target.closest('.plan-toggle')) { foot.classList.toggle('open'); draw(); }
      if (e.target.closest('[data-plan="reset"]')) reset(false);
      if (e.target.closest('[data-plan="apply"]')) apply();
    });
    listeners.push(draw); draw();
  }

  window.PERM = {
    TOOLS: TOOLS, PROJECTS: PROJECTS, PEOPLE: PEOPLE, NODES: NODES, MODES: MODES, STATE: STATE,
    cell: cell, granted: granted, toggle: toggle, grant: grant, setMode: setMode, removeAll: removeAll, reset: reset,
    apply: apply, changeMode: changeMode, byCompany: byCompany, askRemove: askRemove, rosters: rosters, rosterTags: rosterTags,
    mode: mode, baseMode: baseMode, members: members, plan: plan, person: person, isFte: isFte,
    walk: walk, leaves: leaves, toolLeaves: toolLeaves, repoOf: repoOf, parentOf: function (id) { return PARENT[id]; }, projectOf: function (id) { return PROJ_OF[id]; },
    esc: esc, icon: icon, pill: pill, legend: legend, tool: tool, repo: repo, avatar: avatar, role: role, roleTag: roleTag, byRole: byRole, ROLES: ROLES, modeSeg: modeSeg,
    chrome: chrome, onChange: function (f) { listeners.push(f); }
  };
})();
