/* Signoff PL demo: the product in config.demo, with its Parts linked to Signoff EE's and ME's
   demo projects. Their summaries come from assets/demo-designs.js, generated from those tools'
   own demos (tools/demo_designs.html), so the numbers and issues here are what a visitor finds
   when a link opens the design. Demo mode needs no GitHub. */
(function (S) {
  'use strict';
  var P = S.pl, M = S.model;
  var D = (S.config || {}).demo || {};
  var SNAP = window.SIGNOFF_PL_DEMO_DESIGNS || { designs: {} };
  // The demo ME reviews' Partcheck previews: what Partcheck's Send to Signoff ME stores for its demo
  // packages (assets/demo-partcheck.js and assets/demo-partcheck/<review>/, made by
  // partcheck/tools/pl_demo.html), served by blob sha like a repo's files (app.js fileBlob).
  var PCK = window.SIGNOFF_PL_DEMO_PARTCHECK || {};
  var demoFiles = {};
  Object.keys(PCK).forEach(function (id) {
    Object.keys(PCK[id].shas || {}).forEach(function (f) { demoFiles[PCK[id].shas[f]] = 'assets/demo-partcheck/' + id + '/' + f; });
  });
  // A demo review's preview, read the way reader.js reads partcheck/<id>/preview/index.json in a repo.
  function partcheckPreview(id) {
    var d = PCK[id], R = S.plReader;
    if (!d || !R || !R.cleanPreview) return null;
    var dir = 'partcheck/' + id + '/preview/', shas = {};
    Object.keys(d.shas || {}).forEach(function (f) { shas[dir + f] = d.shas[f]; });
    // Sent two days before the visit.
    return R.cleanPreview(Object.assign({}, d.index, { at: new Date(Date.now() - 2 * 864e5).toISOString() }), dir, shas, '');
  }

  // The snapshot's edit times, moved forward by its age, so "edited 1 d ago" stays true.
  function shifted(iso) {
    if (!iso || !SNAP.generatedAt) return iso;
    return new Date(new Date(iso).getTime() + (Date.now() - new Date(SNAP.generatedAt).getTime())).toISOString();
  }

  function build() {
    var user = 'Demo';
    var project = P.newProject(D.project || { name: 'Demo product' }, user);
    // Fixed ids, so the EE, ME, and FW demos' requirements can name their PL parents (`parent` in
    // their config.js): the project is pldemo and each System requirement qdemo-<key>.
    project.id = 'pldemo';
    var ids = {}, index = { at: new Date().toISOString(), entries: {}, errors: [], files: {}, demo: true };
    Object.keys(SNAP.designs).forEach(function (key) {
      var d = SNAP.designs[key], at = key.indexOf(':');
      var summary = d.summary ? Object.assign({}, d.summary, { at: shifted(d.summary.at),
        recent: (d.summary.recent || []).map(function (c) { return Object.assign({}, c, { at: shifted(c.at) }); }) },
        d.summary.revisions ? { revisions: d.summary.revisions.map(function (r) { return r.sentAt ? Object.assign({}, r, { sentAt: shifted(r.sentAt + 'T12:00:00.000Z').slice(0, 10) }) : r; }) } : {},
        d.summary.releases ? { releases: d.summary.releases.map(function (r) { return r.releasedAt ? Object.assign({}, r, { releasedAt: shifted(r.releasedAt + 'T12:00:00.000Z').slice(0, 10) }) : r; }) } : {}) : null;
      index.entries[key] = { tool: key.slice(0, at), id: key.slice(at + 1), repo: '', path: '', sha: '', name: d.name, number: d.number || '',
        revision: d.revision || '', stage: d.stage || '', archived: !!d.archived, summary: summary };
      // The demo boards' pictures: Fabcheck's previews of the demo boards (pcb_dfm/demo). The demo ME
      // reviews' pictures and models: Partcheck's Send of its demo packages (partcheckPreview).
      var pv = (D.previews || {})[key];
      var mm = (D.boardsMm || {})[key];
      var pck = key.slice(0, at) === 'me' ? partcheckPreview(key.slice(at + 1)) : null;
      if (pck) index.entries[key].preview = pck;
      else if (pv) index.entries[key].preview = { repo: '', runId: '', at: '', hero: pv[0][0], board: mm ? P.cleanBoard(mm) : null, images: pv.map(function (x) {
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
      // Where each Part sits assembled (place, mm; +z faces the room): front cover, display board,
      // main PCBA, back cover, wall bracket. Exploded spreads them apart in that order.
      if (r.place) n.place = P.cleanPlace(r.place);
      ids[r.key] = n.id;
      project.nodes[n.id] = n;
    });
    // The demo ME Parts have no attached models: their pictures and 3D come from the Enclosure's and
    // Wall Bracket's Partcheck previews, each Part by its part number. The enclosure's review is two
    // Parts, its front and back covers, so Exploded can put the boards between them.
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
      delete project.reqs[q.id];
      q.id = 'qdemo-' + r.key;
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

  // A demo file by blob sha (the ME reviews' Partcheck models and pictures), or null.
  function file(sha) { return demoFiles[sha] || null; }
  S.plDemo = { build: build, snapshot: SNAP, file: file };
})(window.Signoff = window.Signoff || {});
