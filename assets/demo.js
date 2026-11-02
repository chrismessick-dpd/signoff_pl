/* Signoff PL demo: the product in config.demo, with its Parts linked to Signoff EE's and ME's
   demo projects. Their summaries come from assets/demo-designs.js, generated from those tools'
   own demos (tools/demo_designs.html), so the numbers and issues here are what a visitor finds
   when a link opens the design. Demo mode needs no GitHub. */
(function (S) {
  'use strict';
  var P = S.pl, M = S.model;
  var D = (S.config || {}).demo || {};
  var SNAP = window.SIGNOFF_PL_DEMO_DESIGNS || { designs: {} };

  // The snapshot's edit times, moved forward by its age, so "edited 1 d ago" stays true.
  function shifted(iso) {
    if (!iso || !SNAP.generatedAt) return iso;
    return new Date(new Date(iso).getTime() + (Date.now() - new Date(SNAP.generatedAt).getTime())).toISOString();
  }

  function build() {
    var user = 'Demo';
    var project = P.newProject(D.project || { name: 'Demo product' }, user);
    var ids = {}, index = { at: new Date().toISOString(), entries: {}, errors: [], files: {}, demo: true };
    Object.keys(SNAP.designs).forEach(function (key) {
      var d = SNAP.designs[key], at = key.indexOf(':');
      var summary = d.summary ? Object.assign({}, d.summary, { at: shifted(d.summary.at),
        recent: (d.summary.recent || []).map(function (c) { return Object.assign({}, c, { at: shifted(c.at) }); }) }) : null;
      index.entries[key] = { tool: key.slice(0, at), id: key.slice(at + 1), repo: '', path: '', sha: '', name: d.name, number: d.number || '',
        revision: d.revision || '', stage: d.stage || '', archived: !!d.archived, summary: summary };
      // The demo boards' pictures: Fabcheck's previews of the demo boards (pcb_dfm/demo).
      var pv = (D.previews || {})[key];
      var mm = (D.boardsMm || {})[key];
      if (pv) index.entries[key].preview = { repo: '', runId: '', at: '', hero: pv[0][0], board: mm ? P.cleanBoard(mm) : null, images: pv.map(function (x) {
        return { key: x[0], w: x[1], h: x[2], src: 'assets/demo-previews/' + key.slice(at + 1) + '-' + x[0] + '.webp' };
      }) };
    });
    (D.tree || []).forEach(function (r) {
      var link = r.link ? r.link.split(':') : null;
      var n = P.newNode(project, {
        parent: r.parent ? ids[r.parent] : '', kind: r.kind || 'part', name: r.name, number: r.number || '',
        source: r.source || '', ref: link ? { tool: link[0], id: link[1] } : null,
        qty: r.qty || 1, supplier: r.supplier || '', mpn: r.mpn || '', massG: r.massG == null ? null : r.massG,
        envelopeMm: r.envelopeMm || '', notes: r.notes || ''
      }, user);
      ids[r.key] = n.id;
      project.nodes[n.id] = n;
    });
    // Requirements: System ones in the project (and any firmware ones held in PL), and the
    // EE/ME/FW demo requirements given the parent links PL would have written into those reviews.
    var R = S.plReqs, reqIds = {};
    project.reqs = {};
    (R ? D.requirements || [] : []).forEach(function (r) {
      var parent = r.parent ? project.reqs[reqIds[r.parent]] : null;
      var q = R.newReq(project, {
        text: r.text, kind: r.kind || 'shall', category: r.category || '', source: r.source || '', method: r.method || 'inspection',
        status: r.status || 'draft', discipline: r.discipline || 'sys',
        parts: (r.parts || []).map(function (k) { return ids[k]; }).filter(Boolean)
      }, user);
      if (parent) { q.parent = R.parentLink(project, parent); q.part = ids[r.part] || ''; delete q.parts; }
      reqIds[r.key] = q.id;
      project.reqs[q.id] = q;
      (r.children || []).forEach(function (c) {
        var at = c.lastIndexOf(':'), e = index.entries[c.slice(0, at)];
        if (!e || !e.summary) return;
        e.summary = Object.assign({}, e.summary, { reqList: (e.summary.reqList || []).map(function (x) {
          return x.id === c.slice(at + 1) ? Object.assign({}, x, { parent: { tool: 'pl', project: project.id, id: q.id, ref: q.ref } }) : x;
        }) });
      });
    });
    project.meta.updatedAt = M.now();
    return { project: project, index: index };
  }

  S.plDemo = { build: build, snapshot: SNAP };
})(window.Signoff = window.Signoff || {});
