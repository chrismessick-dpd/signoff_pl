/* Signoff PL: sharing a PL project with people outside the team, and syncing the repositories
   that holds. The model is Signoff EE's (ee_design_review/assets/workspace.js), applied to every
   tool a product links to. See docs/sharing.md.

   Each tool keeps its reviews in a data repo (FTEs only) whose users.json is the roster: `users`
   with a role, and the `shared` map saying which review lives in its own private repo
   (<prefix><slug>, e.g. review-ee-main-board). Sharing a PL project:
     1. moves the project into review-pl-<slug>, with its model files (models/<project id>/);
     2. moves each linked EE, ME, and FW review into that tool's review-<tool>-<slug> (an EE board's
        Fabcheck files go with it), or reuses the repo it's already shared in;
     3. moves each linked Loom harness into review-loom-<slug>;
     4. records the person as a contractor on each of those in that tool's roster, and invites the
        FTEs (Signoff EE's roster is the home of People) and the person to every repo.
   Every step is safe to repeat. Writes to a roster prove themselves additive first (the roster
   without the records written must re-serialize to the original), commit with force:false and are
   read back. A review file is copied byte for byte and never re-serialized here.

   syncAll(): PL's own sync across the data repo and the shared repos, as EE's Workspace.sync:
   FTEs sync the data repo (with the roster) and every repo in the shared map; a token that can't
   open the data repo lists review-pl-* repos instead (a contractor).

   No DOM here; app.js renders. The fetch is injected so tests run against a fake GitHub. */
