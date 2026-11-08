/* Signoff PL: People & access, the views (Chris, 2026-11-07). The model is access.js.

   PL's tab in the suite's People & access sheet (signoff/assets/people.js), FTEs only. Two layouts:
     Person first       a card per person (FTEs share one), clients grouped by company; open a person
                        to set their mode per PL project and tick Parts
     Tree with people   each PL project's tree with chips of who can open each node
   Edits are staged; the footer says plainly whether anything is staged, just applied or live, and
   Apply lists every repo it creates, invitation it sends and roster it writes before running.
   Removing someone from a PL project asks whether their Parts go too.

   S.plAccessView(ctx) returns { draw(pane), reset() }. ctx:
     demo                    true in ?demo (Apply is simulated in the browser)
     load()                  Promise of { rosters, invites, errors }
     docs()                  the PL projects
     opts                    { tools, pl, owner, nameOf } for S.PLAccess
     apply(access, ops, log) Promise of { failed }
     blocked(ops)            a reason Apply can't run now (an unsynced project), or ''
     toast(text) */
(function (S) {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var I = {
    check: '<path d="M3.5 8.5l3 3 6-7"/>',
    clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9"/>',
    newrepo: '<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke-dasharray="2.2 1.6"/><path d="M8 5.5v5M5.5 8h5"/>',
    minus: '<path d="M3.5 8h9"/><path d="M4 4l8 8" opacity=".55"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7"/>',
    ring: '<circle cx="8" cy="8" r="4.5"/>',
    half: '<circle cx="8" cy="8" r="5"/><path d="M8 3a5 5 0 010 10z" fill="currentColor"/>',
    caret: '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
    repo: '<path d="M4 2.5h7.5v10H5a1 1 0 01-1-1z"/><path d="M4 11.5a1 1 0 011-1h6.5"/>',
    via: '<path d="M4 3v5.5a1.5 1.5 0 001.5 1.5H12"/><path d="M9.5 7.5L12 10l-2.5 2.5"/>',
    x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
    person: '<circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>',
    building: '<path d="M3 13.5V3h6.5v10.5M9.5 6.5H13v7M2 13.5h12"/><path d="M5.2 5.5h2M5.2 8h2M5.2 10.5h2"/>',
    wrench: '<path d="M10.6 2.6a3 3 0 00-3 3.9l-4.9 4.9a1.2 1.2 0 001.7 1.7l4.9-4.9a3 3 0 003.9-3l-1.8 1.8-1.7-.4-.4-1.7z"/>',
    refresh: '<path d="M13 8a5 5 0 11-1.5-3.6"/><path d="M13 2.5v3h-3"/>'
  };
  function icon(n) { return '<svg class="pa-i" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[n] + '</svg>'; }

  var STATE = {
    fte:     { icon: 'lock', label: 'FTE', long: 'FTE: sees everything (Signoff EE’s People)' },
    yes:     { icon: 'check', label: 'Access', long: 'Has access' },
    pending: { icon: 'clock', label: 'Invited', long: 'Invited: not accepted on GitHub yet' },
    'new':   { icon: 'newrepo', label: 'New repo', long: 'Not shared yet: Apply creates a private repo and invites' },
    add:     { icon: 'plus', label: 'Invite', long: 'Apply invites them to the existing repo' },
    remove:  { icon: 'minus', label: 'Remove', long: 'Apply removes their access' },
    none:    { icon: 'ring', label: '', long: 'No access' },
    all:     { icon: 'check', label: 'All', long: 'Every Part below' },
    some:    { icon: 'half', label: 'Some', long: 'Some of the Parts below' },
    na:      { icon: 'ring', label: '', long: 'Nothing here to share' }
  };
  var ROLES = {
    fte: { icon: 'lock', label: 'FTE', group: 'FTEs', about: 'See everything; set on Signoff EE’s People page' },
    client: { icon: 'building', label: 'Client', group: 'Clients', about: 'The client’s people: only what’s shared with them' },
    contractor: { icon: 'wrench', label: 'Contractor', group: 'Contractors', about: 'Outside help: only what’s shared with them' }
  };
  var MODES = [['system', 'Whole system', 'The PL project and every Part it links, now and later'],
    ['project', 'PL + chosen Parts', 'The PL project, plus only the Parts ticked. Coming from Whole system, what they can open now stays ticked'],
    ['parts', 'Parts only', 'Not on the PL project: only the Parts ticked']];
  var TAB_KEY = 'signoff.pl.accessTab';

  function pill(st, opts) {
    opts = opts || {};
    var d = STATE[st.s] || STATE.none;
    var label = opts.label || (st.s === 'some' ? st.n + ' of ' + st.of : st.s === 'all' && st.of ? 'All ' + st.of : d.label);
    var tip = d.long + (st.inherited ? ' (Whole system)' : '') + (st.gap ? '. Linked since the project was shared' : '') + (st.s === 'none' && st.unshared ? '. Not shared yet: giving access creates a private repo' : '');
    return '<span class="pa-st s-' + st.s + (st.inherited ? ' inh' : '') + (opts.compact ? ' compact' : '') + '" title="' + esc(tip) + '">' +
      icon(st.inherited && st.s === 'yes' ? 'via' : d.icon) + (opts.compact || !label ? '' : '<span>' + esc(label) + '</span>') + '</span>';
  }
  function hue(login) { var h = 0; for (var i = 0; i < login.length; i++) h = (h * 31 + login.charCodeAt(i)) % 360; return h; }
  function initials(p) { return (p.name || p.login).split(/[\s.-]+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function avatar(p, cls) { return '<span class="pa-av ' + (cls || '') + '" style="--h:' + hue(p.login) + '" title="' + esc(p.name + ' (@' + p.login + ')') + '">' + esc(initials(p)) + '</span>'; }
  function roleTag(role, short) { var r = ROLES[role]; return '<span class="pa-rtag r-' + role + '" title="' + esc(r.label + ': ' + r.about) + '">' + icon(r.icon) + (short ? '' : esc(r.label)) + '</span>'; }
  function toolChip(acc, tool) { var t = acc.tools[tool]; return '<span class="src ' + esc(tool) + '">' + esc(t ? t.label : tool) + '</span>'; }
  function repoTag(acc, node) {
    var it = acc.items[node.key];
    if (!it) return '';
    return it.repo ? '<span class="pa-repo" title="Private repo for this ' + (node.kind === 'project' ? 'PL project' : 'review') + '">' + icon('repo') + esc(it.repo.split('/')[1]) + '</span>' :
      '<span class="pa-repo fte-only" title="' + esc('FTE-only data repo. Sharing moves it into ' + it.future.split('/')[1]) + '">' + icon('repo') + esc(it.data.split('/')[1]) + ' · FTE only</span>';
  }

  S.plAccessView = function (ctx) {
    // root holds main (redrawn on every change) and the popovers and dialogs, which outlive a redraw.
    var acc = null, loadErr = '', errors = [], loading = null, pane = null, root = null, main = null, ask = null;
    var ui = { tab: 'people', pid: '', q: '', open: {}, openProj: {}, closed: {}, closedCo: {}, foot: false, applied: null };
    try { ui.tab = localStorage.getItem(TAB_KEY) === 'tree' ? 'tree' : 'people'; } catch (e) { /* storage blocked */ }

    function load() {
      if (loading) return loading;
      loadErr = '';
      loading = ctx.load().then(function (ld) {
        errors = ld.errors || [];
        var draftOf = acc;   // keep people added in the page across a reload
        acc = new S.PLAccess(Object.assign({}, ctx.opts, { docs: ctx.docs(), rosters: ld.rosters, invites: ld.invites }));
        if (draftOf) Object.keys(draftOf.added).forEach(function (l) { if (!acc.person(l)) acc.addPerson(draftOf.added[l]); });
        if (!acc.project(ui.pid)) ui.pid = acc.projects[0] ? acc.projects[0].id : '';
      }, function (err) { loadErr = err.message || String(err); }).then(function () { loading = null; render(); askNow(); });
      return loading;
    }

    function draw(p) {
      if (pane !== p) {
        pane = p;
        pane.innerHTML = '<div class="pa"><div class="pa-main"></div></div>';
        root = pane.firstChild; main = root.firstChild;
        bind();
      }
      if (!acc && !loading) load();
      render();
      askNow();
    }
    // The Share sheet's Remove lands here: open the person and ask what to remove.
    function askNow() {
      if (!ask || !acc || !root) return;
      var a = ask; ask = null;
      if (!acc.person(a.login) || !acc.project(a.pid)) return;
      ui.tab = 'people'; ui.open[a.login] = true; render();
      askRemove([a.pid], a.login);
    }

    // ── Rendering ──
    function render() {
      if (!main) return;
      if (!acc) {
        main.innerHTML = '<div class="pa-body"><p class="pa-empty">' + (loadErr ? 'Couldn’t read the people lists: ' + esc(loadErr) + ' <button type="button" class="btn btn-plain" data-pa="reload">Try again</button>' : 'Reading every tool’s people list…') + '</p></div>';
        return;
      }
      main.innerHTML = '<div class="pa-body">' + bar() + scope() + legend() + (ui.tab === 'tree' ? treeTab() : peopleTab()) + '</div>' + foot();
      main.querySelectorAll('[data-mixed]').forEach(function (x) { x.indeterminate = true; });
    }
    function bar() {
      return '<div class="pa-bar"><div class="seg" role="tablist">' +
        '<button type="button" role="tab" data-pa-tab="people" class="' + (ui.tab === 'people' ? 'on' : '') + '">Person first</button>' +
        '<button type="button" role="tab" data-pa-tab="tree" class="' + (ui.tab === 'tree' ? 'on' : '') + '">Tree with people</button></div>' +
        (ui.tab === 'tree' ? (acc.projects.length > 1 ? '<div class="seg pa-projs">' + acc.projects.map(function (p) {
          return '<button type="button" data-pa-proj="' + esc(p.id) + '" class="' + (p.id === ui.pid ? 'on' : '') + '">' + esc(p.name) + '</button>';
        }).join('') + '</div>' : '') :
          '<input class="pa-search" type="search" placeholder="Find a person or company" value="' + esc(ui.q) + '" aria-label="Find a person or company">') +
        '<span class="pa-grow"></span>' +
        (ui.tab === 'people' ? '<button type="button" class="btn" data-pa="add">' + icon('plus') + 'Add person</button>' : '') +
        '<button type="button" class="icon-btn" data-pa="reload" title="Read the people lists again" aria-label="Refresh">' + icon('refresh') + '</button></div>';
    }
    function scope() {
      return '<p class="pa-scope">' + icon('lock') + '<span>Signoff PL’s People &amp; access: everyone on any tool’s people list. Signoff EE, ME, and FW keep their own People pages as they are; this page can set access in all of them.' +
        (ctx.demo ? ' In the demo, Apply stays in this browser.' : '') + '</span></p>' +
        (errors.length ? '<p class="pa-scope pa-warn">' + icon('clock') + '<span>' + esc(errors.join(' ')) + '. Those people lists aren’t shown.</span></p>' : '');
    }
    function legend() {
      var sample = function (cls, label, mark, tip) { return '<span class="pa-cp ' + cls + '" title="' + esc(tip) + '"><span class="pa-av" style="--h:200">' + icon('person') + '</span>' + (mark ? '<span class="pa-mark' + (mark === 'via' ? ' inh' : '') + '">' + icon(mark) + '</span>' : '') + '<span class="pa-cn">' + esc(label) + '</span></span>'; };
      var access = ui.tab === 'tree' ?
        sample('s-yes', 'Given here', '', 'Solid: access given on this node') + sample('s-yes inh', 'Inherited', 'via', 'Dashed: from Whole system') + sample('s-pending', 'Invited', 'clock', STATE.pending.long) :
        pill({ s: 'yes' }) + pill({ s: 'yes', inherited: true }, { label: 'Inherited' }) + pill({ s: 'pending' });
      return '<div class="pa-legend"><div class="pa-lg"><span class="pa-lg-h">Access</span><span class="pa-lg-i">' + access + '</span></div>' +
        '<div class="pa-lg"><span class="pa-lg-h">On Apply</span><span class="pa-lg-i">' + pill({ s: 'new' }) + pill({ s: 'add' }) + pill({ s: 'remove' }) + '</span></div>' +
        '<div class="pa-lg"><span class="pa-lg-h">Roles</span><span class="pa-lg-i">' + ['fte', 'client', 'contractor'].map(function (k) { return roleTag(k); }).join('') + '</span></div></div>';
    }

    // ── Person first ──
    function projectsOf(p) {
      return acc.projects.filter(function (pr) { return acc.members(pr.id).indexOf(p) >= 0 || ui.open[p.login + '+' + pr.id]; });
    }
    function whoLine(p) {
      var bits = (acc.company(p.login) ? [acc.company(p.login)] : []).concat(projectsOf(p).map(function (pr) { return pr.name; }));
      return '<span class="pa-who-line" title="' + esc(ROLES[p.role].label) + '">' + icon(ROLES[p.role].icon) + esc(bits.join(' · ') || 'No PL projects yet') + '</span>';
    }
    function accessLine(p) {
      var projs = acc.projects.filter(function (pr) { return acc.members(pr.id).indexOf(p) >= 0; }), tools = {};
      projs.forEach(function (pr) {
        if (acc.mode(pr.id, p.login) !== 'parts') tools.pl = 1;
        acc.leaves(pr).forEach(function (x) { if (acc.granted(acc.cell(pr.id, p.login, x))) tools[x.tool] = 1; });
      });
      var keys = S.plAccess.ORDER.filter(function (k) { return tools[k]; });
      var full = projs.length && projs.every(function (pr) { return acc.mode(pr.id, p.login) === 'system'; });
      var what = full ? '<span class="pa-full" title="' + esc(MODES[0][2]) + '">' + icon('check') + 'Full project</span>' :
        keys.length ? '<span class="pa-tools">' + keys.map(function (k) { return toolChip(acc, k); }).join('') + '</span>' : '<span class="pa-muted">None yet</span>';
      return '<span class="pa-access"><span class="pa-access-h">Access</span>' + what + '</span>';
    }
    function flags(p) {
      var c = { pending: 0, 'new': 0, add: 0, remove: 0 };
      acc.projects.forEach(function (pr) {
        var seen = {};
        [pr].concat(acc.leaves(pr)).forEach(function (n) { if (seen[n.key]) return; seen[n.key] = 1; var s = acc.cell(pr.id, p.login, n).s; if (s in c) c[s]++; });
      });
      return Object.keys(c).filter(function (k) { return c[k]; }).map(function (k) { return pill({ s: k }, { label: STATE[k].label + ' ' + c[k] }); }).join('');
    }
    function modeSeg(pid, login) {
      var m = acc.mode(pid, login), b = acc.mode(pid, login, 'base');
      return '<div class="seg pa-mode" role="radiogroup" aria-label="Access">' + MODES.map(function (x) {
        return '<button type="button" role="radio" aria-checked="' + (m === x[0]) + '" class="' + (m === x[0] ? 'on' : '') + (m === x[0] && b !== x[0] ? ' changed' : '') + '" data-pa-mode="' + x[0] + '" data-pid="' + esc(pid) + '" data-login="' + esc(login) + '" title="' + esc(x[2]) + '">' + esc(x[1]) + '</button>';
      }).join('') + '</div>';
    }
    function projBlock(p, pr) {
      var key = p.login + '|' + pr.id, m = acc.mode(pr.id, p.login);
      var open = ui.openProj[key] !== undefined ? ui.openProj[key] : m !== 'system';
      var lines = [];
      (function go(n, d) { if (n.kind !== 'project') lines.push({ n: n, d: d }); if (n.kind === 'project' || !ui.closed[key + n.id]) (n.kids || []).forEach(function (k) { go(k, d + 1); }); })(pr, 0);
      return '<div class="pa-proj" data-pid="' + esc(pr.id) + '"><div class="pa-proj-head">' +
        '<button type="button" class="pa-caret' + (open ? '' : ' closed') + '" data-pa-oproj="' + esc(key) + '" aria-label="Fold">' + icon('caret') + '</button>' +
        '<span class="src pl">PL</span><span class="pa-tn"><b>' + esc(pr.name) + '</b>' + repoTag(acc, pr) + '</span><span class="pa-grow"></span>' +
        pill(acc.cell(pr.id, p.login, pr)) + modeSeg(pr.id, p.login) +
        '<button type="button" class="icon-btn pa-x" data-pa-rmproj="' + esc(pr.id) + '" data-login="' + esc(p.login) + '" title="Remove from ' + esc(pr.name) + '…" aria-label="Remove from ' + esc(pr.name) + '">' + icon('x') + '</button></div>' +
        (open ? '<ul class="pa-tree">' + lines.map(function (r) {
          var n = r.n, st = acc.cell(pr.id, p.login, n), kids = n.kids && n.kids.length;
          var box = '<input type="checkbox" class="pa-box" data-pa-cell="' + esc(n.id) + '" data-pid="' + esc(pr.id) + '" data-login="' + esc(p.login) + '"' +
            (st.s === 'all' || (n.kind === 'part' && acc.granted(st)) ? ' checked' : '') + (st.s === 'some' ? ' data-mixed="1"' : '') + ' aria-label="' + esc(n.name) + '">';
          return '<li class="k-' + n.kind + '"><div class="pa-row" style="padding-left:' + ((r.d - 1) * 20) + 'px">' +
            (kids ? '<button type="button" class="pa-caret' + (ui.closed[key + n.id] ? ' closed' : '') + '" data-pa-fold="' + esc(key + n.id) + '">' + icon('caret') + '</button>' : '<span class="pa-sp"></span>') +
            box + (n.kind === 'part' ? toolChip(acc, n.tool) : '') + '<span class="pa-tn"><span class="pa-name">' + esc(n.name) + '</span>' + (st.gap ? '<span class="pa-note">Linked since the project was shared</span>' : '') + '</span>' +
            '<span class="pa-grow"></span>' + (n.kind === 'part' ? repoTag(acc, n) : '') + '<span class="pa-state">' + pill(st) + '</span></div></li>';
        }).join('') + '</ul>' : '') + '</div>';
    }
    function card(p) {
      var projs = projectsOf(p), others = acc.projects.filter(function (pr) { return projs.indexOf(pr) < 0; });
      var open = !!ui.open[p.login];
      return '<section class="card pa-card"><button type="button" class="pa-head" data-pa-open="' + esc(p.login) + '" aria-expanded="' + open + '">' +
        '<span class="pa-caret' + (open ? '' : ' closed') + '">' + icon('caret') + '</span>' + avatar(p, 'lg') +
        '<span class="pa-who"><b>' + esc(p.name) + ' <span class="pa-login">@' + esc(p.login) + '</span></b>' + whoLine(p) + accessLine(p) + '</span>' +
        '<span class="pa-flags">' + flags(p) + '</span></button>' +
        (open ? '<div class="pa-cbody">' +
          (p.role === 'client' ? '<label class="pa-company">' + icon('building') + 'Company <input class="input" data-pa-company="' + esc(p.login) + '" value="' + esc(acc.company(p.login)) + '" placeholder="Their company"></label>' : '') +
          projs.map(function (pr) { return projBlock(p, pr); }).join('') +
          others.map(function (pr) { return '<button type="button" class="btn btn-plain" data-pa-addproj="' + esc(p.login + '+' + pr.id) + '">' + icon('plus') + 'Add to ' + esc(pr.name) + '</button>'; }).join('') +
          (projs.length ? '<button type="button" class="btn btn-plain" data-pa-rmall="' + esc(p.login) + '">' + icon('x') + 'Remove from every project…</button>' :
            '<p class="pa-muted pa-small">Nothing is shared with ' + esc(p.name.split(' ')[0]) + ' in a PL project yet.</p>') +
          '</div>' : '') + '</section>';
    }
    function peopleTab() {
      var q = ui.q.toLowerCase();
      var list = acc.people.filter(function (p) { return !q || (p.name + ' ' + p.login + ' ' + acc.company(p.login)).toLowerCase().indexOf(q) >= 0; });
      var ftes = list.filter(function (p) { return p.role === 'fte'; });
      var html = ftes.length ? '<section class="card pa-card pa-fte"><div class="pa-head">' + ftes.slice(0, 6).map(function (p) { return avatar(p, 'lg'); }).join('') +
        '<span class="pa-who"><b>FTEs: ' + ftes.map(function (p) { return esc(p.name); }).join(', ') + '</b><span class="pa-who-line">They open every project and every repo. FTEs are set on Signoff EE’s People page.</span></span>' + pill({ s: 'fte' }) + '</div></section>' : '';
      ['client', 'contractor'].forEach(function (role) {
        var g = list.filter(function (p) { return p.role === role; });
        if (!g.length) return;
        html += '<h3 class="pa-group">' + roleTag(role, true) + '<span>' + ROLES[role].group + ' · ' + g.length + '</span><span class="pa-muted">' + esc(ROLES[role].about) + '</span></h3>';
        if (role !== 'client') { html += g.map(card).join(''); return; }
        var cos = [];
        g.forEach(function (p) { var c = acc.company(p.login); if (cos.indexOf(c) < 0) cos.push(c); });
        cos.sort(function (a, b) { return (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b); }).forEach(function (c) {
          var ps = g.filter(function (p) { return acc.company(p.login) === c; }), shut = !q && ui.closedCo[c];
          html += '<div class="pa-co"><button type="button" class="pa-co-head" data-pa-co="' + esc(c) + '" aria-expanded="' + !shut + '">' +
            '<span class="pa-caret' + (shut ? ' closed' : '') + '">' + icon('caret') + '</span>' + icon('building') + '<b>' + esc(c || 'No company') + '</b><span class="pa-muted">' + ps.length + ' client' + (ps.length > 1 ? 's' : '') + '</span>' +
            '<span class="pa-co-avs">' + ps.slice(0, 8).map(function (p) { return avatar(p); }).join('') + '</span></button>' +
            (shut ? '' : '<div class="pa-co-body">' + ps.map(card).join('') + '</div>') + '</div>';
        });
      });
      return html || '<p class="pa-empty">' + (q ? 'No one matches.' : 'No one is on any tool’s people list yet.') + '</p>';
    }

    // ── Tree with people ──
    var MARK = { pending: 'clock', 'new': 'newrepo', add: 'plus', remove: 'minus' };
    function chip(pid, n, p) {
      var st = acc.cell(pid, p.login, n);
      if (!acc.granted(st) && st.s !== 'remove' && st.s !== 'some') return '';
      var tip = p.name + ' (' + ROLES[p.role].label + (acc.company(p.login) ? ', ' + acc.company(p.login) : '') + '): ' + STATE[st.s].long + (st.inherited ? ' (Whole system)' : '') + (st.gap ? '. Linked since the project was shared' : '');
      return '<button type="button" class="pa-cp s-' + st.s + (st.inherited ? ' inh' : '') + '" data-pa-chip="' + esc(n.id) + '" data-login="' + esc(p.login) + '" title="' + esc(tip) + '">' + avatar(p) +
        (MARK[st.s] ? '<span class="pa-mark">' + icon(MARK[st.s]) + '</span>' : st.inherited ? '<span class="pa-mark inh">' + icon('via') + '</span>' : '') +
        '<span class="pa-cn">' + esc(p.name.split(' ')[0]) + (st.s === 'some' ? '<span class="pa-some"> · ' + st.n + ' of ' + st.of + ' Parts</span>' : '') + '</span>' +
        '<span class="pa-cr">' + icon(ROLES[p.role].icon) + '</span></button>';
    }
    function treeTab() {
      var pr = acc.project(ui.pid);
      if (!pr) return '<p class="pa-empty">No PL projects yet.</p>';
      var lines = [];
      (function go(n, d) { lines.push({ n: n, d: d }); if (!ui.closed['t' + n.id]) (n.kids || []).forEach(function (k) { go(k, d + 1); }); })(pr, 0);
      var ppl = acc.people.filter(function (p) { return p.role !== 'fte'; });
      return '<p class="pa-muted pa-small">Solid chips were given on that node; dashed chips come from Whole system. Click a chip or + to change it. FTEs see everything and aren’t listed.</p>' +
        '<div class="card pa-ct">' + lines.map(function (r) {
          var n = r.n, kids = n.kids && n.kids.length;
          return '<div class="pa-ct-row k-' + n.kind + '"><div class="pa-row" style="padding-left:' + (r.d * 22) + 'px">' +
            (kids ? '<button type="button" class="pa-caret' + (ui.closed['t' + n.id] ? ' closed' : '') + '" data-pa-fold="t' + esc(n.id) + '">' + icon('caret') + '</button>' : '<span class="pa-sp"></span>') +
            (n.kind === 'project' ? '<span class="src pl">PL</span>' : n.kind === 'part' ? toolChip(acc, n.tool) : '') +
            '<span class="pa-tn"><span class="pa-name">' + esc(n.kind === 'project' ? n.name + ' (PL project)' : n.name) + '</span>' +
            (n.kind !== 'asm' ? repoTag(acc, n) : '<span class="pa-note">Assembly: + here adds every Part in it</span>') + '</span></div>' +
            '<div class="pa-chips">' + ppl.map(function (p) { return chip(pr.id, n, p); }).join('') +
            '<button type="button" class="pa-add" data-pa-addto="' + esc(n.id) + '" aria-label="Add someone to ' + esc(n.name) + '">' + icon('plus') + '</button></div></div>';
        }).join('') + '</div>';
    }

    // ── Footer: Staged, Applied, or Live ──
    var KIND = { create: ['newrepo', 'New repo'], invite: ['plus', 'Invite'], remove: ['minus', 'Remove'], roster: ['person', 'Roster'] };
    function rowsHtml(rows, done) {
      return '<ul class="pa-plan-list">' + rows.map(function (x) {
        return '<li class="pa-pk-row"><span class="pa-pk k-' + x.k + '">' + icon(done ? 'check' : KIND[x.k][0]) + KIND[x.k][1] + '</span><code>' + esc(x.repo) + '</code><span>' + esc(x.text) + (x.detail ? ' <span class="pa-muted">(' + esc(x.detail) + ')</span>' : '') + '</span></li>';
      }).join('') + '</ul>';
    }
    function foot() {
      var ops = acc.plan(), rows = acc.planRows(ops), done = !ops.length && ui.applied, shown = ops.length ? rows : done || [];
      var counts = {}; shown.forEach(function (x) { counts[x.k] = (counts[x.k] || 0) + 1; });
      var n = ops.length;
      return '<footer class="pa-foot' + (n ? ' staged' : done ? ' done' : '') + (ui.foot ? ' open' : '') + '"><div class="pa-foot-bar">' +
        '<button type="button" class="pa-foot-toggle" data-pa="foot" aria-expanded="' + ui.foot + '"' + (shown.length ? '' : ' disabled') + '>' + icon('caret') +
        (n ? '<span class="pa-flag f-staged">' + icon('clock') + 'Staged</span><b>' + n + ' change' + (n > 1 ? 's' : '') + ' not applied</b><span class="pa-foot-note">Nothing has changed on GitHub yet</span>' :
          done ? '<span class="pa-flag f-done">' + icon('check') + 'Applied</span><b>Done just now</b><span class="pa-foot-note">New invitations show as Invited until accepted on GitHub</span>' :
          '<span class="pa-flag f-live">' + icon('check') + 'Live</span><b>No staged changes</b><span class="pa-foot-note">Everything shown is what GitHub has</span>') +
        (shown.length ? '<span class="pa-counts">' + ['create', 'invite', 'remove', 'roster'].filter(function (k) { return counts[k]; }).map(function (k) { return '<span class="pa-pk k-' + k + '">' + icon(KIND[k][0]) + counts[k] + ' ' + KIND[k][1].toLowerCase() + (counts[k] > 1 ? 's' : '') + '</span>'; }).join('') + '</span>' : '') +
        '</button><span class="pa-foot-acts"><button type="button" class="btn" data-pa="discard"' + (n ? '' : ' disabled') + '>Discard</button>' +
        '<button type="button" class="btn btn-primary" data-pa="apply"' + (n ? '' : ' disabled') + '>Apply</button></span></div>' +
        (ui.foot && shown.length ? rowsHtml(shown, !!done && !n) : '') + '</footer>';
    }

    // ── Popovers and dialogs ──
    function closePop() { if (root) root.querySelectorAll('.pa-pop').forEach(function (x) { x.remove(); }); }
    function pop(anchor, html) {
      closePop();
      var el = document.createElement('div');
      el.className = 'pa-pop'; el.innerHTML = html;
      root.appendChild(el);
      var r = anchor.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 16);
      el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      el.style.top = Math.min(r.bottom + 6, window.innerHeight - 60) + 'px';
      el.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 20) + 'px';
      return el;
    }
    function dialog(html) {
      var d = document.createElement('div');
      d.className = 'pa-dlg-wrap';
      d.innerHTML = '<div class="pa-dlg" role="dialog" aria-modal="true">' + html + '</div>';
      root.appendChild(d);
      var f = d.querySelector('.pa-opt, input, [data-dlg="ok"]'); if (f) f.focus();
      d.addEventListener('mousedown', function (e) { if (e.target === d) d.remove(); });
      d.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); d.remove(); } });
      return d;
    }
    function personPop(anchor, pid, n, login) {
      var p = acc.person(login), st = acc.cell(pid, login, n), m = acc.mode(pid, login), it = acc.items[n.key];
      var why = n.kind === 'project' ? (m === 'system' ? 'Whole system: this project and every Part it links, now and later.' : 'PL project, plus the Parts ticked one by one.') :
        st.inherited ? 'From Whole system on ' + acc.project(pid).name + '. Taking this away switches them to PL + chosen Parts.' :
        st.s === 'remove' ? 'Staged: Apply takes them off ' + (it ? (it.repo || it.data).split('/')[1] : 'it') + '.' :
        n.kind === 'asm' ? 'Ticked Part by Part.' : 'Given on this Part, recorded in ' + acc.tools[n.tool].label + '’s people list.';
      var el = pop(anchor, '<div class="pa-pop-row">' + avatar(p, 'lg') + '<span class="pa-grow"><b>' + esc(p.name) + '</b><span class="pa-sub">@' + esc(login) + (acc.company(login) ? ' · ' + esc(acc.company(login)) : '') + '</span></span>' + pill(st) + '</div>' +
        '<div class="pa-pop-row">' + roleTag(p.role) + '</div><p class="pa-pop-foot">' + esc(why) + '</p>' +
        (n.kind === 'project' ? '<div class="pa-pop-row">' + modeSeg(pid, login) + '</div>' : '') +
        '<div class="pa-pop-acts">' + (st.s === 'remove' ? '<button type="button" class="btn" data-pa-pop="undo">Undo</button>' : '<button type="button" class="btn btn-danger" data-pa-pop="off">' + icon('minus') + 'Take away</button>') + '</div>');
      el.addEventListener('click', function (e) {
        var t = e.target.closest('[data-pa-pop],[data-pa-mode]'); if (!t) return;
        e.stopPropagation();
        closePop();
        if (t.dataset.paMode) { changeMode(pid, login, t.dataset.paMode); return; }
        if (n.kind === 'project' && t.dataset.paPop === 'off') { askRemove([pid], login); return; }
        acc.grant(pid, login, n, t.dataset.paPop === 'undo');
        render();
      });
    }
    function addPop(anchor, pid, n) {
      var it = acc.items[n.key], ppl = acc.people.filter(function (p) { return p.role !== 'fte'; });
      function body() {
        return '<h4>Who can open ' + esc(n.name) + '?</h4>' + ['client', 'contractor'].map(function (role) {
          var g = ppl.filter(function (p) { return p.role === role; });
          if (!g.length) return '';
          var cos = role === 'client' ? g.map(function (p) { return acc.company(p.login); }).filter(function (c, i, a) { return a.indexOf(c) === i; }).sort() : [''];
          return '<div class="pa-pop-group">' + roleTag(role) + '</div>' + cos.map(function (c) {
            return (role === 'client' ? '<div class="pa-pop-co">' + icon('building') + esc(c || 'No company') + '</div>' : '') + g.filter(function (p) { return role !== 'client' || acc.company(p.login) === c; }).map(function (p) {
              var st = acc.cell(pid, p.login, n), on = n.kind === 'asm' ? st.s === 'all' : acc.granted(st);
              return '<label class="pa-pop-row pa-pick"><input type="checkbox" data-pa-pick="' + esc(p.login) + '"' + (on ? ' checked' : '') + '>' + avatar(p) +
                '<span class="pa-grow">' + esc(p.name) + '<span class="pa-sub">@' + esc(p.login) + (st.inherited ? ' · Whole system' : '') + '</span></span>' + pill(st, { compact: true }) + '</label>';
            }).join('');
          }).join('');
        }).join('') + '<p class="pa-pop-foot">' + (it && !it.repo && n.kind !== 'asm' ? 'Not shared yet: ticking someone creates ' + esc(it.future.split('/')[1]) + ' at Apply.' :
          n.kind === 'asm' ? 'Ticks every Part in this assembly.' : 'Ticking stages it; nothing changes until Apply.') + '</p>';
      }
      var el = pop(anchor, body());
      el.addEventListener('change', function (e) {
        var t = e.target.closest('[data-pa-pick]'); if (!t) return;
        acc.grant(pid, t.dataset.paPick, n, t.checked);
        render();
        el.innerHTML = body();
      });
    }
    function changeMode(pid, login, mode) {
      if (mode === 'parts' && acc.mode(pid, login) !== 'parts') { askRemove([pid], login); return; }
      acc.setMode(pid, login, mode); render();
    }
    function askRemove(pids, login) {
      var p = acc.person(login), keep = [], repos = [];
      pids.forEach(function (pid) {
        acc.kept(pid, login).forEach(function (k) { keep.push(acc.items[k].name); repos.push((acc.items[k].repo || acc.items[k].future).split('/')[1]); });
      });
      var onAny = pids.some(function (pid) { return acc.mode(pid, login) !== 'parts'; });
      var where = pids.length > 1 ? 'every PL project' : acc.project(pids[0]).name;
      var d = dialog('<h3>Remove ' + esc(p.name) + ' from ' + esc(where) + '?</h3>' +
        (onAny ? '<button type="button" class="pa-opt" data-rm="pl"><b>Only the PL project</b><span>' + (keep.length ? 'They keep ' + keep.length + ' Part' + (keep.length > 1 ? 's' : '') + ': ' + esc(keep.join(', ')) + '. Those stay on each tool’s people list.' : 'They have no Parts here, so this is the same as removing everything.') + '</span></button>' : '') +
        '<button type="button" class="pa-opt" data-rm="all"><b>' + (onAny ? 'The PL project and its Parts' : 'Every Part here') + '</b><span>' + (repos.length ? 'Also takes them off ' + esc(repos.join(', ')) + '.' : 'Takes them off the PL project’s repo.') + '</span></button>' +
        '<div class="pa-dlg-foot"><span class="pa-muted">' + icon('clock') + 'Staged only. Nothing changes on GitHub until Apply.</span><button type="button" class="btn" data-rm="cancel">Cancel</button></div>');
      d.addEventListener('click', function (e) {
        var b = e.target.closest('[data-rm]'); if (!b) return;
        d.remove();
        if (b.dataset.rm === 'cancel') return;
        pids.forEach(function (pid) { acc.removeFrom(pid, login, b.dataset.rm === 'all'); });
        render();
      });
    }
    function addPersonDialog() {
      var d = dialog('<h3>Add a person</h3><p class="pa-muted pa-small">Anyone with a free GitHub account. They’re added to a people list when Apply gives them something.</p>' +
        '<div class="pa-form"><label>GitHub username<input class="input" id="pa-n-login" placeholder="username" autocomplete="off"></label>' +
        '<label>Name<input class="input" id="pa-n-name" placeholder="First Last"></label>' +
        '<div class="seg full" id="pa-n-role"><button type="button" data-role="client">A client</button><button type="button" class="on" data-role="contractor">A contractor</button></div>' +
        '<label id="pa-n-co" hidden>Company<input class="input" id="pa-n-company" placeholder="Their company" list="pa-cos"></label>' +
        '<datalist id="pa-cos">' + acc.people.map(function (p) { return acc.company(p.login); }).filter(function (c, i, a) { return c && a.indexOf(c) === i; }).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>' +
        '<div class="pa-dlg-foot"><span class="pa-grow"></span><button type="button" class="btn" data-dlg="cancel">Cancel</button><button type="button" class="btn btn-primary" data-dlg="ok">Add</button></div>');
      d.addEventListener('click', function (e) {
        var rb = e.target.closest('#pa-n-role [data-role]');
        if (rb) { d.querySelectorAll('#pa-n-role button').forEach(function (x) { x.classList.toggle('on', x === rb); }); d.querySelector('#pa-n-co').hidden = rb.dataset.role !== 'client'; return; }
        var b = e.target.closest('[data-dlg]'); if (!b) return;
        if (b.dataset.dlg === 'cancel') { d.remove(); return; }
        try {
          var rec = acc.addPerson({ login: d.querySelector('#pa-n-login').value, name: d.querySelector('#pa-n-name').value, role: d.querySelector('#pa-n-role .on').dataset.role, company: d.querySelector('#pa-n-company').value });
          d.remove(); ui.open[rec.login] = true; ui.q = ''; render();
        } catch (err) { ctx.toast(err.message); d.querySelector('#pa-n-login').focus(); }
      });
    }
    function applyDialog() {
      var ops = acc.plan(), rows = acc.planRows(ops), why = ctx.blocked(ops);
      if (why) { ctx.toast(why); return; }
      var creates = rows.filter(function (r) { return r.k === 'create'; }).length;
      var d = dialog('<h3>Apply ' + ops.length + ' change' + (ops.length > 1 ? 's' : '') + '?</h3>' +
        '<p class="pa-muted pa-small">' + (creates ? creates + ' new private repo' + (creates > 1 ? 's' : '') + ' will be created. ' : '') + 'GitHub emails each invitation.' + (ctx.demo ? ' In the demo this stays in the browser.' : '') + '</p>' +
        rowsHtml(rows) + '<div class="pa-log" hidden></div>' +
        '<div class="pa-dlg-foot"><span class="pa-grow"></span><button type="button" class="btn" data-dlg="cancel">Cancel</button><button type="button" class="btn btn-primary" data-dlg="ok">Apply</button></div>');
      d.addEventListener('click', function (e) {
        var b = e.target.closest('[data-dlg]'); if (!b || b.disabled) return;
        if (b.dataset.dlg === 'cancel' || b.dataset.dlg === 'close') { d.remove(); return; }
        var log = d.querySelector('.pa-log'); log.hidden = false;
        d.querySelectorAll('[data-dlg]').forEach(function (x) { x.disabled = true; });
        function line(text, cls) { log.insertAdjacentHTML('beforeend', '<div class="' + (cls || '') + '">' + esc(text) + '</div>'); log.scrollTop = 1e6; }
        ctx.apply(acc, ops, line).then(function (res) {
          (res.failed || []).forEach(function (f) { line(f.message, 'err'); });
          line(res.failed && res.failed.length ? 'Finished with problems. Apply again to retry what didn’t run.' : 'Done.', res.failed && res.failed.length ? 'err' : 'ok');
          ui.applied = rows; ui.foot = false;
        }, function (err) { line('Stopped: ' + err.message, 'err'); }).then(function () {
          var foot = d.querySelector('.pa-dlg-foot');
          foot.innerHTML = '<span class="pa-grow"></span><button type="button" class="btn btn-primary" data-dlg="close">Close</button>';
          var keepAdded = acc.added;
          acc.added = {};
          Object.keys(keepAdded).forEach(function (l) { if (!ops.some(function (o) { return (o.logins || [o.login]).indexOf(l) >= 0; })) acc.added[l] = keepAdded[l]; });
          load();
        });
      });
    }

    // ── Events ──
    function bind() {
      root.addEventListener('click', function (e) {
        var t = e.target;
        if (!t.closest('.pa-pop') && !t.closest('[data-pa-chip],[data-pa-addto]')) closePop();
        var b;
        if ((b = t.closest('[data-pa-tab]'))) { ui.tab = b.dataset.paTab; try { localStorage.setItem(TAB_KEY, ui.tab); } catch (x) { /* storage blocked */ } render(); }
        else if ((b = t.closest('[data-pa-proj]'))) { ui.pid = b.dataset.paProj; render(); }
        else if ((b = t.closest('[data-pa-mode]'))) { if (!t.closest('.pa-pop')) changeMode(b.dataset.pid, b.dataset.login, b.dataset.paMode); }
        else if ((b = t.closest('[data-pa-rmproj]'))) askRemove([b.dataset.paRmproj], b.dataset.login);
        else if ((b = t.closest('[data-pa-rmall]'))) { var l = b.dataset.paRmall; askRemove(acc.projects.filter(function (pr) { return acc.members(pr.id).some(function (m) { return m.login === l; }); }).map(function (pr) { return pr.id; }), l); }
        else if ((b = t.closest('[data-pa-addproj]'))) { ui.open[b.dataset.paAddproj] = true; render(); }
        else if ((b = t.closest('[data-pa-co]'))) { ui.closedCo[b.dataset.paCo] = !ui.closedCo[b.dataset.paCo]; render(); }
        else if ((b = t.closest('[data-pa-oproj]'))) { ui.openProj[b.dataset.paOproj] = b.classList.contains('closed'); render(); }
        else if ((b = t.closest('[data-pa-fold]'))) { ui.closed[b.dataset.paFold] = !ui.closed[b.dataset.paFold]; render(); }
        else if ((b = t.closest('[data-pa-open]'))) { ui.open[b.dataset.paOpen] = !ui.open[b.dataset.paOpen]; render(); }
        else if ((b = t.closest('[data-pa-chip]'))) personPop(b, ui.pid, acc.nodes[b.dataset.paChip], b.dataset.login);
        else if ((b = t.closest('[data-pa-addto]'))) addPop(b, ui.pid, acc.nodes[b.dataset.paAddto]);
        else if ((b = t.closest('[data-pa]'))) {
          var a = b.dataset.pa;
          if (a === 'reload') { if (acc && acc.plan().length && !confirm('Read the people lists again? Staged changes are kept only for people added here.')) return; acc = acc ? acc : null; load(); render(); }
          else if (a === 'add') addPersonDialog();
          else if (a === 'foot') { ui.foot = !ui.foot; render(); }
          else if (a === 'discard') { acc.discard(); ui.applied = null; render(); }
          else if (a === 'apply') applyDialog();
        }
      });
      root.addEventListener('change', function (e) {
        var t = e.target;
        if (t.matches('[data-pa-cell]')) { acc.grant(t.dataset.pid, t.dataset.login, acc.nodes[t.dataset.paCell], t.checked); ui.applied = null; render(); }
        else if (t.matches('[data-pa-company]')) { acc.setCompany(t.dataset.paCompany, t.value); render(); }
      });
      root.addEventListener('input', function (e) {
        if (!e.target.matches('.pa-search')) return;
        ui.q = e.target.value; render();
        var s = main.querySelector('.pa-search'); if (s) { s.focus(); s.setSelectionRange(ui.q.length, ui.q.length); }
      });
    }

    return {
      draw: draw,
      reset: function () { acc = null; loading = null; },
      isDirty: function () { return !!(acc && acc.plan().length); },
      removePrompt: function (pid, login) { ask = { pid: pid, login: String(login).toLowerCase() }; askNow(); }
    };
  };
})(window.Signoff = window.Signoff || {});
