/* Signoff PL data model: project documents, the product tree, and the roll-up of the linked
   design reviews. Pure functions only (no DOM, no storage) so tests/test.html can run them.

   A PL project document:
     { schema, id: 'pl…', slug, createdAt, createdBy,
       meta:  { name, client, number, description, phase, archived, updatedAt, updatedBy },
       nodes: { id: { id, parent: '' | node id, order, kind: 'assembly' | 'part', name, number,
                      source: 'ee' | 'me' | … | 'fw' | 'purchased', ref: { tool, id } | null,
                      qty, supplier, mpn, massG, envelopeMm, notes,
                      createdAt, updatedAt, updatedBy, deleted } } }
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

  function merge(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return {
      schema: Math.max(local.schema || 1, remote.schema || 1),
      id: remote.id || local.id,
      slug: remote.slug || local.slug,
      createdAt: remote.createdAt < local.createdAt ? remote.createdAt : local.createdAt,
      createdBy: remote.createdBy || local.createdBy,
      meta: M.newer(local.meta, remote.meta),
      nodes: M.mergeMaps(local.nodes, remote.nodes)
    };
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
       unlinked    a design Part (EE, ME…) not linked to a review yet
       purchased   bought in; no review
       manual      a source with no Signoff tool yet (firmware)
     Assemblies return null. */
  function partStatus(node, index) {
    if (!node || node.kind !== 'part') return null;
    if (node.source === 'purchased') return { state: 'purchased' };
    if (!toolById(node.source)) return { state: node.source ? 'manual' : 'unlinked' };
    var key = refKey(node.ref);
    if (!key) return { state: 'unlinked' };
    var e = index && index.entries && index.entries[key];
    if (e) return { state: e.summary ? 'ok' : 'nosummary', entry: e, summary: e.summary || null };
    if (index && (index.errors || []).some(function (x) { return x.tool === node.source; })) return { state: 'error' };
    return { state: 'notfound' };
  }

  function emptyRoll() {
    var r = { total: 0, reviewed: 0, pct: 0, open: {}, openTotal: 0, fixed: 0, waived: 0,
      parts: 0, designs: 0, summarized: 0, attention: 0, purchased: 0, manual: 0, unlinked: 0,
      massG: 0, massParts: 0, massMissing: 0, stages: {} };
    SEVERITIES.forEach(function (s) { r.open[s] = 0; });
    return r;
  }

  /* Roll-up for every node: { id: roll }, plus '' for the whole project.
     - Progress is reviewed / total checks over the linked designs that have a summary.
       Purchased and firmware Parts aren't in it.
     - A design used twice (two of the same board) counts once in each total.
     - Mass is per Part times quantity, and only over Parts that have one; massMissing counts
       the rest. Assemblies have no mass of their own.
     - Stages are listed per tool, not mapped onto each other. */
  function rollup(project, index) {
    var t = tree(project), out = {};
    function add(roll, node, seen) {
      var st = partStatus(node, index);
      roll.parts++;
      var qty = node.qty > 0 ? node.qty : 1;
      if (node.massG != null && node.massG !== '' && !isNaN(node.massG)) { roll.massG += Number(node.massG) * qty; roll.massParts++; }
      else roll.massMissing++;
      if (st.state === 'purchased') { roll.purchased++; return; }
      if (st.state === 'manual') { roll.manual++; return; }
      if (st.state === 'unlinked') { roll.unlinked++; return; }
      if (st.state !== 'ok') { roll.attention++; return; }
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
      roll.pct = roll.total ? Math.round(100 * roll.reviewed / roll.total) : 0;
      roll.massG = Math.round(roll.massG * 10) / 10;
      return roll;
    }
    function walk(id) {
      var roll = emptyRoll(), seen = {};
      (function gather(nid) {
        var n = t.nodes[nid];
        if (n.kind === 'part') add(roll, n, seen);
        (t.children[nid] || []).forEach(gather);
      })(id);
      out[id] = finish(roll);
      (t.children[id] || []).forEach(walk);
    }
    t.roots.forEach(walk);
    var all = emptyRoll(), seenAll = {};
    flatten(t).forEach(function (id) { if (t.nodes[id].kind === 'part') add(all, t.nodes[id], seenAll); });
    out[''] = finish(all);
    return out;
  }

  // Every open issue across the product's linked designs, worst first. A design used by
  // several Parts is listed once, under the first of them in the tree.
  function issues(project, index) {
    var t = tree(project), out = [], seen = {};
    flatten(t).forEach(function (id) {
      var n = t.nodes[id], st = partStatus(n, index);
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
      var st = partStatus(t.nodes[id], index);
      if (!st || st.state !== 'ok' || st.summary.open) return;
      var key = refKey(t.nodes[id].ref);
      if (seen[key]) return;
      seen[key] = 1;
      var o = (st.summary.issues || {}).open || {};
      n += SEVERITIES.reduce(function (a, s) { return a + (o[s] || 0); }, 0);
    });
    return n;
  }

  // ── Access ───────────────────────────────────────────────
  // PL is for FTEs: anyone whose token opens the PL data repo. The browser keeps a working copy
  // of the projects, so it's shown only while the token in use is the one a sync last confirmed
  // as an FTE's, against the data repo in Settings.
  // access: { login, tag: tokenTag(token), repo: 'owner/name', state: 'fte' | 'none' | '' (not checked) }.

  // A short fingerprint of the token (FNV-1a), so a token changed in another Signoff tool is
  // noticed before the next sync. It can't be turned back into the token.
  function tokenTag(token) {
    var h = 0x811c9dc5;
    token = String(token || '');
    for (var i = 0; i < token.length; i++) { h ^= token.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function canSee(access, token, repo) {
    return !!token && !!access && access.state === 'fte' && access.tag === tokenTag(token) && access.repo === repo;
  }
  // The data repo said no (404): drop the projects it already holds, and keep unsynced ones
  // (hidden) so an FTE's next sync from this browser still pushes them.
  function lockOut(projects, dirty) {
    var out = {};
    Object.keys(projects || {}).forEach(function (k) { if (dirty && dirty[projects[k].id]) out[k] = projects[k]; });
    return out;
  }

  S.pl = {
    SEVERITIES: SEVERITIES, sources: sources, toolById: toolById,
    newProject: newProject, newNode: newNode, nextOrder: nextOrder, merge: merge, liveNodes: liveNodes,
    tree: tree, flatten: flatten, descendants: descendants, canMove: canMove, path: path,
    refKey: refKey, partStatus: partStatus, rollup: rollup, issues: issues, unlistedIssues: unlistedIssues,
    tokenTag: tokenTag, canSee: canSee, lockOut: lockOut
  };
})(window.Signoff = window.Signoff || {});