(function (S) {
  'use strict';
  var M = S.model;

  function Sharer(opts) {
    this.owner = opts.owner;
    this.branch = opts.branch || 'main';
    this.token = opts.token;
    this.fetch = opts.fetch;
    this.tools = opts.tools || [];          // config.tools: { id, name, dataRepo, prefix, previews, review }
    this.pl = opts.pl;                      // { dataRepo, prefix }
    this.peopleRepo = opts.peopleRepo;      // Signoff EE's data repo: the home of People & access
    this.login = (opts.login || '').toLowerCase();
    this.account = new S.GitHubAccount(opts.token, opts.fetch);
    this.rosters = {};                      // 'owner/repo' -> normalized roster, read once per operation
    this.names = {};                        // login -> display name for people added here
    this.roles = {};                        // login -> 'client' | 'contractor' for people added here
    this.companies = {};                    // login -> company, for clients added here
  }

  Sharer.prototype.full = function (name) { return this.owner + '/' + name; };
  Sharer.prototype.store = function (repoFull, extra) {
    var parts = repoFull.split('/');
    return new S.GitHubStore(Object.assign({ owner: parts[0], repo: parts[1], branch: this.branch, dataPath: '', token: this.token }, extra || {}), this.fetch);
  };
  function denied(err) { return err && (err.status === 404 || err.status === 403); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // The tool descriptor sharing works with: PL itself, or an entry of config.tools.
  Sharer.prototype.toolDesc = function (toolId) {
    if (toolId === 'pl') return { id: 'pl', label: 'PL project', dataRepo: this.pl.dataRepo, prefix: this.pl.prefix, files: ['models/'] };
    var t = this.tools.filter(function (x) { return x.id === toolId; })[0];
    if (!t || !t.prefix) return null;   // a tool without shared repos can't share
    return { id: t.id, label: t.short || t.name || t.id, dataRepo: t.dataRepo, prefix: t.prefix, files: t.previews ? [t.previews] : [] };
  };

  Sharer.prototype.whoAmI = function () {
    var self = this;
    if (this.login) return Promise.resolve(this.login);
    return this.account.user().then(function (u) { self.login = String(u.login || '').toLowerCase(); return self.login; });
  };

  // ── Rosters ──
  // A roster as the engine would write it: the file's content normalized through mergeRosters.
  function normalize(parsed) { return M.mergeRosters(M.emptyRoster(), parsed && typeof parsed === 'object' ? parsed : null); }
  // Resolves { snap, entry, text, roster, raw }: the data repo's roster, or an empty one when the file
  // isn't there. `raw` is the parsed file as stored.
  Sharer.prototype.readRoster = function (dataFull) {
    var store = this.store(dataFull);
    return store.snapshot().then(function (snap) {
      var entry = snap.entries.filter(function (e) { return e.type === 'blob' && e.path === 'users.json'; })[0];
      if (!entry) return { snap: snap, entry: null, text: '', raw: null, roster: M.emptyRoster() };
      return store.blob(entry.sha).then(function (text) {
        var raw = null;
        try { raw = JSON.parse(text); } catch (e) { raw = null; }
        return { snap: snap, entry: entry, text: text, raw: raw, roster: normalize(raw) };
      });
    });
  };
  Sharer.prototype.rosterOf = function (dataFull) {
    var self = this;
    if (this.rosters[dataFull]) return Promise.resolve(this.rosters[dataFull]);
    return this.readRoster(dataFull).then(function (r) { self.rosters[dataFull] = r.roster; return r.roster; }, function (err) {
      if (!denied(err)) throw err;
      return null;   // no access, or no data repo: unknown
    });
  };

  /* Change a data repo's roster with `mutate(roster)` (it edits the normalized copy in place and
     returns true when it changed something), plus optional extra `changes` for the same commit (a
     stray file to delete once its shared repo holds it). Proof before committing: the new roster
     with the records `touched` ({ users: [logins], shared: [ids] }) taken out must equal the original
     with the same records taken out, byte for byte, so nothing else in the file moves. The original
     is normalized first when it wasn't written by Signoff (then every field is kept, only the layout
     changes, as EE's own sync would). Commits with force:false, retries when someone pushed first,
     and reads the roster back. Resolves the roster as stored. */
  Sharer.prototype.patchRoster = function (dataFull, touched, mutate, extraChanges, message) {
    var self = this, store = this.store(dataFull), attempt = 0;
    function strip(r) {
      var c = { schema: 1, users: Object.assign({}, r.users), shared: Object.assign({}, r.shared) };
      (touched.users || []).forEach(function (l) { delete c.users[l]; });
      (touched.shared || []).forEach(function (id) { delete c.shared[id]; });
      return M.stableStringify(c);
    }
    function once() {
      attempt++;
      return self.readRoster(dataFull).then(function (r) {
        var base = r.roster, next = normalize(JSON.parse(JSON.stringify(base)));
        var changed = mutate(next);
        if (strip(next) !== strip(base)) throw new Error('The write to ' + dataFull + '/users.json would change more than the records it was given, so it was stopped');
        var text = M.stableStringify(next);
        var changes = (extraChanges || []).filter(function (c) { return r.snap.entries.some(function (e) { return e.path === c.path; }); });
        if (changed || text !== r.text) changes.unshift({ path: 'users.json', text: text, label: 'people' });
        if (!changes.length) return next;
        return store.commit(r.snap, changes, message || 'Signoff PL: share').then(function () {
          return self.readRoster(dataFull).then(function (back) {
            if (M.stableStringify(back.roster) !== text) throw new Error('Read back from ' + dataFull + '/users.json: the roster didn’t stick');
            self.rosters[dataFull] = back.roster;
            return back.roster;
          });
        });
      }).catch(function (err) {
        if ((err.status === 422 || err.status === 409) && attempt < 4) return once();
        throw err;
      });
    }
    return once();
  };

  // ── Files that travel with a design (Fabcheck runs, PL models) ──
  // Copy <dir> from one repo to another, then delete it from the first. Safe to repeat: files already
  // there are skipped, and the source is cleared only once the copy has landed.
  Sharer.prototype.moveDir = function (fromFull, toFull, dir, log) {
    var src = this.store(fromFull), dst = this.store(toFull);
    return src.listTree(dir).then(function (list) {
      if (!list.length) return 0;
      log('Moving ' + list.length + ' file' + (list.length === 1 ? '' : 's') + ' under ' + dir + ' to ' + toFull + '…');
      var files = [], next = 0;
      function worker() {
        if (next >= list.length) return Promise.resolve();
        var e = list[next++];
        return src.blobBytes(e.sha).then(function (bytes) { files.push({ path: e.path, bytes: bytes }); return worker(); });
      }
      return Promise.all([worker(), worker(), worker(), worker()]).then(function () {
        return dst.putFiles(files, { message: 'Signoff PL: move ' + dir + ' to ' + toFull });
      }).then(function () {
        return src.putFiles(list.map(function (e) { return { path: e.path, remove: true }; }), { message: 'Signoff PL: ' + dir + ' moved to ' + toFull });
      }).then(function () { return list.length; });
    });
  };

  // ── Sharing one design of one tool ──
  /* Resolves { repo, created, moved, failedInvites }. `logins` are the people to invite as contractors
     (recorded in the tool's roster); FTEs come from Signoff EE's roster and the tool's own. */
  Sharer.prototype.shareOne = function (tool, id, name, logins, log) {
    var self = this, dataFull = this.full(tool.dataRepo), data = this.store(dataFull);
    var path = 'projects/' + id + '.json', fileText = null, repoFull = '', created = false, snap0;
    log = log || function () {};
    logins = (logins || []).map(function (l) { return String(l).toLowerCase(); });
    return this.whoAmI().then(function () { return self.readRoster(dataFull); }).then(function (r) {
      snap0 = r.snap;
      self.rosters[dataFull] = r.roster;
      var entry = snap0.entries.filter(function (e) { return e.type === 'blob' && e.path === path; })[0];
      var existing = M.sharedRepo(r.roster, id);
      if (!entry && !existing) { var err = new Error(tool.label + ' ' + id + ' isn’t in ' + dataFull); err.status = 404; throw err; }
      return (entry ? data.blob(entry.sha).then(function (t) { fileText = t; }) : Promise.resolve()).then(function () { return existing; });
    }).then(function (existing) {
      if (existing) return existing;
      // Create <prefix><slug>, or adopt it if an earlier, interrupted share made it.
      var base = tool.prefix + M.slugify(name).slice(0, 60);
      return self.account.ownerType(self.owner).then(function (type) {
        var isOrg = type === 'Organization';
        function attempt(n) {
          var rname = n === 1 ? base : base + '-' + n, full = self.full(rname);
          log('Creating private repository ' + full + '…');
          return self.account.createRepo(self.owner, rname, isOrg, 'Signoff: ' + name).then(function () {
            created = true;
            // A shared repo has no use for GitHub Actions; best effort.
            return self.account.disableActions(self.owner, rname).catch(function () { log('Couldn’t turn off GitHub Actions on ' + full + '; do it in the repo settings.'); });
          }).then(function () { return full; }).catch(function (err) {
            if (err.status !== 422 || n >= 9) throw err;
            return self.store(full).snapshot().then(function (snap) {
              var mineThere = snap.entries.some(function (e) { return e.path === path; });
              var empty = snap.entries.every(function (e) { return e.path === 'README.md' || e.type === 'tree'; });
              if (mineThere || empty) { log('Using existing ' + full); return full; }
              return attempt(n + 1);
            }, function () { return attempt(n + 1); });
          });
        }
        return attempt(1);
      });
    }).then(function (full) {
      repoFull = full;
      if (fileText == null) return;   // already moved: nothing to copy
      // A brand-new repository can take a moment before its first commit is readable.
      function put(tries) {
        var shared = self.store(repoFull);
        return shared.listTree(path).then(function (list) {
          if (list.some(function (e) { return e.path === path; })) { log(repoFull + ' already holds the file; left as is.'); return; }
          log('Copying ' + tool.label + ' into ' + repoFull + '…');
          return shared.putFiles([{ path: path, text: fileText }], { message: 'Signoff: share ' + name });
        }).catch(function (err) {
          if ((err.status === 409 || err.status === 404) && tries < 5) return wait(1200).then(function () { return put(tries + 1); });
          throw err;
        });
      }
      return put(1);
    }).then(function () {
      // Files stored next to the design go with it.
      return tool.files.reduce(function (chain, dir) {
        return chain.then(function (n) { return fileText == null ? n : self.moveDir(dataFull, repoFull, dir + id + '/', log).then(function (k) { return n + k; }); });
      }, Promise.resolve(0));
    }).then(function (moved) {
      // Record the move and the contractors, and delete the data repo's copy now that the shared
      // repo holds it (the shared repo was checked above).
      var touched = { users: logins, shared: [id] };
      return self.patchRoster(dataFull, touched, function (r) {
        var changed = false;
        var s = r.shared[id];
        if (!s || s.deleted || String(s.repo).toLowerCase() !== repoFull.toLowerCase()) { r.shared[id] = M.stamp({ id: id, repo: repoFull, name: name }, self.login); changed = true; }
        logins.forEach(function (l) {
          var u = r.users[l];
          if (u && !u.deleted && u.role === 'fte') return;   // an FTE is on everything already
          // A client stays a client and a contractor a contractor; someone new gets the role chosen
          // when they were added (self.roles), else contractor.
          var projects = (u && !u.deleted ? u.projects || [] : []).slice();
          if (projects.indexOf(id) >= 0 && u && !u.deleted) return;
          if (projects.indexOf(id) < 0) projects.push(id);
          // Fields this routine doesn't own (a PL scope, a company) stay as they are.
          var keep = u && !u.deleted ? u : {}, rec = { login: l, name: keep.name || self.names[l] || l, role: keep.role || self.roles[l] || 'contractor', projects: projects, deleted: false };
          if (!keep.company && self.companies[l]) rec.company = self.companies[l];
          r.users[l] = M.stamp(Object.assign({}, keep, rec), self.login);
          changed = true;
        });
        return changed;
      }, fileText == null ? [] : [{ path: path, remove: true, label: 'move ' + id }], 'Signoff: share ' + name + ' as ' + repoFull).then(function () { return moved; });
    }).then(function (moved) {
      return self.ftes(dataFull).then(function (ftes) {
        var people = ftes.concat(logins).filter(function (l, i, a) { return l && a.indexOf(l) === i && l !== self.login && l !== self.owner.toLowerCase(); });
        return self.inviteTo(repoFull, people, log).then(function (failed) { return { repo: repoFull, created: created, moved: moved, failedInvites: failed }; });
      });
    });
  };

  // The FTEs to invite to a new repo: Signoff EE's roster (the home of People) and the tool's own.
  Sharer.prototype.ftes = function (dataFull) {
    var self = this, repos = [dataFull];
    if (this.peopleRepo && this.full(this.peopleRepo) !== dataFull) repos.push(this.full(this.peopleRepo));
    return Promise.all(repos.map(function (r) { return self.rosterOf(r); })).then(function (rosters) {
      var out = [];
      rosters.forEach(function (r) {
        M.liveUsers(r || M.emptyRoster()).forEach(function (u) { if (u.role === 'fte' && out.indexOf(u.login) < 0) out.push(u.login); });
      });
      return out;
    });
  };

  Sharer.prototype.inviteTo = function (repoFull, logins, log) {
    var self = this, failed = [];
    log = log || function () {};
    return logins.reduce(function (chain, login) {
      return chain.then(function () {
        log('Inviting ' + login + ' to ' + repoFull + '…');
        return self.store(repoFull).invite(login).catch(function (err) { failed.push({ login: login, repo: repoFull, message: err.message, status: err.status }); });
      });
    }, Promise.resolve()).then(function () { return failed; });
  };
  Sharer.prototype.revokeFrom = function (repoFull, logins, log) {
    var self = this, failed = [];
    log = log || function () {};
    return logins.reduce(function (chain, login) {
      return chain.then(function () {
        log('Removing ' + login + ' from ' + repoFull + '…');
        return self.store(repoFull).revoke(login).catch(function (err) { failed.push({ login: login, repo: repoFull, message: err.message, status: err.status }); });
      });
    }, Promise.resolve()).then(function () { return failed; });
  };

  // ── A PL project and what it links ──
  // The things sharing a project touches, in order: the project, then each linked design once.
  // nameOf(tool, id) names a design (from the reader's index); a design PL can't name keeps its id.
  Sharer.prototype.items = function (doc, nameOf) {
    var self = this, out = [{ tool: 'pl', id: doc.id, name: doc.meta.name }], seen = {};
    S.pl.liveNodes(doc).forEach(function (n) {
      if (n.kind !== 'part' || !n.ref || !n.ref.tool || !n.ref.id) return;
      var key = n.ref.tool + ':' + n.ref.id;
      if (seen[key] || !self.toolDesc(n.ref.tool)) return;
      seen[key] = 1;
      out.push({ tool: n.ref.tool, id: n.ref.id, name: (nameOf && nameOf(n.ref.tool, n.ref.id)) || n.name || n.ref.id });
    });
    return out;
  };
  /* What sharing `doc` would do, read from the rosters: each item with its repo (if shared already)
     and the people on it, plus the people Signoff EE knows. Resolves
     { items: [{ tool, id, name, repo, people: [logins] }], people: [users], fte: [logins], errors }. */
  Sharer.prototype.plan = function (doc, nameOf) {
    var self = this, items = this.items(doc, nameOf), errors = [];
    var repos = {};
    items.forEach(function (it) { repos[self.full(self.toolDesc(it.tool).dataRepo)] = 1; });
    if (this.peopleRepo) repos[this.full(this.peopleRepo)] = 1;
    return Promise.all(Object.keys(repos).map(function (r) {
      return self.rosterOf(r).then(function (roster) { if (!roster) errors.push({ repo: r, message: 'Can’t open ' + r }); });
    })).then(function () {
      items.forEach(function (it) {
        var roster = self.rosters[self.full(self.toolDesc(it.tool).dataRepo)] || M.emptyRoster();
        it.repo = M.sharedRepo(roster, it.id);
        it.people = M.liveUsers(roster).filter(function (u) { return M.isOutside(u) && (u.projects || []).indexOf(it.id) >= 0; }).map(function (u) { return u.login; });
      });
      var ee = self.peopleRepo ? self.rosters[self.full(self.peopleRepo)] : null;
      var people = M.liveUsers(ee || M.emptyRoster());
      return { items: items, people: people, fte: people.filter(function (u) { return u.role === 'fte'; }).map(function (u) { return u.login; }), errors: errors };
    });
  };

  /* Share a PL project with `logins`: the project, then each linked design, each through shareOne.
     Resolves { results: [{ item, repo, created, error }], failedInvites }. One design failing doesn't
     stop the others; the project itself must succeed first. */
  Sharer.prototype.shareProject = function (doc, logins, nameOf, log) {
    var self = this, items = this.items(doc, nameOf), results = [], failed = [];
    log = log || function () {};
    return items.reduce(function (chain, it, i) {
      return chain.then(function () {
        var tool = self.toolDesc(it.tool);
        log((i ? 'Sharing ' : 'Sharing the project ') + it.name + ' (' + tool.label + ')…');
        return self.shareOne(tool, it.id, it.name, logins, log).then(function (res) {
          results.push({ item: it, repo: res.repo, created: res.created, moved: res.moved });
          failed = failed.concat(res.failedInvites);
          log('Shared as ' + res.repo, 'ok');
        }, function (err) {
          if (i === 0) throw err;
          results.push({ item: it, error: err.message, status: err.status });
          log('Couldn’t share ' + it.name + ': ' + err.message, 'err');
        });
      });
    }, Promise.resolve()).then(function () { return { results: results, failedInvites: failed }; });
  };

  /* Take `login` off one design of one tool (or the PL project itself, tool 'pl'): GitHub access to its
     repo (a pending invitation too) and the assignment in that tool's roster. Resolves { failed: [...] }. */
  Sharer.prototype.revokeOne = function (toolId, id, name, login, log) {
    var self = this, tool = this.toolDesc(toolId), failed = [];
    login = String(login).toLowerCase();
    log = log || function () {};
    if (!tool) return Promise.resolve({ failed: failed });
    var dataFull = this.full(tool.dataRepo);
    return this.whoAmI().then(function () { return self.rosterOf(dataFull); }).then(function (roster) {
      var repo = M.sharedRepo(roster || M.emptyRoster(), id);
      if (!repo) return;
      return self.revokeFrom(repo, [login], log).then(function (f) { failed = failed.concat(f); })
        .then(function () {
          return self.patchRoster(dataFull, { users: [login], shared: [] }, function (r) {
            var u = r.users[login];
            if (!M.isOutside(u) || (u.projects || []).indexOf(id) < 0) return false;
            r.users[login] = M.stamp(Object.assign({}, u, { projects: u.projects.filter(function (x) { return x !== id; }) }), self.login);
            return true;
          }, [], 'Signoff: remove ' + login + ' from ' + name);
        }).catch(function (err) { failed.push({ login: login, repo: dataFull, message: err.message, status: err.status }); });
    }).then(function () { return { failed: failed }; });
  };

  /* Take `login` off a PL project: GitHub access to the project's repo and the repos of everything it
     links, and the contractor's assignment in each roster. Resolves { failed: [...] }. */
  Sharer.prototype.revokeProject = function (doc, login, nameOf, log) {
    var self = this, items = this.items(doc, nameOf), failed = [];
    return items.reduce(function (chain, it) {
      return chain.then(function () {
        return self.revokeOne(it.tool, it.id, it.name, login, log).then(function (r) { failed = failed.concat(r.failed); });
      });
    }, Promise.resolve()).then(function () { return { failed: failed }; });
  };

  /* A person's record in PL's own roster (signoff_pl_data/users.json), for what only PL keeps:
     - scopes[projectId] = 'project': on that PL project with only the Parts ticked; no entry means the
       whole system (the project and everything it links, now and later);
     - company: the client's company, for grouping clients.
     `fn(user)` returns the changed fields, or null for no change. Someone PL's roster doesn't know yet
     gets a record (role from `role`, no projects), so a company can be kept for anyone. */
  Sharer.prototype.patchPlUser = function (login, role, fn, message) {
    var self = this, dataFull = this.full(this.pl.dataRepo);
    login = String(login).toLowerCase();
    return this.whoAmI().then(function () {
      return self.patchRoster(dataFull, { users: [login], shared: [] }, function (r) {
        var u = r.users[login] && !r.users[login].deleted ? r.users[login] : null;
        if (u && u.role === 'fte') return false;
        var base = u || { login: login, name: self.names[login] || login, role: role || self.roles[login] || 'contractor', projects: [], deleted: false };
        var change = fn(base);
        if (!change) return false;
        var next = Object.assign({}, base, change);
        Object.keys(next).forEach(function (k) { if (next[k] === undefined) delete next[k]; });
        r.users[login] = M.stamp(next, self.login);
        return true;
      }, [], message);
    });
  };
  Sharer.prototype.setScope = function (projectId, login, scope) {
    return this.patchPlUser(login, '', function (u) {
      var cur = (u.scopes && u.scopes[projectId]) || '';
      if (cur === (scope || '')) return null;
      var scopes = Object.assign({}, u.scopes || {});
      if (scope) scopes[projectId] = scope; else delete scopes[projectId];
      return { scopes: Object.keys(scopes).length ? scopes : undefined };
    }, 'Signoff PL: ' + login + (scope ? ' on chosen Parts of ' : ' on the whole of ') + projectId);
  };
  Sharer.prototype.setCompany = function (login, company, role) {
    company = String(company || '').trim();
    return this.patchPlUser(login, role, function (u) {
      if ((u.company || '') === company) return null;
      return { company: company || undefined };
    }, 'Signoff PL: company of ' + login);
  };

  // ── PL's sync across its repositories ──
  /* state: { login, projects: { id: doc }, roster, homes: { id: 'owner/repo' }, caches: { 'owner/repo':
     cache }, dataAccess: 'ok' | 'none' | '' }. opts: { merge, message, onRetry, keepLocal(id) }.
     Resolves { state, errors, pushed, gone, dropped, repos: [full] }. The data repo first (FTEs), then
     the shared repos: from the shared map for an FTE, listed by prefix for anyone else. A copy whose
     repo a contractor can no longer reach is dropped unless it has unsynced edits. */
  Sharer.prototype.syncAll = function (state0, opts) {
    var self = this, st = {
      login: state0.login || '', dataAccess: state0.dataAccess || '', roster: state0.roster || M.emptyRoster(),
      projects: Object.assign({}, state0.projects), homes: Object.assign({}, state0.homes), caches: Object.assign({}, state0.caches)
    };
    opts = opts || {};
    var dataFull = this.full(this.pl.dataRepo), errors = [], out = { pushed: 0, gone: [], dropped: [], repos: [] };
    var keep = opts.keepLocal || function () { return false; };
    function homeOf(id) { return M.sharedRepo(st.roster, id) || st.homes[id] || dataFull; }
    function subset(repoFull) {
      var o = {};
      Object.keys(st.projects).forEach(function (id) { if (homeOf(id).toLowerCase() === repoFull.toLowerCase()) o[id] = st.projects[id]; });
      return o;
    }
    function absorb(res, repoFull) {
      Object.keys(res.projects).forEach(function (id) { st.projects[id] = res.projects[id]; st.homes[id] = repoFull; });
      st.caches[repoFull] = res.cache;
      out.pushed += res.pushed;
      (res.gone || []).forEach(function (id) { delete st.projects[id]; delete st.homes[id]; if (out.gone.indexOf(id) < 0) out.gone.push(id); });
    }
    function drop(id) { out.dropped.push(id); delete st.projects[id]; delete st.homes[id]; }
    var store = function (full) { return self.store(full, { merge: opts.merge }); };
    return this.whoAmI().then(function (login) {
      st.login = login;
      return store(dataFull).sync(subset(dataFull), st.roster, st.caches[dataFull], {
        roster: true, deleteStrays: true, dropGone: true, keepLocal: keep, message: opts.message, onRetry: opts.onRetry,
        belongsHere: function (id, r) { return !M.sharedRepo(r, id); }
      }).then(function (res) {
        st.dataAccess = 'ok';
        st.roster = res.roster;
        absorb(res, dataFull);
        res.moved.forEach(function (id) { st.homes[id] = M.sharedRepo(st.roster, id); });
      }, function (err) {
        if (!denied(err)) throw err;
        // The owner, or a token that opened the data repo before: a settings problem, not a contractor.
        if (st.login === self.owner.toLowerCase() || st.dataAccess === 'ok') throw err;
        st.dataAccess = 'none';
        st.roster = M.emptyRoster();
      });
    }).then(function () {
      if (st.dataAccess === 'ok') {
        var repos = {};
        Object.keys(st.roster.shared || {}).forEach(function (id) { var r = M.sharedRepo(st.roster, id); if (r) repos[r] = 1; });
        return Object.keys(repos);
      }
      return self.account.listRepos(self.owner, self.pl.prefix).then(function (names) {
        var reachable = names.map(function (n) { return self.full(n); });
        Object.keys(st.projects).forEach(function (id) {
          var h = st.homes[id];
          if (reachable.indexOf(h) < 0 && !keep(id)) drop(id);
        });
        return reachable;
      });
    }).then(function (repos) {
      out.repos = repos;
      return repos.reduce(function (chain, repoFull) {
        return chain.then(function () {
          var mine = st.dataAccess === 'ok' ? function (id) { return M.sharedRepo(st.roster, id).toLowerCase() === repoFull.toLowerCase(); } : undefined;
          return store(repoFull).sync(subset(repoFull), null, st.caches[repoFull], { message: opts.message, onRetry: opts.onRetry, belongsHere: mine, dropGone: true, keepLocal: keep })
            .then(function (res) { absorb(res, repoFull); })
            .catch(function (err) {
              if (denied(err) && st.dataAccess !== 'ok') Object.keys(subset(repoFull)).forEach(function (id) { if (!keep(id)) drop(id); });
              else errors.push({ repo: repoFull, message: denied(err) ? 'No access to ' + repoFull + ' yet. The repo owner needs to invite you.' : repoFull + ': ' + err.message });
            });
        });
      }, Promise.resolve());
    }).then(function () {
      // Forget caches of repos nothing here uses any more.
      var used = {};
      used[dataFull] = 1;
      Object.keys(st.homes).forEach(function (id) { used[st.homes[id]] = 1; });
      out.repos.forEach(function (r) { used[r] = 1; });
      Object.keys(st.caches).forEach(function (r) { if (!used[r]) delete st.caches[r]; });
      out.state = st; out.errors = errors;
      return out;
    });
  };

  S.PLSharer = Sharer;
  S.plShare = { normalizeRoster: normalize };
})(window.Signoff = window.Signoff || {});
