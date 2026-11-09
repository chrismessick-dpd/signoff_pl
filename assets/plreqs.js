/* Signoff PL requirements: the model behind the Requirements tab (docs/requirements-tab.md).
   Pure functions only, so tests/test.html can run them.

   Every requirement has one home:
   - System requirements live in the PL project, project.reqs, with the engine's record shape
     (model.js, "Requirements") plus `parts`: the PL node ids it's allocated to.
   - A requirement on a board or part lives in that design's review (Signoff EE or ME). PL reads
     it from the review's summary.reqList and writes it back with GitHubStore.patchRecords.
   - Firmware requirements wait in the PL project until Signoff FW exists: a record with a
     `parent` and `part` (the firmware Part's node id).
   A requirement flows down from a System one through its `parent`, { tool: 'pl', project, id,
   ref, text }, keyed by record id. PL counts a child only when that parent is a live System
   requirement of this project; anything else claiming a parent shows as untraced.

   States, worst first: fail (verification failed), risk (an open issue on a check it traces
   to), gap (allocated to a Part that has no requirement for it yet), open, pass. */
(function (S) {
  'use strict';
  var M = S.model, P = S.pl;
  var DISCIPLINES = M.REQ_DISCIPLINES || ['sys', 'ee', 'me', 'fw', 'other'];
  var ORDER = ['fail', 'risk', 'gap', 'open', 'pass'];
  function worst(states) {
    var best = -1;
    states.forEach(function (s) { var i = ORDER.indexOf(s); if (i >= 0 && (best < 0 || i < best)) best = i; });
    return best < 0 ? '' : ORDER[best];
  }

  // ── PL-homed records ─────────────────────────────────────
  function newReq(project, fields, user) {
    project.reqs = project.reqs || {};
    return M.newReq(project, Object.assign({ discipline: 'sys', parts: [] }, fields || {}), user);
  }
  function planReqs(project) { return M.liveReqs({ reqs: project.reqs || {} }); }
  // The System requirements: PL records that don't flow down from another.
  function systemReqs(project) { return planReqs(project).filter(function (q) { return !q.parent; }); }

  // A PL-homed record in the shape of a summary.reqList entry. It has no checks, so no risk.
  function asListItem(q) {
    var p = M.reqParent(q);
    var out = { id: q.id, ref: q.ref || '', text: q.text || '', discipline: M.oneOf(DISCIPLINES, q.discipline, 'sys'), kind: q.kind || 'shall',
      category: q.category || '', method: q.method || 'inspection', status: q.status || 'draft', verify: q.verify || 'open',
      state: q.status === 'deprecated' ? 'deprecated' : q.verify === 'fail' ? 'fail' : q.verify === 'pass' ? 'pass' : 'open',
      links: 0, issues: [], at: q.updatedAt || '', by: q.updatedBy || '' };
    if (p) out.parent = { tool: 'pl', project: p.project, id: p.id, ref: p.ref };
    return out;
  }

  // The flow-down link a child carries, with a snapshot of the parent for people without PL.
  function parentLink(project, sys) {
    return { tool: 'pl', project: project.id, id: sys.id, ref: sys.ref || '', text: sys.text || '' };
  }

  // ── Everything the tab shows ─────────────────────────────
  // items: every requirement PL knows below System level, one per (home, id):
  //   { key, home: { tool, project }, nodes: [node ids of the Parts that use the design],
  //     design: index entry | null, req: reqList entry }
  function items(project, index) {
    var t = P.tree(project), out = [], byDesign = {};
    P.flatten(t).forEach(function (id) {
      var n = t.nodes[id], k = P.refKey(n.ref);
      if ((n.kind !== 'part' && !P.isLinkedAssembly(n)) || !k) return;   // a Part's design, or an assembly's own
      (byDesign[k] = byDesign[k] || []).push(id);
    });
    Object.keys(byDesign).forEach(function (k) {
      var e = index && index.entries && index.entries[k], list = e && e.summary && e.summary.reqList;
      (list || []).forEach(function (r) {
        out.push({ key: k + ':' + r.id, home: { tool: e.tool, project: e.id }, nodes: byDesign[k], design: e, req: r });
      });
    });
    planReqs(project).filter(function (q) { return q.parent; }).forEach(function (q) {
      out.push({ key: 'pl:' + project.id + ':' + q.id, home: { tool: 'pl', project: project.id }, nodes: q.part && t.nodes[q.part] ? [q.part] : [], design: null, req: asListItem(q) });
    });
    return out;
  }

  // The roll-up: { sys: [{ rec, state, kids, cells: { node id: state }, unallocatedKids }],
  //   untraced: [item], sections: (see sections()), parts: [node ids in tree order that have a requirement or an allocation],
  //   counts: { state: n }, inbox: { unallocated, approval, untraced, risk, gaps } }
  function rollup(project, index) {
    var t = P.tree(project), all = items(project, index), sys = systemReqs(project), byId = {};
    sys.forEach(function (q) { byId[q.id] = { rec: q, kids: [], cells: {}, state: '', unallocatedKids: [] }; });
    var untraced = [];
    all.forEach(function (it) {
      var p = it.req.parent, s = p && p.project === project.id && byId[p.id];
      if (s) { s.kids.push(it); it.sys = s.rec; }
      else if (it.req.status !== 'deprecated') untraced.push(it);
    });
    var used = {};
    sys.forEach(function (q) {
      var s = byId[q.id], parts = (q.parts || []).filter(function (id) { return t.nodes[id]; });
      parts.forEach(function (nid) {
        used[nid] = 1;
        var kids = s.kids.filter(function (it) { return it.nodes.indexOf(nid) >= 0 && it.req.state !== 'deprecated'; });
        s.cells[nid] = kids.length ? worst(kids.map(function (it) { return it.req.state; })) : 'gap';
      });
      s.kids.forEach(function (it) {
        it.nodes.forEach(function (nid) { used[nid] = 1; });
        if (!it.nodes.some(function (nid) { return parts.indexOf(nid) >= 0; })) s.unallocatedKids.push(it);
      });
      if (q.status === 'deprecated') { s.state = 'deprecated'; return; }
      if (q.verify === 'fail') { s.state = 'fail'; return; }
      var states = Object.keys(s.cells).map(function (k) { return s.cells[k]; })
        .concat(s.kids.filter(function (it) { return it.req.state !== 'deprecated'; }).map(function (it) { return it.req.state; }));
      s.state = states.length ? worst(states) : q.verify === 'pass' ? 'pass' : 'open';
    });
    untraced.forEach(function (it) { it.nodes.forEach(function (nid) { used[nid] = 1; }); });
    var counts = { fail: 0, risk: 0, gap: 0, open: 0, pass: 0, deprecated: 0 };
    var list = sys.map(function (q) { return byId[q.id]; });
    list.forEach(function (s) { counts[s.state]++; });
    var kids = [];
    list.forEach(function (s) { kids = kids.concat(s.kids); });
    return {
      sys: list, untraced: untraced, counts: counts, sections: sections(all),
      parts: P.flatten(t).filter(function (id) { return used[id]; }),
      inbox: {
        unallocated: list.filter(function (s) { return s.state !== 'deprecated' && !(s.rec.parts || []).length && !s.kids.length; }),
        approval: kids.filter(function (it) { return it.req.status === 'changed'; }),
        untraced: untraced,
        risk: kids.filter(function (it) { return it.req.state === 'risk' || it.req.state === 'fail'; }),
        gaps: list.filter(function (s) { return s.state === 'gap'; })
      }
    };
  }

  // The requirements each linked review brings, whether or not they trace up to a System one:
  // [{ tool, designs: [{ key, design, nodes, items, counts, state }], counts }], tools in config
  // order, designs in tree order, items by ref. Grouped by the review's tool, never by the record's
  // discipline (a record from before disciplines reads as 'other'). A design used by several Parts
  // is listed once. counts: { fail, risk, open, pass, deprecated, live }; state is the worst live one.
  function tally(list) {
    var c = { fail: 0, risk: 0, open: 0, pass: 0, deprecated: 0, live: 0 };
    list.forEach(function (it) { var st = it.req.state; c[st] = (c[st] || 0) + 1; if (st !== 'deprecated') c.live++; });
    return c;
  }
  function byRef(a, b) {
    var x = a.req.ref || '', y = b.req.ref || '', n = x.localeCompare(y, undefined, { numeric: true });
    return n || (a.req.text || '').localeCompare(b.req.text || '');
  }
  function sections(all) {
    var designs = {}, order = [];
    all.forEach(function (it) {
      if (it.home.tool === 'pl' || !it.design) return;
      var k = it.home.tool + ':' + it.home.project;
      if (!designs[k]) { designs[k] = { key: k, tool: it.home.tool, design: it.design, nodes: it.nodes, items: [] }; order.push(k); }
      designs[k].items.push(it);
    });
    var tools = (S.config && S.config.tools || []).map(function (t) { return t.id; });
    order.forEach(function (k) { if (tools.indexOf(designs[k].tool) < 0) tools.push(designs[k].tool); });
    return tools.map(function (tool) {
      var ds = order.filter(function (k) { return designs[k].tool === tool; }).map(function (k) {
        var d = designs[k];
        d.items.sort(byRef);
        d.counts = tally(d.items);
        d.state = worst(d.items.filter(function (it) { return it.req.state !== 'deprecated'; }).map(function (it) { return it.req.state; }));
        return d;
      });
      var every = [];
      ds.forEach(function (d) { every = every.concat(d.items); });
      return { tool: tool, designs: ds, counts: tally(every) };
    }).filter(function (sec) { return sec.designs.length; });
  }

  // A System requirement that probably covers an untraced one: shared category, then shared words.
  var STOP = ['shall', 'should', 'from', 'with', 'than', 'that', 'this', 'when', 'each', 'more', 'least', 'must', 'will', 'without', 'product'];
  function words(s) { return (String(s || '').toLowerCase().match(/[a-z0-9±°]{4,}/g) || []).filter(function (w) { return STOP.indexOf(w) < 0; }); }
  function suggest(item, sysList) {
    var w = words(item.req.text), best = null, bestScore = 0;
    sysList.forEach(function (s) {
      if (s.state === 'deprecated') return;
      var sw = words(s.rec.text), shared = w.filter(function (x) { return sw.indexOf(x) >= 0; }).length;
      var score = shared / Math.max(1, Math.min(w.length, sw.length)) + (item.req.category && item.req.category.toLowerCase() === String(s.rec.category || '').toLowerCase() ? 0.3 : 0);
      if (score > bestScore) { best = s; bestScore = score; }
    });
    return bestScore >= 0.45 ? best : null;
  }

  // ── Writes not yet in a summary ──────────────────────────
  // PL writes records into a review file but can't rebuild its summary (no checklists). Until the
  // review's own tool syncs, PL lays what it wrote over the summary's reqList. An entry is dropped
  // once the summary is as new as the write. overlay: { 'tool:id': { req id: reqList item } }
  function withOverlay(index, overlay) {
    if (!index || !overlay) return index;
    var out = Object.assign({}, index, { entries: Object.assign({}, index.entries) });
    Object.keys(overlay).forEach(function (k) {
      var e = out.entries[k], o = overlay[k];
      if (!e || !e.summary) return;
      var list = (e.summary.reqList || []).slice(), at = e.summary.at || '';
      Object.keys(o).forEach(function (id) {
        if (at >= (o[id].at || '')) return;
        var i = list.map(function (r) { return r.id; }).indexOf(id);
        var prev = i >= 0 ? list[i] : null;
        var next = Object.assign({}, prev || { links: 0, issues: [], state: 'open' }, o[id]);
        if (prev && next.state !== 'deprecated') next.state = next.verify === 'fail' ? 'fail' : prev.state === 'risk' ? 'risk' : next.verify === 'pass' ? 'pass' : 'open';
        if (i >= 0) list[i] = next; else list.push(next);
      });
      out.entries[k] = Object.assign({}, e, { summary: Object.assign({}, e.summary, { reqList: list }) });
    });
    return out;
  }
  // Overlay entries the summaries have caught up with, removed.
  function pruneOverlay(index, overlay) {
    var out = {};
    Object.keys(overlay || {}).forEach(function (k) {
      var e = index && index.entries && index.entries[k], at = (e && e.summary && e.summary.at) || '';
      Object.keys(overlay[k]).forEach(function (id) {
        if (!e || at < (overlay[k][id].at || '')) (out[k] = out[k] || {})[id] = overlay[k][id];
      });
    });
    return out;
  }

  // ── CSV: the compliance matrix, and the full list ────────
  var LABEL = { fail: 'Failing', risk: 'At risk', gap: 'Gap', open: 'Open', pass: 'Met', deprecated: 'Deprecated' };
  // A cell a spreadsheet won't run as a formula (review text comes from contractors).
  function csvCell(v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\r\n']/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function csv(project, index) {
    var r = rollup(project, index), t = P.tree(project);
    var head = ['ID', 'Requirement', 'Type', 'Category', 'Source', 'Verification method', 'Status', 'Roll-up'].concat(r.parts.map(function (id) { return t.nodes[id].name; }));
    var rows = [head];
    r.sys.forEach(function (s) {
      var q = s.rec;
      rows.push([q.ref, q.text, q.kind, q.category, q.source, q.method, q.status, LABEL[s.state]].concat(r.parts.map(function (nid) {
        var kids = s.kids.filter(function (it) { return it.nodes.indexOf(nid) >= 0; });
        if (!kids.length) return s.cells[nid] === 'gap' ? 'Gap' : '';
        return kids.map(function (it) { return it.req.ref + ' ' + LABEL[it.req.state]; }).join('; ');
      })));
    });
    return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  // Every requirement, one row each: System first, then each review's in section order.
  function listCsv(project, index) {
    var r = rollup(project, index), t = P.tree(project), WORDS = { sys: 'System', ee: 'EE', me: 'ME', fw: 'FW', other: 'Other' };
    var rows = [['Home', 'ID', 'Requirement', 'Type', 'Category', 'Verification method', 'Status', 'State', 'Traces to']];
    r.sys.forEach(function (s) { var q = s.rec; rows.push(['System', q.ref, q.text, q.kind, q.category, q.method, q.status, LABEL[s.state], '']); });
    planReqs(project).filter(function (q) { return q.parent; }).forEach(function (q) {
      var n = q.part && t.nodes[q.part], sys = r.sys.filter(function (s) { return s.rec.id === q.parent.id; })[0];
      rows.push([(n ? n.name : 'Project plan') + ' (held in PL)', q.ref, q.text, q.kind, q.category, q.method, q.status, LABEL[asListItem(q).state], sys ? sys.rec.ref : '']);
    });
    r.sections.forEach(function (sec) {
      sec.designs.forEach(function (d) {
        var home = WORDS[sec.tool] ? WORDS[sec.tool] + ' · ' : '';
        d.items.forEach(function (it) {
          var q = it.req;
          rows.push([home + (d.design.name || d.design.id), q.ref, q.text, q.kind, q.category, q.method, q.status, LABEL[q.state], it.sys ? it.sys.ref : '']);
        });
      });
    });
    return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  S.plReqs = {
    DISCIPLINES: DISCIPLINES, LABEL: LABEL, worst: worst,
    newReq: newReq, planReqs: planReqs, systemReqs: systemReqs, asListItem: asListItem, parentLink: parentLink,
    items: items, rollup: rollup, sections: sections, suggest: suggest, withOverlay: withOverlay, pruneOverlay: pruneOverlay, csv: csv, listCsv: listCsv
  };
})(window.Signoff = window.Signoff || {});
