/* Tree with people: the project tree, each node carrying avatar chips of who can open it, with a popover per node. */
(function () {
  'use strict';
  var P = window.PERM, esc = P.esc;
  P.chrome('chips.html', 'Tree with people',
    'The product tree as PL draws it, with the people who can open each node beside it. Solid chips were given that node; outlined chips inherit it from Whole system. Click a chip or + to change it. FTEs see everything and aren’t listed.');

  var body = document.createElement('main'); body.className = 'lab-body'; document.body.insertBefore(body, document.querySelector('.plan'));
  var pid = 'pldemo', closed = {};

  var MARK = { pending: 'clock', 'new': 'newrepo', add: 'plus', remove: 'minus' };
  function sample(cls, label, mark, tip) {
    return '<span class="cp ' + cls + '" title="' + esc(tip) + '"><span class="pav" style="--h:200">' + P.icon('person') + '</span>' + (mark ? '<span class="cp-mark' + (mark === 'via' ? ' inh' : '') + '">' + P.icon(mark) + '</span>' : '') + '<span class="cp-name">' + esc(label) + '</span></span>';
  }
  var SAMPLES = sample('s-yes', 'Given here', '', 'Solid: access given on this node') +
    sample('s-yes inh', 'Inherited', 'via', 'Dashed: inherited from Whole system') +
    sample('s-pending', 'Invited', 'clock', 'Invite pending: not accepted on GitHub yet');
  function chip(n, p) {
    var st = P.cell(pid, p.login, n);
    if (!P.granted(st) && st.s !== 'remove' && st.s !== 'some') return '';
    var cls = 'cp s-' + st.s + (st.inherited ? ' inh' : '');
    var tip = p.name + ' (' + P.ROLES[p.role].label + (p.company ? ', ' + p.company : '') + '): ' + P.STATE[st.s].long + (st.inherited ? ' (inherited from Whole system)' : '');
    return '<button type="button" class="' + cls + '" data-chip="' + n.id + '" data-login="' + esc(p.login) + '" title="' + esc(tip) + '">' + P.avatar(p) +
      (MARK[st.s] ? '<span class="cp-mark">' + P.icon(MARK[st.s]) + '</span>' : st.inherited ? '<span class="cp-mark inh">' + P.icon('via') + '</span>' : '') +
      '<span class="cp-name">' + esc(p.name.split(' ')[0]) + (st.s === 'some' ? '<span class="cp-some"> · ' + st.n + ' of ' + st.of + ' Parts</span>' : '') + '</span>' +
      '<span class="cp-role" title="' + esc(P.ROLES[p.role].label) + '">' + P.icon(P.ROLES[p.role].icon) + '</span></button>';
  }
  function chipsFor(n) {
    if (n.tool === 'buy') {
      var with_ = P.PEOPLE.filter(function (p) { return p.role !== 'fte' && P.cell(pid, p.login, n).s === 'with-pl'; });
      return '<span class="cp-note">' + P.icon('box') + 'No Signoff tool · comes with the PL project' + (with_.length ? ' (' + with_.map(function (p) { return esc(p.name.split(' ')[0]); }).join(', ') + ')' : '') + '</span>';
    }
    var ppl = P.PEOPLE.filter(function (p) { return p.role !== 'fte'; });
    return ppl.map(function (p) { return chip(n, p); }).join('') +
      '<button type="button" class="cp-add" data-add="' + n.id + '" aria-label="Add someone to ' + esc(n.name) + '">' + P.icon('plus') + '</button>';
  }

  function draw() {
    var lines = [];
    (function go(n, d) { lines.push({ n: n, d: d }); if (!closed[n.id]) (n.kids || []).forEach(function (k) { go(k, d + 1); }); })(P.NODES[pid], 0);
    body.innerHTML = '<div class="lab-bar"><div class="seg">' + P.PROJECTS.map(function (p) {
      return '<button type="button" data-proj="' + p.id + '" class="' + (p.id === pid ? 'on' : '') + '">' + esc(p.name) + '</button>';
    }).join('') + '</div></div>' + P.legend({ Access: SAMPLES }) +
      '<div class="card ct">' + lines.map(function (r) {
        var n = r.n, kids = n.kids && n.kids.length;
        return '<div class="ct-row k-' + n.kind + '"><div class="tn" style="padding-left:' + (r.d * 22) + 'px">' +
          (kids ? '<button type="button" class="tn-caret' + (closed[n.id] ? ' closed' : '') + '" data-fold="' + n.id + '">' + P.icon('caret') + '</button>' : '<span class="tn-sp"></span>') +
          (n.kind === 'project' ? '<span class="src pl">PL</span>' : n.kind === 'part' ? P.tool(n) : '') +
          '<span class="tn-text"><span class="tn-name">' + esc(n.kind === 'project' ? n.name + ' (PL project)' : n.name) + '</span>' +
          (n.kind !== 'asm' ? P.repo(n) : '<span class="tn-note">Assembly: + here adds every Part in it</span>') + '</span></div>' +
          '<div class="ct-chips">' + chipsFor(n) + '</div></div>';
      }).join('') + '</div>';
  }

  // Popover for one person on one node, or the add list for a node.
  function pop(anchor, html) {
    closePop();
    var r = anchor.getBoundingClientRect(), el = document.createElement('div');
    el.className = 'pop'; el.innerHTML = html;
    document.body.appendChild(el);
    var left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - el.offsetWidth - 8);
    el.style.left = Math.max(8, left) + 'px'; el.style.top = (r.bottom + window.scrollY + 6) + 'px';
    setTimeout(function () { document.addEventListener('click', outside); });
    return el;
  }
  function outside(e) { if (!e.target.closest('.pop')) closePop(); }
  function closePop() { document.querySelectorAll('.pop').forEach(function (p) { p.remove(); }); document.removeEventListener('click', outside); }

  function personPop(anchor, n, login) {
    var p = P.person(login), st = P.cell(pid, login, n), m = P.mode(pid, login), r = P.repoOf(n);
    var why = n.kind === 'project' ? (m === 'system' ? 'Whole system: this project and every linked review, now and later.' : 'PL project, plus the Parts ticked one by one.') :
      st.inherited ? 'Inherited: ' + p.name.split(' ')[0] + ' has Whole system on ' + P.NODES[pid].name + '. Taking this away switches them to PL + chosen Parts.' :
      st.s === 'remove' ? 'Staged: Apply takes them off ' + (r ? r.future || r.name : 'it') + '.' :
      'Given on this ' + (n.kind === 'asm' ? 'assembly' : 'Part') + ' directly' + (n.kind === 'part' ? ', recorded in ' + P.TOOLS[n.tool].label + '’s users.json.' : '.');
    var el = pop(anchor, '<div class="pop-row">' + P.avatar(p, 'lg') + '<span class="grow"><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.login) + ' · ' + esc((p.company ? p.company + ', ' : '') + (p.note || '')) + '</span></span>' + P.pill(st) + '</div>' +
      '<div class="pop-role">' + P.roleTag(p) + '<span class="muted">People lists</span>' + P.rosterTags(p.login) + '</div>' +
      '<div class="pop-foot">' + esc(why) + (r && !r.inPl ? '<br>' + P.repo(n, { future: true }) : '') + '</div>' +
      (n.kind === 'project' ? '<div class="pop-mode">' + P.modeSeg(pid, login, true) + '</div>' : '') +
      '<div class="pop-acts">' + (st.s === 'remove' ? '<button type="button" class="btn" data-act="undo">Undo</button>' :
        '<button type="button" class="btn btn-danger" data-act="off">' + P.icon('minus') + 'Take away</button>') + '</div>');
    el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-mode]'); if (!t) return;
      if (t.hasAttribute('data-mode')) { closePop(); P.changeMode(pid, login, t.getAttribute('data-mode')); return; }
      if (n.kind === 'project' && t.getAttribute('data-act') === 'off') { closePop(); P.askRemove([pid], login); return; }
      P.grant(pid, login, n, t.getAttribute('data-act') === 'undo');
      closePop();
    });
  }
  function addPop(anchor, n) {
    var r = P.repoOf(n);
    var el = pop(anchor, '<h4>Who can open ' + esc(n.name) + '?</h4>' + P.byRole(P.PEOPLE.filter(function (p) { return p.role !== 'fte'; })).map(function (g) {
      var parts = g.role === 'client' ? P.byCompany(g.people) : [{ company: '', people: g.people }];
      return '<div class="pop-group">' + P.roleTag(g.people[0]) + '</div>' + parts.map(function (c) {
        return (c.company ? '<div class="pop-co">' + P.icon('building') + esc(c.company) + '</div>' : '') + c.people.map(function (p) {
      var st = P.cell(pid, p.login, n), on = n.kind === 'asm' ? st.s === 'all' : P.granted(st);
      return '<label class="pop-row"><input type="checkbox" data-pick="' + esc(p.login) + '"' + (on ? ' checked' : '') + '>' + P.avatar(p) +
        '<span class="grow">' + esc(p.name) + '<span class="sub">' + esc(p.note || p.role) + (st.inherited ? ' · inherited' : '') + '</span></span>' + P.rosterTags(p.login) + P.pill(st, { compact: true }) + '</label>';
    }).join(''); }).join(''); }).join('') + '<div class="pop-foot">' + (r && r.fteOnly && !r.inPl ? 'Not shared yet: ticking someone creates ' + esc(r.future) + ' and moves ' + esc(n.name) + ' out of ' + esc(r.name) + '.' :
      n.kind === 'asm' ? 'Ticks every Part in this assembly.' : 'Everyone on any tool’s people list is here; ticking stages it until Apply.') + '</div>');
    el.addEventListener('change', function (e) {
      var t = e.target.closest('[data-pick]'); if (!t) return;
      P.grant(pid, t.getAttribute('data-pick'), n, t.checked);
      addPop(anchor.isConnected ? anchor : body.querySelector('[data-add="' + n.id + '"]'), n);
    });
  }

  body.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-proj]'))) { pid = t.getAttribute('data-proj'); draw(); }
    else if ((t = e.target.closest('[data-fold]'))) { var id = t.getAttribute('data-fold'); closed[id] = !closed[id]; draw(); }
    else if ((t = e.target.closest('[data-chip]'))) personPop(t, P.NODES[t.getAttribute('data-chip')], t.getAttribute('data-login'));
    else if ((t = e.target.closest('[data-add]'))) addPop(t, P.NODES[t.getAttribute('data-add')]);
  });

  P.onChange(draw); draw();
})();
