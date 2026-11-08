/* Person first: people at the top level, each opening to their projects, then to the Parts. */
(function () {
  'use strict';
  var P = window.PERM, esc = P.esc;
  P.chrome('people.html', 'Person first',
    'Everyone on any tool’s people list (the whole company), one card each. Open a person to see each PL project they’re on and tick Parts below. PL can set access in every tool’s repos.');

  var body = document.createElement('main'); body.className = 'lab-body'; document.body.insertBefore(body, document.querySelector('.plan'));
  var open = { 'jordan-lee-ext': true, 'alex-kim-ext': true }, openProj = {}, closed = {}, closedCo = {}, query = '';

  function summary(p) {
    if (p.role === 'fte') return 'Every project, every Part';
    var bits = [];
    P.PROJECTS.forEach(function (pr) {
      var m = P.mode(pr.id, p.login), n = P.toolLeaves(pr).filter(function (x) { return P.granted(P.cell(pr.id, p.login, x)); }).length;
      if (m === 'system') bits.push(pr.name + ': whole system');
      else if (m === 'project') bits.push(pr.name + ': PL + ' + n + ' Part' + (n === 1 ? '' : 's'));
      else if (n) bits.push(pr.name + ': ' + n + ' Part' + (n === 1 ? '' : 's'));
    });
    return bits.join(' · ') || 'Nothing in PL projects';
  }
  function flags(p) {
    var c = { pending: 0, 'new': 0, add: 0, remove: 0 };
    P.PROJECTS.forEach(function (pr) {
      P.walk(pr, function (n) { if (n.kind !== 'asm') { var s = P.cell(pr.id, p.login, n).s; if (s in c) c[s]++; } });
    });
    return Object.keys(c).filter(function (k) { return c[k]; }).map(function (k) { return P.pill({ s: k }).replace('</span></span>', ' ' + c[k] + '</span></span>'); }).join('');
  }

  function projBlock(p, pr) {
    var key = p.login + '|' + pr.id, m = P.mode(pr.id, p.login);
    var isOpen = openProj[key] !== undefined ? openProj[key] : m !== 'system';
    var lines = [];
    (function go(n, d) {
      if (n.kind !== 'project') lines.push({ n: n, d: d });
      if (n.kind === 'project' || !closed[key + n.id]) (n.kids || []).forEach(function (k) { go(k, d + 1); });
    })(pr, 0);
    return '<div class="pp-proj" data-pid="' + pr.id + '"><div class="pp-proj-head">' +
      '<button type="button" class="tn-caret' + (isOpen ? '' : ' closed') + '" data-oproj="' + esc(key) + '" aria-label="Fold">' + P.icon('caret') + '</button>' +
      '<span class="src pl">PL</span><span class="tn-text"><span class="tn-name"><b>' + esc(pr.name) + '</b> <span class="muted">· ' + esc(pr.client) + '</span></span>' + P.repo(pr) + '</span>' +
      '<span class="grow"></span>' + P.pill(P.cell(pr.id, p.login, pr)) + P.modeSeg(pr.id, p.login, true) +
      '<button type="button" class="icon-btn pp-x" data-rmproj="' + pr.id + '" data-login="' + esc(p.login) + '" title="Remove from ' + esc(pr.name) + '…" aria-label="Remove from ' + esc(pr.name) + '">' + P.icon('x') + '</button></div>' +
      (isOpen ? '<ul class="pp-tree">' + lines.map(function (r) {
        var n = r.n, st = P.cell(pr.id, p.login, n), kids = n.kids && n.kids.length;
        var box = n.tool === 'buy' || st.s === 'na' ? '<span class="pp-box na" title="Nothing to share">' + P.icon('dash') + '</span>' :
          '<input type="checkbox" class="pp-box" data-cell="' + n.id + '" data-proj="' + pr.id + '" data-login="' + esc(p.login) + '"' +
          (st.s === 'all' || (n.kind === 'part' && P.granted(st)) ? ' checked' : '') + (st.s === 'some' ? ' data-mixed="1"' : '') + ' aria-label="' + esc(n.name) + '">';
        return '<li class="k-' + n.kind + '"><div class="tn" style="padding-left:' + ((r.d - 1) * 20) + 'px">' +
          (kids ? '<button type="button" class="tn-caret' + (closed[key + n.id] ? ' closed' : '') + '" data-fold="' + esc(key + n.id) + '">' + P.icon('caret') + '</button>' : '<span class="tn-sp"></span>') +
          box + (n.kind === 'part' ? P.tool(n) : '') + '<span class="tn-text"><span class="tn-name">' + esc(n.name) + '</span>' + (n.note ? '<span class="tn-note">' + esc(n.note) + '</span>' : '') + '</span>' +
          '<span class="grow"></span>' + (n.kind === 'part' ? P.repo(n, { future: st.s === 'new' }) : '') + '<span class="pp-state">' + P.pill(st) + '</span></div></li>';
      }).join('') + '</ul>' : '') + '</div>';
  }

  function draw() {
    var q = query.toLowerCase();
    var people = P.PEOPLE.filter(function (p) { return !q || (p.name + ' ' + p.login + ' ' + (p.company || '')).toLowerCase().indexOf(q) >= 0; });
    var ftes = people.filter(function (p) { return p.role === 'fte'; }), rest = people.filter(function (p) { return p.role !== 'fte'; });
    body.innerHTML = '<div class="lab-bar"><input class="pp-search" type="search" placeholder="Find a person or company" value="' + esc(query) + '">' +
      '<span class="grow"></span><button type="button" class="btn" disabled title="Add someone by GitHub username">' + P.icon('plus') + 'Add person</button></div>' + P.legend() +
      (ftes.length ? '<section class="card pp-card pp-fte"><div class="pp-head">' + ftes.map(function (p) { return P.avatar(p, 'lg'); }).join('') +
        '<div class="pp-who"><b>FTEs: ' + ftes.map(function (p) { return esc(p.name); }).join(', ') + '</b><span class="muted">From Signoff EE’s roster. They open every project and every repo; change that on EE’s People tab.</span></div>' +
        P.pill({ s: 'fte' }) + '</div></section>' : '') +
      P.byRole(rest).map(function (g) {
        var head = '<h3 class="pp-group">' + P.roleTag(g.people[0], true) + '<span>' + esc(g.info.group) + ' · ' + g.people.length + '</span><span class="muted">' + esc(g.info.about) + '</span></h3>';
        if (g.role !== 'client') return head + g.people.map(card).join('');
        return head + P.byCompany(g.people).map(function (c) {
          var shut = q ? false : closedCo[c.company];
          return '<div class="pp-co"><button type="button" class="pp-co-head" data-co="' + esc(c.company) + '" aria-expanded="' + !shut + '">' +
            '<span class="tn-caret' + (shut ? ' closed' : '') + '">' + P.icon('caret') + '</span>' + P.icon('building') +
            '<b>' + esc(c.company || 'No company') + '</b><span class="muted">' + c.people.length + ' client' + (c.people.length > 1 ? 's' : '') + '</span>' +
            '<span class="pp-co-avs">' + c.people.map(function (p) { return P.avatar(p); }).join('') + '</span></button>' +
            (shut ? '' : '<div class="pp-co-body">' + c.people.map(card).join('') + '</div>') + '</div>';
        }).join('');
      }).join('');
    body.querySelectorAll('[data-mixed]').forEach(function (b) { b.indeterminate = true; });
  }

  // Middle row: company · the PL projects they're on (Chris, 2026-11-07).
  function whoLine(p) {
    var on = P.PROJECTS.filter(function (pr) { return P.members(pr.id).indexOf(p) >= 0; }).map(function (pr) { return pr.name; });
    // The role is already the group heading (Clients, Contractors), so the row starts with the company.
    var bits = (p.company ? [p.company] : []).concat(on);
    return '<span class="pp-line" title="' + esc(P.ROLES[p.role].label) + '">' + P.icon(P.ROLES[p.role].icon) + esc(bits.join(' · ') || 'No PL projects yet') + '</span>';
  }
  // Bottom row: Access. "Full project" when they have Whole system on every project they're on;
  // otherwise a badge per tool they can open something in.
  function accessLine(p) {
    var projs = P.PROJECTS.filter(function (pr) { return P.members(pr.id).indexOf(p) >= 0; });
    var tools = {};
    projs.forEach(function (pr) {
      if (P.mode(pr.id, p.login) !== 'parts') tools.pl = true;
      P.toolLeaves(pr).forEach(function (x) { if (P.granted(P.cell(pr.id, p.login, x))) tools[x.tool] = true; });
    });
    var keys = ['pl', 'ee', 'me', 'fw', 'loom'].filter(function (k) { return tools[k]; });
    var full = projs.length && projs.every(function (pr) { return P.mode(pr.id, p.login) === 'system'; });
    var what = full ? '<span class="full-tag" title="Whole system: the PL project and every linked review, now and later">' + P.icon('check') + 'Full project</span>' :
      keys.length ? '<span class="rosters" title="' + esc('Can open something in ' + keys.map(function (k) { return P.TOOLS[k].name; }).join(', ')) + '">' + keys.map(function (k) { return '<span class="src ' + k + '">' + P.TOOLS[k].label + '</span>'; }).join('') + '</span>' :
      '<span class="muted">None yet</span>';
    return '<span class="pp-access"><span class="pp-access-h">Access</span>' + what + '</span>';
  }

  function card(p) {
        var projs = P.PROJECTS.filter(function (pr) { return P.members(pr.id).indexOf(p) >= 0 || open[p.login + '+' + pr.id]; });
        var others = P.PROJECTS.filter(function (pr) { return projs.indexOf(pr) < 0; });
        return '<section class="card pp-card"><button type="button" class="pp-head" data-open="' + esc(p.login) + '" aria-expanded="' + !!open[p.login] + '">' +
          '<span class="tn-caret' + (open[p.login] ? '' : ' closed') + '">' + P.icon('caret') + '</span>' + P.avatar(p, 'lg') +
          '<span class="pp-who"><b>' + esc(p.name) + ' <span class="muted pp-login">' + esc(p.login) + '</span></b>' + whoLine(p) + accessLine(p) + '</span>' +
          '<span class="pp-flags">' + flags(p) + '</span></button>' +
          (open[p.login] ? '<div class="pp-body">' + projs.map(function (pr) { return projBlock(p, pr); }).join('') +
            others.map(function (pr) { return '<button type="button" class="btn btn-plain pp-addproj" data-addproj="' + esc(p.login + '+' + pr.id) + '">' + P.icon('plus') + 'Add to ' + esc(pr.name) + '</button>'; }).join('') +
            (projs.length ? '<button type="button" class="btn btn-plain pp-rm" data-rm="' + esc(p.login) + '">' + P.icon('x') + 'Remove from every project…</button>' : '<p class="muted pp-none">Nothing is shared with ' + esc(p.name.split(' ')[0]) + ' in a PL project yet. They’re on ' + esc(P.TOOLS[p.home].name) + '’s people list.</p>') + '</div>' : '') + '</section>';
  }

  body.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-co]'))) { var co = t.getAttribute('data-co'); closedCo[co] = !closedCo[co]; draw(); }
    else if ((t = e.target.closest('[data-open]'))) { var l = t.getAttribute('data-open'); open[l] = !open[l]; draw(); }
    else if ((t = e.target.closest('[data-oproj]'))) { var k = t.getAttribute('data-oproj'); openProj[k] = t.classList.contains('closed'); draw(); }
    else if ((t = e.target.closest('[data-fold]'))) { var f = t.getAttribute('data-fold'); closed[f] = !closed[f]; draw(); }
    else if ((t = e.target.closest('[data-mode]'))) P.changeMode(t.closest('.pp-proj').getAttribute('data-pid'), t.getAttribute('data-login'), t.getAttribute('data-mode'));
    else if ((t = e.target.closest('[data-rmproj]'))) P.askRemove([t.getAttribute('data-rmproj')], t.getAttribute('data-login'));
    else if ((t = e.target.closest('[data-addproj]'))) { open[t.getAttribute('data-addproj')] = true; draw(); }
    else if ((t = e.target.closest('[data-rm]'))) {
      var who = t.getAttribute('data-rm');
      P.askRemove(P.PROJECTS.filter(function (x) { return P.members(x.id).some(function (m) { return m.login === who; }); }).map(function (x) { return x.id; }), who);
    }
  });
  body.addEventListener('change', function (e) {
    var t = e.target.closest('[data-cell]'); if (!t) return;
    P.grant(t.getAttribute('data-proj'), t.getAttribute('data-login'), P.NODES[t.getAttribute('data-cell')], t.checked);
  });
  body.addEventListener('input', function (e) {
    if (!e.target.matches('.pp-search')) return;
    query = e.target.value; draw();
    var s = body.querySelector('.pp-search'); s.focus(); s.setSelectionRange(query.length, query.length);
  });

  P.onChange(draw); draw();
})();
