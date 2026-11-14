/* Signoff PL app: state, storage, rendering, and interaction.
   PL projects sync to the PL data repo through the Signoff engine's GitHubStore with PL's own
   merge (pl.js). The design reviews Parts link to are read (reader.js); the Requirements tab
   (reqs.js) writes requirement records into them, and nothing else. */
(function (S) {
  'use strict';
  var M = S.model, P = S.pl, C = S.config;

  // ── Storage ──────────────────────────────────────────────
  // PL keeps its data under its own namespace. The token and the light/dark theme are shared
  // by the whole suite, so they live under fixed keys.
  var DEMO = /[?&]demo\b/.test(location.search) || location.hash === '#demo';
  var NS = DEMO ? C.storage.demoNs : C.storage.ns;
  var TOKEN_KEY = 'signoff.token';
  var THEME_KEY = 'signoff.v1.settings';   // .theme (and .user) are read by every Signoff tool

  function load(key, fallback) {
    try { var v = localStorage.getItem(NS + key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) { toast('Couldn’t save in this browser: ' + e.message); }
  }
  function cleanToken(t) { return String(t || '').replace(/[\s​-‍⁠﻿]/g, ''); }
  function getToken() {
    try { return cleanToken(sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''); } catch (e) { return ''; }
  }
  function setToken(token, remember) {
    token = cleanToken(token);
    try {
      sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
      if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    } catch (e) { /* storage blocked */ }
  }
  function sharedSettings() { try { return JSON.parse(localStorage.getItem(THEME_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveSharedTheme(theme) {
    try { var o = sharedSettings(); o.theme = theme; localStorage.setItem(THEME_KEY, JSON.stringify(o)); } catch (e) { /* storage blocked */ }
  }

  var DEFAULT_SETTINGS = { user: '', owner: C.repos.owner, dataRepo: C.repos.dataRepo, branch: 'main', theme: 'auto' };
  var settings = Object.assign({}, DEFAULT_SETTINGS, load('settings', {}));
  settings.theme = sharedSettings().theme || settings.theme || 'auto';
  if (!settings.user && !DEMO) settings.user = sharedSettings().user || '';

  var projects = load('projects', {});    // slug -> PL project document (working copy)
  var dirty = load('dirty', {});          // project id -> time of last unsynced edit
  // Blob shas per repository as of the last sync ('owner/repo' -> { path: { sha } }); a browser from
  // before sharing kept the data repo's alone under `cache`.
  var caches = load('repoCache', null) || (function () { var c = load('cache', null), o = {}; if (c) o[settings.owner + '/' + settings.dataRepo] = c; return o; })();
  var homes = load('homes', {});          // project id -> 'owner/repo' it last synced with (share.js)
  var roster = load('roster', null) || M.emptyRoster();   // PL's users.json: contractors and the shared map
  var index = S.plReader.cleanIndex(load('index', null));   // designs read from EE/ME (reader.js)
  var lastSync = load('lastSync', null);  // { at, errors }
  var access = load('access', { login: '', tag: '', repo: '', state: '' });   // see pl.js, Access
  // Repository invitations from settings.owner waiting for this account, as of the last sync
  // ({ id, repo, owner }). A shared project's repo can't be listed until its invitation is accepted.
  var invitations = load('invitations', []);
  // Requirements comes from reqs.js and plreqs.js; without them PL runs as before.
  var VIEWS = [{ id: 'system', label: 'System' }].concat(S.plReqsView && S.plReqs ? [{ id: 'reqs', label: 'Requirements' }] : [], [{ id: 'bom', label: 'BOM' }, { id: 'issues', label: 'Issues' }]);
  var VIEW_IDS = VIEWS.map(function (v) { return v.id; });
  var ui = Object.assign({ slug: '', view: 'system', closed: {}, layout: 'map', sel: '' }, load('ui', {}));
  if (VIEW_IDS.indexOf(ui.view) < 0) ui.view = 'system';   // Overview and Structure became System (2026-11-01)
  var syncing = false;

  // The demo is rebuilt when its data changes (a new snapshot of the EE/ME demos, or a new
  // product in config.js), so a browser that saw an older demo doesn't keep it.
  var DEMO_VERSION = (S.plDemo.snapshot.generatedAt || '') + '|' + ((C.demo || {}).project || {}).name + '|' + JSON.stringify((C.demo || {}).previews || {}) + JSON.stringify((C.demo || {}).boardsMm || {}) + JSON.stringify((C.demo || {}).requirements || []) +
    JSON.stringify((C.demo || {}).models || {}) + JSON.stringify((C.demo || {}).tree || []);
  if (DEMO && (!Object.keys(projects).length || load('demoVersion', '') !== DEMO_VERSION)) {
    var demo = S.plDemo.build();
    projects = {}; projects[demo.project.slug] = demo.project;
    index = demo.index; dirty = {}; ui.slug = demo.project.slug; ui.closed = {};
    save('projects', projects); save('index', index); save('dirty', dirty); save('demoVersion', DEMO_VERSION);
    save('reqOverlay', {}); save('reqSeen', {});   // the Requirements tab's demo writes belong to the old demo
    save('accessDemo', null);                       // People & access: the demo's rosters start over too
  }

  function persist() { save('projects', projects); save('dirty', dirty); }
  // A Part waiting to be started in its tool (pl.js, state 'planned') links to the design started from
  // it as soon as PL has read that design (claimPlanned). Returns how many Parts it linked.
  function claimAll() {
    var linked = 0;
    if (!index || DEMO && !index.entries) return 0;
    Object.keys(projects).forEach(function (k) {
      var p = projects[k];
      if (p.meta.deleted) return;
      var got = P.claimPlanned(p, index, me()).length;
      if (!got) return;
      linked += got; p.meta.updatedAt = M.now(); p.meta.updatedBy = me(); dirty[p.id] = M.now();
    });
    if (linked) persist();
    return linked;
  }
  claimAll();
  function saveUi() { save('ui', { slug: ui.slug, view: ui.view, closed: ui.closed, sideCollapsed: !!ui.sideCollapsed, layout: ui.layout, sel: ui.sel, bomMode: ui.bomMode, bomCols: ui.bomCols,
    rqLayout: ui.rqLayout, rqFilter: ui.rqFilter, rqOpen: ui.rqOpen, rqSel: ui.rqSel, rqDep: !!ui.rqDep }); }
  function me() { return settings.user || 'Anonymous'; }
  // Signoff PL is for FTEs. Projects show only while a sync has confirmed the token in use.
  function dataRepo() { return (settings.owner + '/' + settings.dataRepo).toLowerCase(); }
  function allowed() { return DEMO || P.canSee(access, getToken(), dataRepo()); }
  function isFte() { return !DEMO && P.isFte(access, getToken(), dataRepo()); }
  // Where a project's files live: its shared repo, else the data repo (docs/sharing.md).
  function homeOf(p) { return (p && (M.sharedRepo(roster, p.id) || homes[p.id])) || settings.owner + '/' + settings.dataRepo; }
  function sharer(token) {
    return new S.PLSharer({ owner: settings.owner, branch: settings.branch, token: token || getToken(), tools: C.tools, login: access.login,
      pl: { dataRepo: settings.dataRepo, prefix: C.repos.prefix || 'review-pl-' }, peopleRepo: C.repos.peopleRepo });
  }
  function denied() { var t = getToken(); return !!t && access.state === 'none' && access.tag === P.tokenTag(t) && access.repo === dataRepo(); }

  // Waiting invitations with an Accept button, as Signoff EE shows them. `act` is the button's
  // attribute: data-act on the page, data-sheet inside Settings. Each repo also links to its
  // invitation on GitHub, for a token that can't accept invitations itself.
  // The suite's shared card (signoff/assets/invites.js) lists private repos too; this one is the fallback.
  function inviteCard(act) {
    if (DEMO || !getToken() || !invitations.length || window.SignoffInvites) return '';
    return '<div class="invite-card"><b>' + plural(invitations.length, 'invitation') + ' from ' + esc(settings.owner) + '</b><span>' +
      invitations.map(function (i) {
        return '<a href="https://github.com/' + esc(i.repo) + '/invitations" target="_blank" rel="noopener" title="Open this invitation on GitHub">' + esc(String(i.repo).split('/')[1]) + '</a>';
      }).join(', ') + '</span><button class="btn btn-primary" ' + (act || 'data-act="accept-invites"') + '>Accept</button></div>';
  }
  function waitingInvites() { return window.SignoffInvites ? window.SignoffInvites.count() : invitations.length; }
  function acceptInvites() {
    var list = invitations.slice(), token = getToken();
    if (!list.length || !token || DEMO) return;
    var acc = new S.GitHubAccount(token), joined = [], failed = [];
    Promise.all(list.map(function (i) {
      return acc.acceptInvitation(i.id).then(function () { joined.push(i.repo); }, function (err) { failed.push({ repo: i.repo, err: err }); });
    })).then(function () {
      invitations = invitations.filter(function (i) { return joined.indexOf(i.repo) < 0; });
      save('invitations', invitations);
      if (failed.length) {
        var f = failed[0];
        toast('Couldn’t accept ' + f.repo.split('/')[1] + ': ' + f.err.message + (f.err.status === 403 || f.err.status === 404
          ? '. This token can’t accept invitations (a fine-grained one can’t): click the repo name to accept it on GitHub, or use a classic token with the repo scope.' : ''));
      } else toast('Joined ' + joined.map(function (r) { return r.split('/')[1]; }).join(', '));
      if (joined.length) sync(); else render();
    });
  }

  // ── Small helpers ────────────────────────────────────────
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); }
  // 'EE, ME, FW, or Loom': a serial list, with the comma before 'or'.
  function orList(a) { return a.length < 3 ? a.join(' or ') : a.slice(0, -1).join(', ') + ', or ' + a[a.length - 1]; }
  function relTime(iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago';
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtMass(g) {
    if (!g) return '—';
    return g >= 1000 ? (Math.round(g / 10) / 100).toLocaleString() + ' kg' : (Math.round(g * 10) / 10).toLocaleString() + ' g';
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

  var ICON = {
    chev: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.2L7 8.8l3.5-3.6"/></svg>',
    pencil: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.8l2.7 2.7L6 12.7 2.6 13.4l.7-3.4z"/><path d="M9.2 4.1l2.7 2.7"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4-4 4 4"/></svg>',
    down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
    sync: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 00-10.6-2.6L4 7M4 12a6 6 0 0010.6 2.6L16 13"/><path d="M4 3.5V7h3.5M16 16.5V13h-3.5"/></svg>',
    more: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="5" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/></svg>',
    moon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M16.2 12.4A6.6 6.6 0 017.6 3.8a6.6 6.6 0 108.6 8.6z"/></svg>',
    sun: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.3 4.3l1.3 1.3M14.4 14.4l1.3 1.3M15.7 4.3l-1.3 1.3M5.6 14.4l-1.3 1.3"/></svg>',
    tree: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="3" y="16" width="6" height="5" rx="1.2"/><rect x="15" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M6 16v-4h12v4"/></svg>',
    expand: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9.2 6.8M2.5 13.5l4.3-4.3"/></svg>',
    full: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>',
    unfull: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/></svg>'
  };

  // Numbers shown here come from review files other people can write; pct() keeps them numbers.
  function pct(v) { return Math.max(0, Math.min(100, Math.round(Number(v)) || 0)); }
  function ring(pct0, size, stroke, label, sub) {
    var pct = pct0 == null ? 0 : Number(pct0) || 0;
    var r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return '<div class="ring" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg width="' + size + '" height="' + size + '"><circle class="ring-track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '"/>' +
      '<circle class="ring-val" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - pct / 100)) + '"/></svg>' +
      (label != null ? '<div class="ring-label"><div><b>' + esc(label) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div></div>' : '') + '</div>';
  }
  function pbar(v) { var n = pct(v); return '<div class="pbar"><div class="bar"><i style="width:' + n + '%"></i></div><span>' + n + '%</span></div>'; }
  function sevs(open) {
    var parts = P.SEVERITIES.filter(function (s) { return open[s]; }).map(function (s) { return '<span class="sev ' + s + '" title="' + cap(s) + '"><b>' + esc(open[s]) + '</b></span>'; });
    return '<span class="sevs">' + (parts.join('') || '<span class="none">None</span>') + '</span>';
  }
  function srcChip(id) {
    var s = P.sources().filter(function (x) { return x.id === id; })[0];
    return s ? '<span class="src ' + esc(id) + '" title="' + esc(s.name) + '">' + esc(s.label) + '</span>' : '';
  }
  var STATE_TEXT = {
    nosummary: ['warn', 'Not summarized yet', 'Open the design in its tool and sync once; its summary is written then.'],
    notfound: ['err', 'Not found', 'No repository your token reaches holds this design. It may have been deleted, or the token can’t open its repo.'],
    error: ['err', 'Couldn’t read', 'The tool’s repositories couldn’t be read at the last refresh.'],
    unlinked: ['dim', 'Not linked', 'Link this Part to its design review.'],
    planned: ['dim', 'Placeholder', 'A placeholder, waiting in its tool’s From Signoff PL list: start it there, and it links to this Part at the next sync. Or link an existing design here.'],
    manual: ['dim', 'No review tool yet', 'Signoff FW is planned; until then this Part is tracked here only.']
  };
  function stateChip(st) {
    var t = st && STATE_TEXT[st.state];
    return t ? '<span class="pstate ' + t[0] + '" title="' + esc(t[2]) + '">' + t[1] + '</span>' : '';
  }
  // A design's line: a review's stage and progress, or what a Loom harness holds (plain text).
  function designStat(s) {
    if (s && s.harness) return plural(s.harness.wires, 'wire') + ' · ' + plural(s.harness.ends, 'end');
    return (s.stage || '') + (s.stage ? ' · ' : '') + pct(s.pct) + '%';
  }
  // A harness Part's detail in the inspector: what it holds and what Loom's checks say.
  function harnessHtml(s) {
    var h = s.harness, m = h.wireMm / 1000;
    var holds = [plural(h.wires, 'wire'), plural(h.ends, 'end'), h.splices && plural(h.splices, 'splice'), h.cables && plural(h.cables, 'cable')].filter(Boolean).join(', ');
    var checks = h.errors || h.warnings ? [h.errors && plural(h.errors, 'error'), h.warnings && plural(h.warnings, 'warning')].filter(Boolean).join(', ') + ' in Loom’s checks' : 'Loom’s checks pass';
    return '<p class="map-ins-text">' + esc(holds) + (h.wireMm ? '<br>' + esc(m.toFixed(2) + ' m (' + (h.wireMm / 304.8).toFixed(2) + ' ft) of wire') : '') + '<br>' +
      '<span class="pstate ' + (h.errors ? 'err' : h.warnings ? 'warn' : 'dim') + '">' + esc(checks) + '</span></p>';
  }
  // Where a linked design opens: its project in its tool, and with `item` that check. In the
  // demo the links open the other tools' demos, whose projects these Parts are.
  function designUrl(node, item) {
    var tool = P.toolById(node.source);
    if (!tool) return '';
    var q = (DEMO ? ['demo'] : []).concat(node.ref && node.ref.id ? ['project=' + encodeURIComponent(node.ref.id)] : [])
      .concat(item ? ['item=' + encodeURIComponent(item)] : []);
    return tool.app + (q.length ? '?' + q.join('&') : '');
  }

  // ── Current project ──────────────────────────────────────
  function current() { var p = allowed() ? projects[ui.slug] : null; return p && !p.meta.deleted ? p : null; }
  function touch(p) {
    p.meta.updatedAt = M.now(); p.meta.updatedBy = me();
    dirty[p.id] = M.now();
    persist(); render();
  }
  function setNode(id, fields) {
    var p = current();
    var n = Object.assign({}, p.nodes[id], fields);
    p.nodes[id] = M.stamp(n, me());
    touch(p);
  }

  // ── Sidebar ──────────────────────────────────────────────
  function renderSidebar() {
    var q = ($('#project-search').value || '').toLowerCase();
    var list = (allowed() ? Object.keys(projects) : []).map(function (k) { return projects[k]; }).filter(function (p) { return !p.meta.deleted; })
      .filter(function (p) { return !q || [p.meta.name, p.meta.client, p.meta.number].join(' ').toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''); });
    var html = list.filter(function (p) { return !p.meta.archived; }).map(function (p) {
      var r = P.rollup(p, index)[''];
      return '<button class="proj' + (p.slug === ui.slug ? ' active' : '') + '" data-act="open-project" data-slug="' + esc(p.slug) + '" title="' + esc(p.meta.name) + '">' +
        ring(r.pct, 26, 3.5) + '<span class="proj-body"><span class="proj-name">' + esc(p.meta.name) + '</span>' +
        '<span class="proj-sub">' + esc([p.meta.number, p.meta.phase].filter(Boolean).join(' · ')) + '</span></span>' +
        (dirty[p.id] ? '<span class="proj-dirty" title="Not synced yet"></span>' : '') + '</button>';
    }).join('') || (allowed() ? '<div class="side-empty">' + (q ? 'No matching projects.' : 'No projects yet.') + '</div>' : '');
    var archived = list.filter(function (p) { return p.meta.archived; });
    if (archived.length) {
      html += '<div class="side-archived"><div class="side-head"><span class="side-label">Archived</span></div>' +
        archived.map(function (p) { return '<button class="proj" data-act="open-project" data-slug="' + esc(p.slug) + '"><span class="proj-body"><span class="proj-name">' + esc(p.meta.name) + '</span></span></button>'; }).join('') + '</div>';
    }
    // A contractor with a project already open may be invited to another (the locked page shows it otherwise).
    if (allowed()) html = inviteCard() + html;
    $('#project-list').innerHTML = html;
    // A contractor has no data repo to put a new project in, and People & access is for FTEs.
    $('.side-head [data-act="new-project"]').hidden = !(DEMO || isFte());
    // People & access lives in Signoff EE, whose list decides who's an FTE across the suite.
    $('#people-link').hidden = !(isFte() || DEMO);
    if (DEMO) {
      document.querySelectorAll('#side-tools a.side-link').forEach(function (a) {
        var href = a.getAttribute('href');
        if (!/[?&]demo\b/.test(href)) a.setAttribute('href', href + '?demo');
      });
    }
  }

  function renderSyncState(state) {
    markSyncButtons();
    var dot = $('#sync-dot'), title = $('#sync-title'), sub = $('#sync-sub');
    var n = Object.keys(dirty).length;
    sub.classList.remove('sync-who');
    // Line 1 is the sync state (and when it last synced); line 2 the GitHub account, when it's known (Chris, 2026-11-10).
    var who = access.login && getToken() ? '@' + access.login : '';
    // Before the first sync after a sign-in, the sign-in itself says who it is. Never the data repo's
    // owner: that read as the wrong account (Chris, 2026-11-13).
    var signedAs = !who && getToken() && window.SignoffAuth ? window.SignoffAuth.status().login : '';
    if (signedAs) who = '@' + signedAs;
    function line2(fallback) { sub.textContent = who || fallback; if (who) sub.classList.add('sync-who'); }
    if (DEMO) { dot.dataset.tone = 'idle'; title.textContent = 'Demo mode'; sub.textContent = 'Changes stay in this browser'; return; }
    if (state === 'busy' || syncing) { dot.dataset.tone = 'busy'; title.textContent = 'Syncing…'; line2('Checking your token'); return; }
    if (!getToken()) { dot.dataset.tone = 'idle'; title.textContent = 'Signed out'; sub.textContent = 'Add your GitHub token'; return; }
    if (denied()) { dot.dataset.tone = 'warn'; title.textContent = 'No access'; sub.textContent = '@' + access.login + ' has no projects'; return; }
    if (!allowed()) { dot.dataset.tone = 'idle'; title.textContent = 'Not checked yet'; sub.textContent = 'Click to sync'; return; }
    if (n) { dot.dataset.tone = 'warn'; title.textContent = plural(n, 'unsynced change'); line2('Click to sync'); return; }
    var errs = lastSync && lastSync.errors && lastSync.errors.length;
    dot.dataset.tone = errs ? 'warn' : lastSync ? 'ok' : 'idle';
    title.textContent = errs ? 'Synced with problems' : lastSync ? 'Synced ' + relTime(lastSync.at) : 'Ready';
    if (errs) sub.textContent = lastSync.errors[0].message; else line2('Click to sync');
  }

  // A Sync button: while a sync runs its arrows turn and it says Syncing… (suite.css .is-syncing).
  function syncButton(label, cls, title) {
    return '<button class="btn' + (cls ? ' ' + cls : '') + (syncing ? ' is-syncing' : '') + '" data-act="sync" data-label="' + esc(label) + '"' +
      (title ? ' data-title="' + esc(title) + '" title="' + esc(syncing ? 'Syncing with GitHub…' : title) + '"' : '') + '>' +
      ICON.sync + '<span class="btn-label">' + (syncing ? 'Syncing…' : esc(label)) + '</span>';
  }
  // Starting or ending a sync updates every Sync button in place, without a render.
  function markSyncButtons() {
    var on = !!syncing;
    document.querySelectorAll('.btn[data-act="sync"]').forEach(function (b) {
      if (b.classList.contains('is-syncing') === on) return;
      b.classList.toggle('is-syncing', on);
      var label = b.querySelector('.btn-label');
      if (label) label.textContent = on ? 'Syncing…' : (b.dataset.label || 'Sync');
      if (b.dataset.title) b.title = on ? 'Syncing with GitHub…' : b.dataset.title;
    });
  }

  // ── Toolbar ──────────────────────────────────────────────
  function renderToolbar() {
    var p = current();
    $('#toolbar-title').textContent = p ? p.meta.name : '';
    if (!p) { $('#view-seg').innerHTML = ''; $('#toolbar-actions').innerHTML = ticketsOn() ? moreButton() : ''; return; }
    var r = P.rollup(p, index)[''];
    $('#view-seg').innerHTML = VIEWS.map(function (v) {
      var need = v.id === 'reqs' && S.plReqsView ? reqsView().badge(p) : 0;
      var extra = v.id === 'issues' && r.openTotal ? '<span class="count">' + esc(r.openTotal) + '</span>' : need ? '<span class="count" title="Waiting in Needs you">' + need + '</span>' : '';
      return '<button role="tab" class="' + (v.id === ui.view ? 'on' : '') + '" data-act="view" data-view="' + v.id + '">' + v.label + extra + '</button>';
    }).join('');
    $('#toolbar-actions').innerHTML = (DEMO ? '' : syncButton('Sync', '', 'Sync PL projects and read the designs again (Ctrl+S)') +
      (Object.keys(dirty).length ? '<span class="badge">' + Object.keys(dirty).length + '</span>' : '') + '</button>') +
      '<button class="btn btn-primary" data-act="add-node" title="Add a Part or assembly">' + ICON.plus + '<span class="btn-label">Add</span></button>' +
      moreButton();
  }
  // Tickets (signoff/assets/tickets.js): Open ticket… and Tickets in the ⋯ menu, for FTEs, on every page.
  function ticketsOn() { return !!(window.SignoffTickets && window.SignoffTickets.can()); }
  function moreButton() { return '<button class="icon-btn" data-act="project-menu" title="More" aria-label="More">' + ICON.more + '</button>'; }
  function ticketEntries() { return ticketsOn() ? [['ticket', 'Open ticket…'], ['tickets', 'Tickets']] : []; }

  // ── Pages ────────────────────────────────────────────────
  // The Requirements tab lives in reqs.js; it gets what it needs from here.
  var reqsViewObj = null;
  function reqsView() {
    return reqsViewObj || (reqsViewObj = S.plReqsView({
      esc: esc, ui: ui, load: load, save: save, index: function () { return index; }, view: function () { return ui.view; },
      headBlock: headBlock, ICON: ICON, ring: ring, plural: plural, srcChip: srcChip, relTime: relTime,
      current: current, touch: touch, me: me, saveUi: saveUi, renderPage: renderPage, toast: toast,
      sheet: sheet, closeSheet: closeSheet, val: val, settings: settings, getToken: getToken, DEMO: DEMO
    }));
  }
  function renderPage() {
    var p = current(), page = $('#page'), scroll = $('#main').scrollTop;
    renderToolbar();
    if (!p) { page.innerHTML = allowed() ? emptyPage() : lockedPage(); return; }
    if (ui.view === 'issues') page.innerHTML = issuesPage(p);
    else if (ui.view === 'reqs') page.innerHTML = reqsView().page(p);
    else if (ui.view === 'bom') page.innerHTML = bomPage(p);
    else page.innerHTML = systemPage(p);
    $('#main').scrollTop = scroll;
    loadPictures(page);
    loadViewers(page);
    initScene(page);
  }

  function emptyPage() {
    var none = !Object.keys(projects).length;
    return '<div class="page"><div class="empty"><div class="empty-art">' + ICON.tree + '</div>' +
      '<h2>' + (none ? 'Lead a product' : 'Pick a project') + '</h2>' +
      '<p>' + (none ? 'A PL project is the whole product: assemblies and the Parts in them. Link each Part to its review in Signoff EE or ME, and see where the product stands in one place.'
        : 'Choose a project from the sidebar, or start a new one.') + '</p>' +
      '<button class="btn btn-primary" data-act="new-project">New project</button>' +
      (none && !DEMO ? ' ' + syncButton('Pull from GitHub') + '</button>' : '') + '</div></div>';
  }

  // Shown instead of the projects until a sync confirms an FTE's token (see allowed()).
  function lockedPage() {
    var repo = '<b>' + esc(settings.owner + '/' + settings.dataRepo) + '</b>', kept = Object.keys(projects).length;
    var head = !getToken() ? ['Sign in to Signoff PL', (signIn() ? 'Sign in with your GitHub account.' : 'Add your GitHub token in Settings.') + ' PL shows the projects once it confirms the token can open ' + repo + ' (Dovetail FTEs) or a project shared with you.']
      : denied() && waitingInvites() ? ['Accept your invitation', 'You’re signed in as <b>@' + esc(access.login) + '</b>. A project has been shared with you, and GitHub is waiting for you to accept the invitation. PL syncs again once you do.']
      : denied() ? ['No projects for this account', 'You’re signed in as <b>@' + esc(access.login) + '</b>, which can’t open ' + repo + ' and is on no shared PL project. An FTE adds you from People in Signoff EE, or shares a project with you from Signoff PL. Accept GitHub’s invitation, then sync again.']
      : syncing ? ['Syncing with GitHub', 'Checking that your token can open ' + repo + '. The projects show here as soon as the sync finishes.']
      : ['Not checked yet', 'PL shows the projects once a sync confirms your token can open ' + repo + '.'];
    var card = inviteCard();
    // With the suite's shared card loaded (its spot is the sidebar), the locked page offers its Accept all too.
    if (!card && window.SignoffInvites && waitingInvites()) card = '<div class="invite-card"><b>' + plural(waitingInvites(), 'invitation') + ' from ' + esc(settings.owner) + '</b><span>' +
      window.SignoffInvites.list().map(function (i) { return esc(String(i.repo).split('/')[1]); }).join(', ') + '</span><button class="btn btn-primary" data-act="invites-accept-all">' + (waitingInvites() > 1 ? 'Accept all' : 'Accept') + '</button></div>';
    return '<div class="page"><div class="empty"><div class="empty-art">' + ICON.tree + '</div><h2>' + head[0] + '</h2><p>' + head[1] + '</p>' +
      (card ? '<div class="invite-wrap">' + card + '</div>' : '') +
      (getToken() ? syncButton(denied() ? 'Sync again' : 'Sync', 'btn-primary') + '</button> <button class="btn" data-act="settings">Settings</button>'
        : signIn() ? '<button class="btn btn-primary" data-act="signin">Sign in with GitHub</button> <button class="btn" data-act="settings">Use a token</button>'
        : '<button class="btn btn-primary" data-act="settings">Settings</button>') +
      (denied() && kept ? '<p class="note" style="margin-top:16px">' + plural(kept, 'unsynced project') + ' from an earlier sign-in ' + (kept === 1 ? 'stays' : 'stay') + ' in this browser, hidden. ' + (kept === 1 ? 'It’s' : 'They’re') + ' pushed the next time an FTE syncs here.</p>' : '') +
      '</div></div>';
  }

  function headBlock(p, eyebrow) {
    var m = p.meta;
    var sub = [m.client, m.number].filter(Boolean).map(esc).join('<span class="sep">·</span>');
    return '<div class="eyebrow">' + esc(eyebrow) + '</div><h1 class="page-title">' + esc(m.name) + '</h1>' +
      '<div class="page-sub">' + (sub ? '<span>' + sub + '</span>' : '') + (m.phase ? '<span class="chip accent">' + esc(m.phase) + '</span>' : '') +
      '<button class="btn page-edit" data-act="edit-project" title="Edit the project’s name, client, phase, and description">' + ICON.pencil + 'Edit</button></div>';
  }
  function stat(n, label, cls, detail) {
    return '<div class="card stat ' + esc(cls || '') + '"><div class="stat-num">' + esc(n) + '</div><div class="stat-label">' + esc(label) + '</div>' + (detail ? '<div class="stat-detail">' + detail + '</div>' : '') + '</div>';
  }

  // ── System: the structure on top, the product's facts underneath ──
  // The structure shows as a tree map (default), a gallery, the exploded 3D view, or a table.
  // Selecting a tile opens the inspector beside it. The map's top button selects the top assembly,
  // or the product itself (PRODUCT) when it has several top-level nodes.
  var PRODUCT = '@product';
  function systemPage(p) {
    var t = P.tree(p), rolls = P.rollup(p, index), ids = P.flatten(t);
    var layout = LAYOUTS.some(function (l) { return l[0] === ui.layout; }) ? ui.layout : 'map', map = layout !== 'list';
    if (ui.sel && ui.sel !== PRODUCT && !t.nodes[ui.sel]) ui.sel = '';
    var sel = map && ids.length ? ui.sel : '';
    var html = '<div class="page' + (map ? ' page-map' + (sel ? ' has-sel' : '') : '') + '"><div class="map-main"><div class="cl-head sys-head"><div>' + headBlock(p, 'System') +
      (p.meta.description ? '<p class="sys-desc">' + esc(p.meta.description) + '</p>' : '') + '</div>' +
      '<div class="cl-head-acts"><div class="seg" role="tablist" aria-label="Layout">' + LAYOUTS.map(function (l) {
        return '<button role="tab" class="' + (layout === l[0] ? 'on' : '') + '" data-act="layout" data-layout="' + l[0] + '">' + l[1] + '</button>';
      }).join('') + '</div><button class="btn" data-act="add-node">' + ICON.plus + ' Add</button></div></div>';
    if (!ids.length) {
      return html + trayHtml(p) + '<div class="card empty"><div class="empty-art">' + ICON.tree + '</div><h2>No Parts yet</h2><p>Add the product’s top assembly, then the Parts in it: boards, mechanical parts, firmware, and purchased items.</p>' +
        '<button class="btn btn-primary" data-act="add-node">Add the first assembly or Part</button></div></div></div>';
    }
    html += layout === 'map' || layout === 'gallery' ? '<div class="sys-diagram">' + (layout === 'gallery' ? gallery(p, t, ids) : treeMap(p, t, rolls)) + '</div>'
      : layout === 'exploded' ? exploded(p, t, ids) : listTable(t, rolls, ids);
    html += infoPanels(p, t, rolls[''], ids) + '</div>';
    // Exploded arranges the selected Part; assemblies and the product get the inspector there too.
    if (sel) html += layout === 'exploded' && sel !== PRODUCT && t.nodes[sel].kind === 'part' ? arrangePanel(p, t, sel) : inspector(p, t, sel);
    // On narrow screens the panel floats over the page; tapping the dimmed page closes it.
    if (sel) html += '<div class="map-ins-scrim" data-act="close-ins" aria-hidden="true"></div>';
    return html + '</div>';
  }

  // What the Overview tab used to show, under the structure.
  // Recent discussion across the linked designs (each review's summary.recent), newest first. A
  // design used by several Parts counts once; each comment opens its check in the review. View all
  // shows every comment the summaries carry, in a scrolling list.
  var DISCUSSION = 8;
  function discussionPanel(t, ids) {
    var seen = {}, rows = [];
    ids.forEach(function (id) {
      var n = t.nodes[id], st = P.linkStatus(n, index);
      if (!st || !st.summary || seen[P.refKey(n.ref)]) return;
      seen[P.refKey(n.ref)] = 1;
      (st.summary.recent || []).forEach(function (c) { rows.push({ c: c, n: n }); });
    });
    if (!rows.length) return '';
    rows.sort(function (a, b) { return (b.c.at || '').localeCompare(a.c.at || ''); });
    var more = rows.length > DISCUSSION, all = more && ui.talkAll;
    return '<div class="section-title">Recent discussion' + (more ? '<button class="btn btn-plain" data-act="talk-all" aria-expanded="' + !!all + '">' +
      (all ? 'Show fewer' : 'View all ' + rows.length) + '</button>' : '') + '</div>' +
      '<div class="card sys-talk' + (all ? ' all' : '') + '">' + (all ? rows : rows.slice(0, DISCUSSION)).map(function (x) {
      var c = x.c, n = x.n;
      return '<a class="cmt sys-talk-row" href="' + esc(designUrl(n, c.item)) + '">' + avatar(c.author) +
        '<div><div class="cmt-head"><b>' + esc(c.author || 'Someone') + '</b><span>' + relTime(c.at) + '</span><span class="sys-talk-on">' + srcChip(n.source) + esc(n.name) + '</span></div>' +
        (c.check ? '<div class="sys-talk-check">' + esc(c.check) + '</div>' : '') +
        '<div class="cmt-text">' + esc(c.text) + '</div></div></a>';
    }).join('') + '</div>';
  }
  function avatar(name) {
    var h = 0, s = String(name || '?');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    var ini = s.split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    return '<div class="avatar" style="background:hsl(' + h + ' 45% 42%)">' + esc(ini || '?') + '</div>';
  }

  function infoPanels(p, t, r, ids) {
    var stageList = Object.keys(r.stages).sort().map(function (k) { var s = k.split(':'); return '<span class="sys-stage">' + srcChip(s[0]) + esc(s.slice(1).join(':')) + (r.stages[k] > 1 ? ' <span class="map-qty">×' + r.stages[k] + '</span>' : '') + '</span>'; }).join('');
    var html = '<div class="section-title">Status</div><div class="card sys-stats">' +
      stat(r.openTotal, 'Open issues', r.openTotal ? 'issue' : 'pass', sevs(r.open)) +
      stat(r.parts, plural(r.parts, 'Part').replace(/^\d+ /, ''), '', [r.designs && plural(r.designs, 'design'), r.purchased && r.purchased + ' purchased', r.manual && r.manual + ' firmware'].filter(Boolean).join(' · ')) +
      stat(r.unlinked + r.attention, 'Need attention', r.unlinked + r.attention ? 'issue' : '', r.unlinked + r.attention ? [r.unlinked && r.unlinked + ' not linked', r.attention && r.attention + ' unreadable'].filter(Boolean).join(' · ') : 'Every design reads') +
      stat(fmtMass(r.massG), 'Mass', '', r.massMissing ? plural(r.massMissing, 'Part') + ' without a mass' : 'All Parts weighed') + '</div>';

    // One row per linked design, in tree order.
    var seen = {}, cards = [];
    ids.forEach(function (id) {
      var n = t.nodes[id], st = P.linkStatus(n, index);
      if (!st || ['ok', 'nosummary'].indexOf(st.state) < 0 || seen[P.refKey(n.ref)]) return;
      seen[P.refKey(n.ref)] = 1;
      var s = st.summary, e = st.entry;
      cards.push('<div class="sys-design">' +
        '<div class="sys-design-name">' + srcChip(n.source) + '<div><b>' + esc(n.name) + '</b><span>' + esc([e.name !== n.name ? e.name : '', e.number, e.revision && 'Rev ' + e.revision].filter(Boolean).join(' · ')) + '</span></div></div>' +
        '<span class="sys-design-stage">' + esc((s && s.stage) || e.stage || '') + (s && s.at ? '<i>Edited ' + relTime(s.at) + (s.by ? ' by ' + esc(s.by) : '') + '</i>' : '') + '</span>' +
        '<div class="sys-design-pct">' + (s && s.harness ? '<span class="muted">' + esc(designStat(s)) + '</span>' : s ? pbar(s.pct) : stateChip(st)) + '</div>' +
        '<div class="sys-design-sev">' + (s && !s.harness ? sevs((s.issues || {}).open || {}) : '') + '</div>' +
        '<a class="open-link" href="' + esc(designUrl(n)) + '">Open in ' + esc(P.toolById(n.source).short) + ' ›</a></div>');
    });
    if (cards.length) html += '<div class="section-title">Designs</div><div class="card sys-designs">' + cards.join('') + '</div>';

    var attn = ids.filter(function (id) {
      var st = P.linkStatus(t.nodes[id], index);
      return st && ['nosummary', 'notfound', 'error', 'unlinked'].indexOf(st.state) >= 0;
    });
    if (attn.length) {
      html += '<div class="section-title">Needs attention</div><div class="card attn">' + attn.map(function (id) {
        var n = t.nodes[id], st = P.linkStatus(n, index);
        return '<div class="attn-row" data-act="edit-node" data-id="' + esc(id) + '">' + srcChip(n.source) +
          '<div class="attn-text">' + esc(n.name) + '<div>' + esc(STATE_TEXT[st.state][2]) + '</div></div>' + stateChip(st) + '</div>';
      }).join('') + '</div>';
    }
    if (Object.keys(r.stages).length) html += '<div class="section-title">Stages</div><div class="card sys-stages"><div class="sys-stage-list">' + stageList + '</div><p class="note">Each tool keeps its own stages. Gates (EVT, DVT, PVT) will tie them together.</p></div>';
    html += discussionPanel(t, ids);
    return html + '<p class="note" style="margin-top:28px">' + (index && index.at ? 'Designs read ' + relTime(index.at) : 'Designs not read yet') +
      (r.designs ? ' · progress is checks reviewed across ' + plural(r.designs, 'linked design') : '') +
      ' · created ' + relTime(p.createdAt) + (p.createdBy ? ' by ' + esc(p.createdBy) : '') + '</p>';
  }

  // ── Structure: a map of tiles (default) or the table ─────
  // Until designs carry a picture, a Part's tile shows a plain drawing of what it is: a board
  // outline for EE, a part outline for ME, a box for purchased, braces for firmware (linked or not).
  function partArt(n, big) {
    var num = esc(((n.ref && P.partStatus(n, index).entry) || {}).number || n.number || '');
    var label = big && num ? '<text class="pa-text" x="60" y="44" text-anchor="middle">' + num + '</text>' : '';
    if (n.source === 'ee') {
      return '<svg viewBox="0 0 120 76" aria-hidden="true"><rect class="pa-board" x="3" y="3" width="114" height="70" rx="7"/>' +
        [[11, 11], [109, 11], [11, 65], [109, 65]].map(function (c) { return '<circle class="pa-hole" cx="' + c[0] + '" cy="' + c[1] + '" r="3"/>'; }).join('') + label + '</svg>';
    }
    if (n.source === 'me') {
      return '<svg viewBox="0 0 120 76" aria-hidden="true"><path class="pa-part" d="M24 24 L60 8 L96 24 L96 54 L60 70 L24 54 Z"/><path class="pa-edge" d="M24 24 L60 40 L96 24 M60 40 V70"/></svg>';
    }
    if (n.source === 'purchased') {
      return '<svg viewBox="0 0 120 76" aria-hidden="true"><path class="pa-box" d="M38 26 L60 16 L82 26 L82 52 L60 62 L38 52 Z"/><path class="pa-edge" d="M38 26 L60 36 L82 26 M60 36 V62 M49 21 L71 31"/></svg>';
    }
    if (n.source === 'loom') {
      // Each connector spans every wire, with room above the top one and below the bottom one (Chris, 2026-11-09).
      return '<svg viewBox="0 0 120 76" aria-hidden="true"><rect class="pa-box" x="10" y="20" width="18" height="36" rx="3"/><rect class="pa-box" x="92" y="20" width="18" height="36" rx="3"/>' +
        '<path class="pa-wire" d="M28 29 C52 29 68 47 92 47 M28 38 C52 38 68 38 92 38 M28 47 C52 47 68 29 92 29"/></svg>';
    }
    if (n.source !== 'fw' && P.toolById(n.source)) return '<svg viewBox="0 0 120 76" aria-hidden="true"><rect class="pa-unknown" x="20" y="12" width="80" height="52" rx="8"/></svg>';
    return '<svg viewBox="0 0 120 76" aria-hidden="true"><text class="pa-fw" x="60" y="47" text-anchor="middle">{ }</text></svg>';
  }

  // ── Pictures ─────────────────────────────────────────────
  // A design's stored picture (reader.js, keepPreview) is fetched with the token the first time a
  // tile shows it, kept in IndexedDB by blob sha, and shown from an object URL. Until it arrives,
  // and wherever there's none, the tile keeps its plain drawing.
  var pvUrls = {}, pvWaiting = {}, pvDbOpen = null;
  function pvDb() {
    if (!pvDbOpen) pvDbOpen = new Promise(function (resolve) {
      try {
        var req = indexedDB.open('signoff-pl-pictures', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('img'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return pvDbOpen;
  }
  function pvGet(sha) {
    return pvDb().then(function (db) {
      return db ? new Promise(function (resolve) {
        try { var r = db.transaction('img').objectStore('img').get(sha); r.onsuccess = function () { resolve(r.result || null); }; r.onerror = function () { resolve(null); }; } catch (e) { resolve(null); }
      }) : null;
    });
  }
  function pvPut(sha, blob) {
    pvDb().then(function (db) { try { if (db) db.transaction('img', 'readwrite').objectStore('img').put(blob, sha); } catch (e) { /* not kept */ } });
  }
  // A stored file by blob sha: the cache, then the files waiting to upload, then GitHub.
  function fileBlob(repo, ref) {
    // The demo's own stored files (demo.js: the ME parts' models) come with the page.
    var demoFile = DEMO && S.plDemo && S.plDemo.file(ref.sha);
    if (demoFile) return fetch(demoFile).then(function (r) { if (!r.ok) throw new Error('not found'); return r.blob(); });
    return pvGet(ref.sha).then(function (blob) {
      return blob || upGet(ref.sha).then(function (u) { return u ? u.blob : null; });
    }).then(function (blob) {
      if (blob || DEMO || !repo || !getToken()) return blob;
      return new S.PLReader({ owner: settings.owner, branch: settings.branch, tools: C.tools, token: getToken() }).image(repo, ref)
        .then(function (b) { pvPut(ref.sha, b); return b; });
    });
  }
  function pictureUrl(repo, img) {
    if (pvUrls[img.sha]) return Promise.resolve(pvUrls[img.sha]);
    if (!pvWaiting[img.sha]) {
      pvWaiting[img.sha] = fileBlob(repo, img)
        .then(function (blob) { return blob ? (pvUrls[img.sha] = URL.createObjectURL(blob)) : null; }, function () { return null; })
        .then(function (url) { if (!url) delete pvWaiting[img.sha]; return url; });
    }
    return pvWaiting[img.sha];
  }

  // Files of attached models wait here until a sync uploads them to the PL data repo. This store
  // survives clearPictures(), as unsynced projects survive a lockout.
  var upDbOpen = null;
  function upDb() {
    if (!upDbOpen) upDbOpen = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DEMO ? 'signoff-pl-demo-uploads' : 'signoff-pl-uploads', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('files'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return upDbOpen;
  }
  function upTx(mode, fn) {
    return upDb().then(function (db) {
      return db ? new Promise(function (resolve) {
        try { var r = fn(db.transaction('files', mode).objectStore('files')); r.onsuccess = function () { resolve(r.result || null); }; r.onerror = function () { resolve(null); }; } catch (e) { resolve(null); }
      }) : null;
    });
  }
  function upGet(sha) { return upTx('readonly', function (s) { return s.get(sha); }); }
  function upPut(sha, rec) { return upTx('readwrite', function (s) { return s.put(rec, sha); }); }
  function upDel(sha) { return upTx('readwrite', function (s) { return s.delete(sha); }); }
  function upKeys() { return upTx('readonly', function (s) { return s.getAllKeys(); }).then(function (k) { return k || []; }); }

  // Upload the waiting files that a live Part still refers to, in one commit, before the project
  // files that refer to them are pushed. Files no Part refers to any more are dropped.
  function uploadModels(token) {
    var want = {}, projectOfModel = {};
    Object.keys(projects).forEach(function (k) {
      var files = P.modelFiles(projects[k]);
      Object.assign(want, files);
      Object.keys(files).forEach(function (sha) { projectOfModel[files[sha]] = projects[k]; });
    });
    return upKeys().then(function (keys) {
      var go = keys.filter(function (k) { return want[k]; });
      keys.filter(function (k) { return !want[k]; }).forEach(upDel);
      if (!go.length) return 0;
      return Promise.all(go.map(function (k) { return upGet(k).then(function (u) { return u && u.blob.arrayBuffer().then(function (b) { return { path: want[k], bytes: new Uint8Array(b), sha: k }; }); }); }))
        .then(function (files) {
          files = files.filter(Boolean);
          // Into each project's own repository (a shared project keeps its models with it).
          var byRepo = {};
          files.forEach(function (f) { var r = homeOf(projectOfModel[f.path]); (byRepo[r] = byRepo[r] || []).push(f); });
          return Object.keys(byRepo).reduce(function (chain, r) {
            return chain.then(function () {
              var store = new S.GitHubStore({ owner: r.split('/')[0], repo: r.split('/')[1], branch: settings.branch, dataPath: '', token: token });
              return store.putFiles(byRepo[r], { message: 'PL models: ' + plural(byRepo[r].length, 'file') + ' (' + me() + ')' }).then(function () {
                return Promise.all(byRepo[r].map(function (f) { return upDel(f.sha); }));
              });
            });
          }, Promise.resolve()).then(function () { return files.length; });
        });
    });
  }

  // A Part's own model pictures, in the shape of a design's preview.
  // A Part's model shows only while its kind takes one (MODEL_SOURCES): a purchased Part switched to
  // Loom keeps its model, supplier, and MPN on the node, hidden, so switching back brings them back.
  function modelOf(n) { return n && n.kind === 'part' && MODEL_SOURCES[n.source] ? P.cleanModel(n.model) : null; }
  function mpnOf(n) { return n && n.source === 'purchased' ? n.mpn || '' : ''; }
  function modelPreview(n) {
    var m = modelOf(n);
    if (!m || !m.views.length) return null;
    return { repo: homeOf(current()), hero: 'iso', model: true,
      images: m.views.map(function (v) { return { key: v.key, type: 'image/png', w: v.w, h: v.h, sha: v.sha }; }) };
  }
  // The picture set a Part shows: its attached model's, else its design's stored preview.
  // A board keeps its Fabcheck pictures on tiles even with a model; the model is for the 3D view.
  function previewFor(n, entry) {
    var pv = entry && entry.preview;
    return (n && n.source === 'ee' && pv) || modelPreview(n) || pv || null;
  }

  function fmtBytes(b) { return b >= 1048576 ? (Math.round(b / 104857.6) / 10).toLocaleString() + ' MB' : Math.max(1, Math.round(b / 1024)).toLocaleString() + ' kB'; }
  function storedBytes(m) { return (m.mesh.size || 0) + ((m.step && m.step.size) || 0) + m.views.reduce(function (a, v) { return a + (v.size || 0); }, 0); }
  function modelLine(m) {
    return esc([m.file, m.bboxMm && m.bboxMm.join(' × ') + ' mm', m.tris.toLocaleString() + ' triangles' + (m.srcTris > m.tris ? ' (simplified from ' + m.srcTris.toLocaleString() + ')' : '')].filter(Boolean).join(' · '));
  }

  // The rotatable view in the inspector, from the stored mesh (decoded once per sha).
  var meshes = {};
  function loadMesh(sha) {
    if (!meshes[sha]) {
      meshes[sha] = fileBlob(homeOf(current()), { sha: sha, type: 'application/octet-stream' })
        .then(function (b) { if (!b) throw new Error('not found'); return b.arrayBuffer(); })
        .then(function (buf) { return S.model3d.decode(new Uint8Array(buf)); });
      meshes[sha].catch(function () { delete meshes[sha]; });
    }
    return meshes[sha];
  }
  function loadViewers(root) {
    (root || document).querySelectorAll('canvas.m3d[data-mesh]').forEach(function (cv) {
      var sha = cv.dataset.mesh;
      cv.removeAttribute('data-mesh');
      loadMesh(sha).then(function (mesh) { if (cv.isConnected) cv.m3d = S.model3d.viewer(cv, mesh); }, function () { toast('Couldn’t load the 3D model'); });
    });
  }

  // ── The large 3D view ────────────────────────────────────
  // A Part's model nearly filling the window, to show the CAD in a review (Chris, 2026-11-09): every
  // standard view, pan, zoom, keys, and full screen. It hangs off <body>, so the page re-rendering
  // underneath (pictures arriving, a sync) leaves it alone. It opens at the inspector's angle and
  // hands its own back on close. Over sheets (60), under menus (70) and toasts (90).
  var BIG_VIEWS = [['iso', 'Iso', -45, 30], ['front', 'Front', 0, 0], ['back', 'Back', 180, 0], ['left', 'Left', 90, 0],
    ['right', 'Right', -90, 0], ['top', 'Top', 0, 90], ['bottom', 'Bottom', 0, -90]].map(function (v) { return { key: v[0], label: v[1], az: v[2] * Math.PI / 180, el: v[3] * Math.PI / 180 }; });
  var bigView = null;
  function smallViewer(id) {
    var cv = ui.sel === id && document.querySelector('#page .map-ins canvas.m3d');
    return (cv && cv.m3d) || null;
  }
  function openModelView(id) {
    var p = current(), n = p && p.nodes[id], mdl = n && modelOf(n);
    if (!mdl) return;
    closeModelView();
    var e = P.partStatus(n, index).entry || {}, sub = [e.number || n.number || mpnOf(n), e.revision && 'Rev ' + e.revision].filter(Boolean).map(esc).join(' · ');
    var wrap = document.createElement('div');
    wrap.className = 'm3x-wrap'; wrap.id = 'm3x';
    wrap.innerHTML = '<div class="m3x" role="dialog" aria-modal="true" aria-label="' + esc((n.name || 'Part') + ' in 3D') + '">' +
      '<div class="m3x-head"><div class="m3x-title"><h2>' + esc(n.name || 'Unnamed') + '</h2><p>' + sub + (sub ? ' · ' : '') + modelLine(mdl) + '</p></div>' +
      '<div class="seg m3x-views" role="group" aria-label="View">' + BIG_VIEWS.map(function (v) { return '<button data-m3x="view" data-key="' + v.key + '">' + v.label + '</button>'; }).join('') + '</div>' +
      '<button class="btn" data-m3x="fit" title="Center it and fit it to the window (0)">Fit</button>' +
      (document.fullscreenEnabled ? '<button class="icon-btn" data-m3x="full" title="Full screen (F)" aria-label="Full screen">' + ICON.full + '</button>' : '') +
      '<button class="icon-btn m3x-close" data-m3x="close" title="Close (Esc)" aria-label="Close">×</button></div>' +
      '<div class="m3x-stage"><canvas class="m3x-canvas" tabindex="0" aria-label="' + esc(n.name || 'Part') + ' in 3D: drag to turn, Shift-drag or right-drag to pan, scroll to zoom, arrow keys to turn"></canvas>' +
      '<div class="xs-load"><span class="spin" aria-hidden="true"></span>Loading 3D…</div></div>' +
      '<p class="m3x-hint">Drag to turn, Shift-drag or right-drag to pan, and scroll to zoom. The arrow keys turn it too, 0 fits it, F goes full screen, and a double-click resets the view.</p></div>';
    document.body.appendChild(wrap);
    var cv = wrap.querySelector('canvas'), b = bigView = { id: id, wrap: wrap, h: null, from: document.activeElement };
    // Which view button is lit: the one picked, until the part is turned by hand.
    function light(key) { wrap.querySelectorAll('[data-m3x="view"]').forEach(function (x) { x.classList.toggle('on', x.dataset.key === key); }); }
    b.light = light;
    b.onFull = function () {
      var btn = wrap.querySelector('[data-m3x="full"]'), on = document.fullscreenElement === wrap;
      if (btn) { btn.innerHTML = on ? ICON.unfull : ICON.full; btn.title = on ? 'Leave full screen (F or Esc)' : 'Full screen (F)'; btn.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen'); }
    };
    document.addEventListener('fullscreenchange', b.onFull);
    window.addEventListener('keydown', bigKeys, true);
    wrap.addEventListener('mousedown', function (ev) { if (ev.target === wrap) closeModelView(); });
    wrap.addEventListener('wheel', function (ev) { if (ev.target !== cv) ev.preventDefault(); }, { passive: false });
    cv.addEventListener('pointerdown', function () { light(''); });
    wrap.addEventListener('click', function (ev) {
      var x = ev.target.closest('[data-m3x]');
      if (!x) return;
      var act = x.dataset.m3x, v = BIG_VIEWS.filter(function (o) { return o.key === x.dataset.key; })[0];
      if (act === 'close') closeModelView();
      else if (act === 'full') toggleBigFull();
      else if (act === 'fit' && b.h) b.h.fit();
      else if (act === 'view' && v && b.h) { b.h.view(v.az, v.el); light(v.key); }
    });
    cv.focus({ preventScroll: true });
    loadMesh(mdl.mesh.sha).then(function (mesh) {
      if (bigView !== b) return;
      wrap.querySelector('.xs-load').remove();
      b.h = S.model3d.viewer(cv, mesh);
      // Start where the inspector is: its 3D angle, else the stored picture it shows (Iso, Top, …).
      var small = smallViewer(id), pic = ui.sel === id && BIG_VIEWS.filter(function (o) { return o.key === ui.pic; })[0];
      if (small) b.h.set(small.get());
      else if (pic) { b.h.view(pic.az, pic.el); light(pic.key); }
      else light('iso');
    }, function () { if (bigView === b) closeModelView(); toast('Couldn’t load the 3D model'); });
  }
  function closeModelView() {
    var b = bigView;
    if (!b) return;
    bigView = null;
    window.removeEventListener('keydown', bigKeys, true);
    document.removeEventListener('fullscreenchange', b.onFull);
    if (document.fullscreenElement === b.wrap) document.exitFullscreen().catch(function () {});
    if (b.h) {
      var small = smallViewer(b.id);
      if (small) small.set(b.h.get());
      b.h.destroy();
    }
    b.wrap.remove();
    var back = document.querySelector('[data-act="m3d-open"][data-id="' + CSS.escape(b.id) + '"]') || (b.from && b.from.isConnected ? b.from : null);
    if (back && back.focus) back.focus({ preventScroll: true });
  }
  function toggleBigFull() {
    if (!bigView) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else bigView.wrap.requestFullscreen().catch(function () { toast('Full screen isn’t available here'); });
  }
  // While it's open, keys are its own: none reach PL's shortcuts behind it (Esc closes it, not the
  // inspector). Ctrl and Cmd shortcuts still pass, and Tab stays inside it.
  function bigKeys(e) {
    var b = bigView;
    if (!b || e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    if (e.altKey) return;
    var h = b.h, k = e.key, T = 15 * Math.PI / 180, onButton = e.target.closest && e.target.closest('button');
    if (k === 'Escape') closeModelView();
    else if (k === 'Tab') {
      var all = Array.prototype.slice.call(b.wrap.querySelectorAll('button, canvas[tabindex]')), i = all.indexOf(document.activeElement);
      if (i < 0 || (e.shiftKey ? i === 0 : i === all.length - 1)) { all[e.shiftKey ? all.length - 1 : 0].focus(); e.preventDefault(); }
      return;
    }
    else if (k === 'f' || k === 'F') toggleBigFull();
    else if (!h || ((k === 'Enter' || k === ' ') && onButton)) return;
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { h.turn(k === 'ArrowLeft' ? -T : T, 0); b.light(''); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') { h.turn(0, k === 'ArrowUp' ? -T : T); b.light(''); }
    else if (k === '+' || k === '=') h.zoomBy(1.25);
    else if (k === '-' || k === '_') h.zoomBy(0.8);
    else if (k === '0') h.fit();
    else return;
    e.preventDefault();
  }
  function downloadStep(id) {
    var m = modelOf(current().nodes[id]);
    if (!m || !m.step) return;
    fileBlob(homeOf(current()), { sha: m.step.sha, type: 'application/gzip' })
      .then(function (b) { if (!b) throw new Error('not found'); return b.arrayBuffer(); })
      .then(function (buf) { return S.model3d.gzip(new Uint8Array(buf), 'gunzip'); })
      .then(function (bytes) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/step' }));
        a.download = m.file; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      }, function () { toast('Couldn’t get the STEP file'); });
  }

  // A STEP made ready to attach (model3d.prepare) → the node's model record and the files to keep.
  // Files are named by blob sha; they wait in the upload store until the next sync (in the demo,
  // they stay in this browser).
  function modelRecord(p, nodeId, prep, keepStep) {
    var gh = S.github, dir = 'models/' + p.id + '/' + nodeId + '/';
    var parts = [{ key: 'mesh', blob: new Blob([prep.meshGz], { type: 'application/octet-stream' }) }]
      .concat(keepStep && prep.stepFits ? [{ key: 'step', blob: new Blob([prep.stepGz], { type: 'application/gzip' }) }] : [])
      .concat(prep.views.map(function (v) { return { key: v.key, blob: v.blob, view: v }; }));
    return Promise.all(parts.map(function (x) {
      return x.blob.arrayBuffer().then(function (b) { return gh.gitBlobShaBytes(new Uint8Array(b)); }).then(function (sha) { x.sha = sha; return x; });
    })).then(function (files) {
      var rec = { file: prep.name, size: prep.size, srcTris: prep.srcTris, tris: prep.tris, bboxMm: prep.bboxMm, dir: dir, at: M.now(), by: me(), step: null, views: [] };
      files.forEach(function (f) {
        if (f.key === 'mesh') rec.mesh = { sha: f.sha, size: f.blob.size };
        else if (f.key === 'step') rec.step = { sha: f.sha, size: f.blob.size };
        else rec.views.push({ key: f.key, sha: f.sha, w: f.view.w, h: f.view.h, size: f.blob.size });
      });
      return Promise.all(files.map(function (f) {
        pvPut(f.sha, f.blob);
        return upPut(f.sha, { blob: f.blob, project: p.id, node: nodeId });
      })).then(function () { return rec; });
    });
  }
  // Attach a STEP to a Part without the sheet (also handy from the console): reads it, stores
  // what PL keeps, and fills an empty envelope from its size.
  function attachModel(nodeId, name, bytes, keepStep) {
    var p = current();
    return S.model3d.prepare(name, bytes).then(function (prep) { return modelRecord(p, nodeId, prep, keepStep !== false); }).then(function (rec) {
      var n = p.nodes[nodeId], f = { model: rec };
      if (!n.envelopeMm && rec.bboxMm) f.envelopeMm = rec.bboxMm.join(' × ');
      setNode(nodeId, f);
      return rec;
    });
  }
  // Pictures are client data: they go when PL locks or the token changes, like the projects do.
  function clearPictures() {
    Object.keys(pvUrls).forEach(function (k) { try { URL.revokeObjectURL(pvUrls[k]); } catch (e) { /* gone */ } });
    pvUrls = {}; pvWaiting = {};
    var open = pvDbOpen; pvDbOpen = null;
    (open || Promise.resolve(null)).then(function (db) {
      try { if (db) db.close(); indexedDB.deleteDatabase('signoff-pl-pictures'); } catch (e) { /* storage blocked */ }
    });
  }
  // Theme twins (Loom's harness drawings, 2026-11-09): an image keyed '<key>-dark' is <key> drawn for a
  // dark page. It's never a side of its own: art() puts both in, and CSS shows the one for the theme
  // (pl.css, .pv-light and .pv-dark), so it follows a theme change without a redraw.
  function darkOf(pv, img) {
    return (img && pv.images.filter(function (i) { return i.key === img.key + '-dark'; })[0]) || null;
  }
  function sides(pv) {
    return pv.images.filter(function (i) { return !/-dark$/.test(i.key) || !pv.images.some(function (j) { return j.key + '-dark' === i.key; }); });
  }
  function pictureOf(pv, key) {
    if (!pv) return null;
    var list = sides(pv);
    return list.filter(function (i) { return i.key === (key || pv.hero); })[0] || list[0];
  }
  // The picture of a Part (or of a design in the picker), or its plain drawing.
  function art(n, big, entry, key) {
    var pv = previewFor(n, entry), img = pictureOf(pv, key);
    if (!img) return partArt(n, big);
    var dk = darkOf(pv, img);
    function tag(i, cls) {
      var url = i.src || pvUrls[i.sha];
      return url ? '<img class="pv' + cls + '" alt="" src="' + esc(url) + '">'
        : '<img class="pv' + cls + '" alt="" data-sha="' + esc(i.sha) + '" data-type="' + esc(i.type) + '" data-repo="' + esc(pv.repo) + '">';
    }
    var ready = (img.src || pvUrls[img.sha]) && (!dk || dk.src || pvUrls[dk.sha]);
    return tag(img, dk ? ' pv-light' : '') + (dk ? tag(dk, ' pv-dark') : '') + (ready ? '' : partArt(n, big));
  }
  function loadPictures(root) {
    if (!allowed()) return;
    (root || document).querySelectorAll('img.pv[data-sha]').forEach(function (el) {
      var img = { sha: el.dataset.sha, type: el.dataset.type };
      el.removeAttribute('data-sha');
      pictureUrl(el.dataset.repo, img).then(function (url) {
        if (!url) return;
        el.src = url;
        var svg = el.parentNode && el.parentNode.querySelector('svg');
        if (svg) svg.remove();
      });
    });
  }

  // Structure layouts. Map is the default; Gallery and Exploded show the stored pictures.
  var LAYOUTS = [['map', 'Map'], ['gallery', 'Gallery'], ['exploded', 'Exploded'], ['list', 'List']];

  // The groups of the map (one per lane), as [{ id, name, parts: [node ids] }], in tree order.
  function laneGroups(t, ids) {
    var top = t.roots.length === 1 && t.nodes[t.roots[0]].kind === 'assembly' ? t.roots[0] : '';
    var level = top ? t.children[top] || [] : t.roots, out = [], loose = [];
    level.forEach(function (id) {
      if (t.nodes[id].kind !== 'assembly') { loose.push(id); return; }
      var inside = P.descendants(t, id);
      out.push({ id: id, name: t.nodes[id].name || 'Unnamed', parts: ids.filter(function (x) { return inside[x] && t.nodes[x].kind !== 'assembly'; }) });
    });
    if (loose.length) out.push({ id: top, name: top ? t.nodes[top].name : 'Top level', parts: loose });
    return out;
  }

  // Big pictures, a section per assembly.
  function gallery(p, t, ids) {
    return trayHtml(p) + '<div class="gal">' + laneGroups(t, ids).map(function (g) {
      if (!g.parts.length) return '';
      return '<section class="gal-sec" data-drop="' + esc(g.id) + '"><div class="map-group-name static">' + esc(g.name) + '</div><div class="gal-grid">' + g.parts.map(function (id) {
        var n = t.nodes[id], st = P.partStatus(n, index), e = st.entry || {};
        return '<button class="gal-tile' + (ui.sel === id ? ' sel' : '') + '" data-act="select-node" data-id="' + esc(id) + '" draggable="true" data-drag-node="' + esc(id) + '">' +
          '<div class="gal-art map-art">' + art(n, true, st.entry) + '</div><div class="map-name">' + esc(n.name || 'Unnamed') + (n.qty > 1 ? ' <span class="map-qty">×' + esc(n.qty) + '</span>' : '') + '</div>' +
          '<div class="map-meta"><span>' + esc(e.number || n.number || mpnOf(n) || '') + (e.revision ? ' · Rev ' + esc(e.revision) : '') + '</span>' + srcChip(n.source) + '</div></button>';
      }).join('') + '</div></section>';
    }).join('') + '</div>';
  }

  // ── Exploded: the product in 3D ──────────────────────────
  // A Part with an attached model shows as that model; a board as a slab carrying its Fabcheck
  // pictures, once its size is known (Fabcheck stores it, or it's typed in here). Nothing PL doesn't
  // have is drawn: the rest are named below the view. Each Part sits where node.place puts it (all
  // zeros is its CAD position); Parts never moved are stacked in structure order, first on top. The
  // slider pulls the parts apart from the middle. Click a part to arrange it in the panel.
  var M3 = S.model3d, DEG = Math.PI / 180;
  function boardSize(n, entry) { return P.cleanBoard(n.boardMm) || (entry && entry.preview && entry.preview.board) || null; }
  function sceneList(t, ids) {
    var parts = [], missing = [], sizeless = [];
    ids.forEach(function (id) {
      var n = t.nodes[id];
      if (n.kind !== 'part') return;
      var e = P.partStatus(n, index).entry, m = modelOf(n), pv = e && e.preview;
      if (m) { parts.push({ id: id, n: n, kind: 'model', model: m }); return; }
      if (n.source === 'ee' && pv) {
        var size = boardSize(n, e);
        if (size) parts.push({ id: id, n: n, kind: 'board', size: size, pv: pv }); else sizeless.push(id);
        return;
      }
      if (P.toolById(n.source) || n.source === 'purchased') missing.push(id);
    });
    return { parts: parts, missing: missing, sizeless: sizeless };
  }

  // Board pictures as textures, decoded once per picture.
  var texCache = {};
  function loadTexture(pv, key) {
    var img = pv.images.filter(function (i) { return i.key === key; })[0];
    if (!img) return Promise.resolve(null);
    var k = img.sha || img.src;
    if (!texCache[k]) {
      texCache[k] = (img.src ? Promise.resolve(img.src) : pictureUrl(pv.repo, img)).then(function (url) {
        return url && new Promise(function (resolve) {
          var im = new Image();
          im.onload = function () {
            var w = 1024, h = Math.max(1, Math.round(w * (im.naturalHeight || img.h || 1) / (im.naturalWidth || img.w || 1)));
            var c = document.createElement('canvas'), g = c.getContext('2d');
            c.width = w; c.height = h; g.drawImage(im, 0, 0, w, h);
            resolve(M3.texture(g.getImageData(0, 0, w, h)));
          };
          im.onerror = function () { resolve(null); };
          im.src = url;
        });
      });
      texCache[k].then(function (r) { if (!r) delete texCache[k]; });
    }
    return texCache[k];
  }
  function sceneObjects(list) {
    return Promise.all(list.parts.map(function (s) {
      var made = s.kind === 'model' ? loadMesh(s.model.mesh.sha).then(function (mesh) { return { mesh: mesh, tex: null }; })
        : Promise.all([loadTexture(s.pv, 'top'), loadTexture(s.pv, 'bottom')]).then(function (tx) { return { mesh: M3.slab(s.size[0], s.size[1], s.size[2]), tex: { 1: tx[0], 2: tx[1] } }; });
      return made.then(function (o) {
        var b = M3.bbox(o.mesh.pos);
        return Object.assign(o, { id: s.id, s: s, pivot: [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2] });
      }, function () { return null; });
    })).then(function (objs) { return objs.filter(Boolean); });
  }
  // Placed Parts go where their place says. The others stack downward from z = 0 in structure
  // order, each centered; placed Parts keep their slot in the stack, so moving one doesn't shift
  // the rest.
  function arrangeScene(objs) {
    var top = 0;
    objs.forEach(function (o) {
      var pl = P.cleanPlace(o.s.n.place);
      o.placed = !!pl;
      o.rot = pl ? [pl.rx, pl.ry, pl.rz] : [0, 0, 0];
      o.R = M3.rotation(o.rot[0], o.rot[1], o.rot[2]);
      o.T = [0, 0, 0];
      var b = M3.placedBox(o);
      if (pl) o.T = [pl.x, pl.y, pl.z];
      else o.T = [-b.c[0], -b.c[1], top - b.hi[2]];
      top -= b.size[2];
    });
  }
  function boxOf(o, T) { return M3.placedBox({ mesh: o.mesh, R: o.R, pivot: o.pivot, T: T || o.T }); }
  function explodeOffsets(objs, k) {
    if (!k || objs.length < 2) return objs.map(function () { return [0, 0, 0]; });
    var boxes = objs.map(function (o) { return boxOf(o, o.liveT); }), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    boxes.forEach(function (b) { for (var i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.lo[i]); hi[i] = Math.max(hi[i], b.hi[i]); } });
    // Layers move apart in Z by their order from the top (thin boards need a set step, not their
    // own spacing), and a little outward in X and Y.
    var c = [0, 1, 2].map(function (i) { return (lo[i] + hi[i]) / 2; }), step = Math.max(8, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.22);
    var order = boxes.map(function (b, i) { return i; }).sort(function (x, y) { return boxes[y].c[2] - boxes[x].c[2] || x - y; }), rank = [];
    order.forEach(function (oi, r) { rank[oi] = r; });
    var mid = (boxes.length - 1) / 2;
    return boxes.map(function (b, i) { return [(b.c[0] - c[0]) * k * 0.5, (b.c[1] - c[1]) * k * 0.5, (mid - rank[i]) * step * k]; });
  }
  function fitCam(objs, keepView) {
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    objs.forEach(function (o) { var b = boxOf(o); for (var i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.lo[i]); hi[i] = Math.max(hi[i], b.hi[i]); } });
    if (!objs.length) { lo = [-50, -50, -50]; hi = [50, 50, 50]; }
    var old = keepView && ui.cam;
    ui.cam = { az: old ? old.az : M3.VIEWS[0].az, el: old ? old.el : M3.VIEWS[0].el, zoom: 1,
      n: objs.length, c: [0, 1, 2].map(function (i) { return (lo[i] + hi[i]) / 2; }), fit: Math.max(20, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1.15) };
  }

  var scene = null, snapState = null;   // snapState: { step: 1 | 2, from } while snapping the selected part
  function exploded(p, t, ids) {
    var list = sceneList(t, ids), spread = ui.spread == null ? 60 : ui.spread;
    var names = function (arr) { return arr.map(function (id) { return '<button class="xs-name" data-act="select-node" data-id="' + esc(id) + '">' + esc(t.nodes[id].name || 'Unnamed') + '</button>'; }).join(', '); };
    if (!list.parts.length && !list.sizeless.length) {
      return '<div class="card empty"><div class="empty-art">' + ICON.tree + '</div><h2>Nothing in 3D yet</h2><p>A board shows here once its Fabcheck run is stored with its review (Send to Signoff) and its size is known. A purchased or ME Part shows once you attach its STEP (Edit the Part).</p></div>';
    }
    return '<div class="xs card"><div class="xs-stage"><canvas class="xs-canvas" tabindex="0" aria-label="The product in 3D: drag to turn, Shift-drag to pan, scroll to zoom, click a part to arrange it"></canvas><canvas class="xs-over" aria-hidden="true"></canvas>' +
      '<div class="xs-hint" hidden></div><div class="xs-load"><span class="spin" aria-hidden="true"></span>Loading 3D…</div></div>' +
      '<div class="xs-ctl"><div class="seg" role="group" aria-label="View">' + M3.VIEWS.map(function (v) { return '<button data-act="xs-view" data-key="' + v.key + '">' + v.label + '</button>'; }).join('') + '</div>' +
      '<button class="btn" data-act="xs-fit">Fit</button>' +
      '<label for="xs-spread">Assembled</label><input type="range" id="xs-spread" min="0" max="120" value="' + spread + '"><span>Exploded</span></div>' +
      '<p class="note">Drag to turn, Shift-drag to pan, scroll to zoom. Click a part to move, turn, or snap it. Parts you haven’t moved are stacked in structure order.' +
      (list.sizeless.length ? ' Boards that need a size first: ' + names(list.sizeless) + '.' : '') +
      (list.missing.length ? ' Not shown, no 3D yet: ' + names(list.missing) + '.' : '') + '</p></div>';
  }

  function sceneObjAt(id) { return scene && scene.objs.filter(function (o) { return o.id === id; })[0]; }
  function initScene(root) {
    var cv = root.querySelector('canvas.xs-canvas');
    if (!cv) { scene = null; return; }
    var p = current(), t = P.tree(p), token = {};
    scene = { token: token, cv: cv, over: root.querySelector('canvas.xs-over'), hint: root.querySelector('.xs-hint'), objs: [], res: null, drag: null, hover: null };
    sceneObjects(sceneList(t, P.flatten(t))).then(function (objs) {
      if (!scene || scene.token !== token) return;
      var load = root.querySelector('.xs-load');
      if (load) load.remove();
      scene.objs = objs;
      arrangeScene(objs);
      if (!ui.cam || ui.cam.n !== objs.length) { fitCam(objs, !!ui.cam); ui.cam.n = objs.length; }
      bindScene(scene);
      drawScene(true);
      showSnapHint();
    });
  }
  // fine: full resolution (and supersampled where the screen isn't already dense); otherwise a
  // quick draw at one pixel per CSS pixel while dragging.
  function drawScene(fine) {
    var sc = scene;
    if (!sc || !sc.cv.isConnected || !ui.cam) return;
    var w = sc.cv.clientWidth, h = sc.cv.clientHeight, dpr = fine ? Math.min(2, window.devicePixelRatio || 1) : 1;
    if (!w || !h) return;
    var W = Math.round(w * dpr), H = Math.round(h * dpr), k = sc.drag && sc.drag.kind === 'move' ? 0 : (ui.spread == null ? 60 : ui.spread) / 60;
    var offs = explodeOffsets(sc.objs, k), sel = -1;
    var objs = sc.objs.map(function (o, i) {
      if (o.id === ui.sel) sel = i;
      var T = o.liveT || o.T;
      return { mesh: o.mesh, R: o.R, pivot: o.pivot, T: [T[0] + offs[i][0], T[1] + offs[i][1], T[2] + offs[i][2]], tex: o.tex };
    });
    sc.res = M3.renderScene(objs, ui.cam, W, H, { ss: fine && dpr < 2 && W * H < 1600000 ? 2 : 1, sel: sel });
    sc.placed = objs; sc.scale = W / w;
    sc.cv.width = W; sc.cv.height = H;
    sc.cv.getContext('2d').putImageData(sc.res.image, 0, 0);
    drawOverlay();
  }
  var sceneRaf = 0, sceneIdle = 0;
  function sceneLater() {
    cancelAnimationFrame(sceneRaf); clearTimeout(sceneIdle);
    sceneRaf = requestAnimationFrame(function () { drawScene(false); });
    sceneIdle = setTimeout(function () { drawScene(true); }, 260);
  }

  // Saves where a part is: its translation now, and its turn (degrees about X, Y, Z).
  function commitPlace(o, T, rot) {
    var r = rot || o.rot, round = function (v) { return Math.round(v * 100) / 100; };
    setNode(o.id, { place: { x: round(T[0]), y: round(T[1]), z: round(T[2]), rx: ((r[0] % 360) + 360) % 360, ry: ((r[1] % 360) + 360) % 360, rz: ((r[2] % 360) + 360) % 360 } });
  }
  function assembled() {
    if (ui.spread !== 0) { ui.spread = 0; var sl = $('#xs-spread'); if (sl) sl.value = 0; }
  }

  function bindScene(sc) {
    var cv = sc.cv;
    function at(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('pointerdown', function (e) {
      if (!sc.res) return;
      cv.focus();
      var xy = at(e), hit = sc.res.pick(xy[0] * sc.scale, xy[1] * sc.scale), o = hit && sc.objs[hit.obj];
      if (snapState && e.button === 0 && !e.shiftKey) { if (sc.hover && !sc.hover.none) snapPick(sc.hover); return; }
      if (e.button === 0 && !e.shiftKey && o && o.id === ui.sel) {
        assembled();
        sc.drag = { kind: 'move', o: o, x0: xy[0], y0: xy[1], T0: o.T.slice() };
      } else {
        sc.drag = { kind: e.button === 0 && !e.shiftKey ? 'orbit' : 'pan', x0: xy[0], y0: xy[1], az: ui.cam.az, el: ui.cam.el, c: ui.cam.c.slice(), hit: o ? o.id : '', moved: false };
      }
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', function (e) {
      var d = sc.drag, xy = at(e);
      if (!d) { if (snapState) snapHover(xy); return; }
      var dx = xy[0] - d.x0, dy = xy[1] - d.y0;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.kind === 'orbit') {
        var turned = M3.orbit(d.az, d.el, dx, dy);   // the product follows the pointer, as in the inspector
        ui.cam.az = turned.az; ui.cam.el = turned.el;
      } else if (d.kind === 'pan') {
        var w = sc.res.unproject(dx * sc.scale, dy * sc.scale);
        ui.cam.c = [d.c[0] - w[0], d.c[1] - w[1], d.c[2] - w[2]];
      } else {
        // Seen from above, a part moves in X and Y; seen from the side, sideways and up or down.
        var mv = sc.res.unproject(dx * sc.scale, dy * sc.scale);
        if (Math.abs(ui.cam.el) > 45 * DEG) mv[2] = 0;
        else { var k = Math.hypot.apply(null, sc.res.unproject(1, 0)) * sc.scale; mv = [sc.res.cam.r[0] * dx * k, sc.res.cam.r[1] * dx * k, -dy * k]; }
        var grid = e.altKey ? 0.01 : 0.5;
        d.o.liveT = d.T0.map(function (v, i) { return mv[i] ? Math.round((v + mv[i]) / grid) * grid : v; });
        showHint(d.o.liveT.map(function (v) { return (Math.round(v * 10) / 10).toLocaleString(); }).join(', ') + ' mm');
      }
      sceneLater();
    });
    cv.addEventListener('pointerup', function () {
      var d = sc.drag;
      sc.drag = null;
      if (!d) return;
      if (d.kind === 'move') { showHint(''); if (d.o.liveT) commitPlace(d.o, d.o.liveT); return; }
      if (!d.moved) { ui.sel = d.hit; ui.pic = ''; snapState = null; saveUi(); renderPage(); return; }
      drawScene(true);
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      ui.cam.zoom = Math.max(0.2, Math.min(40, ui.cam.zoom * Math.exp(-e.deltaY * 0.0015)));
      sceneLater();
    }, { passive: false });
    cv.addEventListener('dblclick', function (e) { if (!snapState && !sc.res.pick(at(e)[0] * sc.scale, at(e)[1] * sc.scale)) { fitCam(sc.objs, true); drawScene(true); } });
    // Arrows nudge the selected part 1 mm in X and Y (10 with Shift), Page Up and Down in Z; R turns it.
    cv.addEventListener('keydown', function (e) {
      var o = sceneObjAt(ui.sel);
      if (!o) return;
      var step = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, step, 0], ArrowDown: [0, -step, 0], PageUp: [0, 0, step], PageDown: [0, 0, -step] }[e.key];
      if (mv) { e.preventDefault(); assembled(); commitPlace(o, [o.T[0] + mv[0], o.T[1] + mv[1], o.T[2] + mv[2]]); }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); turnPart(o, 2); }
    });
  }
  function showHint(text) { if (scene && scene.hint) { scene.hint.textContent = text; scene.hint.hidden = !text; } }

  function turnPart(o, axis) {
    var rot = o.rot.slice();
    rot[axis] += 90;
    commitPlace(o, o.T, rot);
  }
  function stackOn(o, target) {
    var b = boxOf(o), tb = boxOf(target);
    commitPlace(o, [o.T[0] + tb.c[0] - b.c[0], o.T[1] + tb.c[1] - b.c[1], o.T[2] + tb.hi[2] - b.lo[2]]);
  }
  function centerOn(o, target) {
    var b = boxOf(o), tb = boxOf(target);
    commitPlace(o, [o.T[0] + tb.c[0] - b.c[0], o.T[1] + tb.c[1] - b.c[1], o.T[2]]);
  }

  // ── Snapping ─────────────────────────────────────────────
  // Pick a feature on the selected part, then one on another part; the selected part moves so the
  // first lands on the second (model3d.alignMove). Corners, edges, hole axes, and flat faces.
  var featCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function featsOf(mesh) {
    var f = featCache && featCache.get(mesh);
    if (!f) { f = M3.features(mesh); if (featCache) featCache.set(mesh, f); }
    return f;
  }
  function vtxOf(mesh, i) { return [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]]; }
  function segDist(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1], l = vx * vx + vy * vy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
  }
  // The feature under the cursor on scene object oi (x, y in render pixels).
  function featureAt(oi, tri, x, y) {
    var sc = scene, o = sc.objs[oi], po = sc.placed[oi], F = featsOf(o.mesh), s = sc.scale, best = null, bestD = 9 * s;
    // Picked on screen as drawn (perhaps exploded); kept in assembled coordinates, since exploding
    // only shifts each part, so a snap made in the exploded view lands right when assembled.
    var asm = { R: o.R, pivot: o.pivot, T: o.T };
    function W(p) { return M3.place(asm, p); }
    function S2(p) { return sc.res.project(M3.place(po, p)); }
    // Seen, or hidden only by the part being moved (which may cover the spot it should go).
    var tol = (ui.cam.fit || 100) * 0.01;
    function seen(q) {
      var h = sc.res.pick(Math.min(Math.max(q[0], 0), sc.cv.width - 1), Math.min(Math.max(q[1], 0), sc.cv.height - 1));
      return !h || h.obj === oi || q[2] >= h.depth - tol || (snapState && snapState.step === 2 && sc.objs[h.obj].id === ui.sel);
    }
    F.corners.forEach(function (v) {
      var p = vtxOf(o.mesh, v), q = S2(p), d = Math.hypot(q[0] - x, q[1] - y);
      if (d < bestD && seen(q)) { bestD = d; best = { type: 'point', p: W(p), label: 'Corner', obj: oi, rank: 0, dist: d, draw: { dot: p } }; }
    });
    if (best) return best;
    bestD = 7 * s;
    var hitSeg = -1;
    F.segs.forEach(function (e, i) {
      var a = S2(vtxOf(o.mesh, e.a)), b = S2(vtxOf(o.mesh, e.b)), d = segDist([x, y], a, b);
      if (d >= bestD) return;
      var vx = b[0] - a[0], vy = b[1] - a[1], l = vx * vx + vy * vy, u = l ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l)) : 0;
      if (seen([a[0] + vx * u, a[1] + vy * u, a[2] + (b[2] - a[2]) * u])) { bestD = d; hitSeg = i; }
    });
    if (hitSeg >= 0) {
      var e = F.segs[hitSeg];
      if (e.circle >= 0) {
        var c = F.circles[e.circle];
        return { type: 'line', p: W(c.c), d: M3.turn(po, c.n), label: 'Hole axis, ⌀' + fmtLen(c.r * 2), obj: oi, rank: 1, dist: bestD, draw: { circle: e.circle, center: c.c } };
      }
      var A = vtxOf(o.mesh, e.a), B = vtxOf(o.mesh, e.b);
      return { type: 'line', p: W(A), d: M3.turn(po, [B[0] - A[0], B[1] - A[1], B[2] - A[2]]), label: 'Edge', obj: oi, rank: 1, dist: bestD, draw: { group: e.g } };
    }
    if (tri >= 0) {
      var f = F.region[tri], pl = F.planes[f];
      if (pl) return { type: 'plane', p: W(pl.p), n: M3.turn(po, pl.n), label: 'Flat face', obj: oi, rank: 2, dist: 0, draw: { face: f } };
      return { none: true, label: 'Curved face: pick an edge, a hole, or a flat face', obj: oi, draw: {} };
    }
    return null;
  }
  function fmtLen(mm) { return (Math.round(mm * 100) / 100).toLocaleString() + ' mm'; }
  function snapHover(xy) {
    var sc = scene, x = xy[0] * sc.scale, y = xy[1] * sc.scale, found = null;
    var want = function (oi) { var id = sc.objs[oi].id; return snapState.step === 1 ? id === ui.sel : id !== ui.sel; };
    // The part under the cursor first. Failing that (the cursor is on the outline, or on the part
    // being moved, which may hide the spot it should go), the nearest corner or edge of any part
    // that can be picked.
    var h = sc.res.pick(x, y);
    sc.objs.forEach(function (o, oi) {
      if (!want(oi)) return;
      var f = featureAt(oi, h && h.obj === oi ? h.tri : -1, x, y);
      if (f && (!found || (found.none && !f.none) || f.rank < found.rank || (f.rank === found.rank && f.dist < found.dist))) found = f;
    });
    sc.hover = found;
    showHint(found ? found.label : '');
    drawOverlay();
  }
  function snapPick(f) {
    if (snapState.step === 1) { snapState = { step: 2, from: f }; scene.hover = null; showSnapHint(); drawOverlay(); return; }
    var o = sceneObjAt(ui.sel), mv = M3.alignMove(snapState.from, f), from = snapState.from;
    snapState = null;
    toast('Snapped: ' + from.label.toLowerCase() + ' to ' + f.label.toLowerCase());
    commitPlace(o, [o.T[0] + mv[0], o.T[1] + mv[1], o.T[2] + mv[2]]);
  }
  function showSnapHint() {
    var el = $('.xs-snap-step');
    if (!el) return;
    var n = sceneObjAt(ui.sel);
    el.textContent = !snapState ? '' : snapState.step === 1 ? 'Step 1 of 2: pick a corner, edge, hole, or flat face on ' + (n ? n.s.n.name : 'this part') + '.'
      : 'Step 2 of 2: pick where it goes on another part (' + snapState.from.label.toLowerCase() + ' picked).';
  }
  // Draws the hovered feature (accent) and, while placing it, the one picked first (orange).
  function drawOverlay() {
    var sc = scene;
    if (!sc || !sc.over || !sc.res) return;
    var ov = sc.over, g = ov.getContext('2d');
    ov.width = sc.cv.width; ov.height = sc.cv.height;
    g.clearRect(0, 0, ov.width, ov.height);
    [[snapState && snapState.from, '#e07800'], [sc.hover, '#00a3b4']].forEach(function (pair) {
      var f = pair[0];
      if (!f || f.none || !sc.placed[f.obj]) return;
      var o = sc.objs[f.obj], po = sc.placed[f.obj], F = featsOf(o.mesh);
      var P2 = function (p) { var q = sc.res.project(M3.place(po, p)); return [q[0], q[1]]; };
      g.strokeStyle = g.fillStyle = pair[1]; g.lineWidth = 3 * sc.scale; g.lineCap = 'round';
      if (f.draw.dot) { var q = P2(f.draw.dot); g.beginPath(); g.arc(q[0], q[1], 5 * sc.scale, 0, 7); g.fill(); }
      if (f.draw.group != null || f.draw.circle != null) {
        g.beginPath();
        F.segs.forEach(function (e) {
          if (f.draw.group != null ? e.g !== f.draw.group : e.circle !== f.draw.circle) return;
          var a = P2(vtxOf(o.mesh, e.a)), b = P2(vtxOf(o.mesh, e.b));
          g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
        });
        g.stroke();
      }
      if (f.draw.center) {
        var c = P2(f.draw.center), r = 7 * sc.scale;
        g.lineWidth = 1.5 * sc.scale; g.beginPath(); g.moveTo(c[0] - r, c[1]); g.lineTo(c[0] + r, c[1]); g.moveTo(c[0], c[1] - r); g.lineTo(c[0], c[1] + r); g.stroke();
      }
      if (f.draw.face != null) {
        g.globalAlpha = 0.35; g.beginPath();
        for (var t = 0; t < o.mesh.idx.length / 3; t++) {
          if (F.region[t] !== f.draw.face) continue;
          var a2 = P2(vtxOf(o.mesh, o.mesh.idx[t * 3])), b2 = P2(vtxOf(o.mesh, o.mesh.idx[t * 3 + 1])), c2 = P2(vtxOf(o.mesh, o.mesh.idx[t * 3 + 2]));
          g.moveTo(a2[0], a2[1]); g.lineTo(b2[0], b2[1]); g.lineTo(c2[0], c2[1]); g.closePath();
        }
        g.fill(); g.globalAlpha = 1;
      }
    });
  }

  // The panel beside the 3D view: where the selected part is, and the tools that move it.
  function arrangePanel(p, t, id) {
    var n = t.nodes[id], st = P.partStatus(n, index), e = st && st.entry, html = '<aside class="map-ins card xs-panel" aria-label="Arrange ' + esc(n.name) + '"><button class="icon-btn map-ins-close" data-act="close-ins" aria-label="Close">×</button>';
    html += '<h2>' + esc(n.name || 'Unnamed') + '</h2><p class="map-ins-sub">' + esc([e && e.number || n.number || mpnOf(n), n.kind === 'assembly' ? 'Assembly' : ''].filter(Boolean).join(' · ')) + '</p>';
    if (n.kind !== 'part') return html + '<p class="map-ins-text">Assemblies aren’t drawn; arrange the Parts in them.</p></aside>';
    var list = sceneList(t, [id]), inScene = list.parts.length > 0, board = n.source === 'ee' && e && e.preview;
    if (inScene) {
      var pl = P.cleanPlace(n.place) || null;
      html += '<div class="xs-xyz">' + ['x', 'y', 'z'].map(function (k, i) {
        return '<label><span>' + k.toUpperCase() + '</span><input class="input" type="number" step="0.5" data-xyz="' + i + '" value="' + (pl ? pl[k] : '') + '" placeholder="auto"></label>';
      }).join('') + '<span class="xs-unit">mm</span></div>' +
        '<div class="field-label">Turn 90°</div><div class="seg full xs-turn">' + ['X', 'Y', 'Z'].map(function (a, i) { return '<button data-act="xs-turn" data-axis="' + i + '">' + a + '</button>'; }).join('') + '</div>' +
        (pl && (pl.rx || pl.ry || pl.rz) ? '<p class="note">Turned ' + [pl.rx, pl.ry, pl.rz].map(function (v, i) { return 'XYZ'[i] + ' ' + v + '°'; }).join(', ') + '</p>' : '') +
        '<div class="field-label">Snap</div>' +
        (snapState ? '<p class="xs-snap-step"></p><button class="btn" data-act="xs-snap-cancel">Cancel</button>'
          : '<button class="btn btn-primary" data-act="xs-snap">Snap to another part…</button><p class="note">Pick a corner, edge, hole, or flat face here, then one on another part. Faces become flush, edges and hole axes line up, corners meet.</p>');
      var others = sceneList(t, P.flatten(t)).parts.filter(function (s) { return s.id !== id; });
      if (others.length) {
        html += '<div class="field-label">Line up with</div><div class="xs-line"><select class="input" id="xs-target">' + others.map(function (s) { return '<option value="' + esc(s.id) + '"' + (ui.xsTarget === s.id ? ' selected' : '') + '>' + esc(s.n.name || 'Unnamed') + '</option>'; }).join('') + '</select>' +
          '<button class="btn" data-act="xs-stack" title="Put this part on top of it, centered">Stack on</button><button class="btn" data-act="xs-center" title="Center this part over it in X and Y">Center on</button></div>';
      }
      html += '<div class="map-ins-acts">' + (pl ? '<button class="btn" data-act="xs-auto" title="Forget where it was put; stack it with the others">Back to stack</button>' : '') +
        (list.parts[0].kind === 'model' ? '<button class="btn" data-act="xs-cad" title="Where its STEP puts it: parts exported from one CAD assembly line up">CAD position</button>' : '') + '</div>' +
        '<p class="note">Drag the part to move it (from above in X and Y, from the side up and down; Alt for no grid). Arrows nudge 1 mm, Shift 10 mm, Page Up/Down in Z, R turns it.</p>';
    } else if (!board) {
      html += '<p class="map-ins-text">' + (MODEL_SOURCES[n.source] ? 'No 3D yet. Attach its STEP to show it here.' : 'No 3D for this kind of Part.') + '</p>';
    }
    if (board) {
      var size = boardSize(n, e), fab = e.preview.board;
      html += '<div class="field-label">Board size (mm)</div><div class="xs-xyz">' + ['W', 'H', 'T'].map(function (k, i) {
        return '<label><span>' + k + '</span><input class="input" type="number" min="0" step="0.1" data-board="' + i + '" value="' + (size ? size[i] : i === 2 ? 1.6 : '') + '"></label>';
      }).join('') + '</div><div class="map-ins-acts"><button class="btn' + (size ? '' : ' btn-primary') + '" data-act="xs-size">' + (size ? 'Update size' : 'Set size') + '</button></div>' +
        '<p class="note">' + (fab && !P.cleanBoard(n.boardMm) ? 'From Fabcheck.' : fab ? 'Typed in; Fabcheck measured ' + fab.join(' × ') + '.' : 'Fabcheck stores the size with the board’s pictures from its next Send to Signoff; until then, type it in.') + '</p>';
    }
    return html + '<div class="map-ins-acts"><button class="btn" data-act="edit-node" data-id="' + esc(id) + '">Edit Part</button></div></aside>';
  }
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'xs-spread') return;
    ui.spread = Number(e.target.value);
    sceneLater();
  });
  document.addEventListener('change', function (e) {
    var o = sceneObjAt(ui.sel);
    if (e.target.dataset.xyz != null && o) {
      var T = o.T.slice(), v = Number(e.target.value);
      if (e.target.value !== '' && isFinite(v)) { T[Number(e.target.dataset.xyz)] = v; assembled(); commitPlace(o, T); }
    }
    if (e.target.id === 'xs-target') ui.xsTarget = e.target.value;
  });
  function sceneAction(act, el) {
    var o = sceneObjAt(ui.sel), sel = $('#xs-target'), target = sel && sceneObjAt(sel.value);
    switch (act) {
      case 'xs-view':
        var v = M3.VIEWS.filter(function (x) { return x.key === el.dataset.key; })[0];
        if (v && ui.cam) { ui.cam.az = v.az; ui.cam.el = v.el; drawScene(true); }
        break;
      case 'xs-fit': if (scene) { fitCam(scene.objs, true); drawScene(true); } break;
      case 'xs-turn': if (o) { assembled(); turnPart(o, Number(el.dataset.axis)); } break;
      case 'xs-stack': if (o && target) { assembled(); stackOn(o, target); } break;
      case 'xs-center': if (o && target) { assembled(); centerOn(o, target); } break;
      case 'xs-auto': if (o) setNode(o.id, { place: null }); break;
      case 'xs-cad': if (o) setNode(o.id, { place: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }); break;
      case 'xs-snap': if (o) { snapState = { step: 1 }; renderPage(); } break;
      case 'xs-snap-cancel': snapState = null; renderPage(); break;
      case 'xs-size':
        var vals = [].map.call(document.querySelectorAll('[data-board]'), function (i) { return i.value; }), b = P.cleanBoard(vals);
        if (!b) { toast('Type the board’s width and height in mm (thickness defaults to 1.6)'); break; }
        setNode(ui.sel, { boardMm: b });
        break;
    }
  }

  // ── Building from the client project ─────────────────────
  // Each EE and ME summary names its client project. The designs of this product's client project
  // that no Part links to yet wait in a tray above the map: drag one onto an assembly, click it to
  // add it with the Part sheet, or add them all (boards under Electronics, parts under Mechanical).
  function clientProjects() {
    var seen = {};
    Object.keys((index && index.entries) || {}).forEach(function (k) { var s = index.entries[k].summary; if (s && s.project) seen[s.project] = 1; });
    return Object.keys(seen).sort();
  }
  function clientProjectOf(p) { return String(p.meta.clientProject || p.meta.name || '').trim(); }
  function unplaced(p) {
    var want = clientProjectOf(p).toLowerCase(), used = {}, t = P.tree(p);
    if (!want) return [];
    P.flatten(t).forEach(function (id) { if (t.nodes[id].ref) used[P.refKey(t.nodes[id].ref)] = 1; });
    return C.tools.reduce(function (all, tool) { return all.concat(S.plReader.designs(index, tool.id)); }, []).filter(function (d) {
      return !d.archived && !used[d.tool + ':' + d.id] && d.summary && String(d.summary.project || '').toLowerCase() === want &&
        !P.claimedElsewhere(d.summary, Object.keys(projects).map(function (k) { return projects[k]; }), d.tool);
    });
  }
  function trayHtml(p) {
    var list = unplaced(p);
    if (!list.length) return '';
    return '<section class="map-tray"><div class="map-tray-head"><div><b>' + plural(list.length, 'design') + ' in ' + esc(clientProjectOf(p)) + (list.length === 1 ? ' isn’t' : ' aren’t') + ' in the product yet</b>' +
      '<span>Drag one onto an assembly, or click it to add it.</span></div><button class="btn btn-primary" data-act="place-all">Add ' + (list.length === 1 ? 'it' : 'all ' + list.length) + '</button></div>' +
      '<div class="map-tray-cards">' + list.map(function (d) {
        var s = d.summary;
        return '<button class="pick" draggable="true" data-drag-design="' + esc(d.tool + ':' + d.id) + '" data-act="place-design" data-key="' + esc(d.tool + ':' + d.id) + '">' +
          '<div class="map-art">' + art({ source: d.tool, number: d.number }, false, d) + '</div><div class="pick-body"><div class="map-name">' + esc(d.name || d.id) + '</div>' +
          '<div class="map-meta"><span>' + esc([d.number, d.revision && 'Rev ' + d.revision].filter(Boolean).join(' · ')) + '</span><span>' + esc(designStat(s)) + '</span></div>' +
          '<div class="pick-tags">' + srcChip(d.tool) + (P.isAssemblyDesign(d) ? '<span>Assembly</span>' : '') + '</div></div></button>';
      }).join('') + '</div></section>';
  }
  function designPart(p, key, parent) {
    var d = index && index.entries[key];
    if (!d) return null;
    var asm = P.isAssemblyDesign(d);   // a review of an assembly (Signoff ME) makes an assembly node
    var node = P.newNode(p, { kind: asm ? 'assembly' : 'part', name: d.name || d.id, number: d.number || '', parent: parent || '', source: d.tool, ref: { tool: d.tool, id: d.id }, qty: 1,
      identAt: P.isDrawing(d.tool) && d.summary ? d.summary.identAt || '' : undefined }, me());
    p.nodes[node.id] = node;
    return node;
  }
  var GROUPS = { ee: 'Electronics', me: 'Mechanical', loom: 'Harnesses' };   // where "Add all" puts each tool's designs
  // Parts that can carry an attached STEP: purchased ones, ME parts (until a mechanical checker
  // stores their pictures) and boards, whose tiles keep Fabcheck's pictures (previewFor).
  var MODEL_SOURCES = { purchased: 1, me: 1, ee: 1 };
  function placeAll(p) {
    var list = unplaced(p), t = P.tree(p);
    var top = t.roots.length === 1 && t.nodes[t.roots[0]].kind === 'assembly' ? t.roots[0] : '';
    if (!t.roots.length) {
      var root = P.newNode(p, { kind: 'assembly', name: p.meta.name, number: p.meta.number || '', parent: '' }, me());
      p.nodes[root.id] = root; top = root.id;
    }
    var asm = {};
    list.forEach(function (d) {
      var name = GROUPS[d.tool] || (P.toolById(d.tool) || {}).name || 'Parts', k = name.toLowerCase();
      if (!asm[k]) {
        var tt = P.tree(p), hit = (top ? tt.children[top] || [] : tt.roots).filter(function (x) { return tt.nodes[x].kind === 'assembly' && String(tt.nodes[x].name).toLowerCase() === k; })[0];
        if (!hit) { var a = P.newNode(p, { kind: 'assembly', name: name, parent: top }, me()); p.nodes[a.id] = a; hit = a.id; }
        asm[k] = hit;
      }
      designPart(p, d.tool + ':' + d.id, asm[k]);
    });
    if (list.length) { toast('Added ' + plural(list.length, 'Part')); touch(p); }
  }
  // Dragging: a design from the tray adds a Part, a tile moves its Part. Drop targets are lanes and
  // the assembly groups inside them (data-drop is the assembly's id; '' is the top level).
  var dragging = null;
  document.addEventListener('dragstart', function (e) {
    var d = e.target.closest && e.target.closest('[data-drag-design],[data-drag-node]');
    if (!d) return;
    dragging = d.dataset.dragDesign ? { design: d.dataset.dragDesign } : { node: d.dataset.dragNode };
    e.dataTransfer.effectAllowed = dragging.design ? 'copy' : 'move';
    try { e.dataTransfer.setData('text/plain', d.dataset.dragDesign || d.dataset.dragNode); } catch (err) { /* some browsers refuse */ }
    document.body.classList.add('dragging');
  });
  function dragDone() {
    dragging = null; document.body.classList.remove('dragging');
    document.querySelectorAll('.drop-on').forEach(function (x) { x.classList.remove('drop-on'); });
  }
  document.addEventListener('dragend', dragDone);
  function dropTarget(e) {
    var z = e.target.closest && e.target.closest('[data-drop]');
    return dragging && z ? z : null;
  }
  function markDrop(z) {
    document.querySelectorAll('.drop-on').forEach(function (x) { if (x !== z) x.classList.remove('drop-on'); });
    if (z) z.classList.add('drop-on');
  }
  document.addEventListener('dragover', function (e) {
    var z = dropTarget(e);
    markDrop(z);
    if (z) e.preventDefault();
    autoScroll.at(e.clientX, e.clientY);   // after, so a scroll re-marks what's now under the pointer
  });

  // Edge autoscroll for every drag that starts in the page (the Map's tiles, assemblies, and tray, and
  // the Requirements tab's rows). The browser's own drag scroll only wakes in a thin strip at the
  // scroller's edge, and PL scrolls #main, not the window. Within EDGE px of the top or bottom of the
  // scroller under the pointer (or past it, over the header), scroll it each frame, faster toward the
  // edge, and re-mark the drop target under the pointer, since the page moves under a still pointer.
  var autoScroll = (function () {
    var EDGE = 48, MAX = 22;   // px band; px per frame at (or past) the edge
    var x = 0, y = 0, live = false, raf = 0, last = 0;
    function scroller() {
      for (var el = document.elementFromPoint(x, y); el && el !== document.body; el = el.parentElement) {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
      }
      return document.getElementById('main');   // over the header or a gap: the page's scroller
    }
    function speed(d) { return d >= EDGE ? 0 : MAX * Math.pow(1 - Math.max(d, 0) / EDGE, 2); }
    // Time-based, so it runs at the same speed from animation frames and from dragover (which keeps
    // firing while the pointer rests; frames can stall during a drag or in a hidden tab).
    function step() {
      // A resting pointer may get a dragover only every ~350 ms, so allow long steps
      var now = performance.now(), dt = last ? Math.min((now - last) / 16.7, 24) : 1;
      last = now;
      var el = scroller(), r = el && el.getBoundingClientRect();
      if (!r || x < r.left || x > r.right) return;
      var up = speed(y - r.top), down = speed(r.bottom - y), v = down > up ? down : -up;
      if (!v) return;
      var before = el.scrollTop;
      // 'instant': #main has scroll-behavior: smooth, which would turn each step into an animation
      el.scrollTo({ top: before + (v > 0 ? Math.ceil(v * dt) : Math.floor(v * dt)), behavior: 'instant' });
      if (el.scrollTop !== before && dragging) {
        var under = document.elementFromPoint(x, y);
        markDrop(under && under.closest('[data-drop]'));
      }
    }
    // A render mid-drag can detach the dragged element, so its dragend never reaches the document:
    // stop when no dragover has come for a second.
    var heard = 0;
    function frame() {
      raf = 0;
      if (!live) return;
      if (performance.now() - heard > 1000) { stop(); return; }
      step(); raf = requestAnimationFrame(frame);
    }
    function stop() { live = false; last = 0; if (raf) cancelAnimationFrame(raf); raf = 0; }
    document.addEventListener('dragstart', function (e) { live = true; last = 0; heard = performance.now(); x = e.clientX; y = e.clientY; if (!raf) raf = requestAnimationFrame(frame); });
    document.addEventListener('dragend', stop);
    document.addEventListener('drop', stop);
    return { at: function (cx, cy) { heard = performance.now(); if (cx || cy) { x = cx; y = cy; } if (live) step(); }, stop: stop };
  })();
  document.addEventListener('drop', function (e) {
    var z = dropTarget(e), p = current(), what = dragging;
    if (!z || !p) return;
    e.preventDefault();
    var parent = z.dataset.drop;
    dragDone();
    if (what.design) { var n = designPart(p, what.design, parent); if (n) { ui.sel = n.id; saveUi(); touch(p); } return; }
    var t = P.tree(p), id = what.node;
    if (!t.nodes[id] || id === parent || (t.parent[id] || '') === parent) return;
    if (!P.canMove(t, id, parent)) { toast('An assembly can’t go inside itself'); return; }
    setNode(id, { parent: parent, order: P.nextOrder(p, parent) });
  });

  // ── Map: the structure as a tree ─────────────────────────
  // The top assembly is the trunk. Assemblies branch off it, indented and joined by connector
  // lines, and the Parts of each assembly sit in a row of tiles on their own branch. Every branch
  // is a drop target (data-drop is the assembly's id; '' is the top level). A product of one Part
  // shows one button, which is both the top and the Part (P.soloPart).
  var ICON_ASM = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M10 2.5l6.5 3.3v8.4L10 17.5l-6.5-3.3V5.8z"/><path d="M3.5 5.8L10 9.1l6.5-3.3M10 9.1v8.4"/></svg>';
  function treeMap(p, t, rolls) {
    var top = P.topAssembly(t), solo = P.soloPart(t);
    if (solo) {
      return trayHtml(p) + '<div class="tm"><div class="tm-trunk tm-solo" data-drop="' + esc(top) + '"><div class="tm-eyebrow">' + (top ? 'Top assembly · ' + esc(t.nodes[top].name || 'Unnamed') : 'Product') + ' · one Part</div>' + tile(t.nodes[solo]) + '</div></div>';
    }
    function tiles(list) {
      function isBig(id) { return P.toolById(t.nodes[id].source) || modelOf(t.nodes[id]); }
      var big = list.filter(isBig), small = list.filter(function (id) { return !isBig(id); });
      return (big.length ? '<div class="map-tiles">' + big.map(function (id) { return tile(t.nodes[id]); }).join('') + '</div>' : '') +
        (small.length ? '<div class="map-tiles small">' + small.map(function (id) { return tile(t.nodes[id]); }).join('') + '</div>' : '');
    }
    // Children in tree order: each assembly is a branch, and each run of Parts one leaf row.
    function kids(list) {
      var items = [], run = [];
      function flush() { if (run.length) items.push('<div class="tm-item tm-leaves">' + tiles(run) + '</div>'); run = []; }
      list.forEach(function (id) {
        if (t.nodes[id].kind !== 'assembly') { run.push(id); return; }
        flush(); items.push('<div class="tm-item">' + branch(id) + '</div>');
      });
      flush();
      return '<div class="tm-kids">' + items.join('') + '</div>';
    }
    function branch(id) {
      var n = t.nodes[id], r = rolls[id], list = t.children[id] || [];
      return '<div class="tm-asm" data-drop="' + esc(id) + '"><div class="tm-head">' +
        '<button class="tm-node' + (ui.sel === id ? ' sel' : '') + (P.isLinkedAssembly(n) ? ' linked' : '') + '" data-act="select-node" data-id="' + esc(id) + '" draggable="true" data-drag-node="' + esc(id) + '">' +
        '<span class="tm-glyph">' + ICON_ASM + '</span><span class="tm-title"><span class="tm-name">' + esc(n.name || 'Unnamed') + '</span>' + (numberOf(n) ? '<span class="tm-pn">' + esc(numberOf(n)) + '</span>' : '') + '</span>' + ownChip(n) +
        '<span class="tm-sub">' + plural(r.parts, 'Part') + (r.designs ? ' · ' + pct(r.pct) + '%' : '') + '</span>' + (r.openTotal ? sevs(r.open) : '') + '</button>' +
        ownOpen(n) +
        (list.length ? '<button class="icon-btn tm-fold' + (ui.closed[id] ? ' closed' : '') + '" data-act="toggle-node" data-id="' + esc(id) + '" title="' + (ui.closed[id] ? 'Expand' : 'Collapse') + '" aria-expanded="' + !ui.closed[id] + '" aria-label="' + (ui.closed[id] ? 'Expand ' : 'Collapse ') + esc(n.name) + '">' + ICON.chev + '</button>' : '') +
        '<button class="icon-btn" data-act="add-child" data-id="' + esc(id) + '" title="Add inside" aria-label="Add inside ' + esc(n.name) + '">' + ICON.plus + '</button></div>' +
        (ui.closed[id] && list.length ? '' : list.length ? kids(list) : '<div class="tm-kids"><div class="tm-item tm-leaves"><div class="map-empty">Empty: drag a Part here, or use +</div></div></div>') + '</div>';
    }
    var id = top || PRODUCT, r = rolls[top] || rolls[''], n = top ? t.nodes[top] : null;
    var name = n ? n.name || 'Unnamed' : p.meta.name, num = n ? n.number : p.meta.number;
    var trunk = '<div class="tm-head tm-top-head"><button class="tm-top' + (ui.sel === id ? ' sel' : '') + '" data-act="select-node" data-id="' + esc(id) + '">' +
      ring(r.designs ? r.pct : 0, 54, 6, r.designs ? pct(r.pct) + '%' : '—') +
      '<span class="tm-top-text"><span class="tm-eyebrow">' + (top ? 'Top assembly' : 'Product') + (num ? ' · ' + esc(num) : '') + (n ? ownChip(n) : '') + '</span>' +
      '<span class="tm-top-name">' + esc(name) + '</span>' +
      '<span class="tm-sub">' + [plural(r.parts, 'Part'), r.designs && plural(r.designs, 'design'), r.massG && fmtMass(r.massG)].filter(Boolean).join(' · ') + '</span></span>' +
      (r.openTotal ? sevs(r.open) : '<span class="tm-sub">No open issues</span>') + '</button>' +
      (n ? ownOpen(n) : '') +
      (top ? '<button class="icon-btn" data-act="add-child" data-id="' + esc(top) + '" title="Add inside" aria-label="Add inside ' + esc(name) + '">' + ICON.plus + '</button>'
        : '<button class="icon-btn" data-act="add-node" title="Add a Part or assembly" aria-label="Add a Part or assembly">' + ICON.plus + '</button>') + '</div>';
    return trayHtml(p) + '<div class="tm"><div class="tm-trunk" data-drop="' + esc(top) + '">' + trunk + kids(top ? t.children[top] || [] : t.roots) + '</div></div>';
  }

  // An assembly's own review (an ME review of the whole assembly, P.linkStatus): its tool's chip and
  // stage beside the assembly's name, or what's wrong with the link.
  function ownChip(n) {
    if (!P.isLinkedAssembly(n)) return '';
    var st = P.linkStatus(n, index), s = st.summary;
    return '<span class="tm-own" title="' + esc('Reviewed as an assembly in ' + P.toolById(n.source).name) + '">' + srcChip(n.source) +
      (s ? '<span>' + esc(s.stage || '') + '</span>' : st.entry ? '<span>' + esc(st.entry.stage || '') + '</span>' : stateChip(st)) + '</span>';
  }

  // The number under an assembly's or a reviewed Part's name in the Map: its own, else its review's.
  function numberOf(n, st) {
    if (st === undefined) st = P.linkStatus(n, index);
    return n.number || (st && st.entry && st.entry.number) || '';
  }
  // A link beside a linked assembly's head that opens its review (in the same tab, like every tool link).
  function ownOpen(n) {
    if (!P.isLinkedAssembly(n)) return '';
    var st = P.linkStatus(n, index), tool = P.toolById(n.source);
    if (st.state !== 'ok' && st.state !== 'nosummary') return '';
    return '<a class="tm-open" href="' + esc(designUrl(n)) + '" title="Open ' + esc(n.name || 'it') + ' in ' + esc(tool.name) + '">Open in ' + esc(tool.short) + ' ›</a>';
  }

  function tile(n) {
    var st = P.partStatus(n, index), s = st && st.summary, tool = P.toolById(n.source);
    var cls = 'map-tile' + (tool || modelOf(n) ? '' : ' small') + (ui.sel === n.id ? ' sel' : '');
    var qty = n.qty > 1 ? ' <span class="map-qty">×' + esc(n.qty) + '</span>' : '';
    if (!tool && modelOf(n)) {
      return '<button class="' + cls + '" data-act="select-node" data-id="' + esc(n.id) + '" draggable="true" data-drag-node="' + esc(n.id) + '"><div class="map-art">' + art(n, true) + '</div>' +
        '<div class="map-name">' + esc(n.name || 'Unnamed') + qty + '</div><div class="map-meta"><span>' + esc(mpnOf(n) || n.number || cap(st.state === 'purchased' ? 'Purchased' : '')) + '</span>' + srcChip(n.source) + '</div></button>';
    }
    if (!tool) {
      return '<button class="' + cls + '" data-act="select-node" data-id="' + esc(n.id) + '" draggable="true" data-drag-node="' + esc(n.id) + '"><div class="map-art">' + partArt(n) + '</div>' +
        '<div class="map-body"><div class="map-name">' + esc(n.name || 'Unnamed') + qty + '</div><div class="map-meta"><span>' + esc(mpnOf(n) || n.number || (st.state === 'manual' ? 'No review tool yet' : '')) + '</span>' + srcChip(n.source) + '</div></div></button>';
    }
    var num = numberOf(n, st);
    return '<button class="' + cls + '" data-act="select-node" data-id="' + esc(n.id) + '" draggable="true" data-drag-node="' + esc(n.id) + '"><div class="map-art">' + art(n, true, st.entry) + '</div>' +
      '<div class="map-name">' + esc(n.name || 'Unnamed') + qty + (num ? '<span class="map-pn">' + esc(num) + '</span>' : '') + '</div>' +
      (s && !s.harness ? '<div class="bar"><i style="width:' + pct(s.pct) + '%"></i></div>' : '') +
      '<div class="map-meta">' + (s ? '<span>' + esc(designStat(s)) + '</span>' + (s.harness ? '' : sevs((s.issues || {}).open || {})) : stateChip(st)) + srcChip(n.source) + '</div></button>';
  }

  // A board's fab revisions (summary.revisions, tagged in Signoff EE's Revisions tab), oldest first:
  // what was sent to the fab and which one was built.
  function revisionsHtml(revs) {
    if (!revs || !revs.length) return '';
    var said = { sent: 'Sent', built: 'Built', withdrawn: 'Withdrawn' };
    return '<div class="map-ins-revs"><div class="ins-eyebrow">Fab revisions</div>' + revs.map(function (r) {
      return '<div class="map-rev ' + esc(r.status || '') + '"><b>' + esc(r.label || '?') + '</b><span>' + esc([said[r.status], r.sentAt].filter(Boolean).join(' · ')) + '</span></div>';
    }).join('') + '</div>';
  }

  // What a design does, from its description (summary.spec, Scribe in Signoff EE and FW): the
  // top-level gists, and how much of it isn't tied to requirements yet.
  function specHtml(sp) {
    if (!sp || !sp.gists || !sp.gists.length) return '';
    var gaps = [sp.untraced ? sp.untraced + ' unlinked' : '', sp.undescribed ? plural(sp.undescribed, 'requirement') + ' not described' : '', sp.flagged ? sp.flagged + ' flagged for a requirement' : '', sp.notes ? plural(sp.notes, 'review note') : ''].filter(Boolean);
    return '<div class="map-ins-spec"><div class="ins-eyebrow">What it does</div>' + sp.gists.filter(function (g) { return g.gist || !g.depth; }).map(function (g) {
      return '<div class="map-spec' + (g.depth ? ' sub' : '') + '"><b>' + esc(g.title) + '</b>' + (g.gist ? '<span>' + esc(g.gist) + '</span>' : '') + '</div>';
    }).join('') + (sp.more ? '<p class="note">and ' + esc(plural(sp.more, 'more section')) + ' in the review</p>' : '') +
      (gaps.length ? '<p class="note">' + esc(gaps.join(' · ')) + '</p>' : '') + '</div>';
  }

  // The selected Part's detail, beside the map (over it on narrow screens).
  function inspector(p, t, id) {
    if (id === PRODUCT || t.nodes[id].kind === 'assembly') return asmInspector(p, t, id);
    var n = t.nodes[id], st = P.partStatus(n, index), tool = P.toolById(n.source);
    var html = '<aside class="map-ins card" aria-label="' + esc(n.name) + '"><button class="icon-btn map-ins-close" data-act="close-ins" aria-label="Close">×</button>';
    var e = st.entry || {}, s = st.summary;
    var pv = previewFor(n, st.entry), mdl = modelOf(n), side = pv && pv.images.some(function (i) { return i.key === ui.pic; }) ? ui.pic : '';
    var turn = mdl && ui.pic === '3d';
    html += '<div class="map-ins-art">' + (turn ? '<canvas class="m3d" data-mesh="' + esc(mdl.mesh.sha) + '" aria-label="3D view: drag to turn, right-drag to pan, scroll to zoom"></canvas>' : art(n, true, e, side)) +
      (pv && (sides(pv).length > 1 || mdl) ? '<div class="seg map-ins-flip">' + sides(pv).map(function (i) {
        return '<button class="' + (!turn && (side || pv.hero) === i.key ? 'on' : '') + '" data-act="pic" data-key="' + esc(i.key) + '">' + esc(cap(i.key)) + '</button>';
      }).join('') + (mdl ? '<button class="' + (turn ? 'on' : '') + '" data-act="pic" data-key="3d" title="Drag to turn, right-drag to pan, scroll to zoom">3D</button>' : '') + '</div>' : '') +
      (mdl ? '<button class="icon-btn map-ins-expand" data-act="m3d-open" data-id="' + esc(id) + '" title="Open the 3D view large, to show it in a review" aria-label="Open the 3D view large">' + ICON.expand + '</button>' : '') +
      '</div><h2>' + esc(n.name || 'Unnamed') + '</h2>' +
      '<p class="map-ins-sub">' + esc([e.number || n.number || mpnOf(n), e.revision && 'Rev ' + e.revision, (s && s.stage) || e.stage, n.qty > 1 && '×' + n.qty, n.massG != null && n.massG !== '' && fmtMass(Number(n.massG)) + ' each'].filter(Boolean).join(' · ')) + '</p>';
    if (s && s.harness) {
      html += harnessHtml(s);
      if (s.at) html += '<p class="note">Edited ' + relTime(s.at) + (s.by ? ' by ' + esc(s.by) : '') + '</p>';
    } else if (s) {
      var open = (s.issues || {}).open || {}, total = P.SEVERITIES.reduce(function (a, k) { return a + (Number(open[k]) || 0); }, 0);
      html += specHtml(s.spec);
      html += '<div class="map-ins-row">' + ring(s.pct, 56, 6, pct(s.pct) + '%') + '<div><b>' + pct(s.pct) + '% reviewed</b><br>' + (total ? sevs(open) : '<span class="muted">No open issues</span>') + '</div></div>';
      var lists = Object.keys(s.checklists || {}).map(function (k) { return s.checklists[k]; });
      if (lists.length) html += '<div class="map-ins-lists">' + lists.map(function (c) { return '<div class="map-cl"><span>' + esc(c.name) + '</span>' + pbar(c.pct) + '</div>'; }).join('') + '</div>';
      html += revisionsHtml(s.revisions);
      var top = (s.open || []).slice().sort(function (a, b) { return P.SEVERITIES.indexOf(a.severity) - P.SEVERITIES.indexOf(b.severity); }).slice(0, 4);
      if (top.length) {
        html += '<div class="map-ins-issues">' + top.map(function (i) {
          return '<a href="' + esc(designUrl(n, i.id)) + '"><span class="sev ' + esc(i.severity) + '">' + cap(i.severity) + '</span><span>' + esc(i.text) + '</span></a>';
        }).join('') + (total > top.length ? '<p class="note">' + plural(total - top.length, 'more issue') + ' in ' + esc(tool.short) + '</p>' : '') + '</div>';
      }
      if (s.at) html += '<p class="note">Edited ' + relTime(s.at) + (s.by ? ' by ' + esc(s.by) : '') + '</p>';
    } else if (st.state === 'purchased') {
      html += '<p class="map-ins-text">' + esc([n.supplier, n.mpn].filter(Boolean).join(' · ') || 'Purchased') + (n.envelopeMm ? '<br>Envelope ' + esc(n.envelopeMm) + ' mm' : '') + '</p>';
    } else if (STATE_TEXT[st.state]) {
      html += '<p class="map-ins-text">' + stateChip(st) + ' ' + esc(STATE_TEXT[st.state][2]) + '</p>';
    }
    if (n.notes) html += '<p class="map-ins-text">' + esc(n.notes) + '</p>';
    if (mdl) html += '<p class="note">' + modelLine(mdl) + (mdl.step ? ' · <a href="#" data-act="get-step" data-id="' + esc(id) + '">Download STEP</a>' : '') + '</p>';
    if (P.isAssemblyDesign(st.entry)) {
      html += '<div class="ins-own"><p class="map-ins-text">' + srcChip(n.source) + ' ' + esc(tool.name) + ' reviews this as an assembly. Link it to an assembly here and the review shows on that branch, counted with the Parts inside it.</p>' +
        '<button class="btn" data-act="asm-link" data-id="' + esc(id) + '">Link to an assembly…</button></div>';
    }
    var solo = P.soloPart(t) === id && P.topAssembly(t);
    return html + '<div class="map-ins-acts">' + (tool && (st.state === 'ok' || st.state === 'nosummary') ? '<a class="btn btn-primary" href="' + esc(designUrl(n)) + '">Open in ' + esc(tool.name) + '</a>' : '') +
      '<button class="btn" data-act="edit-node" data-id="' + esc(id) + '">Edit</button>' +
      (solo ? '<button class="btn" data-act="edit-node" data-id="' + esc(solo) + '">Edit assembly</button><button class="btn" data-act="add-child" data-id="' + esc(solo) + '">' + ICON.plus + ' Add Part</button>' : '') + '</div></aside>';
  }

  // An assembly's (or the whole product's) detail: everything below it, rolled up.
  function asmInspector(p, t, id) {
    var prod = id === PRODUCT, n = prod ? null : t.nodes[id], rolls = P.rollup(p, index), r = rolls[prod ? '' : id];
    var inside = prod ? null : P.descendants(t, id), name = prod ? p.meta.name : n.name || 'Unnamed';
    var kind = prod ? 'Product' : id === P.topAssembly(t) ? 'Top assembly' : 'Assembly';
    var where = (prod ? [p.meta.client, p.meta.number, p.meta.phase] : [n.number, P.path(t, id).map(function (x) { return x.name; }).join(' › ')]).filter(Boolean);
    var html = '<aside class="map-ins card" aria-label="' + esc(name) + '"><button class="icon-btn map-ins-close" data-act="close-ins" aria-label="Close">×</button>' +
      '<div class="ins-eyebrow">' + kind + '</div><h2>' + esc(name) + '</h2>' +
      (where.length ? '<p class="map-ins-sub">' + esc(where.join(' · ')) + '</p>' : '');
    var own = !prod && P.isLinkedAssembly(n) ? P.linkStatus(n, index) : null;
    if (own) html += ownReviewHtml(n, own);
    html += '<div class="map-ins-row">' + ring(r.designs ? r.pct : 0, 64, 7, r.designs ? pct(r.pct) + '%' : '—') + '<div>' +
      (r.designs ? '<b>' + pct(r.pct) + '% reviewed</b><br>across ' + plural(r.designs, 'linked design') : '<b>No linked designs yet</b>') + '</div></div>';
    var attn = r.unlinked + r.attention;
    html += '<div class="ins-stats">' +
      '<div><span>Open issues</span><b>' + esc(r.openTotal) + '</b>' + (r.openTotal ? sevs(r.open) : '<i>None</i>') + '</div>' +
      '<div><span>Mass</span><b>' + fmtMass(r.massG) + '</b><i>' + (r.massMissing ? plural(r.massMissing, 'Part') + ' without one' : 'All Parts weighed') + '</i></div>' +
      '<div><span>Parts</span><b>' + esc(r.parts) + '</b><i>' + esc([r.designs && plural(r.designs, 'design'), r.purchased && r.purchased + ' purchased', r.manual && r.manual + ' firmware'].filter(Boolean).join(' · ')) + '</i></div>' +
      '<div><span>Need attention</span><b>' + esc(attn) + '</b><i>' + esc(attn ? [r.unlinked && r.unlinked + ' not linked', r.attention && r.attention + ' unreadable'].filter(Boolean).join(' · ') : 'Every design reads') + '</i></div></div>';
    // The children, each a row that selects it.
    var list = prod ? t.roots : t.children[id] || [];
    if (list.length) {
      html += '<div class="ins-kids"><div class="ins-label">In this ' + (prod ? 'product' : 'assembly') + '</div>' + list.map(function (k) {
        var c = t.nodes[k], right;
        if (c.kind === 'assembly') right = '<span>' + plural(rolls[k].parts, 'Part') + (rolls[k].designs ? ' · ' + pct(rolls[k].pct) + '%' : '') + '</span>' + (rolls[k].openTotal ? sevs(rolls[k].open) : '');
        else {
          var st = P.partStatus(c, index), s = st.summary;
          right = s && s.harness ? '<span>' + esc(designStat(s)) + '</span>' : s ? '<span>' + pct(s.pct) + '%</span>' + sevs((s.issues || {}).open || {}) : st.state === 'purchased' ? '<span>Purchased</span>' : stateChip(st);
        }
        return '<button class="ins-kid" data-act="select-node" data-id="' + esc(k) + '"><span class="ins-kid-art">' + (c.kind === 'assembly' ? ICON_ASM : partArt(c)) + '</span>' +
          '<span class="ins-kid-name">' + esc(c.name || 'Unnamed') + (c.qty > 1 ? ' <span class="map-qty">×' + esc(c.qty) + '</span>' : '') + '</span><span class="ins-kid-r">' + right + '</span></button>';
      }).join('') + '</div>';
    }
    var stages = Object.keys(r.stages).sort();
    if (stages.length) html += '<div class="ins-stages"><div class="ins-label">Stages</div>' + stages.map(function (k) { var s = k.split(':'); return '<span>' + srcChip(s[0]) + ' ' + esc(s.slice(1).join(':')) + (r.stages[k] > 1 ? ' ×' + r.stages[k] : '') + '</span>'; }).join('') + '</div>';
    var iss = P.issues(p, index).filter(function (i) { return prod || i.node.id === id || inside[i.node.id]; }), shown = iss.slice(0, 5);
    if (shown.length) {
      html += '<div class="map-ins-issues"><div class="ins-label">Top open issues</div>' + shown.map(function (i) {
        return '<a href="' + esc(designUrl(i.node, i.id)) + '"><span class="sev ' + esc(i.severity) + '">' + cap(i.severity) + '</span><span>' + esc(i.text) + '<span class="ins-from"> · ' + esc(i.node.name) + '</span></span></a>';
      }).join('') + (iss.length > shown.length ? '<button class="ins-more" data-act="view" data-view="issues">All ' + esc(iss.length) + ' in Issues ›</button>' : '') + '</div>';
    }
    return html + '<div class="map-ins-acts">' + (prod ? '<button class="btn" data-act="edit-project">Edit project</button><button class="btn" data-act="add-node">' + ICON.plus + ' Add</button>'
      : (own && (own.state === 'ok' || own.state === 'nosummary') ? '<a class="btn btn-primary" href="' + esc(designUrl(n)) + '">Open in ' + esc(P.toolById(n.source).name) + '</a>' : '') +
        '<button class="btn" data-act="edit-node" data-id="' + esc(id) + '">Edit</button><button class="btn" data-act="add-child" data-id="' + esc(id) + '">' + ICON.plus + ' Add inside</button>') + '</div></aside>';
  }
  // The review of the assembly itself, above the roll-up of what's in it.
  function ownReviewHtml(n, st) {
    var e = st.entry || {}, s = st.summary;
    var html = '<div class="ins-own"><div class="ins-label">' + srcChip(n.source) + ' Reviewed as an assembly</div>';
    if (s) {
      var open = (s.issues || {}).open || {}, total = P.SEVERITIES.reduce(function (a, k) { return a + (Number(open[k]) || 0); }, 0);
      html += '<div class="ins-own-row"><b>' + esc(e.name || s.name || n.name) + '</b><span>' + esc([e.number, e.revision && 'Rev ' + e.revision, s.stage || e.stage].filter(Boolean).join(' · ')) + '</span></div>' +
        '<div class="ins-own-row">' + pbar(s.pct) + (total ? sevs(open) : '<span class="muted">No open issues</span>') + '</div>';
      var lists = Object.keys(s.checklists || {}).map(function (k) { return s.checklists[k]; });
      if (lists.length) html += '<div class="map-ins-lists">' + lists.map(function (c) { return '<div class="map-cl"><span>' + esc(c.name) + '</span>' + pbar(c.pct) + '</div>'; }).join('') + '</div>';
      if (s.at) html += '<p class="note">Edited ' + relTime(s.at) + (s.by ? ' by ' + esc(s.by) : '') + '</p>';
    } else if (STATE_TEXT[st.state]) {
      html += '<p class="map-ins-text">' + stateChip(st) + ' ' + esc(STATE_TEXT[st.state][2]) + '</p>';
    }
    return html + '<p class="note">The progress below counts it with the designs inside.</p></div>';
  }

  function listTable(t, rolls, ids) {
    var html = '';
    var hidden = {};
    ids.forEach(function (id) { if (ui.closed[id] || hidden[t.parent[id]]) { if (hidden[t.parent[id]]) hidden[id] = 1; if (ui.closed[id]) Object.keys(P.descendants(t, id)).forEach(function (d) { hidden[d] = 1; }); } });
    html += '<div class="card" style="overflow-x:auto"><table class="table tree"><thead><tr><th>Name</th><th>Source</th><th class="hide-narrow">Stage</th><th>Progress</th><th>Open issues</th><th class="hide-narrow">Qty</th><th class="hide-narrow">Mass</th><th></th></tr></thead><tbody>' +
      ids.filter(function (id) { return !hidden[id]; }).map(function (id) {
        var n = t.nodes[id], r = rolls[id], st = P.partStatus(n, index), kids = (t.children[id] || []).length;
        var flag = t.flags[id] ? '<span class="pstate err" title="' + (t.flags[id] === 'cycle' ? 'Two moves made this a loop; it was put at the top. Move it where it belongs.' : 'Its assembly was deleted; it was put at the top.') + '">' + (t.flags[id] === 'cycle' ? 'Moved to top' : 'Orphaned') + '</span> ' : '';
        var caret = kids ? '<button class="t-caret' + (ui.closed[id] ? ' closed' : '') + '" data-act="toggle-node" data-id="' + esc(id) + '" aria-label="' + (ui.closed[id] ? 'Expand' : 'Collapse') + '">' + ICON.chev + '</button>' : '<span class="t-spacer"></span>';
        var sub = n.kind === 'part' ? [n.number, st && st.entry && st.entry.number && st.entry.number !== n.number ? st.entry.number : '', mpnOf(n)].filter(Boolean).join(' · ') : (n.number || plural(r.parts, 'Part'));
        var progress = n.kind === 'assembly' ? (r.designs ? pbar(r.pct) : '<span class="muted">—</span>')
          : st.state === 'ok' ? (st.summary.harness ? '<span class="muted">' + esc(designStat(st.summary)) + '</span>' : pbar(st.summary.pct)) : st.state === 'purchased' ? '<span class="muted">Purchased</span>' : stateChip(st);
        var issues = n.kind === 'assembly' ? (r.designs ? sevs(r.open) : '') : st.state === 'ok' ? sevs((st.summary.issues || {}).open || {}) : '';
        var own = P.linkStatus(n, index);   // a Part's design, or an assembly's own review
        var stage = own && own.state === 'ok' ? esc(own.summary.stage || '') : own && own.entry ? esc(own.entry.stage || '') : '';
        var mass = n.kind === 'assembly' ? (r.massG ? fmtMass(r.massG) : '') : n.massG != null && n.massG !== '' ? fmtMass(Number(n.massG) * (n.qty || 1)) : '';
        return '<tr class="' + (n.kind === 'assembly' ? 'asm' : 'part') + '" data-act="edit-node" data-id="' + esc(id) + '">' +
          '<td><div class="t-name" style="padding-left:' + (t.depth[id] * 20) + 'px">' + caret + '<div class="t-label">' + flag + '<b>' + esc(n.name || 'Unnamed') + '</b>' + (sub ? '<div class="t-sub">' + esc(sub) + '</div>' : '') + '</div></div></td>' +
          '<td>' + (n.kind === 'part' || P.isLinkedAssembly(n) ? srcChip(n.source) : '') + '</td>' +
          '<td class="hide-narrow">' + stage + '</td><td>' + progress + '</td><td>' + issues + '</td>' +
          '<td class="num hide-narrow">' + (n.kind === 'part' && n.qty > 1 ? '×' + n.qty : '') + '</td><td class="num hide-narrow">' + mass + '</td>' +
          '<td class="t-acts">' + (n.kind === 'assembly' ? '<button class="icon-btn" data-act="add-child" data-id="' + esc(id) + '" title="Add inside">' + ICON.plus + '</button>' : '') +
          '<button class="icon-btn" data-act="move-up" data-id="' + esc(id) + '" title="Move up">' + ICON.up + '</button>' +
          '<button class="icon-btn" data-act="move-down" data-id="' + esc(id) + '" title="Move down">' + ICON.down + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '<p class="note" style="margin-top:12px">Mass is per Part times quantity, over the Parts that have one. Progress counts linked designs once, however many Parts use them.</p>';
    return html;
  }

  function issuesPage(p) {
    var list = P.issues(p, index), t = P.tree(p), unlisted = P.unlistedIssues(p, index);
    var html = '<div class="page"><div class="cl-head"><div><div class="eyebrow">' + esc(p.meta.name) + '</div><h1 class="page-title">Open issues</h1>' +
      '<div class="page-sub"><span>' + plural(list.length + unlisted, 'open issue') + ' across the product’s designs</span></div></div></div>';
    if (unlisted) html += '<p class="note" style="margin:-12px 0 16px">' + plural(unlisted, 'issue') + ' from designs whose summary predates the issue list aren’t shown. Sync those designs in their tool to list them.</p>';
    if (!list.length) return html + '<div class="card empty"><div class="empty-art">' + ICON.tree + '</div><h2>No open issues</h2><p>Issues raised in the linked Signoff EE and ME reviews show here, worst first.</p></div></div>';
    html += '<div class="card" style="overflow-x:auto"><table class="table"><thead><tr><th>Severity</th><th>Issue</th><th>Part</th><th>Owner</th><th></th></tr></thead><tbody>' +
      list.map(function (i) {
        var where = P.path(t, i.node.id).map(function (n) { return n.name; }).concat([i.node.name]).join(' › ');
        return '<tr data-act="open-url" data-url="' + esc(designUrl(i.node, i.id)) + '"><td><span class="sev ' + esc(i.severity) + '">' + cap(i.severity) + '</span></td>' +
          '<td>' + esc(i.text) + '<div class="muted">' + esc([i.checklist, i.ref].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td>' + srcChip(i.tool) + ' ' + esc(i.node.name) + '<div class="muted">' + esc(where) + '</div></td>' +
          '<td class="muted">' + esc(i.assignee || '—') + '</td>' +
          '<td><a class="open-link" href="' + esc(designUrl(i.node, i.id)) + '" data-stop="1">Open ›</a></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
  }

  // ── Bill of materials ────────────────────────────────────
  // Indented (the structure, numbered) or consolidated (one line per distinct Part, summed). Pick
  // columns, search, sort the consolidated list, export CSV, or print it on a report page.
  var BOM_COLS = [['item', 'Item', 1], ['pic', 'Picture', 1], ['number', 'Number', 1], ['rev', 'Rev', 1], ['source', 'Source', 1], ['supplier', 'Supplier', 1],
    ['mpn', 'MPN', 1], ['qty', 'Qty', 1], ['massG', 'Mass each', 0], ['extMassG', 'Mass', 1], ['status', 'Status', 1], ['notes', 'Notes', 0]];
  function bomCols() {
    var on = ui.bomCols || {};
    return BOM_COLS.filter(function (c) { return on[c[0]] == null ? c[2] : on[c[0]]; }).map(function (c) { return c[0]; });
  }
  function bomData(p) { return P.bom(p, index, ui.bomMode === 'flat' ? 'flat' : 'indented'); }
  // The rows shown: search matches (with their assemblies, when indented), sorted when consolidated.
  function bomRows(p, b, forPrint) {
    var q = String(ui.bomQ || '').trim().toLowerCase(), rows = b.rows;
    if (q) {
      var t = P.tree(p), keep = {};
      rows.forEach(function (r) {
        if ([r.name, r.number, r.mpn, r.supplier, r.notes, r.item].join(' ').toLowerCase().indexOf(q) < 0) return;
        keep[r.id] = 1;
        if (b.mode === 'indented') P.path(t, r.id).forEach(function (a) { keep[a.id] = 1; });
      });
      rows = rows.filter(function (r) { return keep[r.id]; });
    }
    if (b.mode === 'indented' && !forPrint && !q) {
      var hidden = {}, t2 = P.tree(p);
      rows.forEach(function (r) { if (ui.closed[r.id]) Object.keys(P.descendants(t2, r.id)).forEach(function (d) { hidden[d] = 1; }); });
      rows = rows.filter(function (r) { return !hidden[r.id]; });
    }
    var srt = ui.bomSort;
    if (b.mode === 'flat' && srt && srt.key) {
      var k = srt.key === 'qty' ? 'extQty' : srt.key === 'status' ? 'stage' : srt.key, dir = srt.dir === 'desc' ? -1 : 1;
      rows = rows.slice().sort(function (x, y) {
        var a = x[k], c = y[k];
        if (a == null || a === '') return 1; if (c == null || c === '') return -1;
        return (typeof a === 'number' ? a - c : String(a).localeCompare(String(c), undefined, { numeric: true })) * dir;
      });
    }
    return rows;
  }
  function bomCell(p, r, key, b, print) {
    var n = p.nodes[r.id], part = r.kind === 'part';
    switch (key) {
      case 'item': return esc(r.item);
      case 'pic': return part ? '<div class="bom-pic map-art">' + art(n, false, (P.partStatus(n, index) || {}).entry) + '</div>' : '';
      case 'source': return part ? (print ? esc((P.sources().filter(function (s) { return s.id === r.source; })[0] || {}).label || '') : srcChip(r.source)) : '';
      case 'qty': return part ? esc(b.mode === 'flat' ? r.extQty : r.qty) : '';
      case 'massG': return r.massG != null ? fmtMass(r.massG) : '';
      case 'extMassG': return r.extMassG != null ? fmtMass(r.extMassG) : part ? '<span class="muted">—</span>' : esc(fmtMass(bomAsmMass(p, b, r.id)).replace('—', ''));
      case 'status':
        if (!part) return '';
        if (r.pct != null) return esc((r.stage ? r.stage + ' · ' : '') + pct(r.pct) + '%');
        if (r.state === 'purchased') return '';
        return print ? esc((STATE_TEXT[r.state] || [])[1] || '') : stateChip({ state: r.state });
      default: return esc(r[key] || '');
    }
  }
  function bomAsmMass(p, b, id) {
    var t = P.tree(p), inside = P.descendants(t, id);
    return Math.round(b.rows.reduce(function (a, r) { return a + (inside[r.id] && r.extMassG ? r.extMassG : 0); }, 0) * 10) / 10;
  }
  function bomName(p, r, b, print) {
    var t = P.tree(p), kids = r.kind === 'assembly' && (t.children[r.id] || []).length;
    var caret = b.mode === 'indented' && !print ? (kids ? '<button class="t-caret' + (ui.closed[r.id] ? ' closed' : '') + '" data-act="toggle-node" data-id="' + esc(r.id) + '" aria-label="' + (ui.closed[r.id] ? 'Expand' : 'Collapse') + '">' + ICON.chev + '</button>' : '<span class="t-spacer"></span>') : '';
    var uses = b.mode === 'flat' && r.uses.length > 1 ? '<div class="t-sub">In ' + esc(r.uses.map(function (u) { var a = P.path(t, u); return a.length ? a[a.length - 1].name : 'top level'; }).filter(function (x, i, all) { return all.indexOf(x) === i; }).join(', ')) + '</div>' : '';
    return '<div class="t-name" style="padding-left:' + (b.mode === 'indented' ? r.level * (print ? 14 : 18) : 0) + 'px">' + caret + '<div class="t-label">' + (r.kind === 'assembly' ? '<b>' + esc(r.name || 'Unnamed') + '</b>' : esc(r.name || 'Unnamed')) + uses + '</div></div>';
  }
  var BOM_NUM = { qty: 1, massG: 1, extMassG: 1 };
  function bomTable(p) {
    var b = bomData(p), cols = bomCols(), rows = bomRows(p, b), srt = ui.bomSort || {};
    if (!b.rows.length) return '<div class="card empty"><div class="empty-art">' + ICON.tree + '</div><h2>Nothing to list yet</h2><p>Add Parts on the System page; they show here with quantities and mass.</p></div>';
    function th(key, label) {
      var sortable = b.mode === 'flat' && key !== 'pic';
      var mark = srt.key === key ? (srt.dir === 'desc' ? ' ↓' : ' ↑') : '';
      return '<th class="' + (BOM_NUM[key] ? 'num' : '') + (key === 'pic' ? ' bom-pic-col' : '') + '">' + (sortable ? '<button class="bom-sort" data-act="bom-sort" data-key="' + key + '">' + esc(label) + mark + '</button>' : esc(label)) + '</th>';
    }
    var labels = {}; BOM_COLS.forEach(function (c) { labels[c[0]] = c[1]; });
    var head = cols.filter(function (c) { return c === 'item' || c === 'pic'; });
    var rest = cols.filter(function (c) { return head.indexOf(c) < 0; });
    return '<div class="card bom-card"><table class="table tree bom"><thead><tr>' + head.map(function (c) { return th(c, labels[c]); }).join('') + th('name', 'Name') + rest.map(function (c) { return th(c, labels[c]); }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="' + (r.kind === 'assembly' ? 'asm' : 'part') + '" data-act="edit-node" data-id="' + esc(r.uses[0]) + '">' + head.map(function (c) { return '<td class="' + (c === 'item' ? 'bom-item' : '') + '">' + bomCell(p, r, c, b) + '</td>'; }).join('') +
          '<td>' + bomName(p, r, b) + '</td>' + rest.map(function (c) { return '<td class="' + (BOM_NUM[c] ? 'num' : c === 'notes' ? 'bom-notes' : '') + '">' + bomCell(p, r, c, b) + '</td>'; }).join('') + '</tr>';
      }).join('') + (rows.length ? '' : '<tr><td colspan="' + (cols.length + 1) + '" class="muted">Nothing matches “' + esc(ui.bomQ) + '”.</td></tr>') + '</tbody>' +
      '<tfoot><tr><td colspan="' + (head.length + 1) + '"><b>' + plural(b.totals.lines, 'line') + '</b> · ' + plural(b.totals.qty, 'piece') + '</td>' + rest.map(function (c) {
        return '<td class="num">' + (c === 'extMassG' ? '<b>' + fmtMass(b.totals.massG) + '</b>' : '') + '</td>';
      }).join('') + '</tr></tfoot></table></div>' +
      '<p class="note" style="margin-top:12px">' + (b.mode === 'flat' ? 'One line per distinct Part: the same linked design, else the same number, else the same MPN. Quantities are summed across the structure.' : 'Item numbers follow the structure. Quantities are per assembly.') +
      (b.totals.massMissing ? ' ' + plural(b.totals.massMissing, 'line') + ' without a mass ' + (b.totals.massMissing === 1 ? 'isn’t' : 'aren’t') + ' in the total.' : '') + '</p>';
  }
  function bomPage(p) {
    var b = bomData(p), mode = b.mode, on = bomCols();
    return '<div class="page page-bom"><div class="cl-head"><div><div class="eyebrow">' + esc(p.meta.name) + '</div><h1 class="page-title">Bill of materials</h1>' +
      '<div class="page-sub"><span>' + plural(b.totals.lines, 'line') + '</span><span class="sep">·</span><span>' + plural(b.totals.qty, 'piece') + '</span><span class="sep">·</span><span>' + fmtMass(b.totals.massG) + '</span></div></div>' +
      '<div class="cl-head-acts"><button class="btn" data-act="bom-csv" title="Download as CSV">CSV</button><button class="btn btn-primary" data-act="bom-print" title="Print or save as PDF">Print</button></div></div>' +
      '<div class="bom-bar"><div class="seg" role="tablist" aria-label="BOM layout">' + [['indented', 'Indented'], ['flat', 'Consolidated']].map(function (m) {
        return '<button role="tab" class="' + (mode === m[0] ? 'on' : '') + '" data-act="bom-mode" data-mode="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div>' +
      '<input class="input bom-q" id="bom-q" type="search" placeholder="Search name, number, MPN, supplier" value="' + esc(ui.bomQ || '') + '" autocomplete="off" aria-label="Search the BOM">' +
      '<details class="bom-cols"><summary class="btn">Columns</summary><div class="bom-cols-pop">' + BOM_COLS.map(function (c) {
        return '<label class="check"><input type="checkbox" data-bom-col="' + c[0] + '"' + (on.indexOf(c[0]) >= 0 ? ' checked' : '') + '> ' + esc(c[1]) + '</label>';
      }).join('') + '</div></details></div>' +
      '<div id="bom-table">' + bomTable(p) + '</div></div>';
  }
  function refreshBom() {
    var box = $('#bom-table'), p = current();
    if (!box || !p) return;
    box.innerHTML = bomTable(p);
    loadPictures(box);
  }
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'bom-q') return;
    ui.bomQ = e.target.value; refreshBom();
  });
  document.addEventListener('change', function (e) {
    var c = e.target.dataset && e.target.dataset.bomCol;
    if (!c) return;
    ui.bomCols = Object.assign({}, ui.bomCols); ui.bomCols[c] = e.target.checked;
    saveUi(); refreshBom();
  });

  // CSV of every line in the current layout, whatever the columns and search. Names come from
  // review files other people write, so cells that a spreadsheet would run as a formula are quoted.
  function bomCsv(p) {
    var b = P.bom(p, index, ui.bomMode === 'flat' ? 'flat' : 'indented');
    function cell(v) { v = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
    var head = ['Item', 'Level', 'Kind', 'Name', 'Number', 'Rev', 'Source', 'Supplier', 'MPN', 'Qty', 'Mass each (g)', 'Mass (g)', 'Stage', 'Progress (%)', 'Notes'];
    var lines = [head.map(cell).join(',')].concat(b.rows.map(function (r) {
      var src = (P.sources().filter(function (s) { return s.id === r.source; })[0] || {}).label || '';
      return [r.item, r.level, r.kind, r.name, r.number, r.rev, src, r.supplier, r.mpn, r.kind === 'part' ? (b.mode === 'flat' ? r.extQty : r.qty) : '',
        r.massG, r.extMassG, r.stage, r.pct == null ? '' : pct(r.pct), r.notes].map(cell).join(',');
    }));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' }));
    a.download = (p.slug || 'product') + '-bom' + (b.mode === 'flat' ? '-consolidated' : '') + '.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // The printable BOM: the suite's report page (suite.css .report/.paper), with the columns and
  // search in use and every assembly expanded.
  function bomReport(p) {
    var b = bomData(p), cols = bomCols(), rows = bomRows(p, b, true), m = p.meta, labels = {};
    BOM_COLS.forEach(function (c) { labels[c[0]] = c[1]; });
    var head = cols.filter(function (c) { return c === 'item' || c === 'pic'; }), rest = cols.filter(function (c) { return head.indexOf(c) < 0; });
    var today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    var html = '<div class="report-bar"><b>Bill of materials</b><div style="display:flex;gap:8px"><button class="btn" data-act="close-report">Close</button><button class="btn btn-primary" data-act="print">Print / Save PDF</button></div></div>' +
      '<div class="paper bom-paper"><div class="r-head"><div><div class="r-brand">DOVETAIL · SIGNOFF PL</div><h1>' + esc(m.name) + '</h1><div style="color:#515154">Bill of materials, ' + (b.mode === 'flat' ? 'consolidated' : 'indented') + '</div></div>' +
      '<div style="text-align:right;color:#515154">' + esc(today) + '</div></div>' +
      '<div class="r-meta"><div><span>Product number</span>' + esc(m.number || '—') + '</div><div><span>Client</span>' + esc(m.client || '—') + '</div><div><span>Build phase</span>' + esc(m.phase || '—') + '</div>' +
      '<div><span>Totals</span>' + plural(b.totals.lines, 'line') + ' · ' + plural(b.totals.qty, 'piece') + ' · ' + fmtMass(b.totals.massG) + '</div></div>' +
      (ui.bomQ ? '<p style="color:#515154">Filtered: “' + esc(ui.bomQ) + '”</p>' : '') +
      '<table><thead><tr>' + head.map(function (c) { return '<th>' + esc(labels[c]) + '</th>'; }).join('') + '<th>Name</th>' + rest.map(function (c) { return '<th class="' + (BOM_NUM[c] ? 'num' : '') + '">' + esc(labels[c]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="' + (r.kind === 'assembly' ? 'asm' : '') + '">' + head.map(function (c) { return '<td>' + bomCell(p, r, c, b, true) + '</td>'; }).join('') + '<td>' + bomName(p, r, b, true) + '</td>' +
          rest.map(function (c) { return '<td class="' + (BOM_NUM[c] ? 'num' : '') + '">' + bomCell(p, r, c, b, true) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="' + (head.length + 1) + '"><b>Total</b></td>' + rest.map(function (c) { return '<td class="num">' + (c === 'extMassG' ? '<b>' + fmtMass(b.totals.massG) + '</b>' : c === 'qty' ? '<b>' + b.totals.qty + '</b>' : '') + '</td>'; }).join('') + '</tr></tfoot></table>' +
      (b.totals.massMissing ? '<p style="color:#86868b;margin-top:10px">' + plural(b.totals.massMissing, 'line') + ' without a mass ' + (b.totals.massMissing === 1 ? 'is' : 'are') + ' left out of the total.</p>' : '') +
      '<div class="r-foot"><span>Signoff PL' + (window.SIGNOFF_VERSION ? ' · ' + esc(window.SIGNOFF_VERSION.hash) : '') + '</span><span>' + esc(m.name) + (m.number ? ' · ' + esc(m.number) : '') + ' · ' + esc(today) + '</span></div></div>';
    var r = $('#report'); r.innerHTML = html; r.hidden = false;
    loadPictures(r);
  }

  // ── Sheets ───────────────────────────────────────────────
  function sheet(html, opts) {
    closeSheet();
    var wrap = document.createElement('div');
    wrap.className = 'sheet-wrap'; wrap.id = 'sheet';
    wrap.innerHTML = '<div class="sheet' + (opts && opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) closeSheet(); });
    document.body.appendChild(wrap);
    var first = wrap.querySelector('input:not([type=checkbox]),textarea');
    if (first) setTimeout(function () { first.focus(); }, 30);
    return wrap;
  }
  // Deleting marks the project deleted; it syncs like any edit, so it goes for everyone, but the
  // file stays in the data repository with its history. Linked reviews and harnesses aren't touched.
  function deleteProject(p) {
    if (!confirm('Delete ' + (p.meta.name || 'this project') + '? It goes from Signoff PL for everyone at the next sync. ' +
      'Its linked design reviews and harnesses aren’t touched, and the file stays in the data repository, so it can be recovered.')) return false;
    p.meta.deleted = true; p.meta.archived = true;
    if (ui.slug === p.slug) { ui.slug = firstSlug(); ui.sel = ''; saveUi(); }
    touch(p); toast('Deleted ' + (p.meta.name || 'the project'));
    return true;
  }
  function closeSheet() { var s = $('#sheet'); if (s) s.remove(); }

  // ── History (Chris, 2026-11-13: as Signoff EE's, a sheet from the ⋯ menu; ../signoff/docs/history.md) ──
  // The project's changes, newest first, from the versions of its file in git (store.fileHistory,
  // P.historyRows), never stored, each by the record's own stamp. This browser's unsynced edits come
  // first. Runs by one person fold into blocks (M.historyBlocks). Revert writes a record as it was before
  // as a new edit, refused when it changed since. The demo has no git: each record's latest change only.
  var HIST_KEY = { meta: 'meta', node: 'nodes', req: 'reqs' };
  var HIST_KIND = { meta: 'Details', node: 'Part', req: 'Requirement' };
  var HIST_NOUN = { meta: ['detail change', 'detail changes'], node: ['Part change', 'Part changes'], req: ['requirement', 'requirements'] };
  var histCache = {};
  function histWordDiff(a, b) {
    var x = String(a || '').split(/(\s+)/), y = String(b || '').split(/(\s+)/), n = x.length, m = y.length, i, j;
    if (n * m > 250000) return '<del>' + esc(a) + '</del> <ins>' + esc(b) + '</ins>';
    var L = []; for (i = 0; i <= n; i++) L.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = [], put = function (t, s) { var l = out[out.length - 1]; if (l && l.t === t) l.s += s; else out.push({ t: t, s: s }); };
    i = 0; j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { put('=', x[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) put('-', x[i++]);
      else put('+', y[j++]);
    }
    while (i < n) put('-', x[i++]);
    while (j < m) put('+', y[j++]);
    return out.map(function (p) {
      if (p.t === '=') return esc(p.s);
      var lead = /^\s*/.exec(p.s)[0], core = p.s.slice(lead.length), tag = p.t === '+' ? 'ins' : 'del';
      return esc(lead) + (core ? '<' + tag + '>' + esc(core) + '</' + tag + '>' : '');
    }).join('');
  }
  function histText(kind, r, doc) {
    if (!r) return '';
    var line = function (k, v) { return v === '' || v == null ? '' : k + ': ' + v; };
    if (kind === 'node') {
      var parent = r.parent && doc && doc.nodes && doc.nodes[r.parent] ? doc.nodes[r.parent].name || 'Untitled' : r.parent ? '(removed assembly)' : '(top)';
      return [line(r.kind === 'assembly' ? 'Assembly' : 'Part', r.name), line('Number', r.number), line('Under', parent),
        line('Linked to', P.refKey(r.ref) || (r.source ? r.source + ', not linked yet' : '')), line('Quantity', r.qty), line('Supplier', r.supplier), line('MPN', r.mpn),
        line('Mass (g)', r.massG), line('Envelope (mm)', r.envelopeMm), line('3D model', r.model ? r.model.name || 'attached' : ''), line('Notes', r.notes)].filter(Boolean).join('\n');
    }
    if (kind === 'req') return [[r.ref, r.text].filter(Boolean).join(' '), line('Status', r.status), line('Verify', r.verify || 'open'), line('Evidence', r.evidence),
      line('Allocated to', (r.parts || []).length ? (r.parts || []).length + ' Part' + ((r.parts || []).length === 1 ? '' : 's') : '')].filter(Boolean).join('\n');
    return [line('Name', r.name), line('Client', r.client), line('Client project', r.clientProject), line('Number', r.number), line('Phase', r.phase),
      line('Description', r.description), r.archived ? 'Archived' : ''].filter(Boolean).join('\n');
  }
  function historySheet(p) {
    if (!p) return;
    var st = { rows: [], page: 0, more: !DEMO, loading: false, error: '', versions: [], filter: 'all', gap: 2 * 3600e3, open: {}, sel: null };
    var w = sheet('<div></div>', { wide: true }), box = w.querySelector('.sheet');
    box.classList.add('hist-sheet');
    var FILTERS = [['all', 'Everything'], ['node', 'Parts'], ['req', 'Requirements'], ['meta', 'Details']];
    function listText(a) { return a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ', and ' + a[a.length - 1]; }
    function initials(name) { var x = String(name || '?').trim().split(/\s+/).filter(Boolean); return ((x[0] || '?').charAt(0) + (x.length > 1 ? x[x.length - 1].charAt(0) : '')).toUpperCase(); }
    function clock(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
    function relDay(iso) {
      var d = new Date(iso), t = new Date();
      if (isNaN(d)) return '';
      if (d.toDateString() === t.toDateString()) return 'Today';
      if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    }
    function shown() { return st.rows.filter(function (r) { return st.filter === 'all' || r.kind === st.filter; }); }
    // The document a row's record lives in, for names of assemblies: the version it came from.
    function docAt(r, after) {
      if (!r.commit) return after ? p : (st.versions[0] && st.versions[0].doc) || p;
      var k = -1; st.versions.forEach(function (v, i) { if (k < 0 && v.commit && v.commit.sha === r.commit.sha) k = i; });
      return after ? (st.versions[k] || {}).doc : (st.versions[k + 1] || {}).doc;
    }
    function paneHtml() {
      var s = st.sel;
      if (!s) return '<p class="note">Pick a block or a change to see what it did.</p>';
      var rows = s.row != null ? [st.rows[s.row]] : ((M.historyBlocks(shown(), st.gap).filter(function (b) { return b.by + '|' + b.end === s.block; })[0]) || { rows: [] }).rows;
      return rows.map(function (r) {
        var rk = st.rows.indexOf(r), a = histText(r.kind, r.after, docAt(r, true)), b = histText(r.kind, r.before, docAt(r, false));
        var diff = r.deleted ? '<del>' + esc(b || a) + '</del>' : histWordDiff(r.before ? b : '', a);
        var where = r.commit ? 'synced in <a href="https://github.com/' + esc(homeOf(p)) + '/commit/' + esc(r.commit.sha) + '" target="_blank" rel="noopener"><code>' + esc(r.commit.sha.slice(0, 7)) + '</code></a>' +
          (r.commit.login ? ' by @' + esc(r.commit.login) : '') : r.commit === null ? 'not synced yet' : '';
        // A Part or System requirement goes back to its earlier version; an added requirement can be
        // removed (a tombstone). Removing an added Part would orphan what's under it, so that's done in the tree.
        var canRevert = !DEMO && r.kind !== 'meta' && (r.before || (r.kind === 'req' && !r.deleted));
        return '<div class="hist-chg"><h3>' + esc(HIST_KIND[r.kind]) + ': ' + esc(r.label) + '</h3>' +
          '<p class="hist-meta">' + esc((r.by || 'Someone') + ' · ' + clock(r.at) + ', ' + relTime(r.at) + ' · ' + r.detail) + (where ? ' · ' + where : '') + '</p>' +
          (a || b ? '<div class="hist-diff">' + diff + '</div>' : '') +
          (canRevert ? '<div class="hist-acts"><button class="btn btn-sm" data-h="revert" data-r="' + rk + '">' + (r.before ? 'Revert…' : 'Remove…') + '</button></div>' : '') + '</div>';
      }).join('');
    }
    function draw() {
      var blocks = M.historyBlocks(shown(), st.gap), lastDay = '', html = '';
      blocks.forEach(function (b) {
        var day = relDay(b.end);
        if (day !== lastDay) { html += '<li class="hist-day">' + esc(day) + '</li>'; lastDay = day; }
        var counts = {}; b.rows.forEach(function (r) { counts[r.kind] = (counts[r.kind] || 0) + 1; });
        var list = Object.keys(counts).map(function (k) { return counts[k] + ' ' + HIST_NOUN[k][counts[k] === 1 ? 0 : 1]; });
        var key = b.by + '|' + b.end, open = !!st.open[key], unsynced = b.rows.every(function (r) { return r.commit === null; });
        var span = clock(b.start) !== clock(b.end) ? clock(b.start) + '–' + clock(b.end) : clock(b.end);
        html += '<li class="hist-blk' + (open ? ' open' : '') + (st.sel && st.sel.block === key ? ' sel' : '') + '">' +
          '<span class="hist-node" aria-hidden="true">' + esc(initials(b.by)) + '</span>' +
          '<button class="hist-head" data-h="block" data-k="' + esc(key) + '" aria-expanded="' + open + '"><span class="hist-who">' + esc(b.by || 'Someone') + '</span>' +
          (unsynced ? '<span class="hist-tag">Not synced yet</span>' : '') +
          '<span class="hist-when">' + esc(span + ' · ' + relTime(b.end)) + '</span><span class="hist-counts">' + esc(listText(list)) + '</span></button>' +
          (open ? '<ul class="hist-rows">' + b.rows.map(function (r) {
            var rk = st.rows.indexOf(r);
            return '<li><button class="hist-row' + (st.sel && st.sel.row === rk ? ' sel' : '') + '" data-h="row" data-r="' + rk + '"><span class="hist-kind">' + esc(HIST_KIND[r.kind]) + '</span>' +
              '<span class="hist-what">' + esc(r.label) + (r.deleted ? ' <span class="hist-tag hist-del">Removed</span>' : ' <span class="muted">' + esc(r.detail) + '</span>') + '</span>' +
              '<time>' + esc(clock(r.at)) + '</time></button></li>';
          }).join('') + '</ul>' : '') + '</li>';
      });
      var people = {}; st.rows.forEach(function (r) { people[r.by || 'Someone'] = 1; });
      var foot = st.loading ? '<p class="note">Reading the project’s history from GitHub…</p>'
        : st.error ? '<p class="note">' + esc(st.error) + '</p>'
        : st.more ? '<button class="btn" data-h="older">Load older</button>'
        : st.rows.length ? '<p class="note">' + (DEMO ? 'In the demo, history shows each record’s latest change only.' : 'That’s the whole history.') + '</p>' : '';
      box.innerHTML = '<div class="sheet-head"><h2>History · ' + esc(p.meta.name) + '</h2><p>' +
        esc(st.rows.length ? st.rows.length + ' changes by ' + listText(Object.keys(people)) + '. Runs by one person fold into a block.' : 'Who changed what, from the project’s versions on GitHub.') + '</p></div>' +
        '<div class="hist-bar"><div class="seg" role="group" aria-label="Show">' + FILTERS.map(function (f) {
          return '<button data-h="filter" data-f="' + f[0] + '" aria-pressed="' + (st.filter === f[0]) + '">' + esc(f[1]) + '</button>';
        }).join('') + '</div><label class="hist-gap">Fold runs within <select data-h="gap">' + [[30, '30 min'], [120, '2 h'], [1440, '1 day'], [0, 'Never']].map(function (o) {
          return '<option value="' + o[0] * 6e4 + '"' + (st.gap === o[0] * 6e4 ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></label></div>' +
        '<div class="hist-grid"><div class="hist-col"><ol class="hist-tl">' + (html || (st.loading ? '' : '<li class="note">No changes' + (st.filter === 'all' ? '' : ' of this kind') + ' yet.</li>')) + '</ol>' + foot + '</div>' +
        '<div class="hist-col hist-pane">' + paneHtml() + '</div></div>' +
        '<div class="sheet-foot"><button class="btn" data-h="close">Close</button></div>';
    }
    function load() {
      if (DEMO) {
        st.rows = P.historyDiff(null, p).filter(function (r) { return r.kind !== 'meta'; });
        st.more = false; draw(); return;
      }
      var full = homeOf(p), token = getToken();
      var store = new S.GitHubStore({ owner: full.split('/')[0], repo: full.split('/')[1], branch: settings.branch, dataPath: '', token: token });
      st.loading = true; st.error = ''; draw();
      histCache[full] = histCache[full] || {};
      store.fileHistory('projects/' + p.id + '.json', { page: st.page + 1, perPage: 15, cache: histCache[full] }).then(function (got) {
        st.page++;
        st.versions = st.versions.concat(got.versions.map(function (v) {
          var doc = null; try { doc = v.text ? JSON.parse(v.text) : null; } catch (e) { /* not a project file */ }
          return { doc: doc && doc.meta ? doc : null, commit: v.commit };
        }).filter(function (v) { return v.doc; }));
        st.more = got.more;
        // This browser's edits not on GitHub yet: records newer here than in the newest version.
        var newest = st.versions[0], mine = !newest ? P.historyDiff(null, p)
          : P.historyDiff(newest.doc, p).filter(function (r) { return !r.before || String(r.after.updatedAt || '') > String(r.before.updatedAt || ''); });
        mine.forEach(function (r) { r.commit = null; });
        st.rows = mine.concat(P.historyRows(st.versions, { complete: !got.more })).sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
        st.loading = false; draw();
      }, function (err) { st.loading = false; st.error = 'Couldn’t read the history from GitHub: ' + (err.message || 'unknown error'); draw(); });
    }
    function revert(r) {
      var map = HIST_KEY[r.kind], cur = (p[map] || {})[r.id];
      var k = function (x) { return x ? String(x.updatedAt || '') + '|' + String(x.updatedBy || '') : ''; };
      if (k(cur) !== k(r.after)) { toast((cur && cur.updatedBy ? cur.updatedBy : 'Someone') + ' changed it since. Open its newest change to revert from there.'); return; }
      if (!confirm((r.before ? 'Put “' + r.label + '” back as it was before this change?' : 'Remove “' + r.label + '”, which this change added?') +
        '\n\nIt’s saved as a new edit by you and syncs like any other. Nothing in GitHub’s history is rewritten.')) return;
      var rec = JSON.parse(JSON.stringify(r.before || Object.assign({}, r.after, { deleted: true })));
      M.stamp(rec, me());
      p[map] = p[map] || {}; p[map][r.id] = rec;
      touch(p);
      st.rows.unshift({ kind: r.kind, id: r.id, label: r.label, detail: r.before ? 'reverted' : 'removed', at: rec.updatedAt, by: rec.updatedBy, deleted: !!rec.deleted, before: cur, after: rec, commit: null });
      st.sel = { row: 0 }; draw();
      toast(r.before ? 'Reverted' : 'Removed');
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-h]'); if (!b) return;
      var h = b.getAttribute('data-h');
      if (h === 'close') closeSheet();
      else if (h === 'filter') { st.filter = b.getAttribute('data-f'); st.sel = null; draw(); }
      else if (h === 'block') { var key = b.getAttribute('data-k'); st.open[key] = !st.open[key]; st.sel = { block: key }; draw(); }
      else if (h === 'row') { st.sel = { row: +b.getAttribute('data-r') }; draw(); }
      else if (h === 'older') load();
      else if (h === 'revert') revert(st.rows[+b.getAttribute('data-r')]);
    });
    box.addEventListener('change', function (e) { if (e.target.getAttribute('data-h') === 'gap') { st.gap = +e.target.value; st.open = {}; st.sel = null; draw(); } });
    load();
  }
  function val(w, sel) { var el = w.querySelector(sel); return el ? el.value.trim() : ''; }

  function projectSheet(p) {
    var m = p ? p.meta : { name: '', client: '', number: '', description: '', phase: (C.phases || [])[0] };
    var w = sheet('<div class="sheet-head"><h2>' + (p ? 'Project details' : 'New project') + '</h2><p>A PL project is the whole product. Its Parts link to their design reviews in Signoff EE and ME.</p></div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label for="f-name">Product name</label><input class="input" id="f-name" value="' + esc(m.name) + '" placeholder="e.g. Smart thermostat" maxlength="120"></div>' +
      '<div class="row2"><div class="field"><label for="f-client">Client</label><input class="input" id="f-client" value="' + esc(m.client) + '" placeholder="Optional"></div>' +
      '<div class="field"><label for="f-number">Product number</label><input class="input" id="f-number" value="' + esc(m.number) + '" placeholder="e.g. PRD-1042"></div></div>' +
      '<div class="field"><label for="f-cproj">Client project in Signoff EE and ME</label><input class="input" id="f-cproj" list="f-cproj-list" value="' + esc(m.clientProject || '') + '" placeholder="' + esc(m.name || 'Same as the product name') + '" autocomplete="off">' +
        '<datalist id="f-cproj-list">' + clientProjects().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
        '<p class="note">The boards and parts tagged with this project are offered on the System page. Leave it empty to use the product name.</p></div>' +
      '<div class="field"><label for="f-phase">Build phase</label><select class="input" id="f-phase">' + (C.phases || []).map(function (s) { return '<option' + (s === m.phase ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="f-desc">Description</label><textarea class="input" id="f-desc" placeholder="What the product is and where the project stands">' + esc(m.description) + '</textarea></div>' +
      '</div><div class="sheet-foot">' + (p ? '<button class="btn btn-danger" data-sheet="delete">Delete</button><button class="btn" data-sheet="archive">' + (m.archived ? 'Unarchive' : 'Archive') + '</button><span class="spacer"></span>' : '<span class="spacer"></span>') +
      '<button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">' + (p ? 'Save' : 'Create project') + '</button></div>');
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sheet]'); if (!b) return;
      if (b.dataset.sheet === 'cancel') return closeSheet();
      if (b.dataset.sheet === 'archive') { p.meta.archived = !p.meta.archived; closeSheet(); touch(p); return; }
      if (b.dataset.sheet === 'delete') { if (deleteProject(p)) closeSheet(); return; }
      var name = val(w, '#f-name');
      if (!name) { w.querySelector('#f-name').focus(); return; }
      var fields = { name: name, client: val(w, '#f-client'), clientProject: val(w, '#f-cproj'), number: val(w, '#f-number'), phase: val(w, '#f-phase'), description: val(w, '#f-desc') };
      if (p) { Object.assign(p.meta, fields); closeSheet(); touch(p); return; }
      var doc = P.newProject(fields, me()), slug = doc.slug, k = 2;
      while (projects[slug]) slug = doc.slug + '-' + k++;
      doc.slug = slug; projects[slug] = doc;
      ui.slug = slug; ui.view = 'system'; saveUi();
      closeSheet(); touch(doc);
    });
  }

  // Add (fields.parent preset) or edit a node.
  function nodeSheet(id, preset) {
    var p = current(), t = P.tree(p);
    // A new Part goes inside the product's one top assembly unless you choose otherwise.
    var home = t.roots.length === 1 && t.nodes[t.roots[0]].kind === 'assembly' ? t.roots[0] : '';
    var n = id ? p.nodes[id] : Object.assign({ kind: 'part', name: '', number: '', source: (C.tools[0] || {}).id || 'purchased', ref: null, qty: 1, parent: home }, preset || {});
    var banned = id ? Object.assign(P.descendants(t, id), (function () { var o = {}; o[id] = 1; return o; })()) : {};
    var parents = P.flatten(t).filter(function (x) { return t.nodes[x].kind === 'assembly' && !banned[x]; });
    var st = id ? P.partStatus(n, index) : null;
    var w = sheet('<div class="sheet-head"><h2>' + (id ? esc(n.name || 'Part') : 'Add to ' + esc(p.meta.name)) + '</h2>' +
      (id ? '<p>' + esc(P.path(t, id).map(function (x) { return x.name; }).join(' › ') || 'Top level') + '</p>' : '<p>Pick an existing design, or type in a generic Part. An assembly groups Parts.</p>') + '</div>' +
      '<div class="sheet-body">' +
      '<div class="field"><span class="field-label">Kind</span><div class="seg full" id="f-kind">' + [['part', 'Part'], ['assembly', 'Assembly']].map(function (k) {
        return '<button type="button" class="' + (n.kind === k[0] ? 'on' : '') + '" data-kind="' + k[0] + '">' + k[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div id="f-link"></div>' +
      '<div class="row2"><div class="field"><label for="f-name">Name</label><input class="input" id="f-name" value="' + esc(n.name) + '" placeholder="e.g. Main board"></div>' +
      '<div class="field"><label for="f-number">Number</label><input class="input" id="f-number" value="' + esc(n.number) + '" placeholder="Part or drawing number"></div></div>' +
      '<div class="field"><label for="f-parent">Inside</label><select class="input" id="f-parent"><option value="">Top level</option>' + parents.map(function (x) {
        return '<option value="' + esc(x) + '"' + ((n.parent || '') === x ? ' selected' : '') + '>' + ' '.repeat(t.depth[x]) + esc(t.nodes[x].name) + '</option>';
      }).join('') + '</select></div>' +
      '<div id="f-part"></div>' +
      '<div class="field"><label for="f-notes">Notes</label><textarea class="input" id="f-notes" placeholder="Optional">' + esc(n.notes || '') + '</textarea></div>' +
      '</div><div class="sheet-foot">' + (id ? '<button class="btn btn-danger" data-sheet="delete">Delete</button>' : '') + '<span class="spacer"></span>' +
      (id && st && (st.state === 'ok' || st.state === 'nosummary') ? '<a class="btn" href="' + esc(designUrl(n)) + '">Open in ' + esc(P.toolById(n.source).short) + '</a>' : '') +
      '<button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">' + (id ? 'Save' : 'Add') + '</button></div>', { wide: true });

    var kind = n.kind, source = n.source || '';
    var linked = P.refKey(n.ref);   // "tool:id" of the picked design, or ''
    // An assembly may link a review of the whole assembly (summary.kind 'assembly'; P.linkStatus).
    function isAsmKey(k) { return !!k && (P.isAssemblyDesign(index && index.entries[k]) || (n.kind === 'assembly' && k === P.refKey(n.ref))); }
    // A Part is an existing design from a Signoff tool, one to be made in a tool that isn't started yet
    // (it waits in that tool's From Signoff PL list and links itself once started there; pl.js
    // claimPlanned), or a generic Part you type in (purchased). New Parts start on the design list.
    var mode = !P.toolById(source) ? 'generic' : id && !linked ? 'planned' : 'design';
    var generic = mode === 'generic', lastGeneric = generic ? source : 'purchased';
    var lastPlanned = mode === 'planned' ? source : (P.toolById('loom') ? 'loom' : (C.tools[0] || {}).id);
    function allDesigns() {
      return C.tools.reduce(function (all, tool) { return all.concat(S.plReader.designs(index, tool.id)); }, []);
    }
    // Design cards, those of this product's client project first. A design another Part already
    // links to is marked, not hidden: the same board can be used twice.
    function pickCards(q) {
      var list = allDesigns().filter(function (d) { return kind !== 'assembly' || P.isAssemblyDesign(d); }), mine = String(p.meta.name || '').toLowerCase(), used = {};
      P.flatten(t).forEach(function (x) { if (x !== id && t.nodes[x].ref) used[P.refKey(t.nodes[x].ref)] = 1; });
      var shown = list.filter(function (d) {
        return !q || [d.name, d.number, d.summary && d.summary.project, (P.toolById(d.tool) || {}).short].join(' ').toLowerCase().indexOf(q) >= 0;
      });
      var here = shown.filter(function (d) { return d.summary && d.summary.project && d.summary.project.toLowerCase() === mine; });
      var rest = shown.filter(function (d) { return here.indexOf(d) < 0; });
      function card(d) {
        var s = d.summary, key = d.tool + ':' + d.id, on = key === linked;
        return '<button type="button" class="pick' + (on ? ' on' : '') + (d.archived ? ' archived' : '') + '" data-pick="' + esc(key) + '" aria-pressed="' + on + '">' +
          '<div class="map-art">' + art({ source: d.tool, number: d.number }, false, d) + '</div><div class="pick-body"><div class="map-name">' + esc(d.name || d.id) + '</div>' +
          '<div class="map-meta"><span>' + esc([d.number, d.revision && 'Rev ' + d.revision].filter(Boolean).join(' · ')) + '</span>' +
          (s ? '<span>' + (s.harness ? esc(designStat(s)) : esc(s.stage || d.stage || '') + (s.stage || d.stage ? ' · ' : '') + pct(s.pct) + '%') + '</span>' : '<span>Not summarized yet</span>') + '</div>' +
          '<div class="pick-tags">' + srcChip(d.tool) + (P.isAssemblyDesign(d) ? '<span>Assembly</span>' : '') + (s && s.project && here.indexOf(d) < 0 ? '<span>' + esc(s.project) + '</span>' : '') +
            (used[key] ? '<span>In use</span>' : '') + (d.archived ? '<span>Archived</span>' : '') + '</div></div></button>';
      }
      var missing = linked && !list.some(function (d) { return d.tool + ':' + d.id === linked; });
      return (missing ? '<button type="button" class="pick on" data-pick="' + esc(linked) + '"><div class="pick-body"><div class="map-name">' + esc(linked.split(':')[1]) + '</div><div class="map-meta"><span>Not found</span></div></div></button>' : '') +
        (here.length ? '<div class="pick-group">In ' + esc(p.meta.name) + '</div>' + here.map(card).join('') : '') +
        (rest.length ? (here.length ? '<div class="pick-group">Other projects</div>' : '') + rest.map(card).join('') : '') +
        (q && !shown.length ? '<p class="note">Nothing matches “' + esc(q) + '”.</p>' : '');
    }
    function refreshPicks() {
      var box = w.querySelector('#f-ref-list'), qEl = w.querySelector('#f-ref-q');
      if (box) { box.innerHTML = pickCards(qEl ? qEl.value.trim().toLowerCase() : ''); loadPictures(box); }
    }
    function linkFields() {
      var box = w.querySelector('#f-link');
      if (kind !== 'part') {
        var asms = allDesigns().filter(function (d) { return P.isAssemblyDesign(d); });
        box.innerHTML = '<div class="field"><span class="field-label">Review of this assembly (optional)</span>' +
          (asms.length || linked ? (asms.length > 6 ? '<input class="input" id="f-ref-q" type="search" placeholder="Search assembly reviews" autocomplete="off" aria-label="Search assembly reviews">' : '') +
            '<div class="pick-grid" id="f-ref-list">' + pickCards('') + '</div><p class="note">A Signoff ME part marked as an assembly in its details. Its review shows on this branch and counts with the Parts inside. Click it again to unlink.</p>'
            : '<p class="note">None yet. In Signoff ME, open a part’s details and choose <b>An assembly</b>; after the next sync it can be linked here.</p>') + '</div>';
        loadPictures(box);
        return;
      }
      var list = allDesigns(), tools = orList(C.tools.map(function (x) { return x.short; }));
      var html = '<div class="field"><div class="seg full" id="f-mode">' + [['design', 'Existing ' + tools + ' design'], ['planned', 'Placeholder for ' + tools], ['generic', 'Generic Part']].map(function (m) {
        return '<button type="button" class="' + (mode === m[0] ? 'on' : '') + '" data-mode="' + m[0] + '">' + esc(m[1]) + '</button>';
      }).join('') + '</div></div>';
      if (mode === 'planned') {
        var tl = P.toolById(source) || {};
        html += '<div class="field"><span class="field-label">To be made in</span><div class="seg full" id="f-plan">' + C.tools.map(function (x) {
          return '<button type="button" class="' + (source === x.id ? 'on' : '') + '" data-plan="' + esc(x.id) + '">' + esc(x.short) + '</button>';
        }).join('') + '</div><p class="note">' + (source === 'loom'
          ? 'The Part waits in Loom’s From Signoff PL list. Start it there and Loom makes the harness with this name and number; it links to this Part at PL’s next sync.'
          : 'The Part waits in ' + esc(tl.name || 'its tool') + '’s From Signoff PL list. Start it there and the new review gets this name and number; it links to this Part at PL’s next sync.') + '</p></div>';
      } else if (generic) {
        html += '<div class="field"><span class="field-label">Kind of Part</span><div class="seg full" id="f-source">' + P.sources().filter(function (s) { return !s.tool; }).map(function (s) {
          return '<button type="button" class="' + (source === s.id ? 'on' : '') + '" data-source="' + esc(s.id) + '">' + esc(s.name) + '</button>';
        }).join('') + '</div></div>';
      } else {
        html += '<div class="field">' + (list.length > 6 ? '<input class="input" id="f-ref-q" type="search" placeholder="Search designs by name, number, or client project" autocomplete="off" aria-label="Search designs">' : '') +
          '<div class="pick-grid" id="f-ref-list">' + pickCards('') + '</div>' +
          (!index ? '<p class="note">Designs haven’t been read yet. ' + (DEMO ? '' : 'Sync to read them from GitHub.') + '</p>'
            : !list.length ? '<p class="note">No designs found in ' + esc(orList(C.tools.map(function (x) { return x.name; }))) + '. Sync to read them again.</p>' : '') + '</div>';
      }
      box.innerHTML = html;
      loadPictures(box);
    }
    function partFields() {
      linkFields();
      var box = w.querySelector('#f-part');
      if (kind !== 'part') { box.innerHTML = ''; return; }
      box.innerHTML =
      '<div class="row2"><div class="field"><label for="f-qty">Quantity</label><input class="input" id="f-qty" type="number" min="1" step="1" value="' + esc(n.qty || 1) + '"></div>' +
      '<div class="field"><label for="f-mass">Mass each (g)</label><input class="input" id="f-mass" type="number" min="0" step="0.1" value="' + esc(n.massG == null ? '' : n.massG) + '" placeholder="Optional"></div></div>' +
      (source === 'purchased' ? '<div class="row2"><div class="field"><label for="f-supplier">Supplier</label><input class="input" id="f-supplier" value="' + esc(n.supplier || '') + '"></div>' +
        '<div class="field"><label for="f-mpn">Manufacturer part number</label><input class="input" id="f-mpn" value="' + esc(n.mpn || '') + '"></div></div>' +
        '<div class="field"><label for="f-env">Envelope (mm)</label><input class="input" id="f-env" value="' + esc(n.envelopeMm || '') + '" placeholder="e.g. 70 × 55 × 38"></div>' : '') +
      (MODEL_SOURCES[source] ? '<div class="field"><span class="field-label">3D model</span><div class="m-attach" id="f-model">' + modelField() + '</div></div>' : '');
    }
    // A STEP is read here when picked and stored on Save. `mdl` is the Part's model (null once
    // removed); `prep` a newly read one.
    var mdl = id && n.kind === 'part' ? P.cleanModel(n.model) : null, prep = null, keepStep = true, reading = '';
    function modelField() {
      if (reading) return '<div class="m-busy"><span class="spin" aria-hidden="true"></span>' + esc(reading) + '</div>';
      var pick = '<label class="btn m-pick"><input type="file" accept=".step,.stp" id="f-step" hidden>' + (prep || mdl ? 'Replace…' : 'Attach STEP…') + '</label>';
      if (prep) {
        var stored = prep.meshGz.length + prep.views.reduce(function (a, v) { return a + v.blob.size; }, 0);
        return '<div class="m-row"><div class="m-thumb"><img alt="" src="' + esc(prepUrl(prep)) + '"></div><div class="m-info"><b>' + esc(prep.name) + '</b>' +
          '<span>' + esc(prep.bboxMm.join(' × ')) + ' mm · ' + prep.tris.toLocaleString() + ' triangles' + (prep.srcTris > prep.tris ? ' (simplified from ' + prep.srcTris.toLocaleString() + ')' : '') + '</span>' +
          '<span>Stored: model and pictures ' + fmtBytes(stored) + (keepStep && prep.stepFits ? ' + STEP ' + fmtBytes(prep.stepGz.length) + ' compressed (' + fmtBytes(prep.size) + ' as picked)' : '') + '</span>' +
          '<label class="check"><input type="checkbox" id="f-keep-step"' + (keepStep && prep.stepFits ? ' checked' : '') + (prep.stepFits ? '' : ' disabled') + '> Also keep the original STEP' +
            (prep.stepFits ? ' (' + fmtBytes(prep.stepGz.length) + ' compressed)' : ': too big, over ' + fmtBytes(S.model3d.STEP_CAP) + ' compressed') + '</label></div></div>' +
          '<div class="m-acts">' + pick + '<button type="button" class="btn" data-model="remove">Remove</button></div>';
      }
      if (mdl) {
        return '<div class="m-row"><div class="m-thumb map-art">' + art(n, false) + '</div><div class="m-info"><b>' + esc(mdl.file) + '</b><span>' + modelLine(mdl).replace(esc(mdl.file) + ' · ', '') + '</span>' +
          '<span>Stored: ' + fmtBytes(storedBytes(mdl)) + (mdl.step ? ', original STEP included' : ', model and pictures only') + '</span></div></div>' +
          '<div class="m-acts">' + pick + '<button type="button" class="btn" data-model="remove">Remove</button></div>';
      }
      return '<div class="m-drop">' + pick + '<span class="note">Read in this browser. PL stores a simplified model (at most ' + S.model3d.MAX_TRIS.toLocaleString() + ' triangles) and pictures in its data repo; the original STEP too if you choose, compressed. It shows on the map, in Gallery and Exploded, and turns in 3D in the inspector.</span></div>';
    }
    var prepUrls = [];
    function prepUrl(pr) { var u = URL.createObjectURL(pr.views[0].blob); prepUrls.push(u); return u; }
    function refreshModel() { var box = w.querySelector('#f-model'); if (box) { box.innerHTML = modelField(); loadPictures(box); } }
    function readFile(file) {
      if (!file) return;
      if (!/\.(step|stp)$/i.test(file.name)) { toast('Pick a STEP file (.step or .stp)'); return; }
      if (file.size > 300 * 1048576) { toast('That STEP is over 300 MB; export a lighter one (no internal detail) and try again'); return; }
      reading = 'Reading ' + file.name + '…'; refreshModel();
      file.arrayBuffer().then(function (buf) {
        return S.model3d.prepare(file.name, new Uint8Array(buf), function (msg) { reading = msg; refreshModel(); });
      }).then(function (pr) { prep = pr; keepStep = pr.stepFits; reading = ''; refreshModel(); },
        function (err) { reading = ''; refreshModel(); toast('Couldn’t read ' + file.name + ': ' + err.message); });
    }
    w.addEventListener('change', function (e) {
      if (e.target.id === 'f-step') readFile(e.target.files[0]);
      if (e.target.id === 'f-keep-step') { keepStep = e.target.checked; refreshModel(); }
    });
    w.addEventListener('dragover', function (e) { if (e.target.closest('#f-model')) { e.preventDefault(); e.stopPropagation(); } });
    w.addEventListener('drop', function (e) {
      if (!e.target.closest('#f-model')) return;
      e.preventDefault(); e.stopPropagation();
      readFile(e.dataTransfer.files[0]);
    });
    function setKind(k) {
      kind = k;
      w.querySelectorAll('#f-kind button').forEach(function (b) { b.classList.toggle('on', b.dataset.kind === k); });
      partFields();
    }
    partFields();
    w.addEventListener('input', function (e) { if (e.target.id === 'f-ref-q') refreshPicks(); });
    w.addEventListener('click', function (e) {
      var k = e.target.closest('[data-kind]');
      if (k) { setKind(k.dataset.kind); return; }
      var md = e.target.closest('[data-mode]');
      if (md) {
        mode = md.dataset.mode; generic = mode === 'generic';
        source = generic ? lastGeneric : mode === 'planned' ? lastPlanned : (linked ? linked.split(':')[0] : (C.tools[0] || {}).id);
        partFields(); return;
      }
      var pl = e.target.closest('[data-plan]');
      if (pl) { source = lastPlanned = pl.dataset.plan; partFields(); return; }
      var s = e.target.closest('[data-source]');
      if (s) { source = lastGeneric = s.dataset.source; partFields(); return; }
      if (e.target.closest('[data-model="remove"]')) { prep = null; mdl = null; refreshModel(); return; }
      var pk = e.target.closest('[data-pick]');
      if (pk) {
        linked = linked === pk.dataset.pick ? '' : pk.dataset.pick;
        if (linked) source = linked.split(':')[0];
        // ME is the source of truth: a review of an assembly makes this an assembly.
        if (linked && kind === 'part' && isAsmKey(linked)) { setKind('assembly'); toast('That review is of an assembly, so this is an assembly'); }
        var asmPick = kind === 'assembly' && linked && isAsmKey(linked);
        var d = allDesigns().filter(function (x) { return x.tool + ':' + x.id === linked; })[0];
        // The Part takes the design's name and number, unless you've typed your own.
        // An assembly takes its review's name and number even over typed ones (ME is the source of truth;
        // they can still be edited before Save).
        [['#f-name', 'name'], ['#f-number', 'number']].forEach(function (f) {
          var el = w.querySelector(f[0]);
          if ((asmPick && d) || !el.value.trim() || el.value === el.dataset.auto) { el.value = d ? d[f[1]] || '' : ''; el.dataset.auto = el.value; }
        });
        refreshPicks(); return;
      }
      var b = e.target.closest('[data-sheet]'); if (!b) return;
      if (b.dataset.sheet === 'cancel') return closeSheet();
      if (b.dataset.sheet === 'delete') {
        var below = Object.keys(P.descendants(t, id));
        if (!confirm('Delete ' + (n.name || 'this') + (below.length ? ' and the ' + plural(below.length, 'Part or assembly', 'Parts and assemblies') + ' inside it' : '') + '? Linked design reviews aren’t touched.')) return;
        [id].concat(below).forEach(function (x) { p.nodes[x] = M.stamp(Object.assign({}, p.nodes[x], { deleted: true }), me()); });
        closeSheet(); touch(p); return;
      }
      var name = val(w, '#f-name');
      if (!name) { w.querySelector('#f-name').focus(); return; }
      var parent = val(w, '#f-parent');
      if (id && !P.canMove(t, id, parent)) { toast('An assembly can’t go inside itself'); return; }
      var fields = { kind: kind, name: name, number: val(w, '#f-number'), parent: parent, notes: val(w, '#f-notes') };
      var dupes = [];
      if (kind === 'assembly') {
        var ak = isAsmKey(linked) ? linked : '';
        fields.source = ak ? ak.split(':')[0] : '';
        fields.ref = ak ? { tool: ak.split(':')[0], id: ak.split(':').slice(1).join(':') } : null;
        // A Part that links the same review stood for the assembly until now, so it can go (Chris:
        // the enclosure Part goes away and the branch becomes the enclosure).
        // Only a Part that carries nothing an assembly can't hold goes; one with a mass, model, or
        // quantity stays (it may be one of several physical parts that share the review).
        var same = ak && ak !== P.refKey(n.ref) ? P.flatten(t).filter(function (x) { return x !== id && t.nodes[x].kind === 'part' && P.refKey(t.nodes[x].ref) === ak; }) : [];
        dupes = same.filter(function (x) { return !partCarries(t.nodes[x]).length; });
        var kept = same.filter(function (x) { return dupes.indexOf(x) < 0; });
        if (dupes.length && !confirm(dupes.map(function (x) { return t.nodes[x].name || 'A Part'; }).join(', ') + (dupes.length === 1 ? ' links' : ' link') + ' the same review. Remove ' + (dupes.length === 1 ? 'it' : 'them') + ', now that this assembly stands for it?' +
          (kept.length ? '\n\n' + kept.map(function (x) { return (t.nodes[x].name || 'A Part') + ' (' + partCarries(t.nodes[x]).join(', ') + ')'; }).join(', ') + ' also ' + (kept.length === 1 ? 'links' : 'link') + ' it and stay' + (kept.length === 1 ? 's' : '') + '; delete ' + (kept.length === 1 ? 'it' : 'them') + ' yourself if not needed.' : ''))) dupes = [];
      }
      function dropDupes() { dupes.forEach(function (x) { p.nodes[x] = M.stamp(Object.assign({}, p.nodes[x], { deleted: true }), me()); if (ui.sel === x) ui.sel = ''; }); }
      if (kind === 'part') {
        var refId = mode === 'design' ? linked.split(':')[1] || '' : '', mass = val(w, '#f-mass'), qty = parseInt(val(w, '#f-qty'), 10);
        Object.assign(fields, {
          source: source, ref: P.toolById(source) && refId ? { tool: source, id: refId } : null,
          qty: qty > 0 ? qty : 1, massG: mass === '' ? null : Math.max(0, Number(mass)),
          supplier: source === 'purchased' ? val(w, '#f-supplier') : n.supplier || '', mpn: source === 'purchased' ? val(w, '#f-mpn') : n.mpn || '',
          envelopeMm: source === 'purchased' ? val(w, '#f-env') : n.envelopeMm || '',
          // Removed in the sheet → gone; a Part whose kind doesn't take models keeps any it had.
          model: MODEL_SOURCES[source] && !mdl ? null : n.model || null
        });
        // A harness's name and number go back to Loom when they're edited here: stamped now, they
        // win over Loom's at its next sync (loom/assets/store.js). Taken unchanged from the harness,
        // they carry its stamp (pl.js adoptHarnesses).
        if (P.isDrawing(source) && fields.ref) {
          var he = index && index.entries[P.refKey(fields.ref)], hs = he && he.summary;
          if (hs && fields.name === hs.name && fields.number === (hs.number || '')) fields.identAt = hs.identAt || n.identAt || '';
          else if (fields.name !== (n.name || '') || fields.number !== (n.number || '')) fields.identAt = M.now();
        }
      }
      if (reading) { toast('Still reading the STEP…'); return; }
      // A newly read STEP is stored once the Part exists (its files are named under its id).
      var pr = kind === 'part' && MODEL_SOURCES[source] ? prep : null, keep = keepStep;
      function attach(nodeId) {
        if (!pr) return;
        modelRecord(p, nodeId, pr, keep).then(function (rec) {
          var f = { model: rec };
          if (source === 'purchased' && !p.nodes[nodeId].envelopeMm) f.envelopeMm = rec.bboxMm.join(' × ');
          setNode(nodeId, f);
        }, function (err) { toast('Couldn’t keep the model: ' + err.message); });
      }
      if (id) {
        if (parent !== (n.parent || '')) fields.order = P.nextOrder(p, parent);
        dropDupes(); closeSheet(); setNode(id, fields); attach(id); return;
      }
      var node = P.newNode(p, fields, me());
      p.nodes[node.id] = node;
      if (parent) delete ui.closed[parent];
      dropDupes(); closeSheet(); touch(p); attach(node.id);
    });
  }

  // What a Part carries that an assembly can't (assemblies have no mass, model, or quantity), so
  // replacing the Part with an assembly would lose it.
  function partCarries(n) {
    return [n.massG != null && n.massG !== '' && 'a mass', modelOf(n) && 'a 3D model', n.qty > 1 && 'a quantity of ' + n.qty].filter(Boolean);
  }
  // A Part linked to a review of an assembly (summary.kind 'assembly'): pick the assembly that stands
  // for it, or make one where the Part is. The assembly takes the link and the review's name and
  // number (ME is the source of truth), and the Part is removed.
  function asmLinkSheet(partId) {
    var p = current(), t = P.tree(p), n = t.nodes[partId], st = P.partStatus(n, index), e = st && st.entry;
    if (!e) return;
    var asms = P.flatten(t).filter(function (x) { return t.nodes[x].kind === 'assembly'; });
    var guess = asms.filter(function (x) { return !P.isLinkedAssembly(t.nodes[x]) && (t.nodes[x].name || '').toLowerCase() === (e.name || '').toLowerCase(); })[0] || '';
    var carries = partCarries(n);
    var w = sheet('<div class="sheet-head"><h2>Link ' + esc(e.name || n.name) + ' to an assembly</h2><p>' + esc(P.toolById(n.source).name) + ' reviews it as an assembly. The assembly you pick takes the review, its name, and its number' +
      (carries.length ? '. This Part has ' + esc(orList(carries).replace(' or ', ' and ')) + ', which an assembly can’t hold.' : ', and this Part is removed.') + '</p></div>' +
      '<div class="sheet-body"><div class="field"><label for="f-asm">Assembly</label><select class="input" id="f-asm">' +
      '<option value="@new">A new assembly where this Part is</option>' + asms.map(function (x) {
        var a = t.nodes[x], taken = P.isLinkedAssembly(a);
        return '<option value="' + esc(x) + '"' + (x === guess ? ' selected' : '') + (taken ? ' disabled' : '') + '>' + ' '.repeat(t.depth[x]) + esc(a.name || 'Unnamed') + (taken ? ' (has a review)' : '') + '</option>';
      }).join('') + '</select><p class="note">The Parts already in it stay where they are.</p></div>' +
      (carries.length ? '<label class="check"><input type="checkbox" id="f-keep" checked> Keep this Part inside the assembly (it still links the review, which counts once)</label>' : '') + '</div>' +
      '<div class="sheet-foot"><span class="spacer"></span><button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">Link</button></div>');
    w.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-sheet]'); if (!b) return;
      if (b.dataset.sheet === 'cancel') return closeSheet();
      var pick = val(w, '#f-asm'), f = { source: n.source, ref: { tool: n.ref.tool, id: n.ref.id }, name: e.name || n.name, number: e.number || n.number || '' }, target;
      if (pick === '@new') {
        var a = P.newNode(p, Object.assign({ kind: 'assembly', parent: n.parent || '', order: n.order }, f), me());
        p.nodes[a.id] = a; target = a.id;
      } else {
        p.nodes[pick] = M.stamp(Object.assign({}, p.nodes[pick], f), me()); target = pick;
      }
      var keepIt = carries.length && w.querySelector('#f-keep').checked;
      p.nodes[partId] = M.stamp(Object.assign({}, n, keepIt ? { parent: target, order: P.nextOrder(p, target) } : { deleted: true }), me());
      ui.sel = target; delete ui.closed[target]; saveUi();
      closeSheet(); touch(p); toast('Linked to ' + (p.nodes[target].name || 'the assembly'));
    });
  }

  // Swap a node with its neighbor among its siblings.
  function move(id, dir) {
    var p = current(), t = P.tree(p), sibs = t.parent[id] ? t.children[t.parent[id]] : t.roots;
    var i = sibs.indexOf(id), j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    // Renumber the siblings so equal or missing orders can't stall the swap.
    var order = sibs.slice(); order[i] = sibs[j]; order[j] = id;
    order.forEach(function (x, k) { if ((p.nodes[x].order || 0) !== k + 1) p.nodes[x] = M.stamp(Object.assign({}, p.nodes[x], { order: k + 1 }), me()); });
    touch(p);
  }

  // Sign in with GitHub (the engine's auth.js), where this site has a GitHub App; null where it hasn't,
  // and the token field is then the only way in.
  function signIn() {
    var A = !DEMO && window.SignoffAuth;
    if (!A) return null;
    var s = A.status();
    return s.available || s.signedIn ? s : null;
  }
  function startSignIn() { return window.SignoffAuth.signIn(location.href); }

  function settingsSheet() {
    var token = getToken(), remembered = false;
    try { remembered = !!localStorage.getItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    var auth = signIn(), viaSignIn = !!(auth && auth.signedIn);
    function tokenFields() {
      return '<details class="guide"' + (token || auth ? '' : ' open') + '><summary>New to GitHub? Set up in four steps</summary><ol>' +
        '<li>Create a free account at <a href="https://github.com/signup" target="_blank" rel="noopener">github.com/signup</a>.</li>' +
        '<li>Send your username to your Dovetail contact.</li>' +
        '<li><a href="https://github.com/settings/tokens/new?scopes=repo&amp;description=Dovetail%20Signoff" target="_blank" rel="noopener">Create a token</a> (the link fills in the settings; pick an expiry and click <i>Generate token</i>).</li>' +
        '<li>Paste the token below and click <b>Save &amp; sync</b>. Signoff shows any invitations waiting for you, with an Accept button.</li></ol></details>' +
        '<div class="field"><label for="s-token">Access token</label><input class="input" id="s-token" type="password" value="' + esc(token) + '" placeholder="ghp_… or github_pat_…" autocomplete="off">' +
        '<p class="note">Shared with the other Signoff tools in this browser and sent only to api.github.com. Clients and contractors use a classic token with the <b>repo</b> scope. An FTE’s token needs to reach the PL data repo and every Signoff EE, ME, and FW repository; sharing creates new repositories, which a fine-grained token limited to selected repositories can’t reach.</p></div>' +
        '<label class="check"><input type="checkbox" id="s-remember"' + (remembered ? ' checked' : '') + '> Remember the token after closing the browser</label>';
    }
    var w = sheet('<div class="sheet-head"><h2>Settings</h2><p>PL projects sync through a private GitHub repository. The designs they link to are read from Signoff EE and ME’s repositories.</p></div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label for="s-user">Your name</label><input class="input" id="s-user" value="' + esc(settings.user) + '" placeholder="First Last"></div>' +
      '<div class="field"><span class="field-label">Appearance</span><div class="seg full" id="s-theme">' + [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(function (t) {
        return '<button type="button" class="' + (settings.theme === t[0] ? 'on' : '') + '" data-theme="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div></div>' +
      (DEMO ? '<p class="note">Git sync is off in demo mode. <a href="' + esc(location.pathname) + '">Open the full tool</a>.</p>' :
        '<div class="field-label" style="margin-top:20px;font-size:13px;color:var(--text);font-weight:600">Signoff Repository Access</div>' +
        (viaSignIn || (access.login && token && access.tag === P.tokenTag(token)) ? '<p class="note" style="margin:0 0 12px">Signed in ' + (viaSignIn ? 'with GitHub ' : '') + 'as <b>@' + esc(viaSignIn ? auth.login : access.login) + '</b> · ' +
          (access.state === 'fte' ? 'FTE: you see every PL project' : access.state === 'contractor' ? 'Client or contractor: you see the projects shared with you' :
            access.state === 'none' ? 'no PL project shared with you yet' : 'not synced yet') + '</p>' : '') +
        inviteCard('data-sheet="accept"') +
        // The token is the second way in: a gray button beside Sign in that drops its panel down.
        (viaSignIn ? '' : auth ? '<div class="signin-row"><button type="button" class="btn btn-primary" data-sheet="signin">Sign in with GitHub</button>' +
          '<button type="button" class="btn token-toggle" data-sheet="token" aria-expanded="' + !!token + '" aria-controls="s-token-panel">Use a token instead</button></div>' +
          '<p class="note" style="margin:0 0 12px">Uses your GitHub login, with its two-factor step. No token to create or keep track of.</p>' +
          '<div class="token-panel" id="s-token-panel"' + (token ? '' : ' hidden') + '>' + tokenFields() + '</div>' : tokenFields()) +
        '<details class="guide" style="margin-top:14px"><summary>Repositories</summary>' +
        '<div class="row2" style="margin-top:10px"><div class="field"><label for="s-owner">Account or organization</label><input class="input" id="s-owner" value="' + esc(settings.owner) + '"></div>' +
        '<div class="field"><label for="s-branch">Branch</label><input class="input" id="s-branch" value="' + esc(settings.branch) + '"></div></div>' +
        '<div class="field"><label for="s-data">PL data repo</label><input class="input" id="s-data" value="' + esc(settings.dataRepo) + '"></div>' +
        '<p class="note">Designs are read from ' + C.tools.map(function (t) { return esc(t.dataRepo) + (t.prefix ? ' and ' + esc(t.prefix) + '…' : ''); }).join(', ') + ' (set in assets/config.js).</p></details>') +
      '</div><div class="sheet-foot">' + (DEMO || !token ? '' : '<button class="btn" data-sheet="signout" title="' + (viaSignIn ? 'Sign out of GitHub here, and remove' : 'Remove the token and') + ' every Signoff and Fabcheck copy kept in this browser">Sign out</button>') +
      '<span class="spacer"></span><button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">' + (DEMO ? 'Done' : 'Save & sync') + '</button></div>');
    var theme = settings.theme;
    w.addEventListener('click', function (e) {
      var t = e.target.closest('#s-theme [data-theme]');
      if (t) { theme = t.dataset.theme; w.querySelectorAll('#s-theme button').forEach(function (b) { b.classList.toggle('on', b === t); }); applyTheme(theme); return; }
      var b = e.target.closest('[data-sheet]'); if (!b) return;
      if (b.dataset.sheet === 'cancel') { applyTheme(settings.theme); return closeSheet(); }
      if (b.dataset.sheet === 'signout') return signOut();
      if (b.dataset.sheet === 'token') {
        var panel = w.querySelector('#s-token-panel'); if (!panel) return;
        var opening = panel.hidden;
        panel.hidden = !opening; b.setAttribute('aria-expanded', String(opening));
        var tf = opening && panel.querySelector('#s-token'); if (tf && !tf.value) tf.focus();
        return;
      }
      if (b.dataset.sheet === 'signin') {
        // Keep the name typed so far; the token comes back from GitHub.
        settings.user = val(w, '#s-user') || settings.user; settings.theme = theme; save('settings', settings); saveSharedTheme(theme);
        b.disabled = true;
        return startSignIn().catch(function (err) { b.disabled = false; toast(err.message); });
      }
      if (b.dataset.sheet === 'accept') { applyTheme(settings.theme); closeSheet(); acceptInvites(); return; }
      settings.user = val(w, '#s-user'); settings.theme = theme;
      if (!DEMO) {
        settings.owner = val(w, '#s-owner') || C.repos.owner; settings.branch = val(w, '#s-branch') || 'main'; settings.dataRepo = val(w, '#s-data') || C.repos.dataRepo;
        var was = getToken(), tokField = w.querySelector('#s-token');
        if (tokField) setToken(tokField.value, w.querySelector('#s-remember').checked);   // none while signed in with GitHub
        if (getToken() !== was) { clearPictures(); invitations = []; save('invitations', invitations); }
      }
      save('settings', settings); saveSharedTheme(theme);
      closeSheet(); render();
      if (!DEMO && getToken()) sync();
    });
  }

  // Sign out of this browser, as Signoff EE's Settings does: the token goes (it's shared), and so
  // does every copy the suite keeps here (EE, ME, FW, and PL working copies, PL's pictures and
  // waiting model files, Fabcheck's runs and hand-offs). Only the theme stays. Unsynced changes
  // would be lost, so they're counted first.
  var SUITE_NS = ['signoff.v1.', 'signoff-me.v1.', 'signoff-fw.v1.', 'signoff-pl.v1.', 'fabcheck.v1.'];
  var SUITE_DBS = ['fabcheck', 'dovetail-handoff', 'dovetail-handoff-demo', 'signoff-pl-pictures', 'signoff-pl-uploads'];
  function signOut() {
    var unsynced = 0;
    SUITE_NS.forEach(function (ns) {
      try { unsynced += Object.keys(JSON.parse(localStorage.getItem(ns + 'dirty') || '{}') || {}).length; } catch (e) { /* unreadable: nothing counted */ }
    });
    try { unsynced += Object.keys((JSON.parse(localStorage.getItem('signoff.v1.held') || '{}') || {}).projects || {}).length; } catch (e) { /* ignore */ }
    var ask = 'Sign out of this browser? This removes your GitHub token and every Signoff and Fabcheck copy kept here. Your projects and reviews stay on GitHub.';
    if (unsynced) ask = plural(unsynced, 'project, review, or list has', 'projects, reviews, or lists have') + ' changes that aren’t on GitHub yet and would be lost. Sync first unless you mean to throw them away.\n\n' + ask;
    if (!confirm(ask)) return;
    var theme = settings.theme;
    // A sign-in is revoked on GitHub first; the reload waits for it, or the request is cut off.
    var A = window.SignoffAuth;
    (A ? A.signOut() : Promise.resolve()).catch(function () { /* cleared below anyway */ }).then(function () {
      try {
        sessionStorage.removeItem(TOKEN_KEY);
        Object.keys(localStorage).forEach(function (k) {
          if (k === TOKEN_KEY || k === 'signoff.login' || k.indexOf('signoff.auth') === 0 || SUITE_NS.some(function (ns) { return k.indexOf(ns) === 0; })) localStorage.removeItem(k);
        });
      } catch (e) { /* storage blocked */ }
      clearPictures();
      var up = upDbOpen; upDbOpen = null;
      return up;
    }).then(function (db) { try { if (db) db.close(); } catch (e) { /* closed */ } }).then(function () {
      try { SUITE_DBS.forEach(function (db) { indexedDB.deleteDatabase(db); }); } catch (e) { /* no IndexedDB */ }
      saveSharedTheme(theme);
      location.reload();
    });
  }

  // ── Share (docs/sharing.md) ──────────────────────────────
  // Who a project is shared with, and what sharing it touches: the project, each linked review and
  // each linked harness, each moved into its own private repo by share.js and the person invited.
  function progressSheet(title) {
    var w = sheet('<div class="sheet-head"><h2>' + esc(title) + '</h2></div><div class="sheet-body"><div class="log" id="op-log"></div></div>' +
      '<div class="sheet-foot"><span class="spacer"></span><button class="btn btn-primary" data-sheet="done" disabled>Done</button></div>');
    w.querySelector('[data-sheet="done"]').addEventListener('click', closeSheet);
    return {
      log: function (text, cls) { var l = w.querySelector('#op-log'); if (!l) return; l.innerHTML += '<div class="' + (cls || '') + '">' + esc(text) + '</div>'; l.scrollTop = 1e6; },
      done: function () { var d = w.querySelector('[data-sheet="done"]'); if (d) d.disabled = false; }
    };
  }
  function designName(tool, id) { var e = index && index.entries && index.entries[tool + ':' + id]; return e ? e.name : ''; }
  function shareSheet(p) {
    if (!p || !isFte() || !getToken()) return;
    if (dirty[p.id]) { toast('Sync first, so the shared copy starts from what’s on GitHub.'); return; }
    var sh = sharer(), w = sheet('<div class="sheet-head"><h2>Share ' + esc(p.meta.name) + '</h2><p>Reading who has it…</p></div>' +
      '<div class="sheet-body"><p class="note">Checking the repositories.</p></div><div class="sheet-foot"><span class="spacer"></span><button class="btn" data-sheet="cancel">Cancel</button></div>');
    w.addEventListener('click', function (e) { var b = e.target.closest('[data-sheet="cancel"]'); if (b) closeSheet(); });
    sh.plan(p, designName).then(function (plan) {
      if (!document.body.contains(w)) return;
      var onProject = plan.items[0].people;
      var known = plan.people.filter(function (u) { return M.isOutside(u) && onProject.indexOf(u.login) < 0; });   // clients and contractors
      function row(it) {
        var tool = it.tool === 'pl' ? { short: 'PL' } : P.toolById(it.tool) || { short: it.tool };
        return '<tr><td><span class="chip">' + esc(tool.short) + '</span> ' + esc(it.name) + '</td><td class="muted">' + (it.repo ? 'Shared as <b>' + esc(it.repo.split('/')[1]) + '</b>' : 'Gets its own private repository') + '</td></tr>';
      }
      w.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-head"><h2>Share ' + esc(p.meta.name) + '</h2>' +
        '<p>Sharing gives someone the product, every review its Parts link to, and every harness, each in its own private repository. Internal data stays in the FTE-only repositories.</p></div>' +
        '<div class="sheet-body">' +
        '<div class="field"><span class="field-label">Shared with</span>' + (onProject.length ? '<div>' + onProject.map(function (l) {
          var u = plan.people.filter(function (x) { return x.login === l; })[0];
          return '<span class="chip">' + esc(u && u.name ? u.name + ' (@' + l + ')' : '@' + l) + (u && u.role === 'client' ? ' · client' : '') + ' <button type="button" class="btn btn-plain" style="padding:0 4px;font-size:12px" data-revoke="' + esc(l) + '" title="Remove access">Remove</button></span>';
        }).join(' ') + '</div><p class="note">Remove opens People &amp; access, which asks whether they keep their Parts or lose those too.</p>' : '<p class="note">No one outside the team yet.</p>') + '</div>' +
        '<div class="field"><span class="field-label">Add a person</span><div class="row2">' +
          '<div class="field"><label for="sh-name">Name</label><input class="input" id="sh-name" placeholder="First Last"></div>' +
          '<div class="field"><label for="sh-login">GitHub username</label><input class="input" id="sh-login" placeholder="username" autocomplete="off" list="sh-known"></div></div>' +
          '<div class="field"><span class="field-label">They are</span><div class="seg full" id="sh-role"><button type="button" data-role="client">A client</button><button type="button" class="on" data-role="contractor">A contractor</button></div></div>' +
          '<datalist id="sh-known">' + known.map(function (u) { return '<option value="' + esc(u.login) + '">' + esc(u.name || u.login) + '</option>'; }).join('') + '</datalist>' +
          (known.length ? '<p class="note">Signoff EE already knows ' + known.map(function (u) { return '<button type="button" class="btn btn-plain" style="padding:0 6px;font-size:12px" data-pick="' + esc(u.login) + '" data-name="' + esc(u.name || '') + '" data-prole="' + esc(u.role) + '">' + esc(u.name || u.login) + '</button>'; }).join(' ') + '.</p>' : '') +
          '<p class="note">They need a free GitHub account. FTEs (from Signoff EE’s People) are on every repository already.</p></div>' +
        '<div class="field"><span class="field-label">What goes with it</span><div class="card table-scroll" style="overflow:hidden"><table class="table"><tbody>' + plan.items.map(row).join('') + '</tbody></table></div>' +
        (plan.errors.length ? '<p class="note">' + esc(plan.errors.map(function (e) { return e.message; }).join(' ')) + ' Those repositories can’t be shared from here.</p>' : '') + '</div>' +
        '</div><div class="sheet-foot"><span class="spacer"></span><button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">Share</button></div></div>';
      w.addEventListener('click', function (e) {
        var pk = e.target.closest('[data-pick]');
        if (pk) {
          w.querySelector('#sh-login').value = pk.dataset.pick; w.querySelector('#sh-name').value = pk.dataset.name;
          w.querySelectorAll('#sh-role button').forEach(function (x) { x.classList.toggle('on', x.dataset.role === (pk.dataset.prole === 'client' ? 'client' : 'contractor')); });
          return;
        }
        var rb = e.target.closest('#sh-role [data-role]');
        if (rb) { w.querySelectorAll('#sh-role button').forEach(function (x) { x.classList.toggle('on', x === rb); }); return; }
        var rv = e.target.closest('[data-revoke]');
        if (rv) {
          // People & access asks whether their Parts go too, and stages it until Apply (Chris, 2026-11-07).
          var who = rv.dataset.revoke;
          closeSheet();
          if (window.SignoffPeople && SignoffPeople.tools.some(function (t) { return t.id === 'signoff_pl'; })) {
            accessView.reset(); SignoffPeople.open('signoff_pl'); accessView.removePrompt(p.id, who);
          } else toast('Open People & access to remove @' + who);
          return;
        }
        var b = e.target.closest('[data-sheet]');
        if (!b) return;
        if (b.dataset.sheet === 'cancel') return closeSheet();
        var l = w.querySelector('#sh-login').value.trim().replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(l)) { w.querySelector('#sh-login').focus(); toast('Enter their GitHub username'); return; }
        var fresh = plan.items.filter(function (it) { return !it.repo; }).length;
        if (!confirm('Share ' + p.meta.name + ' with @' + l + '?' + (fresh ? '\n\n' + plural(fresh, 'new private repository', 'new private repositories') + ' will be created.' : '') + '\n\nGitHub emails the invitation.')) return;
        var ui3 = progressSheet('Sharing ' + p.meta.name + ' with ' + l);
        sh.names[l] = w.querySelector('#sh-name').value.trim();
        sh.roles[l] = (w.querySelector('#sh-role .on') || {}).dataset ? w.querySelector('#sh-role .on').dataset.role : 'contractor';   // someone already known keeps their role
        sh.shareProject(p, [l], designName, ui3.log).then(function (res) {
          res.failedInvites.forEach(function (f) {
            ui3.log(f.login + ' on ' + f.repo + ': ' + (f.status === 403 || f.status === 404 ? 'only the owner (or an org admin) can change access, and the token needs Administration: write' : f.message), 'err');
          });
          var bad = res.results.filter(function (r) { return r.error; }).length + res.failedInvites.length;
          ui3.log(bad ? 'Finished with problems.' : 'Done. Syncing…', bad ? 'err' : 'ok');
        }, function (err) {
          ui3.log('Stopped: ' + err.message + (err.status === 403 || err.status === 404 ? ' — creating repositories needs the owner’s token with Administration: write on All repositories.' : ''), 'err');
        }).then(function () { ui3.done(); sync(); });
      });
    }, function (err) {
      if (!document.body.contains(w)) return;
      w.querySelector('.sheet-body').innerHTML = '<p class="note">Couldn’t read the repositories: ' + esc(err.message) + '</p>';
    });
  }

  // ── People & access: PL's tab in the suite's People sheet (access.js, access-view.js) ──
  var accessView = S.plAccessView({
    demo: DEMO,
    load: function () {
      if (DEMO) {
        var kept = load('accessDemo', null);
        return Promise.resolve(kept && kept.rosters ? Object.assign({ errors: [] }, kept) : Object.assign({ errors: [] }, S.plAccess.demoRosters(settings.owner)));
      }
      if (!isFte() || !getToken()) return Promise.reject(new Error('People & access is for FTEs: sync with a token that opens ' + settings.owner + '/' + settings.dataRepo));
      return S.plAccess.load(sharer());
    },
    docs: function () { return Object.keys(projects).map(function (k) { return projects[k]; }); },
    get opts() { return { tools: C.tools, pl: { dataRepo: settings.dataRepo, prefix: C.repos.prefix || 'review-pl-' }, owner: settings.owner, nameOf: designName }; },
    apply: function (acc, ops, log) {
      if (DEMO) {
        var sim = acc.simulate(ops);
        save('accessDemo', { rosters: sim.rosters, invites: sim.invites });
        ops.forEach(function (o) { log((o.k === 'share' ? 'Shared ' + o.name + ' with ' + o.logins.join(', ') : o.k === 'remove' ? 'Removed ' + o.login + ' from ' + o.name : o.k === 'scope' ? 'Scope for ' + o.login + ' on ' + o.name : 'Company for ' + o.login) + ' (demo)', 'ok'); });
        return Promise.resolve({ failed: [] });
      }
      return acc.run(sharer(), ops, log).then(function (res) { sync(); return res; });
    },
    // Apply moves a project into its shared repo, so it starts from what's on GitHub, as Share does.
    blocked: function (ops) {
      if (DEMO) return '';
      if (!getToken() || !isFte()) return 'People & access needs an FTE’s token.';
      var unsynced = ops.filter(function (o) { return o.k === 'share' && o.tool === 'pl' && dirty[o.id]; });
      return unsynced.length ? 'Sync first, so the shared copy starts from what’s on GitHub.' : '';
    },
    toast: function (t) { toast(t); }
  });
  if (window.SignoffPeople && SignoffPeople.register) {
    SignoffPeople.register('signoff_pl', { label: 'Signoff PL', sub: 'Projects', draw: function (el) { accessView.draw(el); } });
  }

  // ── Sync ─────────────────────────────────────────────────
  // 1. Who's signed in: a new token or login hides the projects until this sync confirms it.
  // 2. PL projects: the data repo and the shared repos (share.js syncAll), merged with PL's merge.
  //    A token that opens the data repo is an FTE's; one that reaches only review-pl-* repos is a
  //    contractor's; one that reaches nothing locks PL, which drops the projects it holds (P.lockOut).
  // 3. Designs: read again from EE, ME, FW, and Loom.
  function sync() {
    if (DEMO) { toast('Demo mode keeps everything in this browser'); return; }
    if (syncing) return;
    if (!getToken()) { settingsSheet(); return; }
    syncing = true; renderSyncState('busy');
    if (!current()) renderPage();   // an empty or locked page says the sync is running
    var token = getToken(), tag = P.tokenTag(token), signedIn = false, started = {}, errors = [], pushed = 0;
    var sh = sharer(token);
    sh.account.user()
      .then(function (u) {
        var login = String(u.login || '').toLowerCase();
        signedIn = true;
        if (access.tag !== tag || access.login !== login || access.repo !== dataRepo()) { access = { login: login, tag: tag, repo: dataRepo(), state: '' }; save('access', access); render(); }
        started = Object.assign({}, dirty);
        var byId = {}; Object.keys(projects).forEach(function (k) { byId[projects[k].id] = projects[k]; });
        var names = Object.keys(dirty).map(function (id) { return byId[id] ? byId[id].meta.name : id; });
        // Attached models' files go up first, so a pushed project never names a file the repo lacks.
        // A token that can't write leaves them waiting; a 404 is dealt with by the sync below.
        return uploadModels(token).catch(function (err) {
          if (err.status !== 404) errors.push({ repo: settings.dataRepo, message: 'Models not uploaded yet: ' + err.message });
        }).then(function () {
          return sh.syncAll({ login: login, projects: byId, roster: roster, homes: homes, caches: caches, dataAccess: access.state === 'fte' ? 'ok' : '' },
            { merge: P.merge, keepLocal: function (id) { return !!dirty[id]; }, message: 'PL update' + (names.length ? ': ' + names.join(', ') : '') + ' (' + me() + ')' });
        });
      })
      .then(function (res) {
        var st = res.state;
        errors = errors.concat(res.errors);
        pushed = res.pushed; caches = st.caches; homes = st.homes; roster = st.roster;
        if (st.dataAccess === 'ok') access.state = 'fte';
        else if (Object.keys(st.projects).length || res.repos.length) access.state = 'contractor';
        else { var e404 = new Error('no access'); e404.status = 404; throw e404; }
        var nowById = {}; Object.keys(projects).forEach(function (k) { nowById[projects[k].id] = projects[k]; });
        var next = {};
        Object.keys(st.projects).forEach(function (id) {
          var doc = nowById[id] ? P.merge(nowById[id], st.projects[id]) : st.projects[id];
          var slug = doc.slug || M.slugify(doc.meta.name), base = slug, n = 2;
          while (next[slug]) slug = base + '-' + n++;
          next[slug] = doc;
        });
        // Copies the sync dropped (deleted on GitHub, or a contractor's access taken away) go, unless edited since.
        Object.keys(nowById).forEach(function (id) { if (!st.projects[id] && dirty[id]) { var d = nowById[id]; next[d.slug] = d; } });
        projects = next;
        Object.keys(started).forEach(function (k) { if (dirty[k] === started[k]) delete dirty[k]; });
      }, function (err) {
        if (!signedIn) throw err;   // /user failed: the token itself doesn't work
        if (err.status !== 404 && err.status !== 403) { errors.push({ repo: settings.dataRepo, message: err.message }); return; }
        access.state = 'none';
        projects = P.lockOut(projects, dirty); caches = {}; homes = {}; roster = M.emptyRoster(); index = null; clearPictures();
      })
      .then(function () {
        // Invitations from this owner waiting to be accepted (Signoff EE's step 4). A token that
        // can't list them (a fine-grained one) shows none.
        return sh.account.invitations().then(function (inv) {
          invitations = inv.filter(function (i) { return i.owner && i.owner.toLowerCase() === settings.owner.toLowerCase(); });
        }, function () { invitations = []; }).then(function () { save('invitations', invitations); });
      })
      .then(function () {
        save('access', access);
        if (access.state !== 'fte' && access.state !== 'contractor') return;
        return new S.PLReader({ owner: settings.owner, branch: settings.branch, tools: C.tools, token: token }).refresh(index)
          .then(function (ix) {
            index = ix; errors = errors.concat(ix.errors);
            // Waiting Parts started in their tool link up, and harness names and numbers edited in
            // Loom since come over; both go up with the next sync.
            claimAll();
            Object.keys(projects).forEach(function (k) {
              var p = projects[k];
              if (!P.adoptHarnesses(p, index, me()).length) return;
              p.meta.updatedAt = M.now(); p.meta.updatedBy = me(); dirty[p.id] = M.now();
            });
          });
      })
      .then(function () {
        syncing = false;
        lastSync = { at: M.now(), errors: errors };
        save('repoCache', caches); save('homes', homes); save('roster', roster); save('index', index); save('lastSync', lastSync); persist();
        if (!projects[ui.slug]) ui.slug = firstSlug();
        render();
        // The locked page offers what the shared card finds, so draw it again once the card has looked.
        if (window.SignoffInvites) window.SignoffInvites.refresh().then(function () { if (!allowed()) render(); });
        if (access.state === 'none' && waitingInvites()) toast(plural(waitingInvites(), 'invitation') + ' waiting for @' + access.login + ': accept to open what’s shared with you.');
        else if (access.state === 'none') toast('@' + access.login + ' can’t open ' + settings.owner + '/' + settings.dataRepo + ' and is on no shared PL project.');
        else if (waitingInvites() && !errors.length) toast(plural(waitingInvites(), 'invitation') + ' waiting: Accept is in the sidebar.');
        else if (errors.length) toast(errors[0].message + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' more)' : ''));
        else toast((pushed ? 'Synced — ' + plural(pushed, 'change') + ' pushed' : 'Up to date') + ' · ' + plural(Object.keys(index.entries).length, 'design') + ' read');
        checkForUpdate();
      })
      .catch(function (err) {
        syncing = false; render();
        toast('Sync failed: ' + err.message);
      });
  }
  function firstSlug() { return Object.keys(projects).filter(function (k) { return !projects[k].meta.archived && !projects[k].meta.deleted; })[0] || ''; }

  // ── Menus, toasts, theme ─────────────────────────────────
  function menu(anchor, entries) {
    closeMenu();
    var m = document.createElement('div');
    m.className = 'menu'; m.id = 'menu';
    m.innerHTML = entries.map(function (e) { return e === '-' ? '<hr>' : '<button data-menu="' + e[0] + '"' + (e[2] ? ' class="danger"' : '') + '>' + esc(e[1]) + '</button>'; }).join('');
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = (r.bottom + 6) + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
    return new Promise(function (resolve) {
      m.addEventListener('click', function (e) { var b = e.target.closest('[data-menu]'); if (b) { closeMenu(); resolve(b.dataset.menu); } });
    });
  }
  function closeMenu() { var m = $('#menu'); if (m) m.remove(); }
  function toast(text) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 320); }, 3600);
  }
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function isDark(theme) { return theme === 'dark' || (theme !== 'light' && !!(darkQuery && darkQuery.matches)); }
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    var btn = $('#theme-btn');
    if (btn) { var dark = isDark(theme); btn.innerHTML = dark ? ICON.sun : ICON.moon; btn.title = dark ? 'Light mode' : 'Dark mode'; }
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', function () { applyTheme(settings.theme); });
  var shownTag = getToken() ? P.tokenTag(getToken()) : '';
  window.addEventListener('storage', function (e) {
    // Signed in or out in another Signoff tool. A sign-in's refresh changes the token but not its tag.
    if (e.key === TOKEN_KEY || e.key === 'signoff.login') {
      var tag = getToken() ? P.tokenTag(getToken()) : '';
      if (tag !== shownTag) { shownTag = tag; render(); }
      return;
    }
    var t = e.key === THEME_KEY && sharedSettings().theme;
    if (t && t !== settings.theme) { settings.theme = t; applyTheme(t); }
  });
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 860px)') : { matches: false };
  function toggleSidebar() {
    if (narrow.matches) { $('#app').classList.toggle('nav-open'); return; }
    ui.sideCollapsed = !ui.sideCollapsed;
    $('#app').classList.toggle('side-collapsed', ui.sideCollapsed);
    saveUi();
  }
  // On a narrow window a tap outside the open menu (on its scrim, suite.css) closes it and goes
  // no further, as in Signoff EE and Loom.
  document.addEventListener('click', function (e) {
    var app = $('#app');
    if (!app.classList.contains('nav-open') || e.target !== app) return; // the scrim is #app's ::after
    app.classList.remove('nav-open'); e.preventDefault(); e.stopPropagation();
  }, true);

  // ── Events ───────────────────────────────────────────────
  // A click on blank space in the main area (nothing to click or type in, no text being selected)
  // closes an open inspector, as its × does: the System tab's (ui.sel) or the Requirements tab's (ui.rqSel).
  var LIVE = 'a, button, input, select, textarea, label, summary, [contenteditable], [role="button"], [tabindex], [data-rq], [draggable="true"], canvas, svg, .map-ins, .rq-ins, #sheet';
  function blankClick(e) {
    return !!e.target.closest('#main') && !e.target.closest(LIVE) && !!document.querySelector('#main .map-ins, #main .rq-ins') &&
      !String(window.getSelection ? window.getSelection() : '');
  }
  function closeDetails() {
    if (ui.view === 'reqs') { if (!ui.rqSel) return; ui.rqSel = ''; }
    else { if (!ui.sel) return; ui.sel = ''; snapState = null; }
    saveUi(); renderPage();
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#menu')) closeMenu();
    if (e.target.closest('[data-stop]')) return;   // links inside clickable rows
    var el = e.target.closest('[data-act]');
    if (!el && blankClick(e)) { closeDetails(); return; }
    if (!el || el.closest('#sheet')) return;
    var act = el.dataset.act, id = el.dataset.id;
    if (!allowed() && ['nav', 'theme', 'settings', 'sync', 'accept-invites'].indexOf(act) < 0) return;
    switch (act) {
      case 'nav': toggleSidebar(); break;
      case 'theme':
        settings.theme = isDark(settings.theme) ? 'light' : 'dark';
        save('settings', settings); saveSharedTheme(settings.theme); applyTheme(settings.theme); break;
      case 'settings': settingsSheet(); break;
      case 'signin': el.disabled = true; startSignIn().catch(function (err) { el.disabled = false; toast(err.message); }); break;
      case 'sync': sync(); break;
      case 'accept-invites': acceptInvites(); break;
      case 'invites-accept-all': if (window.SignoffInvites) window.SignoffInvites.acceptAll(); break;
      case 'new-project': projectSheet(null); break;
      case 'open-project': ui.slug = el.dataset.slug; $('#app').classList.remove('nav-open'); saveUi(); render(); break;
      case 'view': ui.view = el.dataset.view; saveUi(); renderPage(); break;
      case 'add-node': nodeSheet(null, {}); break;
      case 'edit-project': projectSheet(current()); break;
      case 'add-child': e.stopPropagation(); nodeSheet(null, { parent: id }); break;
      case 'edit-node': nodeSheet(id); break;
      case 'asm-link': asmLinkSheet(id); break;
      case 'select-node': ui.sel = ui.sel === id ? '' : id; ui.pic = ''; snapState = null; saveUi(); renderPage(); break;
      case 'xs-view': case 'xs-fit': case 'xs-turn': case 'xs-stack': case 'xs-center': case 'xs-auto': case 'xs-cad': case 'xs-snap': case 'xs-snap-cancel': case 'xs-size':
        sceneAction(act, el); break;
      case 'pic': ui.pic = el.dataset.key; renderPage(); break;
      case 'm3d-open': openModelView(id); break;
      case 'get-step': e.preventDefault(); downloadStep(id); break;
      case 'bom-mode': ui.bomMode = el.dataset.mode; ui.bomSort = null; saveUi(); renderPage(); break;
      case 'bom-sort': (function () {
        var k = el.dataset.key, s0 = ui.bomSort || {};
        ui.bomSort = s0.key !== k ? { key: k, dir: 'asc' } : s0.dir === 'asc' ? { key: k, dir: 'desc' } : null;
        refreshBom();
      })(); break;
      case 'bom-csv': bomCsv(current()); break;
      case 'bom-print': bomReport(current()); break;
      case 'close-report': $('#report').hidden = true; break;
      case 'print': window.print(); break;
      case 'close-ins': ui.sel = ''; snapState = null; saveUi(); renderPage(); break;
      case 'layout': ui.layout = el.dataset.layout; saveUi(); renderPage(); break;
      case 'talk-all': ui.talkAll = !ui.talkAll; saveUi(); renderPage(); break;
      case 'place-all': placeAll(current()); break;
      case 'place-design': (function () {
        var d = index && index.entries[el.dataset.key];
        if (d) nodeSheet(null, { kind: P.isAssemblyDesign(d) ? 'assembly' : 'part', source: d.tool, ref: { tool: d.tool, id: d.id }, name: d.name || d.id, number: d.number || '' });
      })(); break;
      case 'open-url': if (el.dataset.url) location.href = el.dataset.url; break;
      case 'toggle-node': e.stopPropagation(); if (ui.closed[id]) delete ui.closed[id]; else ui.closed[id] = 1; saveUi(); renderPage(); break;
      case 'move-up': e.stopPropagation(); move(id, -1); break;
      case 'move-down': e.stopPropagation(); move(id, 1); break;
      case 'project-menu':
        menu(el, !current() ? ticketEntries() : [['edit', 'Project details…'], ['history', 'History…']].concat(isFte() ? [['share', 'Share…']] : [], [['export', 'Export project (JSON)']], DEMO ? [['reset', 'Reset demo', true]] : [], ['-', ['archive', current().meta.archived ? 'Unarchive project' : 'Archive project'], ['delete', 'Delete project…', true]], ticketsOn() ? ['-'].concat(ticketEntries()) : [])).then(function (c) {
          if (c === 'ticket') { window.SignoffTickets.newTicket(); return; }
          if (c === 'tickets') { window.SignoffTickets.open(); return; }
          var p = current();
          if (c === 'edit') projectSheet(p);
          if (c === 'history') historySheet(p);
          if (c === 'share') shareSheet(p);
          if (c === 'export') {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([M.stableStringify(p)], { type: 'application/json' }));
            a.download = p.slug + '.pl.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
          }
          if (c === 'reset') resetDemo();
          if (c === 'archive') { p.meta.archived = !p.meta.archived; touch(p); }
          if (c === 'delete') deleteProject(p);
        });
        break;
    }
  });
  $('#project-search').addEventListener('input', renderSidebar);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('#report').hidden) { $('#report').hidden = true; return; }
      if (snapState && !$('#sheet')) { snapState = null; renderPage(); return; }
      if (!$('#sheet') && !$('#menu') && ui.sel && ui.view === 'system') { ui.sel = ''; saveUi(); renderPage(); return; }
      closeSheet(); closeMenu(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); sync(); return; }
    if (e.target.closest('input,textarea,select') || $('#sheet')) return;
    // Up and down step through the list shown: Requirements rows, or the System tiles (Map, Gallery, List).
    // The 3D view's canvas keeps its own arrows (it nudges the selected Part).
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
        e.target.tagName !== 'CANVAS' && !$('#menu') && stepList(e.key === 'ArrowDown')) { e.preventDefault(); return; }
    if (e.key === '[' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleSidebar(); }
    if (allowed() && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); projectSheet(null); }
  });
  // Moves the selection one row along the page's list and keeps it in view. False when there's no list.
  function stepList(down) {
    var page = $('#page'), seen = {}, rows, rq;
    if (!page) return false;
    var shown = function (el) { return el.offsetParent && !el.closest('aside, .ins-kids, .xs-name'); };
    rows = Array.prototype.filter.call(page.querySelectorAll('.rq-row[data-rq="sel"], tr[data-rq="sel"]'), shown);
    rq = rows.length > 0;
    if (!rq) rows = Array.prototype.filter.call(page.querySelectorAll('[data-act="select-node"]'), shown);
    var ids = rows.map(function (el) { return el.dataset.id; }).filter(function (id) { return seen[id] ? false : (seen[id] = true); });
    if (!ids.length) return false;
    var cur = rq ? ui.rqSel : ui.sel, i = ids.indexOf(cur);
    var next = ids[i < 0 ? (down ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + (down ? 1 : -1)))];
    if (next === cur) return true;
    if (rq) ui.rqSel = next; else { ui.sel = next; ui.pic = ''; snapState = null; }
    saveUi(); renderPage();
    var el = $('#page').querySelector((rq ? '[data-rq="sel"]' : '[data-act="select-node"]') + '[data-id="' + CSS.escape(next) + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
    return true;
  }
  function resetDemo() {
    Object.keys(localStorage).forEach(function (k) { if (k.indexOf(C.storage.demoNs) === 0) localStorage.removeItem(k); });
    location.reload();
  }

  function render() { renderSidebar(); renderSyncState(); renderPage(); }

  // ── Start ────────────────────────────────────────────────
  applyTheme(settings.theme);
  // Applied on narrow windows too (suite.css only hides it above 860 px), so widening the window
  // later shows the sidebar as it was left.
  if (ui.sideCollapsed) $('#app').classList.add('side-collapsed');
  // The Dovetail Signoff links fold to a row of icons, as in every tool (signoff/assets/sidefoot.js).
  if (window.SignoffFoot) window.SignoffFoot.fold($('#side-tools'));
  if (DEMO) {
    var banner = $('#demo-banner');
    banner.hidden = false;
    document.body.classList.add('has-banner');
    banner.innerHTML = 'You’re exploring a demo of Signoff PL, Dovetail’s project lead tool. The product and its designs are made up; changes stay in this browser.<button id="reset-demo">Reset demo</button>';
    banner.querySelector('#reset-demo').addEventListener('click', resetDemo);
  }
  // ── Tool updates (as in Signoff EE) ──────────────────────
  // A page left open keeps running the version it loaded. Now and then (on opening, every few
  // minutes, when the tab comes back into view, after a sync) it asks this site which version it
  // serves now. If that's another one, it reloads into it as soon as nothing is being typed
  // or edited (no sheet open, where a STEP is read) and the large 3D view is closed, and the new page says "Tool updated". If the site serves the same version, or
  // can't be reached, the page stays as it is. A version it already reloaded for is never tried
  // twice, so a stale cache can't make it loop.
  var UPDATE_KEY = 'signoff.toolUpdate';   // sessionStorage: { tried: hash, from: hash }
  var updateWaiting = '', updateBusy = false;
  function updateMemo(v) {
    try {
      if (v === undefined) return JSON.parse(sessionStorage.getItem(UPDATE_KEY) || '{}') || {};
      if (v) sessionStorage.setItem(UPDATE_KEY, JSON.stringify(v)); else sessionStorage.removeItem(UPDATE_KEY);
    } catch (e) { return null; }
  }
  function pageIdle() {
    var a = document.activeElement;
    var typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    // bigView: the large 3D view, shown in a review. People & access holds staged edits until Apply, and a
    // ticket being written lives only on the page, so neither reloads under the person.
    return !syncing && !typing && !$('#sheet') && !$('#menu') && !bigView && !document.querySelector('.tk-wrap, .tk-new, #people-pop') && !document.hidden;
  }
  function reloadWhenIdle() {
    if (!updateWaiting) return;
    if (!pageIdle()) { setTimeout(reloadWhenIdle, 3000); return; }
    if (updateMemo({ tried: updateWaiting, from: (window.SIGNOFF_VERSION || {}).hash }) === null) { updateWaiting = ''; return; }
    location.reload();
  }
  function checkForUpdate() {
    var have = (window.SIGNOFF_VERSION || {}).hash;
    if (!have || updateBusy || updateWaiting || !window.fetch) return;
    updateBusy = true;
    fetch('assets/version.js?nc=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (text) {
        updateBusy = false;
        var m = /hash:\s*'([0-9a-f]+)'/.exec(text || '');
        if (!m || m[1] === have || (updateMemo() || {}).tried === m[1]) return;
        updateWaiting = m[1];
        reloadWhenIdle();
      }, function () { updateBusy = false; });
  }
  (function () {
    var memo = updateMemo() || {};
    if (memo.from && memo.from !== (window.SIGNOFF_VERSION || {}).hash) { updateMemo({ tried: memo.tried }); setTimeout(function () { toast('Tool updated'); }, 300); }
    setTimeout(checkForUpdate, 5000);
    setInterval(checkForUpdate, 5 * 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkForUpdate(); });
  })();

  if (!projects[ui.slug]) ui.slug = firstSlug();
  render();
  if (!DEMO && getToken()) sync();
  // Accepted from the suite's invitations card: sync to pick up what was just joined.
  window.addEventListener('signoff:invites-accepted', function () { if (!DEMO && getToken()) sync(); });

  // Hooks for driving the 3D view from the console or a test (clicking by coordinates is fragile).
  S.app = { sync: sync, render: render, attachModel: attachModel,
    scene: { get: function () { return scene; }, draw: drawScene, commit: commitPlace, stackOn: stackOn, centerOn: centerOn, featureAt: featureAt, snapPick: snapPick,
      startSnap: function () { snapState = { step: 1 }; renderPage(); } } };
})(window.Signoff = window.Signoff || {});
