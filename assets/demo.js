/* Signoff PL demo: a made-up product (config.demo) and a made-up index of the design reviews
   its Parts link to, so demo mode needs no GitHub. Links open the other tools' demos. */
(function (S) {
  'use strict';
  var P = S.pl, M = S.model;
  var D = (S.config || {}).demo || {};

  function build() {
    var user = 'Demo';
    var project = P.newProject(D.project || { name: 'Demo product' }, user);
    var ids = {}, index = { at: new Date().toISOString(), entries: {}, errors: [], files: {}, demo: true };
    Object.keys(D.designs || {}).forEach(function (k) {
      var d = D.designs[k], id = 'demo-' + k;
      var summary = d.noSummary ? null : Object.assign({ v: 1 }, d);
      if (summary) delete summary.noSummary;
      index.entries[d.tool + ':' + id] = { tool: d.tool, id: id, repo: '', path: '', sha: '', name: d.name, number: d.number || '',
        revision: d.revision || '', stage: d.stage || '', archived: false, summary: summary };
    });
    (D.tree || []).forEach(function (r) {
      var n = P.newNode(project, {
        parent: r.parent ? ids[r.parent] : '', kind: r.kind || 'part', name: r.name, number: r.number || '',
        source: r.source || '', ref: r.link ? { tool: D.designs[r.link].tool, id: 'demo-' + r.link } : null,
        qty: r.qty || 1, supplier: r.supplier || '', mpn: r.mpn || '', massG: r.massG == null ? null : r.massG,
        envelopeMm: r.envelopeMm || '', notes: r.notes || ''
      }, user);
      ids[r.key] = n.id;
      project.nodes[n.id] = n;
    });
    project.meta.updatedAt = M.now();
    return { project: project, index: index };
  }

  S.plDemo = { build: build };
})(window.Signoff = window.Signoff || {});
