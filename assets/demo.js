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
      var summary = d.summary ? Object.assign({}, d.summary, { at: shifted(d.summary.at) }) : null;
      index.entries[key] = { tool: key.slice(0, at), id: key.slice(at + 1), repo: '', path: '', sha: '', name: d.name, number: d.number || '',
        revision: d.revision || '', stage: d.stage || '', archived: !!d.archived, summary: summary };
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
    project.meta.updatedAt = M.now();
    return { project: project, index: index };
  }

  S.plDemo = { build: build, snapshot: SNAP };
})(window.Signoff = window.Signoff || {});
