/* Signoff PL: the Requirements tab (docs/requirements-tab.md). The model is plreqs.js.

   System requirements are edited here and sync with the PL project. Requirements that live in
   a design's review (Signoff EE or ME) are written straight into that review's file with the
   engine's GitHubStore.patchRecords, after a confirm: only those records change, with
   force:false, and a record someone else changed since PL read it comes back as a conflict card
   instead of being overwritten. What PL wrote shows through an overlay (plreqs.withOverlay)
   until the review's own tool syncs and renews its summary.

   app.js creates the view with S.plReqsView(ctx) and calls page(p) for the tab. Every control
   here uses data-rq, so app.js's own click handler never sees it. */
(function (S) {
  'use strict';
  var M = S.model, P = S.pl, R = S.plReqs, C = S.config;
  var LABEL = { fail: 'Failing', risk: 'At risk', gap: 'Gap', open: 'Open', pass: 'Met', deprecated: 'Deprecated' };
  var CHILD_LABEL = { fail: 'Failing', risk: 'At risk', open: 'Open', pass: 'Pass', deprecated: 'Deprecated' };
  var WORD = { inspection: 'Inspection', analysis: 'Analysis', demonstration: 'Demonstration', test: 'Test',
    draft: 'Draft', approved: 'Approved', changed: 'Changed', deprecated: 'Deprecated', open: 'Not verified', pass: 'Pass', fail: 'Fail',
    shall: 'Shall', should: 'Should', sys: 'System', ee: 'EE', me: 'ME', fw: 'FW', other: 'Other' };

  S.plReqsView = function (ctx) {
    var esc = ctx.esc, ui = ctx.ui;
    var overlay = ctx.load('reqOverlay', {});
    var seen = ctx.load('reqSeen', {});      // PL project id -> when this browser last marked it seen
    var drag = null;

    function idx() {
      var ix = ctx.index();
      overlay = R.pruneOverlay(ix, overlay);
      return R.withOverlay(ix, overlay);
    }
    function nodeName(t, id) { return (t.nodes[id] && t.nodes[id].name) || 'Part'; }
    function chip(state, labels) { return '<span class="rq-state rq-' + esc(state) + '">' + esc((labels || LABEL)[state] || state) + '</span>'; }
    function discChip(d) { return '<span class="rq-disc rq-d-' + esc(d) + '">' + esc(WORD[d] || d) + '</span>'; }
    var COLORS = { fail: 'var(--issue)', risk: 'var(--warn)', gap: 'var(--hair-2)', open: 'var(--na)', pass: 'var(--pass)', deprecated: 'var(--na)' };
    // One segment per allocated Part (or per child when it has none).
    function segRing(states, size) {
      if (!states.length) states = ['open'];
      var r = size / 2 - 3, c = 2 * Math.PI * r, n = states.length, gap = n > 1 ? 2 : 0, len = c / n - gap;
      return '<svg class="rq-ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + states.map(function (s, i) {
        return '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + COLORS[s] + '" stroke-width="4.5" stroke-dasharray="' + len + ' ' + (c - len) +
          '" stroke-dashoffset="' + (-(i * c / n)) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>';
      }).join('') + '</svg>';
    }
    function sysStates(s) {
      var cells = Object.keys(s.cells).map(function (k) { return s.cells[k]; });
      return cells.length ? cells : s.kids.map(function (it) { return it.req.state; });
    }
    function reqUrl(it, check) {
      var tool = P.toolById(it.home.tool);
      if (!tool) return '';
      return tool.app + '?' + (ctx.DEMO ? 'demo&' : '') + 'project=' + encodeURIComponent(it.home.project) + (check ? '&item=' + encodeURIComponent(check) : '&req=' + encodeURIComponent(it.req.id));
    }
    function isNew(p, at) { return !!seen[p.id] && !!at && at > seen[p.id]; }
    function homeName(t, it) { return it.design ? it.design.name || it.home.project : it.nodes.length ? nodeName(t, it.nodes[0]) : 'Project plan'; }

    // ── Page ───────────────────────────────────────────────
    function page(p) {
      if (!seen[p.id]) { seen[p.id] = M.now(); ctx.save('reqSeen', seen); }
      var ix = idx(), r = R.rollup(p, ix), t = P.tree(p);
      var f = ui.rqFilter || {}, sel = ui.rqSel || '';
      var live = r.sys.filter(function (s) { return s.state !== 'deprecated'; });
      var met = live.filter(function (s) { return s.state === 'pass'; }).length, pct = live.length ? Math.round(100 * met / live.length) : 0;
      var kidsCount = 0; r.sys.forEach(function (s) { kidsCount += s.kids.length; });
      var html = '<div class="page rq-page"><div class="rq-main"><div class="cl-head"><div>' + ctx.headBlock(p, 'Requirements') + '</div>' +
        '<div class="cl-head-acts"><div class="seg" role="tablist" aria-label="Layout">' + [['list', 'List'], ['matrix', 'Matrix']].map(function (l) {
          return '<button role="tab" class="' + ((ui.rqLayout || 'list') === l[0] ? 'on' : '') + '" data-rq="layout" data-v="' + l[0] + '">' + l[1] + '</button>';
        }).join('') + '</div><button class="btn" data-rq="csv">Export CSV</button><button class="btn btn-primary" data-rq="add">' + ctx.ICON.plus + ' Add requirement</button></div></div>';

      // The header: the product ring, state counters (filters) and the coverage strip.
      html += '<div class="card rq-hero">' + ctx.ring(pct, 84, 8, pct + '%', 'met') + '<div class="rq-hero-body">' +
        '<div class="rq-sub">' + ctx.plural(live.length, 'System requirement') + ' · ' + ctx.plural(kidsCount, 'derived requirement') + ' · ' + r.untraced.length + ' untraced</div>' +
        '<div class="rq-counters">' + ['fail', 'risk', 'gap', 'open', 'pass'].map(function (k) {
          return '<button class="rq-counter' + (f.state === k ? ' on' : '') + '" data-rq="state" data-v="' + k + '"><i style="background:' + COLORS[k] + '"></i><b>' + r.counts[k] + '</b> ' + LABEL[k].toLowerCase() + '</button>';
        }).join('') + '</div>' + strip(p, t, r, f) + '</div></div>';

      html += '<div class="filters rq-filters"><div class="seg">' + [['', 'All'], ['sys', 'System'], ['ee', 'EE'], ['me', 'ME'], ['fw', 'FW']].map(function (d) {
        return '<button class="' + ((f.disc || '') === d[0] ? 'on' : '') + '" data-rq="disc" data-v="' + d[0] + '">' + d[1] + '</button>';
      }).join('') + '</div>' + (f.part ? '<button class="chip accent rq-clear" data-rq="part" data-v="">' + esc(nodeName(t, f.part)) + ' ×</button>' : '') +
        '<div class="search"><input id="rq-q" type="search" placeholder="Filter requirements" value="' + esc(ui.rqQ || '') + '" autocomplete="off"></div>' +
        (r.sys.some(function (s) { return s.kids.some(function (it) { return isNew(p, it.req.at); }); }) || r.untraced.some(function (it) { return isNew(p, it.req.at); })
          ? '<button class="btn" data-rq="seen" title="Changes made since you last marked them seen have a dot">Mark all seen</button>' : '') + '</div>';

      if (!r.sys.length && !r.untraced.length) {
        html += '<div class="card empty"><h2>No requirements yet</h2><p>Write the product’s System requirements here, then drag each onto the Parts that must meet it. ' +
          'Requirements written in Signoff EE and ME show up too, and trace up to these.</p><button class="btn btn-primary" data-rq="add">Add the first requirement</button></div>';
      } else html += (ui.rqLayout === 'matrix' ? matrix(p, t, r, f) : list(p, t, r, f));
      html += '</div><div class="rq-side">' + (sel ? inspector(p, t, r, ix, sel) : '') + inbox(p, t, r) + partsRail(p, t, r) + '</div></div>';
      return html;
    }

    function strip(p, t, r, f) {
      if (!r.parts.length) return '';
      return '<div class="rq-strip" aria-label="Coverage by Part">' + r.parts.map(function (nid) {
        var n = t.nodes[nid], cells = r.sys.filter(function (s) { return s.cells[nid]; }).map(function (s) {
          var st = s.cells[nid];
          return '<button class="rq-cell rq-c-' + st + '" data-rq="cell" data-id="' + esc(s.rec.id) + '" data-part="' + esc(nid) + '" title="' + esc(s.rec.ref + ' on ' + n.name + ': ' + LABEL[st]) + '"></button>';
        }).join('');
        return '<div class="rq-strip-part' + (f.part === nid ? ' on' : '') + '"><button class="rq-strip-name" data-rq="part" data-v="' + esc(nid) + '">' + ctx.srcChip(n.source) + ' ' + esc(n.name) + '</button><div class="rq-cells">' + (cells || '<span class="note">no allocations</span>') + '</div></div>';
      }).join('') + '</div>';
    }

    function textMatch(q, s) { return !q || String(s).toLowerCase().indexOf(q.toLowerCase()) >= 0; }
    function sysShown(s, f) {
      if (f.state && s.state !== f.state) return false;
      if (f.part && !s.cells[f.part] && !s.kids.some(function (it) { return it.nodes.indexOf(f.part) >= 0; })) return false;
      if (f.disc && f.disc !== 'sys' && !s.kids.some(function (it) { return it.req.discipline === f.disc; })) return false;
      return textMatch(ui.rqQ, [s.rec.ref, s.rec.text, s.rec.category, s.rec.source].concat(s.kids.map(function (it) { return it.req.ref + ' ' + it.req.text; })).join(' '));
    }
    function kidShown(it, f) {
      return (!f.part || it.nodes.indexOf(f.part) >= 0) && (!f.disc || f.disc === 'sys' || it.req.discipline === f.disc);
    }

    function list(p, t, r, f) {
      var sel = ui.rqSel || '', open = ui.rqOpen || {};
      var rows = r.sys.filter(function (s) { return sysShown(s, f); }).map(function (s) {
        var q = s.rec, expanded = open[q.id] !== false;
        var h = '<div class="rq-row' + (sel === q.id ? ' sel' : '') + (s.state === 'deprecated' ? ' dep' : '') + '" data-rq="sel" data-id="' + esc(q.id) + '" draggable="true" data-rq-drag="' + esc(q.id) + '">' +
          '<button class="rq-caret' + (expanded ? ' open' : '') + '" data-rq="toggle" data-id="' + esc(q.id) + '" aria-label="Show or hide its requirements">' + ctx.ICON.chev + '</button>' +
          segRing(sysStates(s), 28) + '<span class="rq-ref">' + esc(q.ref) + '</span>' +
          '<span class="rq-text"><span class="rq-t">' + esc(q.text || 'No text yet') + '</span><span class="rq-meta">' + esc([WORD[q.kind], q.category, WORD[q.method], q.source].filter(Boolean).join(' · ')) +
          (q.status !== 'approved' ? ' · ' + esc(WORD[q.status]) : '') + (!(q.parts || []).length ? ' · not allocated' : '') + '</span></span>' + chip(s.state) + '</div>';
        if (!expanded) return h;
        (q.parts || []).forEach(function (nid) {
          if (!t.nodes[nid] || (f.part && f.part !== nid)) return;
          var kids = s.kids.filter(function (it) { return it.nodes.indexOf(nid) >= 0 && kidShown(it, f); });
          if (!kids.length && s.cells[nid] === 'gap' && (!f.disc || f.disc === 'sys' || t.nodes[nid].source === f.disc)) {
            h += '<div class="rq-row kid gap"><span></span>' + ctx.srcChip(t.nodes[nid].source) + '<span class="rq-ref">—</span><span class="rq-text"><span class="rq-t muted">' + esc(t.nodes[nid].name) +
              ': allocated, no requirement for it yet</span></span><button class="btn btn-sm" data-rq="derive" data-id="' + esc(q.id) + '" data-part="' + esc(nid) + '">Derive</button></div>';
          }
          kids.forEach(function (it) { h += kidRow(p, t, it, sel); });
        });
        s.unallocatedKids.filter(function (it) { return kidShown(it, f); }).forEach(function (it) { h += kidRow(p, t, it, sel, true); });
        return h;
      });
      var un = r.untraced.filter(function (it) { return kidShown(it, f) && !f.state && textMatch(ui.rqQ, it.req.ref + ' ' + it.req.text); });
      return '<div class="card rq-list">' + (rows.join('') || '<div class="empty"><p>No System requirement matches.</p></div>') +
        (un.length ? '<div class="rq-section">Not traced to a System requirement</div>' + un.map(function (it) { return kidRow(p, t, it, sel); }).join('') : '') + '</div>';
    }
    function kidRow(p, t, it, sel, stray) {
      var q = it.req, key = it.key, tool = P.toolById(it.home.tool);
      var issues = (q.issues || []).map(function (id) {
        var o = it.design && it.design.summary && (it.design.summary.open || []).filter(function (x) { return x.id === id; })[0];
        return '<a class="rq-pill" href="' + esc(reqUrl(it, id)) + '" target="_blank" rel="noopener" data-stop title="' + esc(o ? o.text : id) + '"><i class="sev-dot ' + esc(o ? o.severity : 'minor') + '"></i>' + esc(id) + (o ? ' · ' + esc(o.severity) : '') + '</a>';
      }).join('');
      return '<div class="rq-row kid' + (sel === key ? ' sel' : '') + (q.state === 'deprecated' ? ' dep' : '') + '" data-rq="sel" data-id="' + esc(key) + '"><span>' + (isNew(p, q.at) ? '<i class="rq-new" title="Changed since you last looked"></i>' : '') + '</span>' +
        discChip(q.discipline) + '<span class="rq-ref">' + esc(q.ref) + '</span><span class="rq-text"><span class="rq-t">' + esc(homeName(t, it)) + ' · ' + esc(q.text) + '</span>' +
        '<span class="rq-meta">' + esc([WORD[q.method], tool ? 'in Signoff ' + tool.short : 'held in PL'].join(' · ')) + (q.status === 'changed' ? ' · <b class="rq-warn">Changed, needs approval</b>' : '') +
        (stray ? ' · <b class="rq-warn">its Part isn’t allocated</b>' : '') + issues + '</span></span>' + chip(q.state, CHILD_LABEL) + '</div>';
    }

    function matrix(p, t, r, f) {
      var cols = r.parts.filter(function (nid) { return !f.part || nid === f.part; });
      return '<div class="card rq-matrix"><table class="table"><thead><tr><th>System requirement</th>' + cols.map(function (nid) { return '<th>' + ctx.srcChip(t.nodes[nid].source) + ' ' + esc(t.nodes[nid].name) + '</th>'; }).join('') +
        '<th>Roll-up</th></tr></thead><tbody>' + r.sys.filter(function (s) { return sysShown(s, f); }).map(function (s) {
          return '<tr data-rq="sel" data-id="' + esc(s.rec.id) + '"><td><span class="rq-ref">' + esc(s.rec.ref) + '</span> ' + esc(s.rec.text) + '</td>' + cols.map(function (nid) {
            var kids = s.kids.filter(function (it) { return it.nodes.indexOf(nid) >= 0; });
            if (!s.cells[nid] && !kids.length) return '<td class="rq-none">·</td>';
            return '<td>' + kids.map(function (it) { return '<div><span class="rq-ref">' + esc(it.req.ref) + '</span> ' + chip(it.req.state, CHILD_LABEL) + '</div>'; }).join('') + (s.cells[nid] === 'gap' ? chip('gap') : '') + '</td>';
          }).join('') + '<td>' + chip(s.state) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    // ── Needs you, and the Parts to drop on ────────────────
    function inbox(p, t, r) {
      var b = r.inbox, groups = [];
      function g(title, items) { if (items.length) groups.push('<div class="rq-ib-g">' + esc(title) + ' · ' + items.length + '</div>' + items.join('')); }
      g('Unallocated', b.unallocated.map(function (s) {
        return '<div class="rq-ib" draggable="true" data-rq-drag="' + esc(s.rec.id) + '"><span class="rq-ref">' + esc(s.rec.ref) + '</span> ' + esc(s.rec.text) + '<div class="note">Drag it onto a Part below.</div></div>';
      }));
      g('Needs approval', b.approval.map(function (it) {
        return '<div class="rq-ib"><span class="rq-ref">' + esc(homeName(t, it) + ' · ' + it.req.ref) + '</span> was reworded after approval.<div class="rq-ib-acts">' +
          '<button class="btn btn-sm btn-primary" data-rq="approve" data-id="' + esc(it.key) + '">Approve</button><button class="btn btn-sm" data-rq="sel" data-id="' + esc(it.key) + '">Look</button></div></div>';
      }));
      g('Untraced', b.untraced.slice(0, 4).map(function (it) {
        var sug = R.suggest(it, r.sys);
        return '<div class="rq-ib"><span class="rq-ref">' + esc(homeName(t, it) + ' · ' + it.req.ref) + '</span> ' + esc(it.req.text) +
          '<div class="note">' + (sug ? 'Looks like ' + esc(sug.rec.ref) + ', ' + esc(sug.rec.text) : 'No obvious System parent.') + '</div><div class="rq-ib-acts">' +
          '<button class="btn btn-sm" data-rq="trace" data-id="' + esc(it.key) + '">Trace up</button></div></div>';
      }).concat(b.untraced.length > 4 ? ['<div class="note rq-ib-more">' + (b.untraced.length - 4) + ' more in the list</div>'] : []));
      g('At risk or failing', b.risk.slice(0, 4).map(function (it) {
        return '<button class="rq-ib rq-ib-btn" data-rq="sel" data-id="' + esc(it.key) + '"><span class="rq-ref">' + esc(homeName(t, it) + ' · ' + it.req.ref) + '</span> ' + chip(it.req.state, CHILD_LABEL) +
          '<div class="note">' + esc((it.req.issues || []).join(', ') || 'Verification failed') + '</div></button>';
      }));
      g('Gaps', b.gaps.map(function (s) {
        return '<button class="rq-ib rq-ib-btn" data-rq="sel" data-id="' + esc(s.rec.id) + '"><span class="rq-ref">' + esc(s.rec.ref) + '</span> ' + esc(s.rec.text) +
          '<div class="note">Allocated to ' + Object.keys(s.cells).filter(function (k) { return s.cells[k] === 'gap'; }).map(function (k) { return esc(nodeName(t, k)); }).join(', ') + ' with nothing derived yet.</div></button>';
      }));
      var n = b.unallocated.length + b.approval.length + b.untraced.length + b.risk.length + b.gaps.length;
      return '<div class="card rq-inbox"><h3>Needs you' + (n ? ' <span class="count">' + n + '</span>' : '') + '</h3>' + (groups.join('') || '<p class="note">Nothing waiting. Every requirement is allocated and traced.</p>') + '</div>';
    }
    function partsRail(p, t, r) {
      var parts = P.flatten(t).filter(function (id) { return t.nodes[id].kind === 'part' && t.nodes[id].source !== 'purchased'; });
      if (!parts.length) return '';
      return '<div class="card rq-parts"><h3>Parts <span class="note">drop a requirement to allocate</span></h3><div class="rq-part-grid">' + parts.map(function (nid) {
        var n = r.sys.filter(function (s) { return s.cells[nid]; }).length;
        return '<div class="rq-part" data-rq-drop="' + esc(nid) + '">' + ctx.srcChip(t.nodes[nid].source) + ' ' + esc(t.nodes[nid].name) + '<span class="note">' + ctx.plural(n, 'System requirement') + '</span></div>';
      }).join('') + '</div></div>';
    }

    // ── Inspector ──────────────────────────────────────────
    function findItem(r, key) {
      var all = r.untraced.slice();
      r.sys.forEach(function (s) { all = all.concat(s.kids); });
      return all.filter(function (it) { return it.key === key; })[0] || null;
    }
    function inspector(p, t, r, ix, sel) {
      var s = r.sys.filter(function (x) { return x.rec.id === sel; })[0];
      if (s) return sysInspector(p, t, s);
      var it = findItem(r, sel);
      if (!it) { ui.rqSel = ''; return ''; }
      var q = it.req, tool = P.toolById(it.home.tool), par = q.parent && r.sys.filter(function (x) { return x.rec.id === q.parent.id && q.parent.project === p.id; })[0];
      var html = '<aside class="card rq-ins"><button class="icon-btn rq-ins-close" data-rq="close" aria-label="Close">×</button>' +
        '<div class="eyebrow">' + discChip(q.discipline) + ' ' + esc(homeName(t, it)) + ' · ' + esc(q.ref) + '</div><h2 class="rq-ins-text">' + esc(q.text) + '</h2>' +
        '<p>' + chip(q.state, CHILD_LABEL) + ' <span class="note">' + esc([WORD[q.kind], q.category, WORD[q.method], WORD[q.status]].filter(Boolean).join(' · ')) + '</span></p>' +
        '<div class="rq-ins-h">Lives in</div><p>' + (tool ? 'The ' + esc(homeName(t, it)) + ' review in Signoff ' + esc(tool.short) + '. Edits from here are written into that review.' : 'This PL project (no review tool for it yet).') + '</p>' +
        '<div class="rq-ins-h">Flows down from</div>' + (par ? '<button class="rq-link" data-rq="sel" data-id="' + esc(par.rec.id) + '"><span class="rq-ref">' + esc(par.rec.ref) + '</span> ' + esc(par.rec.text) + '</button>'
          : '<p class="note">Nothing yet.</p><button class="btn btn-sm" data-rq="trace" data-id="' + esc(it.key) + '">Trace up</button>');
      if (tool) {
        html += '<div class="rq-ins-h">Verification</div><p>' + esc(WORD[q.verify]) + ' · ' + ctx.plural(q.links || 0, 'traced check') + '</p>' +
          ((q.issues || []).length ? '<div class="rq-issues">' + q.issues.map(function (id) {
            var o = (it.design.summary.open || []).filter(function (x) { return x.id === id; })[0];
            return '<a href="' + esc(reqUrl(it, id)) + '" target="_blank" rel="noopener"><span class="sev ' + esc(o ? o.severity : 'minor') + '">' + esc(o ? o.severity : 'issue') + '</span><span>' + esc(o ? o.text : id) + '</span></a>';
          }).join('') + '</div>' : '');
      }
      if (q.at) html += '<p class="note">' + (isNew(p, q.at) ? '<i class="rq-new"></i>' : '') + 'Changed ' + esc(ctx.relTime(q.at)) + (q.by ? ' by ' + esc(q.by) : '') + '</p>';
      html += '<div class="rq-ins-acts">' + (tool ? '<a class="btn btn-primary" href="' + esc(reqUrl(it)) + '" target="_blank" rel="noopener">Open in ' + esc(tool.name) + '</a>' : '') +
        '<button class="btn" data-rq="edit-kid" data-id="' + esc(it.key) + '">Edit</button>' +
        (q.status === 'changed' ? '<button class="btn" data-rq="approve" data-id="' + esc(it.key) + '">Approve</button>' : '') + '</div></aside>';
      return html;
    }
    function sysInspector(p, t, s) {
      var q = s.rec;
      function seg(key, values) {
        return '<div class="seg full">' + values.map(function (v) { return '<button class="' + (q[key] === v ? 'on' : '') + '" data-rq="field" data-key="' + key + '" data-v="' + v + '">' + WORD[v] + '</button>'; }).join('') + '</div>';
      }
      var parts = (q.parts || []).filter(function (nid) { return t.nodes[nid]; });
      var free = P.flatten(t).filter(function (id) { return t.nodes[id].kind === 'part' && parts.indexOf(id) < 0 && t.nodes[id].source !== 'purchased'; });
      return '<aside class="card rq-ins"><button class="icon-btn rq-ins-close" data-rq="close" aria-label="Close">×</button>' +
        '<div class="eyebrow">' + discChip('sys') + ' System · ' + esc(q.ref) + ' · ' + chip(s.state) + '</div>' +
        '<div class="field"><label for="rq-text">Requirement</label><textarea class="input" id="rq-text" rows="3" data-rq-input="text">' + esc(q.text) + '</textarea></div>' +
        '<div class="row2"><div class="field"><label for="rq-cat">Category</label><input class="input" id="rq-cat" data-rq-input="category" value="' + esc(q.category) + '"></div>' +
        '<div class="field"><label for="rq-src">Source</label><input class="input" id="rq-src" data-rq-input="source" value="' + esc(q.source) + '" placeholder="Spec and section"></div></div>' +
        '<div class="field"><span class="field-label">Type</span>' + seg('kind', ['shall', 'should']) + '</div>' +
        '<div class="field"><span class="field-label">Verify by</span>' + seg('method', M.REQ_METHODS) + '</div>' +
        '<div class="field"><span class="field-label">Status</span>' + seg('status', M.REQ_STATUS) + '</div>' +
        '<div class="field"><span class="field-label">Verified at product level</span>' + seg('verify', M.REQ_VERIFY) + '</div>' +
        '<div class="rq-ins-h">Allocated to</div>' + (parts.length ? parts.map(function (nid) {
          var kids = s.kids.filter(function (it) { return it.nodes.indexOf(nid) >= 0; });
          return '<div class="rq-alloc">' + ctx.srcChip(t.nodes[nid].source) + ' <b>' + esc(t.nodes[nid].name) + '</b> ' + chip(s.cells[nid] || 'gap') +
            '<button class="cmt-del" data-rq="unalloc" data-id="' + esc(q.id) + '" data-part="' + esc(nid) + '">Remove</button>' +
            (kids.length ? kids.map(function (it) { return '<button class="rq-link" data-rq="sel" data-id="' + esc(it.key) + '"><span class="rq-ref">' + esc(it.req.ref) + '</span> ' + esc(it.req.text) + ' ' + chip(it.req.state, CHILD_LABEL) + '</button>'; }).join('')
              : '<button class="btn btn-sm" data-rq="derive" data-id="' + esc(q.id) + '" data-part="' + esc(nid) + '">Derive a requirement here</button>') + '</div>';
        }).join('') : '<p class="note">Not allocated. Drag the row onto a Part, or pick one.</p>') +
        (free.length ? '<select class="input" data-rq-alloc="' + esc(q.id) + '"><option value="">Allocate to a Part…</option>' + free.map(function (id) { return '<option value="' + esc(id) + '">' + esc(t.nodes[id].name) + '</option>'; }).join('') + '</select>' : '') +
        (s.kids.some(function (it) { return it.home.tool !== 'pl'; }) ? '<p class="note">Children keep a copy of this wording for people without PL. <a href="#" data-rq="push-text" data-id="' + esc(q.id) + '">Send the current wording to them</a>.</p>' : '') +
        '<p class="note">Changed ' + esc(ctx.relTime(q.updatedAt)) + (q.updatedBy ? ' by ' + esc(q.updatedBy) : '') + '</p>' +
        '<div class="rq-ins-acts"><button class="btn btn-danger" data-rq="delete" data-id="' + esc(q.id) + '">Delete</button></div></aside>';
    }

    // ── Editing PL's own records ───────────────────────────
    function setSys(id, fields) {
      var p = ctx.current(), prev = p && p.reqs && p.reqs[id];
      if (!prev) return;
      var next = Object.assign({}, prev, fields);
      if (prev.status === 'approved' && fields.text !== undefined && fields.text !== prev.text) next.status = 'changed';
      p.reqs[id] = M.stamp(next, ctx.me());
      ctx.touch(p);
    }
    function addSys() {
      var p = ctx.current(); if (!p) return;
      var q = R.newReq(p, {}, ctx.me());
      p.reqs[q.id] = q;
      ui.rqSel = q.id; ctx.saveUi(); ctx.touch(p);
      setTimeout(function () { var el = document.getElementById('rq-text'); if (el) el.focus(); }, 40);
    }
    function allocate(id, nid) {
      var p = ctx.current(), q = p && p.reqs && p.reqs[id];
      if (!q || q.parent) return;
      var parts = (q.parts || []).slice();
      if (parts.indexOf(nid) >= 0) return;
      parts.push(nid);
      setSys(id, { parts: parts });
      ctx.toast(q.ref + ' allocated to ' + nodeName(P.tree(p), nid));
    }

    // ── Writing into a review ──────────────────────────────
    // The review file is found through the tool's data repo's shared map, read fresh, never from
    // the reader's cache: a review that just moved to its own repo leaves a stray behind.
    function homeStore(entry) {
      var tool = P.toolById(entry.tool), s = ctx.settings, token = ctx.getToken();
      var data = new S.GitHubStore({ owner: s.owner, repo: tool.dataRepo, branch: s.branch, dataPath: '', token: token });
      return data.snapshot().then(function (snap) {
        var u = snap.entries.filter(function (e) { return e.path === 'users.json'; })[0];
        return u ? data.blob(u.sha).then(function (t) { return M.sharedRepo(JSON.parse(t), entry.id); }) : '';
      }).then(function (shared) {
        var full = shared || s.owner + '/' + tool.dataRepo;
        return { store: new S.GitHubStore({ owner: full.split('/')[0], repo: full.split('/')[1], branch: s.branch, dataPath: '', token: token }), full: full, path: 'projects/' + entry.id + '.json', tool: tool };
      });
    }
    function readDoc(h) {
      return h.store.snapshot().then(function (snap) {
        var e = snap.entries.filter(function (x) { return x.path === h.path; })[0];
        if (!e) throw new Error(h.path + ' isn’t in ' + h.full);
        return h.store.blob(e.sha).then(function (t) { return JSON.parse(t); });
      });
    }
    // What PL wrote, kept for the overlay, rebuilt from known fields like anything read from a review.
    function remember(entryKey, rec, entry) {
      var raw = R.asListItem(rec);
      raw.discipline = M.oneOf(R.DISCIPLINES, rec.discipline, entry.tool);
      raw.at = rec.updatedAt;
      var item = (S.plReader.cleanSummary({ reqList: [raw] }).reqList || [])[0];
      if (!item) return;
      (overlay[entryKey] = overlay[entryKey] || {})[rec.id] = item;
      ctx.save('reqOverlay', overlay);
    }
    // change(doc) -> { records, bases, what }. Asks first, then writes; a conflict opens a card.
    function writeToReview(entryKey, change) {
      var entry = ctx.index().entries[entryKey];
      if (!entry) return ctx.toast('That design isn’t read yet. Sync first.');
      if (ctx.DEMO) {
        var demoDoc = { reqs: {} };
        var c = change(demoDoc, true);
        c.records.forEach(function (rec) { remember(entryKey, rec, entry); });
        ctx.toast('Demo: written in this browser only. ' + c.what);
        return ctx.renderPage();
      }
      if (!ctx.getToken()) return ctx.toast('Add your GitHub token in Settings first');
      var h;
      homeStore(entry).then(function (x) { h = x; return readDoc(h); }).then(function (doc) {
        var c = change(doc, false);
        confirmWrite(h, entry, c, function () {
          ctx.toast('Writing to ' + h.full + '…');
          h.store.patchRecords(h.path, 'reqs', c.records, { bases: c.bases, message: 'Signoff PL: ' + c.what + ' (' + ctx.me() + ')' }).then(function (res) {
            c.records.forEach(function (rec) { if (res.written.indexOf(rec.id) >= 0) remember(entryKey, rec, entry); });
            if (res.conflicts.length) conflictCard(entryKey, h, c, res.conflicts);
            else ctx.toast(res.written.length ? 'Written to ' + h.full : 'Nothing to write: the review already has it');
            ctx.renderPage();
          }, function (err) { ctx.toast('Not written: ' + err.message); });
        });
      }).catch(function (err) { ctx.toast('Couldn’t read the review: ' + err.message); });
    }
    function confirmWrite(h, entry, c, go) {
      var shared = h.full.split('/')[1].indexOf(h.tool.prefix) === 0;
      var w = ctx.sheet('<div class="sheet-head"><h2>Write to ' + esc(entry.name) + '?</h2><p>' + esc(c.what) + '. Signoff PL writes only these requirement records into <b>' + esc(h.full) + '</b>, and nothing else in the review changes.' +
        (shared ? ' This review is shared with its contractors, who will see the change.' : '') + '</p></div>' +
        '<div class="sheet-body">' + c.records.map(function (rec) { return '<p><span class="rq-ref">' + esc(rec.ref) + '</span> ' + esc(rec.text) + (rec.parent ? '<br><span class="note">Flows down from ' + esc(rec.parent.ref) + '</span>' : '') + '</p>'; }).join('') + '</div>' +
        '<div class="sheet-foot"><span class="spacer"></span><button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">Write</button></div>');
      w.addEventListener('click', function (e) {
        var b = e.target.closest('[data-sheet]'); if (!b) return;
        ctx.closeSheet();
        if (b.dataset.sheet === 'ok') go();
      });
    }
    var FIELDS = ['text', 'kind', 'category', 'source', 'method', 'status', 'verify', 'evidence', 'discipline'];
    function conflictCard(entryKey, h, c, conflicts) {
      var cf = conflicts[0], mine = c.records.filter(function (r) { return r.id === cf.id; })[0], theirs = cf.theirs || {};
      var diff = FIELDS.concat(['parent']).filter(function (k) { return JSON.stringify(mine[k] || '') !== JSON.stringify(theirs[k] || ''); });
      var w = ctx.sheet('<div class="sheet-head"><h2>' + esc(mine.ref) + ' changed in the review</h2><p>' + esc(theirs.updatedBy || 'Someone') + ' changed it ' + esc(ctx.relTime(theirs.updatedAt)) +
        ', after PL read it. Nothing was written. Pick which version to keep.</p></div><div class="sheet-body"><table class="table"><thead><tr><th></th><th>In the review</th><th>Yours</th></tr></thead><tbody>' +
        diff.map(function (k) {
          var show = function (v) { return k === 'parent' ? (v ? v.ref : '') : v; };
          return '<tr><td>' + esc(k) + '</td><td>' + esc(show(theirs[k]) || '—') + '</td><td>' + esc(show(mine[k]) || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="sheet-foot"><span class="spacer"></span><button class="btn" data-sheet="cancel">Keep theirs</button><button class="btn btn-primary" data-sheet="ok">Keep mine</button></div>', { wide: true });
      w.addEventListener('click', function (e) {
        var b = e.target.closest('[data-sheet]'); if (!b) return;
        ctx.closeSheet();
        if (b.dataset.sheet !== 'ok') return;
        var again = M.stamp(Object.assign({}, mine), ctx.me()), bases = {};
        bases[mine.id] = theirs.updatedAt || '';
        h.store.patchRecords(h.path, 'reqs', [again], { bases: bases, message: 'Signoff PL: ' + c.what + ', kept over a newer edit (' + ctx.me() + ')' }).then(function (res) {
          if (res.written.length) { remember(entryKey, again, ctx.index().entries[entryKey]); ctx.toast('Written to ' + h.full); }
          else if (res.conflicts.length) ctx.toast('It changed again. Open it again to compare.');
          ctx.renderPage();
        }, function (err) { ctx.toast('Not written: ' + err.message); });
      });
    }

    // A child record changed through `fn`, wherever it lives.
    function editChild(it, fn, what) {
      var p = ctx.current();
      if (it.home.tool === 'pl') {
        var prev = p.reqs[it.req.id]; if (!prev) return;
        p.reqs[it.req.id] = M.stamp(fn(Object.assign({}, prev)), ctx.me());
        ctx.touch(p); ctx.toast(what);
        return;
      }
      var entryKey = it.home.tool + ':' + it.home.project;
      writeToReview(entryKey, function (doc, demo) {
        var cur = doc.reqs && doc.reqs[it.req.id];
        var base = demo ? Object.assign({}, it.req, { links: [] }) : cur;
        if (!base) throw new Error(it.req.ref + ' isn’t in the review any more');
        var rec = M.stamp(fn(Object.assign({}, base)), ctx.me()), bases = {};
        if (!demo) bases[rec.id] = cur.updatedAt || '';
        return { records: [rec], bases: bases, what: what };
      });
    }
    function derive(sysId, nid) {
      var p = ctx.current(), t = P.tree(p), sys = p.reqs[sysId], n = t.nodes[nid];
      if (!sys || !n) return;
      var link = R.parentLink(p, sys), key = P.refKey(n.ref), tool = P.toolById(n.source);
      if (!tool || !key) {
        var q = R.newReq(p, { text: sys.text, kind: sys.kind, category: sys.category, method: sys.method, discipline: n.source === 'fw' ? 'fw' : 'other', parent: link, part: nid }, ctx.me());
        delete q.parts;
        p.reqs[q.id] = q; ui.rqSel = 'pl:' + p.id + ':' + q.id; ctx.saveUi(); ctx.touch(p);
        return ctx.toast(q.ref + ' derived for ' + n.name + ', held in this project');
      }
      writeToReview(key, function (doc) {
        var rec = M.newReq({ reqs: doc.reqs || {} }, { text: sys.text, kind: sys.kind, category: sys.category, source: sys.ref + ' (project plan)', method: sys.method, discipline: tool.id, parent: link }, ctx.me());
        if (ctx.DEMO) rec.ref = 'REQ-' + String(((ctx.index().entries[key].summary || {}).reqList || []).length + 1).padStart(3, '0');
        var bases = {}; bases[rec.id] = '';
        return { records: [rec], bases: bases, what: 'Derive ' + rec.ref + ' on ' + n.name + ' from ' + sys.ref };
      });
    }
    function traceSheet(it) {
      var p = ctx.current(), r = R.rollup(p, idx()), sug = R.suggest(it, r.sys);
      var live = r.sys.filter(function (s) { return s.state !== 'deprecated'; });
      var w = ctx.sheet('<div class="sheet-head"><h2>Trace ' + esc(it.req.ref) + ' up</h2><p>' + esc(it.req.text) + '</p></div><div class="sheet-body"><div class="rq-pick">' + live.map(function (s) {
        return '<label class="rq-pick-row"><input type="radio" name="rq-par" value="' + esc(s.rec.id) + '"' + (sug === s ? ' checked' : '') + '> <span class="rq-ref">' + esc(s.rec.ref) + '</span> ' + esc(s.rec.text) + (sug === s ? ' <span class="chip accent">suggested</span>' : '') + '</label>';
      }).join('') + '</div></div><div class="sheet-foot"><span class="spacer"></span><button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">Trace</button></div>', { wide: true });
      w.addEventListener('click', function (e) {
        var b = e.target.closest('[data-sheet]'); if (!b) return;
        var pick = w.querySelector('input[name=rq-par]:checked');
        ctx.closeSheet();
        if (b.dataset.sheet !== 'ok' || !pick) return;
        var sys = p.reqs[pick.value];
        editChild(it, function (rec) { rec.parent = R.parentLink(p, sys); return rec; }, 'Trace ' + it.req.ref + ' to ' + sys.ref);
      });
    }
    function editKidSheet(it) {
      var q = it.req;
      var w = ctx.sheet('<div class="sheet-head"><h2>Edit ' + esc(q.ref) + '</h2><p>' + (it.home.tool === 'pl' ? 'Held in this project.' : 'Written into the review when you save, after a confirm.') + '</p></div><div class="sheet-body">' +
        '<div class="field"><label for="rk-text">Requirement</label><textarea class="input" id="rk-text" rows="3">' + esc(q.text) + '</textarea></div>' +
        '<div class="row2"><div class="field"><label for="rk-status">Status</label><select class="input" id="rk-status">' + M.REQ_STATUS.map(function (v) { return '<option value="' + v + '"' + (q.status === v ? ' selected' : '') + '>' + WORD[v] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="rk-verify">Verified</label><select class="input" id="rk-verify">' + M.REQ_VERIFY.map(function (v) { return '<option value="' + v + '"' + (q.verify === v ? ' selected' : '') + '>' + WORD[v] + '</option>'; }).join('') + '</select></div></div>' +
        '</div><div class="sheet-foot"><span class="spacer"></span><button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">Save</button></div>');
      w.addEventListener('click', function (e) {
        var b = e.target.closest('[data-sheet]'); if (!b) return;
        var text = ctx.val(w, '#rk-text'), status = ctx.val(w, '#rk-status'), verify = ctx.val(w, '#rk-verify');
        ctx.closeSheet();
        if (b.dataset.sheet !== 'ok') return;
        editChild(it, function (rec) {
          if (text && text !== rec.text) { rec.text = text; if (rec.status === 'approved' && status === 'approved') status = 'changed'; }
          rec.status = M.oneOf(M.REQ_STATUS, status, rec.status); rec.verify = M.oneOf(M.REQ_VERIFY, verify, rec.verify);
          return rec;
        }, 'Edit ' + q.ref);
      });
    }
    function pushText(sysId) {
      var p = ctx.current(), r = R.rollup(p, idx()), s = r.sys.filter(function (x) { return x.rec.id === sysId; })[0];
      if (!s) return;
      var byDesign = {};
      s.kids.forEach(function (it) { if (it.home.tool !== 'pl') (byDesign[it.home.tool + ':' + it.home.project] = byDesign[it.home.tool + ':' + it.home.project] || []).push(it); });
      Object.keys(byDesign).forEach(function (k) {
        writeToReview(k, function (doc, demo) {
          var bases = {}, recs = byDesign[k].map(function (it) {
            var cur = demo ? Object.assign({}, it.req) : doc.reqs && doc.reqs[it.req.id];
            if (!cur) return null;
            if (!demo) bases[cur.id] = cur.updatedAt || '';
            return M.stamp(Object.assign({}, cur, { parent: R.parentLink(p, s.rec) }), ctx.me());
          }).filter(Boolean);
          return { records: recs, bases: bases, what: 'Update the wording of ' + s.rec.ref + ' on its children' };
        });
      });
    }

    // ── Events ─────────────────────────────────────────────
    function filter(k, v) { ui.rqFilter = Object.assign({}, ui.rqFilter || {}); ui.rqFilter[k] = ui.rqFilter[k] === v ? '' : v; ctx.saveUi(); ctx.renderPage(); }
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-stop]') || e.target.closest('#sheet')) return;
      var el = e.target.closest('[data-rq]');
      if (!el || !ctx.current() || ctx.view() !== 'reqs') return;
      var a = el.dataset.rq, id = el.dataset.id, p = ctx.current();
      if (el.tagName === 'A') e.preventDefault();
      var r, it;
      switch (a) {
        case 'layout': ui.rqLayout = el.dataset.v; ctx.saveUi(); ctx.renderPage(); break;
        case 'state': filter('state', el.dataset.v); break;
        case 'disc': ui.rqFilter = Object.assign({}, ui.rqFilter || {}, { disc: el.dataset.v }); ctx.saveUi(); ctx.renderPage(); break;
        case 'part': filter('part', el.dataset.v); break;
        case 'cell': ui.rqFilter = Object.assign({}, ui.rqFilter || {}, { part: el.dataset.part }); ui.rqSel = id; ui.rqOpen = Object.assign({}, ui.rqOpen); ui.rqOpen[id] = true; ctx.saveUi(); ctx.renderPage(); break;
        case 'toggle': e.stopPropagation(); ui.rqOpen = Object.assign({}, ui.rqOpen); ui.rqOpen[id] = ui.rqOpen[id] === false; ctx.saveUi(); ctx.renderPage(); break;
        case 'sel': ui.rqSel = ui.rqSel === id && el.classList.contains('rq-row') ? '' : id; ctx.saveUi(); ctx.renderPage(); break;
        case 'close': ui.rqSel = ''; ctx.saveUi(); ctx.renderPage(); break;
        case 'add': addSys(); break;
        case 'csv': {
          var dl = document.createElement('a');
          dl.href = URL.createObjectURL(new Blob(['﻿' + R.csv(p, idx())], { type: 'text/csv' }));
          dl.download = (p.slug || 'product') + '-requirements.csv'; dl.click();
          setTimeout(function () { URL.revokeObjectURL(dl.href); }, 1000);
          break;
        }
        case 'seen': seen[p.id] = M.now(); ctx.save('reqSeen', seen); ctx.renderPage(); break;
        case 'field': setSys(ui.rqSel, (function () { var f = {}; f[el.dataset.key] = el.dataset.v; return f; })()); break;
        case 'unalloc': setSys(id, { parts: (p.reqs[id].parts || []).filter(function (x) { return x !== el.dataset.part; }) }); break;
        case 'delete': if (window.confirm('Delete ' + p.reqs[id].ref + '? Its derived requirements stay in their reviews, untraced.')) { setSys(id, { deleted: true }); ui.rqSel = ''; ctx.saveUi(); } break;
        case 'derive': e.stopPropagation(); derive(id, el.dataset.part); break;
        case 'push-text': pushText(id); break;
        case 'trace': case 'approve': case 'edit-kid':
          r = R.rollup(p, idx()); it = findItem(r, id);
          if (!it) break;
          if (a === 'trace') traceSheet(it);
          else if (a === 'edit-kid') editKidSheet(it);
          else editChild(it, function (rec) { rec.status = 'approved'; return rec; }, 'Approve ' + it.req.ref);
          break;
      }
    });
    document.addEventListener('input', function (e) {
      if (e.target.id === 'rq-q') {
        ui.rqQ = e.target.value; ctx.saveUi(); ctx.renderPage();
        var q = document.getElementById('rq-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }
    });
    document.addEventListener('change', function (e) {
      var k = e.target.dataset && e.target.dataset.rqInput;
      if (k && ui.rqSel) setSys(ui.rqSel, (function () { var f = {}; f[k] = e.target.value; return f; })());
      var al = e.target.dataset && e.target.dataset.rqAlloc;
      if (al && e.target.value) allocate(al, e.target.value);
    });
    document.addEventListener('dragstart', function (e) {
      var d = e.target.closest && e.target.closest('[data-rq-drag]');
      if (!d) return;
      drag = d.dataset.rqDrag;
      e.dataTransfer.effectAllowed = 'link';
      try { e.dataTransfer.setData('text/plain', drag); } catch (err) { /* some browsers refuse */ }
      document.body.classList.add('rq-dragging');
    });
    document.addEventListener('dragend', function () { drag = null; document.body.classList.remove('rq-dragging'); document.querySelectorAll('.rq-part.on').forEach(function (x) { x.classList.remove('on'); }); });
    document.addEventListener('dragover', function (e) {
      var z = drag && e.target.closest && e.target.closest('[data-rq-drop]');
      document.querySelectorAll('.rq-part.on').forEach(function (x) { if (x !== z) x.classList.remove('on'); });
      if (!z) return;
      e.preventDefault(); z.classList.add('on');
    });
    document.addEventListener('drop', function (e) {
      var z = drag && e.target.closest && e.target.closest('[data-rq-drop]');
      if (!z) return;
      e.preventDefault();
      var id = drag; drag = null;
      allocate(id, z.dataset.rqDrop);
    });

    // Count for the tab label: what's waiting in Needs you that someone must act on. Untraced
    // requirements stay in the inbox but not in the count: some never need a System parent.
    function badge(p) {
      var b = R.rollup(p, idx()).inbox;
      return b.unallocated.length + b.approval.length + b.risk.length + b.gaps.length;
    }
    return { page: page, badge: badge };
  };
})(window.Signoff = window.Signoff || {});
