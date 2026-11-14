/* Signoff PL data model: project documents, the product tree, and the roll-up of the linked
   design reviews. Pure functions only (no DOM, no storage) so tests/test.html can run them.

   A PL project document:
     { schema, id: 'pl…', slug, createdAt, createdBy,
       meta:  { name, client, number, description, phase, archived, updatedAt, updatedBy },
       nodes: { id: { id, parent: '' | node id, order, kind: 'assembly' | 'part', name, number,
                      source: 'ee' | 'me' | … | 'fw' | 'purchased', ref: { tool, id } | null,
                      (an assembly may link a review too: source 'me' and the ref of a Signoff ME
                      review of an assembly, summary.kind 'assembly'; see linkStatus)
                      qty, supplier, mpn, massG, envelopeMm, notes,
                      createdAt, updatedAt, updatedBy, deleted } },
       reqs:  { id: requirement record, see plreqs.js } }
   Nodes merge record by record like every Signoff document: the newer record wins and
   deletions are tombstones. Two people moving nodes at once can still leave a cycle, and
   deleting an assembly orphans its children; tree() puts both at the top, flagged.

   The index (reader.js) maps 'tool:id' to the design's summary, written by Signoff EE/ME. */
(function (S) {
  'use strict';
  var M = S.model;
  var C = S.config;
  var IDS = C.ids || {};
  var SEVERITIES = ['critical', 'major', 'minor'];

  // Sources a Part can have: each linkable tool, then firmware (until Signoff FW exists and is
  // added to config.tools) and purchased parts.
  function sources() {
    var out = (C.tools || []).map(function (t) { return { id: t.id, label: t.short, name: t.name, tool: t }; });
    if (!out.some(function (s) { return s.id === 'fw'; })) out.push({ id: 'fw', label: 'FW', name: 'Firmware', tool: null });
    out.push({ id: 'purchased', label: 'Purchased', name: 'Purchased part', tool: null });
    return out;
  }
  function toolById(id) { return (C.tools || []).filter(function (t) { return t.id === id; })[0] || null; }
  // A Part linked to a tool whose designs aren't reviews (Loom's harnesses: config `review: false`).
  function isDrawing(source) { var t = toolById(source); return !!t && t.review === false; }

  // ── Documents ────────────────────────────────────────────

  function newProject(fields, user) {
    var t = M.now();
    return {
      schema: 1,
      id: M.uid(IDS.project || 'pl'),
      slug: M.slugify(fields.name),
      createdAt: t,
      createdBy: user || '',
      meta: {
        name: fields.name || 'Untitled project',
        client: fields.client || '',
        clientProject: fields.clientProject || '',
        number: fields.number || '',
        description: fields.description || '',
        phase: fields.phase || (C.phases || [])[0] || '',
        archived: false,
        updatedAt: t,
        updatedBy: user || ''
      },
      nodes: {}
    };
  }

  function newNode(project, fields, user) {
    var t = M.now();
    var parent = fields.parent || '';
    var n = Object.assign({
      id: M.uid(IDS.node || 'n'), parent: parent, order: nextOrder(project, parent), kind: 'part', name: '', number: '',
      source: '', ref: null, qty: 1, supplier: '', mpn: '', massG: null, envelopeMm: '', notes: '', createdAt: t
    }, fields);
    return M.stamp(n, user);
  }

  function nextOrder(project, parent) {
    var max = 0;
    liveNodes(project).forEach(function (n) { if ((n.parent || '') === parent) max = Math.max(max, n.order || 0); });
    return max + 1;
  }

  // Requirements (plreqs.js) merge record by record like nodes. Top-level keys this copy doesn't
  // know are carried along (the remote's wins), so an older copy never drops a newer one's data.
  function merge(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return Object.assign({}, local, remote, {
      schema: Math.max(local.schema || 1, remote.schema || 1),
      id: remote.id || local.id,
      slug: remote.slug || local.slug,
      createdAt: remote.createdAt < local.createdAt ? remote.createdAt : local.createdAt,
      createdBy: remote.createdBy || local.createdBy,
      meta: M.newer(local.meta, remote.meta),
      nodes: M.mergeMaps(local.nodes, remote.nodes),
      reqs: M.mergeMaps(local.reqs || {}, remote.reqs || {})
    });
  }

  function liveNodes(project) {
    var n = project.nodes || {};
    return Object.keys(n).map(function (k) { return n[k]; }).filter(function (x) { return !x.deleted; });
  }

  // ── Tree ─────────────────────────────────────────────────
  // { roots: [ids], children: { id: [ids] }, parent: { id: effective parent }, depth: { id },
  //   flags: { id: 'orphan' | 'cycle' } }. Children are ordered by `order`, then name.
  function tree(project) {
    var live = {}, parent = {}, flags = {};
    liveNodes(project).forEach(function (n) { live[n.id] = n; });
    Object.keys(live).forEach(function (id) {
      var p = live[id].parent || '';
      if (p && !live[p]) { flags[id] = 'orphan'; p = ''; }
      parent[id] = p;
    });
    // Break each cycle at its lowest id, which then sits at the top.
    Object.keys(live).sort().forEach(function (id) {
      var seen = {}, at = id;
      while (at && !seen[at]) { seen[at] = 1; at = parent[at]; }
      if (!at) return;
      var loop = [], x = at;
      do { loop.push(x); x = parent[x]; } while (x !== at);
      var cut = loop.sort()[0];
      parent[cut] = ''; flags[cut] = 'cycle';
    });
    var children = {}, roots = [];
    function byOrder(a, b) { return (live[a].order || 0) - (live[b].order || 0) || (live[a].name || '').localeCompare(live[b].name || '') || a.localeCompare(b); }
    Object.keys(live).forEach(function (id) {
      if (parent[id]) (children[parent[id]] = children[parent[id]] || []).push(id);
      else roots.push(id);
    });
    roots.sort(byOrder);
    Object.keys(children).forEach(function (k) { children[k].sort(byOrder); });
    var depth = {};
    (function walk(ids, d) { ids.forEach(function (id) { depth[id] = d; walk(children[id] || [], d + 1); }); })(roots, 0);
    return { roots: roots, children: children, parent: parent, depth: depth, flags: flags, nodes: live };
  }

  // Depth-first order, for the structure table.
  function flatten(t) {
    var out = [];
    (function walk(ids) { ids.forEach(function (id) { out.push(id); walk(t.children[id] || []); }); })(t.roots);
    return out;
  }

  function descendants(t, id) {
    var out = {};
    (function walk(ids) { ids.forEach(function (c) { out[c] = 1; walk(t.children[c] || []); }); })(t.children[id] || []);
    return out;
  }

  // The product's top: its one top-level assembly, or '' when there are several top-level nodes.
  function topAssembly(t) {
    return t.roots.length === 1 && t.nodes[t.roots[0]].kind === 'assembly' ? t.roots[0] : '';
  }
  // A product of one Part, alone or inside its one top assembly: that Part's id, else ''. The map
  // shows such a product as a single button that is both the top and the Part.
  function soloPart(t) {
    var ids = Object.keys(t.nodes), parts = ids.filter(function (id) { return t.nodes[id].kind === 'part'; });
    if (parts.length !== 1) return '';
    var top = topAssembly(t);
    return ids.length === 1 || (ids.length === 2 && top && t.parent[parts[0]] === top) ? parts[0] : '';
  }

  // Where a node may move: anywhere but itself or below itself.
  function canMove(t, id, newParent) {
    if (!newParent) return true;
    if (newParent === id || !t.nodes[newParent]) return false;
    return !descendants(t, id)[newParent];
  }

  function path(t, id) {
    var out = [], seen = {};
    for (var at = t.parent[id]; at && !seen[at]; at = t.parent[at]) { seen[at] = 1; out.unshift(t.nodes[at]); }
    return out;
  }

  // ── Linked designs ───────────────────────────────────────

  function refKey(ref) { return ref && ref.tool && ref.id ? ref.tool + ':' + ref.id : ''; }

  /* How a Part stands against the index:
       ok          linked, and the design's summary was read
       nosummary   linked; the project file has no summary yet (open it in its tool once)
       notfound    linked, but no repository this token reaches holds that project
       error       linked, but its tool's repositories couldn't be read
       planned     a Part to be made in a Signoff tool (EE, ME, FW, Loom) that isn't started yet: it
                   waits in that tool's From Signoff PL tray, and links itself once started there
                   (claimPlanned)
       unlinked    a Part with no source
       purchased   bought in; no review
       manual      a source with no Signoff tool yet (firmware)
     Assemblies return null (linkStatus covers an assembly's own review). */
  function partStatus(node, index) {
    if (!node || node.kind !== 'part') return null;
    if (node.source === 'purchased') return { state: 'purchased' };
    if (!toolById(node.source)) return { state: node.source ? 'manual' : 'unlinked' };
    if (!refKey(node.ref)) return { state: 'planned' };
    return refStatus(node, index);
  }
  function refStatus(node, index) {
    var key = refKey(node.ref);
    var e = index && index.entries && index.entries[key];
    if (e) return { state: e.summary ? 'ok' : 'nosummary', entry: e, summary: e.summary || null };
    if (index && (index.errors || []).some(function (x) { return x.tool === node.source; })) return { state: 'error' };
    return { state: 'notfound' };
  }
  /* An assembly can link a review of the whole assembly (Chris, 2026-11-08: a mechanical part may be
     an assembly, so its Signoff ME review says so, summary.kind 'assembly', and PL shows it on that
     assembly's branch). linkStatus is partStatus for a Part, the same states as a linked Part for a
     linked assembly, and null for an assembly that links nothing. Everything that walks the tree to
     reach designs (roll-up, issues, discussion, requirements, sharing) uses it. */
  function isLinkedAssembly(node) { return !!node && node.kind === 'assembly' && !!refKey(node.ref) && !!toolById(node.source); }
  function linkStatus(node, index) {
    if (node && node.kind === 'assembly') return isLinkedAssembly(node) ? refStatus(node, index) : null;
    return partStatus(node, index);
  }

  function emptyRoll() {
    var r = { total: 0, reviewed: 0, pct: 0, open: {}, openTotal: 0, fixed: 0, waived: 0,
      parts: 0, designs: 0, summarized: 0, attention: 0, purchased: 0, manual: 0, unlinked: 0, planned: 0,
      massG: 0, massParts: 0, massMissing: 0, stages: {}, harnesses: 0 };
    SEVERITIES.forEach(function (s) { r.open[s] = 0; });
    return r;
  }

  /* Roll-up for every node: { id: roll }, plus '' for the whole project.
     - Progress is reviewed / total checks over the linked designs that have a summary.
       Purchased and firmware Parts aren't in it.
     - A design used twice (two of the same board) counts once in each total.
     - Mass is per Part times quantity, and only over Parts that have one; massMissing counts
       the rest, except firmware Parts, which have none. Assemblies have no mass of their own.
     - An assembly's own review (linkStatus) counts in its roll and every roll above it like a
       Part's design, but not as a Part, and adds no mass.
     - Stages are listed per tool, not mapped onto each other. */
  function rollup(project, index) {
    var t = tree(project), out = {};
    function add(roll, node, seen) {
      var st = partStatus(node, index);
      roll.parts++;
      var qty = node.qty > 0 ? node.qty : 1;
      if (node.massG != null && node.massG !== '' && !isNaN(node.massG)) { roll.massG += Number(node.massG) * qty; roll.massParts++; }
      else if (node.source !== 'fw') roll.massMissing++;   // firmware has no mass
      if (st.state === 'purchased') { roll.purchased++; return; }
      if (st.state === 'manual') { roll.manual++; return; }
      if (st.state === 'unlinked') { roll.unlinked++; return; }
      if (st.state === 'planned') { roll.planned++; return; }
      design(roll, node, seen, st);
    }
    function design(roll, node, seen, st) {
      if (st.state !== 'ok') { roll.attention++; return; }
      // A harness has no checks: it's counted, but stays out of progress, issues, and stages.
      if (isDrawing(node.source)) { roll.harnesses++; return; }
      var key = refKey(node.ref);
      if (seen[key]) return;
      seen[key] = 1;
      var s = st.summary;
      roll.designs++; roll.summarized++;
      roll.total += s.total || 0; roll.reviewed += s.reviewed || 0;
      var iss = s.issues || {};
      SEVERITIES.forEach(function (sev) { roll.open[sev] += (iss.open || {})[sev] || 0; });
      roll.fixed += iss.fixed || 0; roll.waived += iss.waived || 0;
      var stageKey = node.source + ':' + (s.stage || '—');
      roll.stages[stageKey] = (roll.stages[stageKey] || 0) + 1;
    }
    function finish(roll) {
      roll.openTotal = SEVERITIES.reduce(function (a, s) { return a + roll.open[s]; }, 0);
      // Linked designs with nothing to review (no checks) are done: 100%.
      roll.pct = roll.total ? Math.round(100 * roll.reviewed / roll.total) : roll.designs ? 100 : 0;
      roll.massG = Math.round(roll.massG * 10) / 10;
      return roll;
    }
    function walk(id) {
      var roll = emptyRoll(), seen = {};
      (function gather(nid) {
        var n = t.nodes[nid];
        if (n.kind === 'part') add(roll, n, seen);
        else if (isLinkedAssembly(n)) design(roll, n, seen, refStatus(n, index));
        (t.children[nid] || []).forEach(gather);
      })(id);
      out[id] = finish(roll);
      (t.children[id] || []).forEach(walk);
    }
    t.roots.forEach(walk);
    var all = emptyRoll(), seenAll = {};
    flatten(t).forEach(function (id) {
      var n = t.nodes[id];
      if (n.kind === 'part') add(all, n, seenAll);
      else if (isLinkedAssembly(n)) design(all, n, seenAll, refStatus(n, index));
    });
    out[''] = finish(all);
    return out;
  }

  // Every open issue across the product's linked designs, worst first. A design used by
  // several Parts is listed once, under the first of them in the tree.
  function issues(project, index) {
    var t = tree(project), out = [], seen = {};
    flatten(t).forEach(function (id) {
      var n = t.nodes[id], st = linkStatus(n, index);
      if (!st || st.state !== 'ok') return;
      var key = refKey(n.ref);
      if (seen[key]) return;
      seen[key] = 1;
      (st.summary.open || []).forEach(function (i) {
        out.push(Object.assign({}, i, { node: n, tool: n.source, projectId: n.ref.id, design: st.entry.name || st.summary.name }));
      });
    });
    return out.sort(function (a, b) { return SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity); });
  }

  // Parts whose linked design reports open issues but whose summary has no list (written by
  // an older engine): their counts are in the totals, but issues() can't show them.
  function unlistedIssues(project, index) {
    var t = tree(project), n = 0, seen = {};
    flatten(t).forEach(function (id) {
      var st = linkStatus(t.nodes[id], index);
      if (!st || st.state !== 'ok' || st.summary.open) return;
      var key = refKey(t.nodes[id].ref);
      if (seen[key]) return;
      seen[key] = 1;
      var o = (st.summary.issues || {}).open || {};
      n += SEVERITIES.reduce(function (a, s) { return a + (o[s] || 0); }, 0);
    });
    return n;
  }

  // A design that's a review of an assembly (summary.kind, Signoff ME's details window).
  function isAssemblyDesign(entry) { return !!(entry && entry.summary && entry.summary.kind === 'assembly'); }

  // ── Access ───────────────────────────────────────────────
  // An FTE is anyone whose token opens the PL data repo; a contractor's token opens only the
  // review-pl-* repos of the projects shared with them (docs/sharing.md). The browser keeps a
  // working copy of the projects, so it's shown only while the token in use is the one a sync last
  // confirmed, against the data repo in Settings.
  // access: { login, tag: tokenTag(token), repo: 'owner/name', state: 'fte' | 'contractor' | 'none' | '' (not checked) }.

  // tokenTag is the engine's token fingerprint (model.js), so a token changed in another Signoff
  // tool is noticed before the next sync.
  var tokenTag = M.tokenTag;
  function canSee(access, token, repo) {
    return !!token && !!access && (access.state === 'fte' || access.state === 'contractor') && access.tag === tokenTag(token) && access.repo === repo;
  }
  function isFte(access, token, repo) { return canSee(access, token, repo) && access.state === 'fte'; }
  // The data repo said no (404): drop the projects it already holds, and keep unsynced ones
  // (hidden) so an FTE's next sync from this browser still pushes them.
  function lockOut(projects, dirty) {
    var out = {};
    Object.keys(projects || {}).forEach(function (k) { if (dirty && dirty[projects[k].id]) out[k] = projects[k]; });
    return out;
  }

  // ── 3D models ────────────────────────────────────────────
  // A Part's attached model (app.js, model3d.js), as stored on the node:
  //   { file, size, srcTris, tris, bboxMm: [x, y, z], dir, at, by,
  //     mesh: { sha, size }, step: { sha, size } | null, views: [{ key, sha, w, h, size }] }
  // The files live in the PL data repo under dir (models/<project id>/<node id>/). Only what
  // passes here is shown.
  var SHA = /^[0-9a-f]{40}$/, VIEW_KEYS = ['iso', 'top', 'front', 'right'];
  function cleanModel(m) {
    if (!m || typeof m !== 'object' || !m.mesh || !SHA.test(m.mesh.sha)) return null;
    var views = (Array.isArray(m.views) ? m.views : []).filter(function (v) { return v && VIEW_KEYS.indexOf(v.key) >= 0 && SHA.test(v.sha); })
      .map(function (v) { return { key: v.key, sha: v.sha, w: Number(v.w) || 0, h: Number(v.h) || 0, size: Number(v.size) || 0 }; });
    var num = function (x) { return isFinite(Number(x)) ? Number(x) : 0; };
    return {
      file: String(m.file || 'model.step'), size: num(m.size), srcTris: num(m.srcTris), tris: num(m.tris),
      bboxMm: Array.isArray(m.bboxMm) ? m.bboxMm.slice(0, 3).map(num) : null, dir: String(m.dir || ''), at: String(m.at || ''), by: String(m.by || ''),
      mesh: { sha: m.mesh.sha, size: num(m.mesh.size) }, step: m.step && SHA.test(m.step.sha) ? { sha: m.step.sha, size: num(m.step.size) } : null, views: views
    };
  }
  // The blob shas a project's live Parts refer to (for uploads), as { sha: path }.
  function modelFiles(project) {
    var out = {};
    liveNodes(project).forEach(function (n) {
      var m = cleanModel(n.model);
      if (!m) return;
      out[m.mesh.sha] = m.dir + 'mesh.plm.gz';
      if (m.step) out[m.step.sha] = m.dir + 'source.step.gz';
      m.views.forEach(function (v) { out[v.sha] = m.dir + v.key + '.png'; });
    });
    return out;
  }

  // ── Arranging (the 3D Exploded view) ─────────────────────
  // node.place = { x, y, z (mm), rx, ry, rz (degrees) } moves a Part from where its own
  // coordinates put it: all zeros is its CAD position. A Part without one is stacked
  // automatically. node.boardMm = [w, h, t] is a board's size when Fabcheck hasn't stored one.
  function cleanPlace(p) {
    if (!p || typeof p !== 'object') return null;
    var out = {};
    ['x', 'y', 'z', 'rx', 'ry', 'rz'].forEach(function (k) {
      var v = Number(p[k]);
      out[k] = isFinite(v) ? Math.max(-100000, Math.min(100000, v)) : 0;
    });
    return out;
  }
  function cleanBoard(b) {
    if (!b) return null;
    var a = Array.isArray(b) ? b : [b.w, b.h, b.t];
    var w = Number(a[0]), h = Number(a[1]), t = a[2] == null || a[2] === '' ? 1.6 : Number(a[2]);
    if (!(w > 0 && w <= 2000 && h > 0 && h <= 2000 && t > 0 && t <= 20)) return null;
    return [w, h, t];
  }

  // ── Bill of materials ────────────────────────────────────
  // mode 'indented': every node in tree order, numbered 1, 1.1, 1.2.1…
  // mode 'flat': one line per distinct Part, quantities summed. Parts are the same when they link
  // the same design, else share a number, else an MPN; never by name alone.
  // Extended quantity multiplies by the assemblies above (an assembly without qty counts once),
  // so the BOM's mass total matches rollup()'s.
  function bom(project, index, mode) {
    var t = tree(project), ids = flatten(t), item = {}, ext = {}, rows = [];
    (function number(list, prefix, mult) {
      list.forEach(function (id, i) {
        var n = t.nodes[id], q = n.qty > 0 ? Number(n.qty) : 1;
        item[id] = prefix + (i + 1);
        ext[id] = mult * q;
        number(t.children[id] || [], item[id] + '.', n.kind === 'assembly' ? mult * q : mult);
      });
    })(t.roots, '', 1);
    function hasMass(n) { return n.massG != null && n.massG !== '' && !isNaN(n.massG); }
    ids.forEach(function (id) {
      var n = t.nodes[id], st = linkStatus(n, index) || {}, e = st.entry || {}, s = st.summary;
      var part = n.kind === 'part';
      rows.push({
        id: id, item: item[id], level: t.depth[id], kind: n.kind, name: n.name || '', number: ((part || isLinkedAssembly(n)) && e.number) || n.number || '',
        rev: e.revision || '', source: part || isLinkedAssembly(n) ? n.source || '' : '', state: st.state || '',
        // Only a purchased Part shows its supplier and MPN; another kind keeps them hidden (app.js modelOf).
        supplier: n.source === 'purchased' ? n.supplier || '' : '', mpn: n.source === 'purchased' ? n.mpn || '' : '',
        qty: part ? (n.qty > 0 ? Number(n.qty) : 1) : null, extQty: part ? ext[id] : null,
        massG: part && hasMass(n) ? Number(n.massG) : null, extMassG: part && hasMass(n) ? Math.round(Number(n.massG) * ext[id] * 10) / 10 : null,
        stage: (s && s.stage) || e.stage || '', pct: s && !isDrawing(n.source) ? s.pct : null, notes: n.notes || '', ref: refKey(n.ref), uses: [id]
      });
    });
    if (mode === 'flat') {
      var byKey = {}, flat = [];
      rows.filter(function (r) { return r.kind === 'part'; }).forEach(function (r) {
        var k = r.ref ? 'ref:' + r.ref : r.number ? 'pn:' + r.number.toLowerCase() : r.mpn ? 'mpn:' + r.mpn.toLowerCase() : 'id:' + r.id;
        var g = byKey[k];
        if (!g) { g = byKey[k] = Object.assign({}, r, { uses: [] }); g.qty = 0; g.extQty = 0; g.extMassG = r.extMassG == null ? null : 0; flat.push(g); }
        g.uses.push(r.id); g.qty += r.qty; g.extQty += r.extQty;
        if (r.extMassG != null) g.extMassG = Math.round(((g.extMassG || 0) + r.extMassG) * 10) / 10;
      });
      flat.forEach(function (g, i) { g.item = String(i + 1); g.level = 0; });
      rows = flat;
    }
    var parts = rows.filter(function (r) { return r.kind === 'part'; });
    var mass = parts.reduce(function (a, r) { return a + (r.extMassG || 0); }, 0);
    return { mode: mode === 'flat' ? 'flat' : 'indented', rows: rows, totals: { lines: parts.length, qty: parts.reduce(function (a, r) { return a + r.extQty; }, 0),
      massG: Math.round(mass * 10) / 10, massMissing: parts.filter(function (r) { return r.massG == null && r.source !== 'fw'; }).length } };
  }

  /* Name and number of Parts linked to Loom harnesses go both ways (loom/assets/store.js). Whichever
     side edited them last wins, by `identAt`: Loom stamps it on the harness, PL on the node when the
     Part sheet changes either. Here a harness whose stamp is newer than its Part's brings its name and
     number over. Returns the ids of the nodes it changed (stamped with `user`). */
  function adoptHarnesses(project, index, user) {
    var changed = [];
    liveNodes(project).forEach(function (n) {
      if (n.kind !== 'part' || !isDrawing(n.source)) return;
      var st = partStatus(n, index), s = st && st.summary;
      if (!s || !s.identAt || s.identAt <= (n.identAt || '')) return;
      var name = s.name || n.name, number = s.number || '';
      if (name === n.name && number === (n.number || '')) return;
      project.nodes[n.id] = M.stamp(Object.assign({}, n, { name: name, number: number, identAt: s.identAt }), user);
      changed.push(n.id);
    });
    return changed;
  }

  /* A design started from a waiting Part (state 'planned') names it in its summary as
     plPart: { project: PL project id, node: node id, at: when it was started } (Loom's harnesses so far;
     loom/assets/store.js). Here each waiting Part of this project takes the design that names it: the
     earliest started (plPart.at) when several do, and only while the Part still waits for that tool (a Part switched
     back to Purchased stays purchased, and the design waits in the tray like any other). Archived
     designs and designs another Part already links are skipped. Returns the ids of the nodes it
     linked (stamped with `user`). */
  function claimFor(project, index) {
    var out = {}, used = {};
    liveNodes(project).forEach(function (n) { var k = refKey(n.ref); if (k) used[k] = 1; });
    var entries = (index && index.entries) || {};
    Object.keys(entries).sort(function (a, b) {
      var startedAt = function (k) { var s = entries[k].summary; return (s && s.plPart && s.plPart.at) || '~'; };   // unstamped last
      var x = startedAt(a), y = startedAt(b);
      return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1;
    }).forEach(function (k) {
      var e = entries[k], s = e.summary, pp = s && s.plPart;
      if (!pp || pp.project !== project.id || e.archived || used[k] || out[pp.node]) return;
      var n = project.nodes[pp.node];
      if (!n || n.deleted || n.kind !== 'part' || n.ref || n.source !== e.tool || !toolById(n.source)) return;
      out[pp.node] = k; used[k] = 1;
    });
    return out;   // { node id: 'tool:id' }
  }
  function claimPlanned(project, index, user) {
    var found = claimFor(project, index), changed = [];
    Object.keys(found).forEach(function (id) {
      var n = project.nodes[id], e = index.entries[found[id]], f = { ref: { tool: e.tool, id: e.id } };
      // The harness took the Part's name and number; from here they sync both ways by identAt.
      if (isDrawing(n.source) && e.summary.identAt) f.identAt = e.summary.identAt;
      project.nodes[id] = M.stamp(Object.assign({}, n, f), user);
      changed.push(id);
    });
    return changed;
  }
  // True when a design of `tool` names a waiting Part of a PL project in `projects` (so no tray offers
  // it: that Part takes it at the next claim). EE, ME, and FW write summary.tool upper case; the index's
  // tool id (`tool`) is what Parts use.
  function claimedElsewhere(summary, projects, tool) {
    var pp = summary && summary.plPart;
    if (!pp) return false;
    return (projects || []).some(function (p) {
      var n = p.id === pp.project && p.nodes && p.nodes[pp.node];
      return !!n && !n.deleted && n.kind === 'part' && !n.ref && n.source === String(tool || summary.tool || '').toLowerCase();
    });
  }

  // ── History (Chris, 2026-11-13; ../signoff/docs/history.md) ──
  // PL's version of the engine's recordDiff: the records whose stamp differs between two versions of a
  // PL project, as rows { kind: 'meta' | 'node' | 'req', id, label, detail, at, by, deleted, before,
  // after }. A node's detail says what changed in words ("moved from Housing to Electronics, renamed");
  // assembly names come from the version each side is in. before null: every record is new. Rows go by
  // each record's own stamp, never the commit's author. Values are untrusted: escape them.
  var NODE_WORDS = [['name', 'renamed'], ['number', 'part number'], ['qty', 'quantity'], ['supplier', 'supplier'], ['mpn', 'MPN'],
    ['massG', 'mass'], ['envelopeMm', 'envelope'], ['notes', 'notes'], ['kind', 'part or assembly']];
  function nodeName(doc, id) { var n = doc && doc.nodes && doc.nodes[id]; return n ? n.name || n.number || 'Untitled' : id ? 'a removed assembly' : 'the top'; }
  function nodeDetail(b, a, docB, docA) {
    if (!b) return 'added' + (a.parent ? ' under ' + nodeName(docA, a.parent) : '');
    if (a.deleted && !b.deleted) return 'removed';
    if (!a.deleted && b.deleted) return 'brought back';
    var out = [], same = function (k) { return JSON.stringify(b[k] == null ? null : b[k]) === JSON.stringify(a[k] == null ? null : a[k]); };
    if ((b.parent || '') !== (a.parent || '')) out.push('moved from ' + nodeName(docB, b.parent) + ' to ' + nodeName(docA, a.parent));
    else if (!same('order')) out.push('reordered');
    if (!same('source') || refKey(b.ref) !== refKey(a.ref)) out.push(refKey(a.ref) ? (refKey(b.ref) ? 'linked to another design' : 'linked to a design') : refKey(b.ref) ? 'unlinked' : 'source changed');
    NODE_WORDS.forEach(function (w) { if (!same(w[0])) out.push(w[0] === 'name' ? 'renamed' : w[1] + ' changed'); });
    if (!same('model')) out.push(a.model ? (b.model ? '3D model replaced' : '3D model added') : '3D model removed');
    if (!same('place')) out.push('moved in 3D');
    return out.length ? out.join(', ') : 'edited';
  }
  function historyDiff(before, after) {
    if (!after || !after.meta) return [];
    var out = [], key = function (r) { return r && typeof r === 'object' ? String(r.updatedAt || '') + '|' + String(r.updatedBy || '') : ''; };
    function add(kind, b, a, id, label, detail) {
      if (!a || typeof a !== 'object' || (b && key(a) === key(b))) return;
      out.push({ kind: kind, id: String(id || ''), label: label, detail: detail, at: typeof a.updatedAt === 'string' ? a.updatedAt : '',
        by: typeof a.updatedBy === 'string' ? a.updatedBy : '', deleted: !!a.deleted, before: b || null, after: a });
    }
    // Every edit restamps meta (app.js touch), so it's a change only when a field other than the stamp differs.
    var bare = function (m) { var o = Object.assign({}, m || {}); delete o.updatedAt; delete o.updatedBy; return M.stableStringify(o); };
    if (!before || bare(before.meta) !== bare(after.meta)) add('meta', before && before.meta, after.meta, after.id, 'Project details', 'name, client, phase, or description');
    Object.keys(after.nodes || {}).forEach(function (id) {
      var a = after.nodes[id], b = before && (before.nodes || {})[id];
      add('node', b, a, id, String((a && (a.name || a.number)) || 'Untitled'), a ? nodeDetail(b, a, before, after) : '');
    });
    Object.keys(after.reqs || {}).forEach(function (id) {
      var a = after.reqs[id], b = before && (before.reqs || {})[id];
      var d = !b ? 'added' : a.deleted && !b.deleted ? 'removed' : (b.verify || 'open') !== (a.verify || 'open') ? 'verify: ' + (b.verify || 'open') + ' → ' + (a.verify || 'open') : 'edited';
      add('req', b, a, id, ((a && a.ref ? a.ref + ' ' : '') + String((a && a.text) || '')).trim().slice(0, 160) || 'Requirement', d);
    });
    return out.sort(function (x, y) { return x.at < y.at ? 1 : x.at > y.at ? -1 : 0; });
  }
  // versions newest first, [{ doc, commit }]; as model.historyRows.
  function historyRows(versions, opts) {
    var out = [], v = versions || [];
    for (var i = 0; i < v.length; i++) {
      var older = v[i + 1];
      if (!older && !(opts && opts.complete)) break;
      historyDiff(older ? older.doc : null, v[i].doc).forEach(function (r) { r.commit = v[i].commit || null; out.push(r); });
    }
    return out.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  }

  S.pl = {
    historyDiff: historyDiff, historyRows: historyRows,
    SEVERITIES: SEVERITIES, sources: sources, toolById: toolById, isDrawing: isDrawing, adoptHarnesses: adoptHarnesses,
    linkStatus: linkStatus, isLinkedAssembly: isLinkedAssembly, isAssemblyDesign: isAssemblyDesign,
    claimFor: claimFor, claimPlanned: claimPlanned, claimedElsewhere: claimedElsewhere,
    newProject: newProject, newNode: newNode, nextOrder: nextOrder, merge: merge, liveNodes: liveNodes,
    tree: tree, flatten: flatten, descendants: descendants, canMove: canMove, path: path, topAssembly: topAssembly, soloPart: soloPart,
    refKey: refKey, partStatus: partStatus, rollup: rollup, issues: issues, unlistedIssues: unlistedIssues,
    tokenTag: tokenTag, canSee: canSee, isFte: isFte, lockOut: lockOut, cleanModel: cleanModel, modelFiles: modelFiles, bom: bom, cleanPlace: cleanPlace, cleanBoard: cleanBoard
  };
})(window.Signoff = window.Signoff || {});
