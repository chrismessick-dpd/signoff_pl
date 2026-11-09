/* Signoff PL: reads the design reviews a project's Parts link to.

   For each tool in config.tools it lists the tool's data repo plus every repository of the
   owner whose name starts with the tool's prefix (review-ee-…), and reads projects/*.json in
   each. Only `meta` and the `summary` block are kept. Files whose blob sha hasn't changed since
   the last refresh aren't downloaded again.

   The map from project id to repository is rebuilt on every refresh, so a Part keeps working
   when its project moves out of the data repo into its own shared repo. If the same project
   is in both for a moment (the move was interrupted), the shared repo's copy wins.

   Review files come from repositories contractors can write to, so nothing in them is
   trusted: every entry is rebuilt from known fields (numbers as numbers, severities from the
   list), a file only counts for the project its name says, and when the tool's data repo has
   a People list (users.json), a shared repo only counts for the projects its shared map puts
   there.

   index: { v, at, entries: { 'tool:id': { tool, id, repo, path, sha, name, number, revision,
            stage, summary | null } }, errors: [{ tool, repo, message }], files: { 'owner/repo':
            { path: { sha, entry } } } } */
(function (S) {
  'use strict';

  function Reader(opts) {
    this.owner = opts.owner;
    this.branch = opts.branch || 'main';
    this.tools = opts.tools || [];
    this.token = opts.token;
    this.fetch = opts.fetch;
    this.account = new S.GitHubAccount(opts.token, opts.fetch);
  }

  Reader.prototype.store = function (repo) {
    return new S.GitHubStore({ owner: this.owner, repo: repo, branch: this.branch, dataPath: '', token: this.token }, this.fetch);
  };

  var SEVERITIES = ['critical', 'major', 'minor'], REV_STATUS = ['sent', 'built', 'withdrawn'];
  function str(v) { return v == null || typeof v === 'object' ? '' : String(v); }
  function num(v, max) { v = Math.max(0, Math.round(Number(v)) || 0); return max ? Math.min(v, max) : v; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

  // A summary (EE README, "The project summary") rebuilt from the fields PL knows.
  function cleanSummary(s) {
    if (!s || typeof s !== 'object') return null;
    var iss = obj(s.issues), open = {}, checklists = {};
    SEVERITIES.forEach(function (sev) { open[sev] = num(obj(iss.open)[sev]); });
    Object.keys(obj(s.checklists)).forEach(function (k) {
      if (k === '__proto__') return;
      var c = obj(s.checklists[k]);
      checklists[k] = { name: str(c.name), total: num(c.total), reviewed: num(c.reviewed), pct: num(c.pct, 100), issuesOpen: num(c.issuesOpen) };
    });
    var q = s.reqs && typeof s.reqs === 'object' ? s.reqs : null;
    var out = {
      v: num(s.v), tool: str(s.tool), name: str(s.name), client: str(s.client), project: str(s.project), number: str(s.number), revision: str(s.revision),
      stage: str(s.stage), archived: !!s.archived, total: num(s.total), reviewed: num(s.reviewed), pct: num(s.pct, 100),
      checklists: checklists, issues: { open: open, fixed: num(iss.fixed), waived: num(iss.waived) },
      reqs: q ? { total: num(q.total), approved: num(q.approved), pass: num(q.pass), fail: num(q.fail), risk: num(q.risk), open: num(q.open), unlinked: num(q.unlinked) } : null,
      at: str(s.at), by: str(s.by)
    };
    // A Loom harness (loom/assets/store.js, summarize): when its name and number were last edited
    // there, and what it holds.
    if (s.identAt != null) out.identAt = str(s.identAt).slice(0, 40);
    // A review of an assembly (Signoff ME, EE README "The project summary"): only 'assembly' is kept.
    if (s.kind === 'assembly') out.kind = 'assembly';
    // The waiting PL Part a design was started from (pl.js claimPlanned): { project, node }.
    var pp = s.plPart;
    if (pp && typeof pp === 'object' && typeof pp.project === 'string' && typeof pp.node === 'string' && pp.project && pp.node) {
      out.plPart = { project: pp.project.slice(0, 80), node: pp.node.slice(0, 80), at: str(pp.at).slice(0, 40) };
    }
    if (s.harness && typeof s.harness === 'object') {
      var hs = s.harness;
      out.harness = { ends: num(hs.ends), splices: num(hs.splices), wires: num(hs.wires), cables: num(hs.cables), sets: num(hs.sets),
        wireMm: num(hs.wireMm), errors: num(hs.errors), warnings: num(hs.warnings),
        boards: Array.isArray(hs.boards) ? hs.boards.filter(function (b) { return typeof b === 'string'; }).slice(0, 50).map(function (b) { return b.slice(0, 80); }) : [] };
    }
    if (Array.isArray(s.reqList)) out.reqList = s.reqList.slice(0, 2000).map(cleanReq).filter(Boolean);
    // summary.recent: the review's latest comments (EE README, "The project summary").
    if (Array.isArray(s.recent)) {
      out.recent = s.recent.filter(function (c) { return c && typeof c === 'object'; }).slice(0, 20).map(function (c) {
        return { id: str(c.id).slice(0, 80), item: str(c.item).slice(0, 80), check: str(c.check).slice(0, 200), author: str(c.author).slice(0, 100), at: str(c.at).slice(0, 40), text: str(c.text).slice(0, 600) };
      });
    }
    // summary.revisions: the board's tagged fab revisions in order (EE README, "The project summary").
    if (Array.isArray(s.revisions)) {
      out.revisions = s.revisions.filter(function (r) { return r && typeof r === 'object'; }).slice(0, 50).map(function (r) {
        return { label: str(r.label).slice(0, 40), status: REV_STATUS.indexOf(r.status) >= 0 ? r.status : '', sentAt: str(r.sentAt).slice(0, 20) };
      });
    }
    // summary.spec: a firmware description's top-level gists and gaps (EE README, "The project summary").
    if (s.spec && typeof s.spec === 'object') {
      var sp = s.spec;
      out.spec = { gists: (Array.isArray(sp.gists) ? sp.gists : []).filter(function (g) { return g && typeof g === 'object'; }).slice(0, 12).map(function (g) {
        return { title: str(g.title).slice(0, 120), gist: str(g.gist).slice(0, 300), depth: g.depth === 1 ? 1 : 0 };
      }), sections: num(sp.sections), untraced: num(sp.untraced), undescribed: num(sp.undescribed), flagged: num(sp.flagged) };
    }
    if (Array.isArray(s.open)) {
      out.open = s.open.filter(function (i) { return i && typeof i === 'object'; }).map(function (i) {
        return { id: str(i.id), severity: SEVERITIES.indexOf(i.severity) >= 0 ? i.severity : 'minor', text: str(i.text),
          checklist: str(i.checklist), assignee: str(i.assignee), ref: str(i.ref) };
      });
    }
    return out;
  }
  // One entry of summary.reqList (EE README, "The project summary"): enums from their lists,
  // text capped, and a parent only when it's a Signoff PL link.
  function oneOf(list, v, fallback) { return list.indexOf(v) >= 0 ? v : fallback; }
  function cleanReq(r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
    var out = {
      id: r.id.slice(0, 80), ref: str(r.ref).slice(0, 40), text: str(r.text).slice(0, 2000),
      discipline: oneOf(['sys', 'ee', 'me', 'fw', 'other'], r.discipline, 'other'), kind: oneOf(['shall', 'should'], r.kind, 'shall'),
      category: str(r.category).slice(0, 200), method: oneOf(['inspection', 'analysis', 'demonstration', 'test'], r.method, 'inspection'),
      status: oneOf(['draft', 'approved', 'changed', 'deprecated'], r.status, 'draft'), verify: oneOf(['open', 'pass', 'fail'], r.verify, 'open'),
      state: oneOf(['deprecated', 'fail', 'risk', 'pass', 'open'], r.state, 'open'), links: num(r.links),
      issues: Array.isArray(r.issues) ? r.issues.filter(function (i) { return typeof i === 'string'; }).slice(0, 50).map(function (i) { return i.slice(0, 80); }) : [],
      at: str(r.at), by: str(r.by)
    };
    var p = r.parent;
    if (p && typeof p === 'object' && p.tool === 'pl' && typeof p.id === 'string' && typeof p.project === 'string') {
      out.parent = { tool: 'pl', project: p.project.slice(0, 80), id: p.id.slice(0, 80), ref: str(p.ref).slice(0, 40) };
    }
    return out;
  }
  function cleanEntry(e) {
    e = obj(e);
    var out = { id: str(e.id), name: str(e.name), number: str(e.number), revision: str(e.revision), stage: str(e.stage),
      archived: !!e.archived, summary: cleanSummary(e.summary) };
    var pv = keepPreview(e.preview);
    if (pv) out.preview = pv;
    return out;
  }

  // Pictures a checker stored next to a review (EE's docs/fabcheck-link.md, "Board previews"):
  // <tool.previews><id>/preview/index.json names them. PL keeps each image's blob sha and fetches
  // the bytes only when a tile shows it. `shas` maps the repo's paths to blob shas.
  var IMAGE_TYPES = { 'image/webp': 1, 'image/png': 1 };
  function cleanPreview(doc, dir, shas, repo) {
    doc = obj(doc);
    var images = (Array.isArray(doc.images) ? doc.images : []).map(obj).map(function (i) {
      var file = str(i.file), key = str(i.key), type = str(i.type);
      if (!/^[a-z0-9-]{1,32}$/.test(key) || !/^[a-z0-9-]{1,32}\.(webp|png)$/.test(file) || !IMAGE_TYPES[type] || !shas[dir + file]) return null;
      return { key: key, type: type, w: num(i.w, 4096), h: num(i.h, 4096), sha: shas[dir + file] };
    }).filter(Boolean);
    return images.length ? keepPreview({ repo: repo, runId: doc.runId, at: doc.at, hero: doc.hero, images: images, board: doc.board }) : null;
  }
  // A preview as stored in the index: images by blob sha, or (demo only) by a file under
  // assets/demo-previews/.
  function keepPreview(p) {
    p = obj(p);
    var images = (Array.isArray(p.images) ? p.images : []).map(obj).map(function (i) {
      var key = str(i.key), sha = str(i.sha), src = str(i.src);
      if (!/^[a-z0-9-]{1,32}$/.test(key)) return null;
      if (/^[0-9a-f]{40}$/.test(sha) && IMAGE_TYPES[str(i.type)]) return { key: key, type: str(i.type), w: num(i.w, 4096), h: num(i.h, 4096), sha: sha };
      if (/^assets\/demo-previews\/[a-z0-9-]+\.(svg|webp)$/.test(src)) return { key: key, w: num(i.w, 4096), h: num(i.h, 4096), src: src };
      return null;
    }).filter(Boolean);
    if (!images.length) return null;
    var hero = images.some(function (i) { return i.key === str(p.hero); }) ? str(p.hero) : images[0].key;
    // board: the board's size in mm as Fabcheck measured it ({ w, h, t }), for the 3D Exploded view.
    var board = S.pl && S.pl.cleanBoard(p.board);
    return { repo: /^[\w.-]+\/[\w.-]+$/.test(str(p.repo)) ? str(p.repo) : '', runId: str(p.runId), at: str(p.at), hero: hero, images: images, board: board };
  }
  // A stored index (localStorage) goes through the same cleaning before it is shown.
  function cleanIndex(index) {
    if (!index || typeof index !== 'object') return index || null;
    var entries = {};
    Object.keys(obj(index.entries)).forEach(function (k) {
      if (k === '__proto__') return;
      var e = obj(index.entries[k]);
      entries[k] = Object.assign({ tool: str(e.tool), repo: str(e.repo), path: str(e.path), sha: str(e.sha) }, cleanEntry(e));
    });
    return Object.assign({}, index, { entries: entries });
  }

  function keep(doc) {
    var m = obj(doc.meta);
    // EE and ME keep the number as meta.board; Loom as meta.number. A deleted harness reads as archived.
    return cleanEntry({ id: doc.id, name: m.name, number: m.board || m.number, revision: m.revision, stage: m.stage, archived: m.archived || m.deleted, summary: doc.summary });
  }

  // The shape of a cached entry. Bump it whenever keep() or cleanSummary() starts keeping a new field:
  // a file whose blob hasn't changed is otherwise never read again, so the field would stay missing
  // (2: summary.reqList, which a cache from before the Requirements tab dropped; 3: summary.revisions;
  // 4: Loom harnesses, meta.number, summary.identAt and summary.harness; 5: summary.plPart; 6: summary.spec; 7: summary.kind).
  var CACHE_V = 7;

  // Resolves a new index. `prev` (the last index) supplies the blob cache, if it has this shape.
  Reader.prototype.refresh = function (prev) {
    var self = this, prevFiles = (prev && prev.v === CACHE_V && prev.files) || {};
    var index = { v: CACHE_V, at: new Date().toISOString(), entries: {}, errors: [], files: {} };
    var sharedMaps = {};   // tool id -> the shared map from its data repo's users.json, if any

    function readRepo(tool, repo) {
      var full = self.owner + '/' + repo, store = self.store(repo), cached = prevFiles[full] || {};
      return store.snapshot().then(function (snap) {
        var files = snap.entries.filter(function (e) {
          return e.type === 'blob' && /^projects\/[^/]+\.json$/.test(e.path);
        });
        index.files[full] = {};
        var isData = repo === tool.dataRepo, people = isData && snap.entries.filter(function (e) { return e.path === 'users.json'; })[0];
        var seen = people && cached['users.json'];
        var map = !people ? Promise.resolve()
          : (seen && seen.sha === people.sha ? Promise.resolve(seen.shared) : store.blob(people.sha).then(function (t) { return obj(JSON.parse(t)).shared; }))
            .then(function (m) {
              index.files[full]['users.json'] = { sha: people.sha, shared: m };
              if (m && typeof m === 'object') sharedMaps[tool.id] = m;
            }).catch(function () { /* unreadable: no check */ });
        return map.then(function () { return Promise.all(files.map(function (e) {
          var hit = cached[e.path], fileId = e.path.slice('projects/'.length, -'.json'.length);
          var got = hit && hit.sha === e.sha ? Promise.resolve(cleanEntry(hit.entry))
            : store.blob(e.sha).then(function (text) { return keep(obj(JSON.parse(text))); });
          return got.then(function (entry) {
            if (entry.id !== fileId) return;   // a file only counts for the project its name says
            var shared = sharedMaps[tool.id] && obj(sharedMaps[tool.id][fileId]);
            // A shared repo only counts for the projects the data repo's shared map puts there.
            if (!isData && sharedMaps[tool.id] && (shared.deleted || str(shared.repo).toLowerCase() !== full.toLowerCase())) return;
            index.files[full][e.path] = { sha: e.sha, entry: entry };
            var key = tool.id + ':' + entry.id, had = index.entries[key];
            // The data repo is read first, so a shared repo's copy replaces its stale twin.
            if (had && repo === tool.dataRepo && had.repo !== full) return;
            index.entries[key] = Object.assign({ tool: tool.id, repo: full, path: e.path, sha: e.sha }, entry);
          }).catch(function (err) {
            index.errors.push({ tool: tool.id, repo: full, message: e.path + ': ' + err.message });
          });
        })); }).then(function () { return readPreviews(tool, full, store, snap.entries, cached); });
      }).catch(function (err) {
        // A tool with no data repo yet is fine; anything else is reported.
        if (err.status === 404 && repo === tool.dataRepo) return;
        index.errors.push({ tool: tool.id, repo: full, message: err.message });
      });
    }

    // The previews stored in this repo, for the designs it holds. One that can't be read is left out
    // quietly: a tile without a picture still works.
    function readPreviews(tool, full, store, entries, cached) {
      if (!tool.previews) return;
      var shas = {}, head = tool.previews;
      entries.forEach(function (e) { if (e.type === 'blob') shas[e.path] = e.sha; });
      return Promise.all(entries.filter(function (e) {
        return e.type === 'blob' && e.path.indexOf(head) === 0 && /^[^/]+\/preview\/index\.json$/.test(e.path.slice(head.length));
      }).map(function (e) {
        var id = e.path.slice(head.length).split('/')[0], entry = index.entries[tool.id + ':' + id];
        if (!entry || entry.repo !== full) return;
        var hit = cached[e.path], dir = e.path.slice(0, -'index.json'.length);
        var got = hit && hit.sha === e.sha ? Promise.resolve(hit.doc) : store.blob(e.sha).then(function (t) { return JSON.parse(t); });
        return got.then(function (doc) {
          index.files[full][e.path] = { sha: e.sha, doc: doc };
          var pv = cleanPreview(doc, dir, shas, full);
          if (pv) entry.preview = pv;
        }).catch(function () { /* no picture */ });
      }));
    }

    return Promise.all(this.tools.map(function (tool) {
      return (tool.prefix ? self.account.listRepos(self.owner, tool.prefix) : Promise.resolve([])).then(function (names) {
        var repos = [tool.dataRepo].concat(names.filter(function (n) { return n !== tool.dataRepo; }));
        return repos.reduce(function (chain, repo) { return chain.then(function () { return readRepo(tool, repo); }); }, Promise.resolve());
      }).catch(function (err) {
        index.errors.push({ tool: tool.id, repo: self.owner, message: 'Couldn’t list ' + tool.name + ' repositories: ' + err.message });
      });
    })).then(function () { return index; });
  };

  // Designs of one tool, for the link picker: newest first, archived last.
  function designs(index, toolId) {
    var e = (index && index.entries) || {};
    return Object.keys(e).map(function (k) { return e[k]; }).filter(function (d) { return d.tool === toolId; })
      .sort(function (a, b) {
        return (a.archived - b.archived) || ((b.summary && b.summary.at) || '').localeCompare((a.summary && a.summary.at) || '') || a.name.localeCompare(b.name);
      });
  }

  // One stored image's bytes, as a Blob.
  Reader.prototype.image = function (repo, img) {
    return this.store(repo.split('/')[1]).blobBytes(img.sha).then(function (b) { return new Blob([b], { type: img.type }); });
  };

  S.PLReader = Reader;
  S.plReader = { CACHE_V: CACHE_V, designs: designs, cleanSummary: cleanSummary, cleanIndex: cleanIndex };
})(window.Signoff = window.Signoff || {});
