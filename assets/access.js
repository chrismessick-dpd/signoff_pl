/* Signoff PL: People & access, the model (no DOM). Chris, 2026-11-07; the views are access-view.js.

   PL's people list is the whole company: everyone on any tool's roster (users.json in signoff_pl_data,
   ee_design_review_data, me_design_review_data, fw_design_review_data, and loom_data). Each tool keeps
   managing its own people on its own People page; PL can set access in all of them.

   Per person per PL project, one of three modes:
     system   Whole system: on the PL project, and every Part it links, now and later (no scope entry)
     project  PL + chosen Parts: on the PL project, plus only the Parts ticked (PL roster
              users[login].scopes[projectId] = 'project')
     parts    Parts only: not on the PL project; only the reviews ticked, in each tool's roster
   Access to a Part is the tool roster's users[login].projects holding the design id, as EE and ME
   already record it. FTEs come from Signoff EE's roster and see everything. Purchased Parts, and Parts
   with no Signoff tool, have nothing to share and aren't listed.

   `base` is what the rosters say now; `draft` is what the page shows. Nothing is written until Apply,
   and plan() lists exactly what Apply would do. A Whole-system person missing a Part linked since the
   project was shared shows as staged on load (`gap`), so it's obvious nothing has happened yet. */
(function (S) {
  'use strict';
  var M = S.model, P = S.pl;
  var ORDER = ['pl', 'ee', 'me', 'fw', 'loom'];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* opts: { docs: [PL project], rosters: { pl, ee, me, fw, loom } (normalized rosters, or null when
     unreadable), tools: config.tools, pl: { dataRepo, prefix }, owner, nameOf(tool, id),
     invites: { 'owner/repo': [logins] } (pending GitHub invitations) } */
  function Access(opts) {
    this.opts = opts;
    var self = this;
    this.tools = { pl: { id: 'pl', label: 'PL', name: 'Signoff PL', prefix: opts.pl.prefix, dataRepo: opts.pl.dataRepo } };
    (opts.tools || []).forEach(function (t) {
      if (t.prefix) self.tools[t.id] = { id: t.id, label: t.short || t.id, name: t.name || t.id, prefix: t.prefix, dataRepo: t.dataRepo };
    });
    this.rosters = {};
    ORDER.forEach(function (k) { if (self.tools[k]) self.rosters[k] = opts.rosters[k] || null; });
    this.invites = opts.invites || {};
    this.buildPeople();
    this.buildProjects();
    this.base = this.grantsFromRosters();
    this.draft = clone(this.base);
    this.added = {};
    this.applied = null;
  }

  Access.prototype.roster = function (tool) { return this.rosters[tool] || M.emptyRoster(); };
  Access.prototype.full = function (name) { return this.opts.owner + '/' + name; };

  // ── People: the union of every roster ──
  Access.prototype.buildPeople = function () {
    var self = this, byLogin = {};
    ORDER.forEach(function (tool) {
      if (!self.rosters[tool]) return;
      M.liveUsers(self.rosters[tool]).forEach(function (u) {
        var l = String(u.login || '').toLowerCase();
        if (!l) return;
        var p = byLogin[l] || (byLogin[l] = { login: l, name: '', role: '', roles: {}, company: '', lists: [] });
        if (!p.name && u.name && u.name !== l) p.name = u.name;
        if (p.lists.indexOf(tool) < 0) p.lists.push(tool);
        p.roles[u.role] = 1;
        if (tool === 'ee') p.role = u.role;
        if (tool === 'pl' && u.company) p.company = u.company;
      });
    });
    // FTE status is Signoff EE's (the home of FTEs); without an EE record, any roster's word counts.
    Object.keys(byLogin).forEach(function (l) {
      var p = byLogin[l];
      if (!p.role) p.role = p.roles.fte ? 'fte' : p.roles.client ? 'client' : 'contractor';
      if (p.role !== 'fte' && p.role !== 'client') p.role = 'contractor';
      if (!p.name) p.name = l;
      delete p.roles;
    });
    this.people = Object.keys(byLogin).map(function (l) { return byLogin[l]; });
    this.sortPeople();
  };
  Access.prototype.sortPeople = function () {
    var rank = { fte: 0, client: 1, contractor: 2 };
    this.people.sort(function (a, b) { return (rank[a.role] - rank[b.role]) || a.name.localeCompare(b.name); });
  };
  Access.prototype.person = function (login) { return this.people.filter(function (p) { return p.login === login; })[0] || null; };
  Access.prototype.isFte = function (login) { var p = this.person(login); return !!p && p.role === 'fte'; };

  // ── Projects: each PL project's tree, keeping only what can be shared ──
  Access.prototype.buildProjects = function () {
    var self = this, nameOf = this.opts.nameOf || function () { return ''; };
    this.items = {};       // 'tool:id' -> { tool, id, name, repo, future }
    this.nodes = {};       // node id -> node, for every project
    this.projects = (this.opts.docs || []).filter(function (d) { return d && !d.meta.deleted && !d.meta.archived; }).map(function (doc) {
      var t = P.tree(doc);
      var proj = { id: doc.id, kind: 'project', tool: 'pl', key: 'pl:' + doc.id, name: doc.meta.name, client: doc.meta.client || '', doc: doc, kids: [] };
      self.item('pl', doc.id, doc.meta.name);
      function build(id, parent) {
        var n = t.nodes[id];
        if (n.kind === 'assembly') {
          var kids = (t.children[id] || []).map(function (k) { return build(k, id); }).filter(Boolean);
          if (!kids.length) return null;
          var a = { id: n.id, kind: 'asm', name: n.name || 'Assembly', kids: kids, project: doc.id };
          self.nodes[a.id] = a; kids.forEach(function (k) { k.parent = a.id; });
          return a;
        }
        if (!n.ref || !n.ref.tool || !n.ref.id || !self.tools[n.ref.tool] || n.ref.tool === 'pl') return null;
        var nm = nameOf(n.ref.tool, n.ref.id) || n.name || n.ref.id;
        self.item(n.ref.tool, n.ref.id, nm);
        var part = { id: n.id, kind: 'part', tool: n.ref.tool, key: n.ref.tool + ':' + n.ref.id, name: n.name || nm, project: doc.id };
        self.nodes[part.id] = part;
        return part;
      }
      proj.kids = t.roots.map(function (r) { return build(r, ''); }).filter(Boolean);
      // A single top assembly named for the product is the product: show its children directly.
      if (proj.kids.length === 1 && proj.kids[0].kind === 'asm' && proj.kids[0].name === doc.meta.name) proj.kids = proj.kids[0].kids;
      proj.kids.forEach(function (k) { k.parent = proj.id; });
      self.nodes[proj.id] = proj;
      return proj;
    });
  };
  Access.prototype.item = function (tool, id, name) {
    var key = tool + ':' + id;
    if (this.items[key]) return this.items[key];
    var t = this.tools[tool], repo = M.sharedRepo(this.roster(tool), id);
    return (this.items[key] = { key: key, tool: tool, id: id, name: name, repo: repo, data: this.full(t.dataRepo), future: this.full(t.prefix + M.slugify(name || id).slice(0, 60)) });
  };
  Access.prototype.project = function (id) { return this.projects.filter(function (p) { return p.id === id; })[0] || null; };
  function leaves(n) { return n.kind === 'part' ? [n] : (n.kids || []).reduce(function (a, k) { return a.concat(leaves(k)); }, []); }
  Access.prototype.leaves = function (n) { return leaves(n); };
  Access.prototype.keysOf = function (projectId) {
    var p = this.project(projectId), seen = {};
    return p ? leaves(p).map(function (x) { return x.key; }).filter(function (k) { return !seen[k] && (seen[k] = 1); }) : [];
  };

  // ── Grants: { login: { pl: { projectId: 1 }, items: { key: 1 }, scopes: { projectId: 'project' }, company } } ──
  Access.prototype.grantsFromRosters = function () {
    var self = this, g = {};
    ORDER.forEach(function (tool) {
      var r = self.rosters[tool];
      if (!r) return;
      M.liveUsers(r).forEach(function (u) {
        if (!M.isOutside(u)) return;
        var l = u.login.toLowerCase(), e = g[l] || (g[l] = { pl: {}, items: {}, scopes: {}, company: '' });
        (u.projects || []).forEach(function (id) { if (tool === 'pl') e.pl[id] = 1; else e.items[tool + ':' + id] = 1; });
        if (tool === 'pl') { e.scopes = Object.assign({}, u.scopes || {}); e.company = u.company || ''; }
      });
    });
    return g;
  };
  function entry(store, login) { return store[login] || (store[login] = { pl: {}, items: {}, scopes: {}, company: '' }); }
  function peek(store, login) { return store[login] || { pl: {}, items: {}, scopes: {}, company: '' }; }
  Access.prototype.mode = function (projectId, login, which) {
    if (this.isFte(login)) return 'fte';
    var e = peek(which === 'base' ? this.base : this.draft, login);
    return e.pl[projectId] ? (e.scopes[projectId] === 'project' ? 'project' : 'system') : 'parts';
  };
  // Does `login` hold `key` in a store? In the draft, Whole system on any project linking it counts.
  Access.prototype.holds = function (which, login, key) {
    var self = this, store = which === 'base' ? this.base : this.draft, e = peek(store, login);
    if (which !== 'base' && this.unreadable(key)) return this.holds('base', login, key);
    if (key.indexOf('pl:') === 0) return !!e.pl[key.slice(3)];
    if (e.items[key]) return true;
    if (which === 'base') return false;
    return this.projects.some(function (p) { return e.pl[p.id] && e.scopes[p.id] !== 'project' && self.keysOf(p.id).indexOf(key) >= 0; });
  };
  // The Parts of a project someone keeps when they leave Whole system or the PL project: what the
  // rosters say they hold, plus what's ticked for them in the page.
  Access.prototype.kept = function (projectId, login) {
    var self = this, e = peek(this.draft, login);
    return this.keysOf(projectId).filter(function (k) { return self.holds('base', login, k) || e.items[k]; });
  };
  // A tool whose people list couldn't be read: its Parts can't be changed from here (nothing is staged).
  Access.prototype.unreadable = function (key) { var it = this.items[key]; return !!it && !this.rosters[it.tool]; };
  Access.prototype.pending = function (login, key) {
    var it = this.items[key];
    return !!(it && it.repo && (this.invites[it.repo] || []).indexOf(login) >= 0);
  };

  /* One cell. s: fte, yes, pending, new (Apply creates the repo), add (Apply invites), remove, none;
     assemblies: all, some, none, na (no shareable Parts). inherited: from Whole system. gap: the person
     has Whole system and this Part was linked since. */
  Access.prototype.cell = function (projectId, login, node) {
    if (this.isFte(login)) return { s: 'fte' };
    var self = this;
    if (node.kind === 'asm') {
      var ls = leaves(node);
      if (!ls.length) return { s: 'na' };
      var k = ls.filter(function (x) { return self.holds('draft', login, x.key); }).length;
      return { s: k === ls.length ? 'all' : k ? 'some' : 'none', n: k, of: ls.length, inherited: this.mode(projectId, login) === 'system' };
    }
    var key = node.key, it = this.items[key];
    var now = this.holds('draft', login, key), was = this.holds('base', login, key);
    var inherited = node.kind === 'part' && this.mode(projectId, login) === 'system';
    if (now && was) return { s: this.pending(login, key) ? 'pending' : 'yes', inherited: inherited };
    if (now) return { s: it && it.repo ? 'add' : 'new', inherited: inherited, gap: inherited && this.mode(projectId, login, 'base') === 'system' };
    if (was) return { s: 'remove' };
    return { s: 'none', unshared: !(it && it.repo) };
  };
  Access.prototype.granted = function (st) { return /^(fte|yes|pending|new|add|all)$/.test(st.s); };

  // People with anything to do with a project, plus FTEs.
  Access.prototype.members = function (projectId) {
    var self = this, keys = ['pl:' + projectId].concat(this.keysOf(projectId));
    return this.people.filter(function (p) {
      if (p.role === 'fte') return true;
      return keys.some(function (k) { return self.holds('draft', p.login, k) || self.holds('base', p.login, k); });
    });
  };

  // ── Edits (draft only) ──
  Access.prototype.setMode = function (projectId, login, mode) {
    if (this.isFte(login)) return;
    var e = entry(this.draft, login), was = this.mode(projectId, login), self = this;
    if (was === 'system' && mode !== 'system') {
      // Leaving Whole system keeps what they really hold, ticked: nothing goes silently, and a Part
      // linked since sharing that they never had isn't granted by the switch.
      this.kept(projectId, login).forEach(function (k) { e.items[k] = 1; });
    }
    if (mode === 'parts') { delete e.pl[projectId]; delete e.scopes[projectId]; }
    else {
      e.pl[projectId] = 1;
      if (mode === 'project') e.scopes[projectId] = 'project'; else delete e.scopes[projectId];
    }
    void self;
  };
  Access.prototype.grant = function (projectId, login, node, on) {
    if (this.isFte(login)) return;
    if (node.kind === 'project') { this.setMode(projectId, login, on ? (this.mode(projectId, login) === 'parts' ? 'project' : this.mode(projectId, login)) : 'parts'); return; }
    var e = entry(this.draft, login), ls = leaves(node);
    if (!ls.length) return;
    if (!on && this.mode(projectId, login) === 'system') this.setMode(projectId, login, 'project');
    ls.forEach(function (x) { if (on) e.items[x.key] = 1; else delete e.items[x.key]; });
  };
  Access.prototype.toggle = function (projectId, login, node) {
    var st = this.cell(projectId, login, node);
    if (node.kind === 'project') { this.setMode(projectId, login, this.mode(projectId, login) === 'system' ? 'project' : 'system'); return; }
    this.grant(projectId, login, node, !(st.s === 'all' || (node.kind !== 'asm' && this.granted(st))));
  };
  // Off a PL project: the PL project only (keeping their Parts), or the project and its Parts.
  Access.prototype.removeFrom = function (projectId, login, withParts) {
    var e = entry(this.draft, login);
    if (withParts) this.keysOf(projectId).forEach(function (k) { delete e.items[k]; });
    else this.kept(projectId, login).forEach(function (k) { e.items[k] = 1; });
    delete e.pl[projectId]; delete e.scopes[projectId];
  };
  Access.prototype.setCompany = function (login, company) { entry(this.draft, login).company = String(company || '').trim(); };
  Access.prototype.company = function (login) { var p = this.person(login); return p && p.role === 'client' ? peek(this.draft, login).company || '' : ''; };
  // Someone not on any roster yet: shown at once; written only when Apply gives them something.
  Access.prototype.addPerson = function (p) {
    var l = String(p.login || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(l)) throw new Error('Enter their GitHub username');
    if (this.person(l)) return this.person(l);
    var rec = { login: l, name: String(p.name || '').trim() || l, role: p.role === 'client' ? 'client' : 'contractor', company: '', lists: [], added: true };
    this.people.push(rec); this.sortPeople();
    this.added[l] = rec;
    if (rec.role === 'client' && p.company) this.setCompany(l, p.company);
    return rec;
  };
  Access.prototype.discard = function () {
    var self = this;
    this.draft = clone(this.base);
    Object.keys(this.added).forEach(function (l) { self.people = self.people.filter(function (p) { return p.login !== l; }); });
    this.added = {};
  };

  /* What Apply would do, in the order it runs:
       share   { tool, id, name, logins, create }    shareOne: creates the repo if needed, records, invites
       remove  { tool, id, name, login }              revokeOne
       scope   { project, name, login, scope }        PL roster scopes
       company { login, company }                     PL roster company
     PL projects go first, so someone is on the project before its Parts. */
  Access.prototype.plan = function () {
    var self = this, shares = {}, removes = [], scopes = [], companies = [];
    var keys = Object.keys(this.items).sort(function (a, b) { return (a.indexOf('pl:') === 0 ? 0 : 1) - (b.indexOf('pl:') === 0 ? 0 : 1); });
    this.people.forEach(function (p) {
      if (p.role === 'fte') return;
      keys.forEach(function (k) {
        var now = self.holds('draft', p.login, k), was = self.holds('base', p.login, k), it = self.items[k];
        if (now && !was) (shares[k] = shares[k] || { k: 'share', tool: it.tool, id: it.id, name: it.name, logins: [], create: !it.repo, repo: it.repo || it.future }).logins.push(p.login);
        if (!now && was) removes.push({ k: 'remove', tool: it.tool, id: it.id, name: it.name, login: p.login, repo: it.repo || it.data });
      });
      self.projects.forEach(function (pr) {
        var now = self.mode(pr.id, p.login), was = self.mode(pr.id, p.login, 'base');
        var sNow = now === 'project' ? 'project' : '', sWas = peek(self.base, p.login).scopes[pr.id] || '';
        if (now !== 'parts' && sNow !== sWas) scopes.push({ k: 'scope', project: pr.id, name: pr.name, login: p.login, scope: sNow });
        else if (now === 'parts' && sWas) scopes.push({ k: 'scope', project: pr.id, name: pr.name, login: p.login, scope: '' });
        void was;
      });
      if (p.role === 'client' && (peek(self.draft, p.login).company || '') !== (peek(self.base, p.login).company || '')) companies.push({ k: 'company', login: p.login, company: peek(self.draft, p.login).company || '' });
    });
    return keys.filter(function (k) { return shares[k]; }).map(function (k) { return shares[k]; }).concat(removes, scopes, companies);
  };
  // The plan as rows to show: one per repo to create, invitations per repo, removals, roster writes.
  Access.prototype.planRows = function (ops) {
    var self = this, rows = [], rosterRows = {};
    function roster(tool, text) { var key = self.tools[tool].label + ' users.json'; (rosterRows[key] = rosterRows[key] || []).push(text); }
    (ops || this.plan()).forEach(function (o) {
      if (o.k === 'share') {
        var short = o.repo.split('/')[1];
        if (o.create) rows.push({ k: 'create', repo: short, text: 'Create private repo', detail: 'moves ' + o.name + ' out of ' + self.items[o.tool + ':' + o.id].data.split('/')[1] + '; FTEs invited' });
        rows.push({ k: 'invite', repo: short, text: 'Invite ' + o.logins.join(', ') });
        o.logins.forEach(function (l) { roster(o.tool, l + ' + ' + o.name); });
      } else if (o.k === 'remove') {
        rows.push({ k: 'remove', repo: o.repo.split('/')[1], text: 'Remove ' + o.login });
        roster(o.tool, o.login + ' − ' + o.name);
      } else if (o.k === 'scope') {
        roster('pl', o.login + (o.scope ? ': chosen Parts of ' : ': whole of ') + o.name);
      } else if (o.k === 'company') {
        roster('pl', o.login + ': company ' + (o.company ? '“' + o.company + '”' : 'cleared'));
      }
    });
    Object.keys(rosterRows).forEach(function (r) { rows.push({ k: 'roster', repo: r, text: rosterRows[r].join('; ') }); });
    return rows;
  };

  /* Apply with a PLSharer (live). log(text, cls). Resolves { failed: [{ op, message }] }. Each step is
     safe to repeat, so a failure leaves the rest to a second Apply. */
  Access.prototype.run = function (sh, ops, log) {
    var self = this, failed = [];
    log = log || function () {};
    ops.forEach(function (o) {
      (o.logins || [o.login]).forEach(function (l) {
        var p = self.person(l);
        if (!p) return;
        if (p.name && p.name !== l) sh.names[l] = p.name;
        sh.roles[l] = p.role === 'client' ? 'client' : 'contractor';
        var c = peek(self.draft, l).company; if (c) sh.companies[l] = c;
      });
    });
    return ops.reduce(function (chain, o) {
      return chain.then(function () {
        var step;
        if (o.k === 'share') { log('Sharing ' + o.name + ' with ' + o.logins.join(', ') + '…'); step = sh.shareOne(sh.toolDesc(o.tool), o.id, o.name, o.logins, log).then(function (res) { (res.failedInvites || []).forEach(function (f) { failed.push({ op: o, message: f.login + ' on ' + f.repo + ': ' + f.message }); }); }); }
        else if (o.k === 'remove') { log('Removing ' + o.login + ' from ' + o.name + '…'); step = sh.revokeOne(o.tool, o.id, o.name, o.login, log).then(function (res) { res.failed.forEach(function (f) { failed.push({ op: o, message: f.login + ' on ' + f.repo + ': ' + f.message }); }); }); }
        else if (o.k === 'scope') { log((o.scope ? 'Chosen Parts' : 'Whole system') + ' for ' + o.login + ' on ' + o.name + '…'); step = sh.setScope(o.project, o.login, o.scope); }
        else if (o.k === 'company') { log('Company for ' + o.login + '…'); step = sh.setCompany(o.login, o.company, 'client'); }
        return step.catch(function (err) { failed.push({ op: o, message: err.message, status: err.status }); log('Couldn’t: ' + err.message, 'err'); });
      });
    }, Promise.resolve()).then(function () { return { failed: failed }; });
  };

  /* The demo's Apply: the same ops applied to the in-memory rosters (as shareOne and revokeOne would
     record them), returning the rosters to rebuild from. New invitations wait as pending. */
  Access.prototype.simulate = function (ops) {
    var self = this, rosters = clone(this.rosters), invites = clone(this.invites), who = 'demo';
    function user(tool, l) {
      var r = rosters[tool] || (rosters[tool] = M.emptyRoster()), p = self.person(l) || { name: l, role: 'contractor' };
      return r.users[l] && !r.users[l].deleted ? r.users[l] : (r.users[l] = { login: l, name: p.name, role: p.role === 'client' ? 'client' : 'contractor', projects: [], deleted: false });
    }
    ops.forEach(function (o) {
      if (o.k === 'share') {
        var r = rosters[o.tool] || (rosters[o.tool] = M.emptyRoster());
        if (!M.sharedRepo(r, o.id)) r.shared[o.id] = M.stamp({ id: o.id, repo: o.repo, name: o.name }, who);
        o.logins.forEach(function (l) {
          var u = user(o.tool, l);
          if (u.projects.indexOf(o.id) < 0) u.projects = u.projects.concat([o.id]);
          var c = peek(self.draft, l).company; if (c && !u.company && o.tool === 'pl') u.company = c;
          (invites[o.repo] = invites[o.repo] || []).push(l);
        });
      } else if (o.k === 'remove') {
        var ru = rosters[o.tool] && rosters[o.tool].users[o.login];
        if (ru) ru.projects = ru.projects.filter(function (x) { return x !== o.id; });
        if (invites[o.repo]) invites[o.repo] = invites[o.repo].filter(function (x) { return x !== o.login; });
      } else if (o.k === 'scope') {
        var su = user('pl', o.login), sc = Object.assign({}, su.scopes || {});
        if (o.scope) sc[o.project] = o.scope; else delete sc[o.project];
        if (Object.keys(sc).length) su.scopes = sc; else delete su.scopes;
      } else if (o.k === 'company') {
        var cu = user('pl', o.login);
        if (o.company) cu.company = o.company; else delete cu.company;
      }
    });
    return { rosters: rosters, invites: invites };
  };

  /* The demo's rosters: the Smart Thermostat story. Two FTEs; Acme Climate's clients (a program manager
     on the whole system, a quality engineer on the Enclosure, a firmware lead on PL + firmware) and one
     from another company with nothing yet; contractors on some boards. The Wall Bracket was linked after
     the project was shared, so it's in no repo yet and the whole-system client's access to it is staged. */
  function demoRosters(owner) {
    var at = '2026-11-01T09:00:00.000Z';
    function u(login, name, role, projects, extra) { return Object.assign({ login: login, name: name, role: role, projects: projects, deleted: false, updatedAt: at, updatedBy: 'demo' }, extra || {}); }
    function sh(id, slug, name) { return { id: id, repo: owner + '/' + slug, name: name, updatedAt: at, updatedBy: 'demo' }; }
    function roster(users, shared) {
      var r = { schema: 1, users: {}, shared: {} };
      users.forEach(function (x) { r.users[x.login] = x; });
      shared.forEach(function (x) { r.shared[x.id] = x; });
      return r;
    }
    return {
      rosters: {
        pl: roster([
          u('morgan-hale', 'Morgan Hale', 'client', ['pldemo'], { company: 'Acme Climate' }),
          u('lee-wong', 'Lee Wong', 'client', ['pldemo'], { company: 'Acme Climate', scopes: { pldemo: 'project' } }),
          u('dana-ortiz', 'Dana Ortiz', 'client', [], { company: 'Acme Climate' }),
          u('ari-shah', 'Ari Shah', 'client', [], { company: 'Northwind Retail' }),
          u('alex-kim', 'Alex Kim', 'contractor', ['pldemo'], { scopes: { pldemo: 'project' } }),
          u('casey-wu', 'Casey Wu', 'contractor', ['pldemo'], { scopes: { pldemo: 'project' } })
        ], [sh('pldemo', 'review-pl-smart-thermostat', 'Smart Thermostat')]),
        ee: roster([
          u('sam-rivera', 'Sam Rivera', 'fte', []), u('priya-nair', 'Priya Nair', 'fte', []),
          u('morgan-hale', 'Morgan Hale', 'client', ['pdemo7', 'pdemo11']),
          u('jordan-lee', 'Jordan Lee', 'contractor', ['pdemo7', 'pdemo11'])
        ], [sh('pdemo7', 'review-ee-main-pcba', 'Main PCBA'), sh('pdemo11', 'review-ee-display-sensor-board', 'Display & Sensor Board')]),
        me: roster([
          u('morgan-hale', 'Morgan Hale', 'client', ['mdemo5']),
          u('dana-ortiz', 'Dana Ortiz', 'client', ['mdemo5']),
          u('alex-kim', 'Alex Kim', 'contractor', ['mdemo5']),
          u('riley-park', 'Riley Park', 'contractor', [])
        ], [sh('mdemo5', 'review-me-enclosure', 'Enclosure')]),
        fw: roster([
          u('morgan-hale', 'Morgan Hale', 'client', ['fdemo3']),
          u('lee-wong', 'Lee Wong', 'client', ['fdemo3']),
          u('casey-wu', 'Casey Wu', 'contractor', ['fdemo3'])
        ], [sh('fdemo3', 'review-fw-thermostat-firmware', 'Thermostat Firmware')]),
        loom: roster([], [])
      },
      invites: (function () {
        var o = {};
        o[owner + '/review-ee-display-sensor-board'] = ['jordan-lee'];
        o[owner + '/review-fw-thermostat-firmware'] = ['casey-wu'];
        o[owner + '/review-pl-smart-thermostat'] = ['casey-wu'];
        return o;
      })()
    };
  }

  /* Read everything the view needs, live: each tool's roster (a tool whose data repo this token can't
     open is left out, and named in `errors`), then pending invitations on every shared repo that has
     outside people. Resolves { rosters, invites, errors }. */
  function load(sh) {
    var rosters = {}, errors = [], tools = ['pl'].concat((sh.tools || []).filter(function (t) { return t.prefix; }).map(function (t) { return t.id; }));
    sh.rosters = {};   // always read fresh
    return Promise.all(tools.map(function (id) {
      var d = sh.toolDesc(id);
      if (!d) return null;
      return sh.rosterOf(sh.full(d.dataRepo)).then(function (r) {
        rosters[id] = r;
        if (!r) errors.push('Can’t open ' + sh.full(d.dataRepo));
      }, function (err) { rosters[id] = null; errors.push(sh.full(d.dataRepo) + ': ' + err.message); });
    })).then(function () {
      var repos = {};
      Object.keys(rosters).forEach(function (id) {
        var r = rosters[id]; if (!r) return;
        var outside = M.liveUsers(r).filter(M.isOutside);
        Object.keys(r.shared || {}).forEach(function (sid) {
          var repo = M.sharedRepo(r, sid);
          if (repo && outside.some(function (u) { return (u.projects || []).indexOf(sid) >= 0; })) repos[repo] = 1;
        });
      });
      var invites = {};
      return Promise.all(Object.keys(repos).map(function (full) {
        return sh.store(full).invitations().then(function (list) { invites[full] = list.map(function (i) { return i.login; }); }, function () { /* no admin rights: invitations unknown */ });
      })).then(function () { return { rosters: rosters, invites: invites, errors: errors }; });
    });
  }

  S.PLAccess = Access;
  S.plAccess = { demoRosters: demoRosters, load: load, ORDER: ORDER };
})(window.Signoff = window.Signoff || {});
