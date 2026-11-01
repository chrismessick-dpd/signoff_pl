/* Signoff PL app: state, storage, rendering and interaction.
   PL projects sync to the PL data repo through the Signoff engine's GitHubStore with PL's own
   merge (pl.js). The design reviews Parts link to are read, never written (reader.js). */
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
  var cache = load('cache', {});          // blob shas in the PL data repo as of the last sync
  var index = S.plReader.cleanIndex(load('index', null));   // designs read from EE/ME (reader.js)
  var lastSync = load('lastSync', null);  // { at, errors }
  var access = load('access', { login: '', tag: '', repo: '', state: '' });   // see pl.js, Access
  var ui = Object.assign({ slug: '', view: 'overview', closed: {}, layout: 'map', sel: '' }, load('ui', {}));
  var syncing = false;

  // The demo is rebuilt when its data changes (a new snapshot of the EE/ME demos, or a new
  // product in config.js), so a browser that saw an older demo doesn't keep it.
  var DEMO_VERSION = (S.plDemo.snapshot.generatedAt || '') + '|' + ((C.demo || {}).project || {}).name + '|' + JSON.stringify((C.demo || {}).previews || {});
  if (DEMO && (!Object.keys(projects).length || load('demoVersion', '') !== DEMO_VERSION)) {
    var demo = S.plDemo.build();
    projects = {}; projects[demo.project.slug] = demo.project;
    index = demo.index; dirty = {}; ui.slug = demo.project.slug; ui.closed = {};
    save('projects', projects); save('index', index); save('dirty', dirty); save('demoVersion', DEMO_VERSION);
  }

  function persist() { save('projects', projects); save('dirty', dirty); }
  function saveUi() { save('ui', { slug: ui.slug, view: ui.view, closed: ui.closed, sideCollapsed: !!ui.sideCollapsed, layout: ui.layout, sel: ui.sel }); }
  function me() { return settings.user || 'Anonymous'; }
  // Signoff PL is for FTEs. Projects show only while a sync has confirmed the token in use.
  function dataRepo() { return (settings.owner + '/' + settings.dataRepo).toLowerCase(); }
  function allowed() { return DEMO || P.canSee(access, getToken(), dataRepo()); }
  function denied() { var t = getToken(); return !!t && access.state === 'none' && access.tag === P.tokenTag(t) && access.repo === dataRepo(); }

  // ── Small helpers ────────────────────────────────────────
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); }
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
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4-4 4 4"/></svg>',
    down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
    sync: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 00-10.6-2.6L4 7M4 12a6 6 0 0010.6 2.6L16 13"/><path d="M4 3.5V7h3.5M16 16.5V13h-3.5"/></svg>',
    more: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="5" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/></svg>',
    moon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M16.2 12.4A6.6 6.6 0 017.6 3.8a6.6 6.6 0 108.6 8.6z"/></svg>',
    sun: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.3 4.3l1.3 1.3M14.4 14.4l1.3 1.3M15.7 4.3l-1.3 1.3M5.6 14.4l-1.3 1.3"/></svg>',
    tree: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="3" y="16" width="6" height="5" rx="1.2"/><rect x="15" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M6 16v-4h12v4"/></svg>'
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
    manual: ['dim', 'No review tool yet', 'Signoff FW is planned; until then this Part is tracked here only.']
  };
  function stateChip(st) {
    var t = st && STATE_TEXT[st.state];
    return t ? '<span class="pstate ' + t[0] + '" title="' + esc(t[2]) + '">' + t[1] + '</span>' : '';
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
  function current() { return allowed() ? projects[ui.slug] || null : null; }
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
    var list = (allowed() ? Object.keys(projects) : []).map(function (k) { return projects[k]; })
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
    $('#project-list').innerHTML = html;
    $('.side-head [data-act="new-project"]').hidden = !allowed();
    // People & access lives in Signoff EE, whose list decides who's an FTE across the suite.
    $('#people-link').hidden = DEMO || !allowed();
    if (DEMO) {
      document.querySelectorAll('#side-tools a.side-link').forEach(function (a) {
        var href = a.getAttribute('href');
        if (!/[?&]demo\b/.test(href)) a.setAttribute('href', href + '?demo');
      });
    }
  }

  function renderSyncState(state) {
    var dot = $('#sync-dot'), title = $('#sync-title'), sub = $('#sync-sub');
    var n = Object.keys(dirty).length;
    if (DEMO) { dot.dataset.tone = 'idle'; title.textContent = 'Demo mode'; sub.textContent = 'Changes stay in this browser'; return; }
    if (state === 'busy' || syncing) { dot.dataset.tone = 'busy'; title.textContent = 'Syncing…'; sub.textContent = settings.owner; return; }
    if (!getToken()) { dot.dataset.tone = 'idle'; title.textContent = 'Signed out'; sub.textContent = 'Add your GitHub token'; return; }
    if (denied()) { dot.dataset.tone = 'warn'; title.textContent = 'No access'; sub.textContent = '@' + access.login + ' isn’t an FTE'; return; }
    if (!allowed()) { dot.dataset.tone = 'idle'; title.textContent = 'Not checked yet'; sub.textContent = 'Click to sync'; return; }
    if (n) { dot.dataset.tone = 'warn'; title.textContent = plural(n, 'unsynced change'); sub.textContent = 'Click to sync'; return; }
    var errs = lastSync && lastSync.errors && lastSync.errors.length;
    dot.dataset.tone = errs ? 'warn' : lastSync ? 'ok' : 'idle';
    title.textContent = errs ? 'Synced with problems' : lastSync ? 'Synced' : 'Ready';
    sub.textContent = errs ? lastSync.errors[0].message : lastSync ? relTime(lastSync.at) : 'Click to sync';
  }

  // ── Toolbar ──────────────────────────────────────────────
  var VIEWS = [{ id: 'overview', label: 'Overview' }, { id: 'structure', label: 'Structure' }, { id: 'issues', label: 'Issues' }];
  function renderToolbar() {
    var p = current();
    $('#toolbar-title').textContent = p ? p.meta.name : '';
    if (!p) { $('#view-seg').innerHTML = ''; $('#toolbar-actions').innerHTML = ''; return; }
    var r = P.rollup(p, index)[''];
    $('#view-seg').innerHTML = VIEWS.map(function (v) {
      var extra = v.id === 'issues' && r.openTotal ? '<span class="count">' + esc(r.openTotal) + '</span>' : '';
      return '<button role="tab" class="' + (v.id === ui.view ? 'on' : '') + '" data-act="view" data-view="' + v.id + '">' + v.label + extra + '</button>';
    }).join('');
    $('#toolbar-actions').innerHTML = (DEMO ? '' : '<button class="btn" data-act="sync" title="Sync PL projects and read the designs again (Ctrl+S)">' + ICON.sync + '<span class="btn-label">Sync</span>' +
      (Object.keys(dirty).length ? '<span class="badge">' + Object.keys(dirty).length + '</span>' : '') + '</button>') +
      '<button class="btn btn-primary" data-act="add-node" title="Add a Part or assembly">' + ICON.plus + '<span class="btn-label">Add</span></button>' +
      '<button class="icon-btn" data-act="project-menu" title="More" aria-label="More">' + ICON.more + '</button>';
  }

  // ── Pages ────────────────────────────────────────────────
  function renderPage() {
    var p = current(), page = $('#page'), scroll = $('#main').scrollTop;
    renderToolbar();
    if (!p) { page.innerHTML = allowed() ? emptyPage() : lockedPage(); return; }
    if (ui.view === 'structure') page.innerHTML = structurePage(p);
    else if (ui.view === 'issues') page.innerHTML = issuesPage(p);
    else page.innerHTML = overviewPage(p);
    $('#main').scrollTop = scroll;
    loadPictures(page);
  }

  function emptyPage() {
    var none = !Object.keys(projects).length;
    return '<div class="page"><div class="empty"><div class="empty-art">' + ICON.tree + '</div>' +
      '<h2>' + (none ? 'Lead a product' : 'Pick a project') + '</h2>' +
      '<p>' + (none ? 'A PL project is the whole product: assemblies and the Parts in them. Link each Part to its review in Signoff EE or ME, and see where the product stands in one place.'
        : 'Choose a project from the sidebar, or start a new one.') + '</p>' +
      '<button class="btn btn-primary" data-act="new-project">New project</button>' +
      (none && !DEMO ? ' <button class="btn" data-act="sync">Pull from GitHub</button>' : '') + '</div></div>';
  }

  // Shown instead of the projects until a sync confirms an FTE's token (see allowed()).
  function lockedPage() {
    var repo = '<b>' + esc(settings.owner + '/' + settings.dataRepo) + '</b>', kept = Object.keys(projects).length;
    var head = !getToken() ? ['Sign in to Signoff PL', 'Signoff PL is for Dovetail FTEs. Add your GitHub token in Settings; PL shows the projects once it confirms the token can open ' + repo + '.']
      : denied() ? ['Signoff PL is for Dovetail FTEs', 'You’re signed in as <b>@' + esc(access.login) + '</b>, which can’t open ' + repo + '. An FTE adds you from People in Signoff EE. Accept GitHub’s invitation, then sync again.']
      : ['Not checked yet', 'PL shows the projects once a sync confirms your token can open ' + repo + '.'];
    return '<div class="page"><div class="empty"><div class="empty-art">' + ICON.tree + '</div><h2>' + head[0] + '</h2><p>' + head[1] + '</p>' +
      (getToken() ? '<button class="btn btn-primary" data-act="sync">' + (denied() ? 'Sync again' : 'Sync') + '</button> <button class="btn" data-act="settings">Settings</button>'
        : '<button class="btn btn-primary" data-act="settings">Settings</button>') +
      (denied() && kept ? '<p class="note" style="margin-top:16px">' + plural(kept, 'unsynced project') + ' from an earlier sign-in ' + (kept === 1 ? 'stays' : 'stay') + ' in this browser, hidden. ' + (kept === 1 ? 'It’s' : 'They’re') + ' pushed the next time an FTE syncs here.</p>' : '') +
      '</div></div>';
  }

  function headBlock(p, eyebrow) {
    var m = p.meta;
    var sub = [m.client, m.number].filter(Boolean).map(esc).join('<span class="sep">·</span>');
    return '<div class="eyebrow">' + esc(eyebrow) + '</div><h1 class="page-title">' + esc(m.name) + '</h1>' +
      '<div class="page-sub">' + (sub ? '<span>' + sub + '</span>' : '') + (m.phase ? '<span class="chip accent">' + esc(m.phase) + '</span>' : '') + '</div>';
  }
  function stat(n, label, cls, detail) {
    return '<div class="card stat ' + esc(cls || '') + '"><div class="stat-num">' + esc(n) + '</div><div class="stat-label">' + esc(label) + '</div>' + (detail ? '<div class="stat-detail">' + detail + '</div>' : '') + '</div>';
  }

  function overviewPage(p) {
    var rolls = P.rollup(p, index), r = rolls[''], t = P.tree(p);
    var ids = P.flatten(t);
    var html = '<div class="page"><div class="page-head"><div class="page-head-text">' + headBlock(p, 'Product') +
      (p.meta.description ? '<p style="color:var(--text-2);margin:14px 0 0;max-width:62ch">' + esc(p.meta.description) + '</p>' : '') +
      '<p class="note" style="margin-top:12px">' + (index && index.at ? 'Designs read ' + relTime(index.at) : 'Designs not read yet') +
      (r.designs ? ' · progress is checks reviewed across ' + plural(r.designs, 'linked design') : '') + '</p></div>' +
      ring(r.pct, 132, 11, r.pct + '%', 'reviewed') + '</div>';
    if (!ids.length) {
      return html + '<div class="card empty"><div class="empty-art">' + ICON.tree + '</div><h2>No Parts yet</h2><p>Add the product’s assemblies, then the Parts in them: boards, mechanical parts, firmware and purchased items.</p>' +
        '<button class="btn btn-primary" data-act="add-node">Add the first assembly or Part</button></div></div>';
    }
    var stageList = Object.keys(r.stages).sort().map(function (k) { var s = k.split(':'); return srcChip(s[0]) + ' ' + esc(s.slice(1).join(':')) + (r.stages[k] > 1 ? ' ×' + r.stages[k] : ''); }).join('<br>');
    html += '<div class="grid grid-4">' +
      stat(r.openTotal, 'Open issues', r.openTotal ? 'issue' : 'pass', sevs(r.open)) +
      stat(r.parts, plural(r.parts, 'Part').replace(/^\d+ /, ''), '', [r.designs && plural(r.designs, 'design'), r.purchased && r.purchased + ' purchased', r.manual && r.manual + ' firmware'].filter(Boolean).join(' · ')) +
      stat(r.unlinked + r.attention, 'Need attention', r.unlinked + r.attention ? 'issue' : '', r.unlinked + r.attention ? [r.unlinked && r.unlinked + ' not linked', r.attention && r.attention + ' unreadable'].filter(Boolean).join(' · ') : 'Every design reads') +
      stat(fmtMass(r.massG), 'Mass', '', r.massMissing ? plural(r.massMissing, 'Part') + ' without a mass' : 'All Parts weighed') + '</div>';

    // One card per linked design, in tree order.
    var seen = {}, cards = [];
    ids.forEach(function (id) {
      var n = t.nodes[id], st = P.partStatus(n, index);
      if (!st || ['ok', 'nosummary'].indexOf(st.state) < 0 || seen[P.refKey(n.ref)]) return;
      seen[P.refKey(n.ref)] = 1;
      var s = st.summary, e = st.entry;
      cards.push('<div class="card cl-card design-card">' +
        '<div class="cl-card-top"><div><div class="cl-card-title">' + srcChip(n.source) + esc(n.name) + '</div>' +
        '<div class="cl-card-desc">' + esc([e.name !== n.name ? e.name : '', e.number, e.revision && 'Rev ' + e.revision].filter(Boolean).join(' · ')) + '</div></div>' +
        (s ? ring(s.pct, 46, 5, s.pct, '') : '') + '</div>' +
        (s ? pbar(s.pct) : stateChip(st)) +
        '<div class="cl-card-foot"><span>' + esc((s && s.stage) || e.stage || '') + '</span>' + (s ? sevs((s.issues || {}).open || {}) : '') + '</div>' +
        '<div class="cl-card-foot"><span class="muted" style="color:var(--text-3);font-size:12px">' + (s && s.at ? 'Edited ' + relTime(s.at) + (s.by ? ' by ' + esc(s.by) : '') : '') + '</span>' +
        '<a class="open-link" href="' + esc(designUrl(n)) + '" target="_blank" rel="noopener">Open in ' + esc(P.toolById(n.source).name) + ' ›</a></div></div>');
    });
    if (cards.length) html += '<div class="section-title">Designs</div><div class="grid grid-3">' + cards.join('') + '</div>';

    var attn = ids.filter(function (id) {
      var st = P.partStatus(t.nodes[id], index);
      return st && ['nosummary', 'notfound', 'error', 'unlinked'].indexOf(st.state) >= 0;
    });
    if (attn.length) {
      html += '<div class="section-title">Needs attention</div><div class="card attn">' + attn.map(function (id) {
        var n = t.nodes[id], st = P.partStatus(n, index);
        return '<div class="attn-row" data-act="edit-node" data-id="' + esc(id) + '">' + srcChip(n.source) +
          '<div class="attn-text">' + esc(n.name) + '<div>' + esc(STATE_TEXT[st.state][2]) + '</div></div>' + stateChip(st) + '</div>';
      }).join('') + '</div>';
    }
    if (Object.keys(r.stages).length) html += '<div class="section-title">Stages</div><div class="card" style="padding:14px 18px;font-size:13.5px;line-height:2">' + stageList + '<p class="note">Each tool keeps its own stages. Gates (EVT, DVT, PVT) will tie them together.</p></div>';
    html += '<p class="note" style="margin-top:28px">Created ' + relTime(p.createdAt) + (p.createdBy ? ' by ' + esc(p.createdBy) : '') + '</p></div>';
    return html;
  }

  // ── Structure: a map of tiles (default) or the table ─────
  // Until designs carry a picture, a Part's tile shows a plain drawing of what it is: a board
  // outline for EE, a part outline for ME, a box for purchased, braces for firmware.
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
    if (P.toolById(n.source)) return '<svg viewBox="0 0 120 76" aria-hidden="true"><rect class="pa-unknown" x="20" y="12" width="80" height="52" rx="8"/></svg>';
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
  function pictureUrl(repo, img) {
    if (pvUrls[img.sha]) return Promise.resolve(pvUrls[img.sha]);
    if (!pvWaiting[img.sha]) {
      pvWaiting[img.sha] = pvGet(img.sha).then(function (blob) {
        if (blob || !repo || !getToken()) return blob;
        return new S.PLReader({ owner: settings.owner, branch: settings.branch, tools: C.tools, token: getToken() }).image(repo, img)
          .then(function (b) { pvPut(img.sha, b); return b; });
      }).then(function (blob) { return blob ? (pvUrls[img.sha] = URL.createObjectURL(blob)) : null; }, function () { return null; })
        .then(function (url) { if (!url) delete pvWaiting[img.sha]; return url; });
    }
    return pvWaiting[img.sha];
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
  function pictureOf(entry, key) {
    var pv = entry && entry.preview;
    return pv ? pv.images.filter(function (i) { return i.key === (key || pv.hero); })[0] || pv.images[0] : null;
  }
  // The picture of a Part (or of a design in the picker), or its plain drawing.
  function art(n, big, entry, key) {
    var img = pictureOf(entry, key);
    if (!img) return partArt(n, big);
    var url = img.src || pvUrls[img.sha];
    if (url) return '<img class="pv" alt="" src="' + esc(url) + '">';
    return '<img class="pv" alt="" data-sha="' + esc(img.sha) + '" data-type="' + esc(img.type) + '" data-repo="' + esc(entry.preview.repo) + '">' + partArt(n, big);
  }
  function loadPictures(root) {
    if (DEMO || !allowed()) return;
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

  function structurePage(p) {
    var t = P.tree(p), rolls = P.rollup(p, index), ids = P.flatten(t);
    var layout = LAYOUTS.some(function (l) { return l[0] === ui.layout; }) ? ui.layout : 'map', map = layout !== 'list';
    if (map && ui.sel && !t.nodes[ui.sel]) ui.sel = '';
    var html = '<div class="page' + (map ? ' page-map' + (ui.sel ? ' has-sel' : '') : '') + '"><div class="map-main"><div class="cl-head"><div><div class="eyebrow">' + esc(p.meta.name) + '</div><h1 class="page-title">Structure</h1>' +
      '<div class="page-sub"><span>' + plural(rolls[''].parts, 'Part') + '</span><span class="sep">·</span><span>' + fmtMass(rolls[''].massG) + '</span></div></div>' +
      '<div class="cl-head-acts"><div class="seg" role="tablist" aria-label="Layout">' + LAYOUTS.map(function (l) {
        return '<button role="tab" class="' + (layout === l[0] ? 'on' : '') + '" data-act="layout" data-layout="' + l[0] + '">' + l[1] + '</button>';
      }).join('') + '</div><button class="btn" data-act="add-node">' + ICON.plus + ' Add</button></div></div>';
    if (!ids.length) return html + (trayHtml(p) || '<div class="card empty"><div class="empty-art">' + ICON.tree + '</div><h2>No Parts yet</h2><p>Start with the top assembly.</p><button class="btn btn-primary" data-act="add-node">Add</button></div>') + '</div></div>';
    if (map) return html + (layout === 'gallery' ? gallery(p, t, ids) : layout === 'exploded' ? exploded(p, t, ids) : mapLanes(p, t, rolls, ids)) + '</div>' + (ui.sel ? inspector(p, t, ui.sel) : '') + '</div>';
    return html + listTable(t, rolls, ids) + '</div></div>';
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
          '<div class="map-meta"><span>' + esc(e.number || n.number || n.mpn || '') + (e.revision ? ' · Rev ' + esc(e.revision) : '') + '</span>' + srcChip(n.source) + '</div></button>';
      }).join('') + '</div></section>';
    }).join('') + '</div>';
  }

  // The Parts that have a stored picture, stacked in tree order and pulled apart by the slider.
  // Parts without one are named below rather than drawn, so nothing on the stack is made up.
  function exploded(p, t, ids) {
    var parts = ids.filter(function (id) { return t.nodes[id].kind !== 'assembly'; });
    var shown = parts.filter(function (id) { return pictureOf(P.partStatus(t.nodes[id], index).entry); });
    var missing = parts.filter(function (id) { return shown.indexOf(id) < 0 && P.toolById(t.nodes[id].source); });
    if (!shown.length) {
      return '<div class="card empty"><div class="empty-art">' + ICON.tree + '</div><h2>No pictures yet</h2><p>The exploded view stacks the Parts that have a picture. A board gets one when its Fabcheck run is stored with its review (Send to Signoff).</p></div>';
    }
    var gap = ui.spread == null ? 60 : ui.spread;
    return '<div class="xp card"><div class="xp-stage"><div class="xp-stack" style="--gap:' + gap + 'px">' + shown.slice().reverse().map(function (id, i) {
      var n = t.nodes[id];
      return '<button class="xp-layer' + (ui.sel === id ? ' sel' : '') + '" style="--i:' + i + '" data-act="select-node" data-id="' + esc(id) + '" aria-label="' + esc(n.name) + '">' +
        art(n, true, P.partStatus(n, index).entry) + '<span class="xp-label">' + esc(n.name) + '</span></button>';
    }).join('') + '</div></div>' +
      '<div class="xp-ctl"><label for="xp-spread">Assembled</label><input type="range" id="xp-spread" min="0" max="120" value="' + gap + '"><span>Exploded</span></div>' +
      '<p class="note">Top of the stack is the first Part in the structure. Reorder Parts in the Map or List to change it.' +
      (missing.length ? ' Not shown, no picture yet: ' + esc(missing.map(function (id) { return t.nodes[id].name; }).join(', ')) + '.' : '') + '</p></div>';
  }
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'xp-spread') return;
    ui.spread = Number(e.target.value);
    var st = document.querySelector('.xp-stack');
    if (st) st.style.setProperty('--gap', ui.spread + 'px');
  });

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
      return !d.archived && !used[d.tool + ':' + d.id] && d.summary && String(d.summary.project || '').toLowerCase() === want;
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
          '<div class="map-meta"><span>' + esc([d.number, d.revision && 'Rev ' + d.revision].filter(Boolean).join(' · ')) + '</span><span>' + esc(s.stage || '') + (s.stage ? ' · ' : '') + pct(s.pct) + '%</span></div>' +
          '<div class="pick-tags">' + srcChip(d.tool) + '</div></div></button>';
      }).join('') + '</div></section>';
  }
  function designPart(p, key, parent) {
    var d = index && index.entries[key];
    if (!d) return null;
    var node = P.newNode(p, { kind: 'part', name: d.name || d.id, number: d.number || '', parent: parent || '', source: d.tool, ref: { tool: d.tool, id: d.id }, qty: 1 }, me());
    p.nodes[node.id] = node;
    return node;
  }
  var GROUPS = { ee: 'Electronics', me: 'Mechanical' };   // where "Add all" puts each tool's designs
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
  document.addEventListener('dragover', function (e) {
    var z = dropTarget(e);
    document.querySelectorAll('.drop-on').forEach(function (x) { if (x !== z) x.classList.remove('drop-on'); });
    if (!z) return;
    e.preventDefault(); z.classList.add('drop-on');
  });
  document.addEventListener('drop', function (e) {
    var z = dropTarget(e), p = current(), what = dragging;
    if (!z || !p) return;
    e.preventDefault();
    var parent = z.dataset.drop;
    dragDone();
    if (what.design) { var n = designPart(p, what.design, parent); if (n) { ui.sel = n.id; saveUi(); touch(p); } return; }
    var t = P.tree(p), id = what.node;
    if (!t.nodes[id] || (t.parent[id] || '') === parent) return;
    if (!P.canMove(t, id, parent)) { toast('An assembly can’t go inside itself'); return; }
    setNode(id, { parent: parent, order: P.nextOrder(p, parent) });
  });

  // One lane per assembly under the top assembly (or per top-level assembly when there are
  // several). Parts at the top level share a lane; deeper assemblies are headed groups in their lane.
  function mapLanes(p, t, rolls, ids) {
    var top = t.roots.length === 1 && t.nodes[t.roots[0]].kind === 'assembly' ? t.roots[0] : '';
    var level = top ? t.children[top] || [] : t.roots;
    var lanes = level.filter(function (id) { return t.nodes[id].kind === 'assembly'; });
    var loose = level.filter(function (id) { return t.nodes[id].kind !== 'assembly'; });
    function tiles(list) {
      var big = list.filter(function (id) { return P.toolById(t.nodes[id].source); }), small = list.filter(function (id) { return !P.toolById(t.nodes[id].source); });
      return (big.length ? '<div class="map-tiles">' + big.map(function (id) { return tile(t.nodes[id]); }).join('') + '</div>' : '') +
        (small.length ? '<div class="map-tiles small">' + small.map(function (id) { return tile(t.nodes[id]); }).join('') + '</div>' : '');
    }
    function laneHead(id, name, r) {
      return '<div class="map-lane-head"><button class="map-lane-name" data-act="edit-node" data-id="' + esc(id) + '" title="Edit assembly">' + esc(name) + '</button>' +
        '<span class="map-lane-sub">' + plural(r.parts, 'Part') + (r.designs ? ' · ' + pct(r.pct) + '%' : '') + '</span>' + (r.openTotal ? sevs(r.open) : '') +
        '<button class="icon-btn" data-act="add-child" data-id="' + esc(id) + '" title="Add inside" aria-label="Add inside ' + esc(name) + '">' + ICON.plus + '</button></div>';
    }
    var html = trayHtml(p) + '<div class="map-lanes">' + lanes.map(function (lane) {
      var inside = P.descendants(t, lane), groups = [{ id: lane, parts: [] }];
      ids.forEach(function (id) {
        if (!inside[id]) return;
        if (t.nodes[id].kind === 'assembly') groups.push({ id: id, parts: [] });
        else groups.filter(function (g) { return g.id === t.parent[id]; }).concat(groups.slice(-1))[0].parts.push(id);
      });
      return '<section class="map-lane" data-drop="' + esc(lane) + '">' + laneHead(lane, t.nodes[lane].name || 'Unnamed', rolls[lane]) +
        groups.map(function (g, k) {
          if (!k) return tiles(g.parts);
          return '<div class="map-group" data-drop="' + esc(g.id) + '"><button class="map-group-name" data-act="edit-node" data-id="' + esc(g.id) + '">' + esc(t.nodes[g.id].name || 'Unnamed') + '</button>' +
            (g.parts.length ? tiles(g.parts) : '<div class="map-empty">Empty</div>') + '</div>';
        }).join('') + (Object.keys(inside).length ? '' : '<div class="map-empty">No Parts yet</div>') + '</section>';
    }).join('');
    if (loose.length) {
      html += '<section class="map-lane" data-drop="' + esc(top) + '"><div class="map-lane-head"><span class="map-lane-name static">' + esc(top ? t.nodes[top].name : 'Top level') + '</span>' +
        '<span class="map-lane-sub">' + plural(loose.length, 'Part') + '</span></div>' + tiles(loose) + '</section>';
    }
    return html + '</div>';
  }

  function tile(n) {
    var st = P.partStatus(n, index), s = st && st.summary, tool = P.toolById(n.source);
    var cls = 'map-tile' + (tool ? '' : ' small') + (ui.sel === n.id ? ' sel' : '');
    var qty = n.qty > 1 ? ' <span class="map-qty">×' + esc(n.qty) + '</span>' : '';
    if (!tool) {
      return '<button class="' + cls + '" data-act="select-node" data-id="' + esc(n.id) + '" draggable="true" data-drag-node="' + esc(n.id) + '"><div class="map-art">' + partArt(n) + '</div>' +
        '<div class="map-body"><div class="map-name">' + esc(n.name || 'Unnamed') + qty + '</div><div class="map-meta"><span>' + esc(n.mpn || n.number || (st.state === 'manual' ? 'No review tool yet' : '')) + '</span>' + srcChip(n.source) + '</div></div></button>';
    }
    return '<button class="' + cls + '" data-act="select-node" data-id="' + esc(n.id) + '" draggable="true" data-drag-node="' + esc(n.id) + '"><div class="map-art">' + art(n, true, st.entry) + '</div>' +
      '<div class="map-name">' + esc(n.name || 'Unnamed') + qty + '</div>' +
      (s ? '<div class="bar"><i style="width:' + pct(s.pct) + '%"></i></div>' : '') +
      '<div class="map-meta">' + (s ? '<span>' + esc(s.stage || '') + (s.stage ? ' · ' : '') + pct(s.pct) + '%</span>' + sevs((s.issues || {}).open || {}) : stateChip(st)) + srcChip(n.source) + '</div></button>';
  }

  // The selected Part's detail, beside the map (over it on narrow screens).
  function inspector(p, t, id) {
    var n = t.nodes[id], st = P.partStatus(n, index), tool = P.toolById(n.source);
    var html = '<aside class="map-ins card" aria-label="' + esc(n.name) + '"><button class="icon-btn map-ins-close" data-act="close-ins" aria-label="Close">×</button>';
    if (n.kind === 'assembly') {
      var r = P.rollup(p, index)[id];
      return html + '<h2>' + esc(n.name) + '</h2><p class="map-ins-sub">' + esc(P.path(t, id).map(function (x) { return x.name; }).concat(['Assembly']).join(' › ')) + '</p>' +
        '<div class="map-ins-row">' + (r.designs ? ring(r.pct, 56, 6, pct(r.pct) + '%') : '') + '<div>' + plural(r.parts, 'Part') + '<br>' + sevs(r.open) + '</div></div>' +
        '<div class="map-ins-acts"><button class="btn" data-act="edit-node" data-id="' + esc(id) + '">Edit</button></div></aside>';
    }
    var e = st.entry || {}, s = st.summary;
    var pv = e.preview, side = pv && pv.images.some(function (i) { return i.key === ui.pic; }) ? ui.pic : '';
    html += '<div class="map-ins-art">' + art(n, true, e, side) +
      (pv && pv.images.length > 1 ? '<div class="seg map-ins-flip">' + pv.images.map(function (i) {
        return '<button class="' + ((side || pv.hero) === i.key ? 'on' : '') + '" data-act="pic" data-key="' + esc(i.key) + '">' + esc(cap(i.key)) + '</button>';
      }).join('') + '</div>' : '') + '</div><h2>' + esc(n.name || 'Unnamed') + '</h2>' +
      '<p class="map-ins-sub">' + esc([e.number || n.number || n.mpn, e.revision && 'Rev ' + e.revision, (s && s.stage) || e.stage, n.qty > 1 && '×' + n.qty, n.massG != null && n.massG !== '' && fmtMass(Number(n.massG)) + ' each'].filter(Boolean).join(' · ')) + '</p>';
    if (s) {
      var open = (s.issues || {}).open || {}, total = P.SEVERITIES.reduce(function (a, k) { return a + (Number(open[k]) || 0); }, 0);
      html += '<div class="map-ins-row">' + ring(s.pct, 56, 6, pct(s.pct) + '%') + '<div><b>' + pct(s.pct) + '% reviewed</b><br>' + (total ? sevs(open) : '<span class="muted">No open issues</span>') + '</div></div>';
      var lists = Object.keys(s.checklists || {}).map(function (k) { return s.checklists[k]; });
      if (lists.length) html += '<div class="map-ins-lists">' + lists.map(function (c) { return '<div class="map-cl"><span>' + esc(c.name) + '</span>' + pbar(c.pct) + '</div>'; }).join('') + '</div>';
      var top = (s.open || []).slice().sort(function (a, b) { return P.SEVERITIES.indexOf(a.severity) - P.SEVERITIES.indexOf(b.severity); }).slice(0, 4);
      if (top.length) {
        html += '<div class="map-ins-issues">' + top.map(function (i) {
          return '<a href="' + esc(designUrl(n, i.id)) + '" target="_blank" rel="noopener"><span class="sev ' + esc(i.severity) + '">' + cap(i.severity) + '</span><span>' + esc(i.text) + '</span></a>';
        }).join('') + (total > top.length ? '<p class="note">' + plural(total - top.length, 'more issue') + ' in ' + esc(tool.short) + '</p>' : '') + '</div>';
      }
      if (s.at) html += '<p class="note">Edited ' + relTime(s.at) + (s.by ? ' by ' + esc(s.by) : '') + '</p>';
    } else if (st.state === 'purchased') {
      html += '<p class="map-ins-text">' + esc([n.supplier, n.mpn].filter(Boolean).join(' · ') || 'Purchased') + (n.envelopeMm ? '<br>Envelope ' + esc(n.envelopeMm) + ' mm' : '') + '</p>';
    } else if (STATE_TEXT[st.state]) {
      html += '<p class="map-ins-text">' + stateChip(st) + ' ' + esc(STATE_TEXT[st.state][2]) + '</p>';
    }
    if (n.notes) html += '<p class="map-ins-text">' + esc(n.notes) + '</p>';
    return html + '<div class="map-ins-acts">' + (tool && (st.state === 'ok' || st.state === 'nosummary') ? '<a class="btn btn-primary" href="' + esc(designUrl(n)) + '" target="_blank" rel="noopener">Open in ' + esc(tool.name) + '</a>' : '') +
      '<button class="btn" data-act="edit-node" data-id="' + esc(id) + '">Edit</button></div></aside>';
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
        var sub = n.kind === 'part' ? [n.number, st && st.entry && st.entry.number && st.entry.number !== n.number ? st.entry.number : '', n.mpn].filter(Boolean).join(' · ') : (n.number || plural(r.parts, 'Part'));
        var progress = n.kind === 'assembly' ? (r.designs ? pbar(r.pct) : '<span class="muted">—</span>')
          : st.state === 'ok' ? pbar(st.summary.pct) : st.state === 'purchased' ? '<span class="muted">Purchased</span>' : stateChip(st);
        var issues = n.kind === 'assembly' ? (r.designs ? sevs(r.open) : '') : st.state === 'ok' ? sevs((st.summary.issues || {}).open || {}) : '';
        var stage = n.kind === 'part' && st.state === 'ok' ? esc(st.summary.stage || '') : n.kind === 'part' && st.entry ? esc(st.entry.stage || '') : '';
        var mass = n.kind === 'assembly' ? (r.massG ? fmtMass(r.massG) : '') : n.massG != null && n.massG !== '' ? fmtMass(Number(n.massG) * (n.qty || 1)) : '';
        return '<tr class="' + (n.kind === 'assembly' ? 'asm' : 'part') + '" data-act="edit-node" data-id="' + esc(id) + '">' +
          '<td><div class="t-name" style="padding-left:' + (t.depth[id] * 20) + 'px">' + caret + '<div class="t-label">' + flag + '<b>' + esc(n.name || 'Unnamed') + '</b>' + (sub ? '<div class="t-sub">' + esc(sub) + '</div>' : '') + '</div></div></td>' +
          '<td>' + (n.kind === 'part' ? srcChip(n.source) : '') + '</td>' +
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
          '<td><a class="open-link" href="' + esc(designUrl(i.node, i.id)) + '" target="_blank" rel="noopener" data-stop="1">Open ›</a></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
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
  function closeSheet() { var s = $('#sheet'); if (s) s.remove(); }
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
        '<p class="note">The boards and parts tagged with this project are offered on the Structure page. Leave it empty to use the product name.</p></div>' +
      '<div class="field"><label for="f-phase">Build phase</label><select class="input" id="f-phase">' + (C.phases || []).map(function (s) { return '<option' + (s === m.phase ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="f-desc">Description</label><textarea class="input" id="f-desc" placeholder="What the product is and where the project stands">' + esc(m.description) + '</textarea></div>' +
      '</div><div class="sheet-foot">' + (p ? '<button class="btn btn-danger" data-sheet="archive">' + (m.archived ? 'Unarchive' : 'Archive') + '</button><span class="spacer"></span>' : '<span class="spacer"></span>') +
      '<button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">' + (p ? 'Save' : 'Create project') + '</button></div>');
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sheet]'); if (!b) return;
      if (b.dataset.sheet === 'cancel') return closeSheet();
      if (b.dataset.sheet === 'archive') { p.meta.archived = !p.meta.archived; closeSheet(); touch(p); return; }
      var name = val(w, '#f-name');
      if (!name) { w.querySelector('#f-name').focus(); return; }
      var fields = { name: name, client: val(w, '#f-client'), clientProject: val(w, '#f-cproj'), number: val(w, '#f-number'), phase: val(w, '#f-phase'), description: val(w, '#f-desc') };
      if (p) { Object.assign(p.meta, fields); closeSheet(); touch(p); return; }
      var doc = P.newProject(fields, me()), slug = doc.slug, k = 2;
      while (projects[slug]) slug = doc.slug + '-' + k++;
      doc.slug = slug; projects[slug] = doc;
      ui.slug = slug; ui.view = 'structure'; saveUi();
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
      (id && st && (st.state === 'ok' || st.state === 'nosummary') ? '<a class="btn" href="' + esc(designUrl(n)) + '" target="_blank" rel="noopener">Open in ' + esc(P.toolById(n.source).short) + '</a>' : '') +
      '<button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">' + (id ? 'Save' : 'Add') + '</button></div>', { wide: true });

    var kind = n.kind, source = n.source || '';
    var linked = P.refKey(n.ref);   // "tool:id" of the picked design, or ''
    // A Part is either an existing design from Signoff EE or ME, or a generic Part you type in
    // (purchased, or firmware until Signoff FW exists). New Parts start on the design list.
    var generic = !P.toolById(source), lastGeneric = generic ? source : 'purchased';
    function allDesigns() {
      return C.tools.reduce(function (all, tool) { return all.concat(S.plReader.designs(index, tool.id)); }, []);
    }
    // Design cards, those of this product's client project first. A design another Part already
    // links to is marked, not hidden: the same board can be used twice.
    function pickCards(q) {
      var list = allDesigns(), mine = String(p.meta.name || '').toLowerCase(), used = {};
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
          (s ? '<span>' + esc(s.stage || d.stage || '') + (s.stage || d.stage ? ' · ' : '') + pct(s.pct) + '%</span>' : '<span>Not summarized yet</span>') + '</div>' +
          '<div class="pick-tags">' + srcChip(d.tool) + (s && s.project && here.indexOf(d) < 0 ? '<span>' + esc(s.project) + '</span>' : '') +
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
      if (kind !== 'part') { box.innerHTML = ''; return; }
      var list = allDesigns(), tools = C.tools.map(function (x) { return x.short; }).join(' or ');
      var html = '<div class="field"><div class="seg full" id="f-mode">' + [['design', 'Existing ' + tools + ' design'], ['generic', 'Generic Part']].map(function (m) {
        return '<button type="button" class="' + ((generic ? 'generic' : 'design') === m[0] ? 'on' : '') + '" data-mode="' + m[0] + '">' + esc(m[1]) + '</button>';
      }).join('') + '</div></div>';
      if (generic) {
        html += '<div class="field"><span class="field-label">Kind of Part</span><div class="seg full" id="f-source">' + P.sources().filter(function (s) { return !s.tool; }).map(function (s) {
          return '<button type="button" class="' + (source === s.id ? 'on' : '') + '" data-source="' + esc(s.id) + '">' + esc(s.name) + '</button>';
        }).join('') + '</div></div>';
      } else {
        html += '<div class="field">' + (list.length > 6 ? '<input class="input" id="f-ref-q" type="search" placeholder="Search designs by name, number or client project" autocomplete="off" aria-label="Search designs">' : '') +
          '<div class="pick-grid" id="f-ref-list">' + pickCards('') + '</div>' +
          (!index ? '<p class="note">Designs haven’t been read yet. ' + (DEMO ? '' : 'Sync to read them from GitHub.') + '</p>'
            : !list.length ? '<p class="note">No designs found in ' + esc(C.tools.map(function (x) { return x.name; }).join(' or ')) + '. Sync to read them again.</p>' : '') + '</div>';
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
        '<div class="field"><label for="f-env">Envelope (mm)</label><input class="input" id="f-env" value="' + esc(n.envelopeMm || '') + '" placeholder="e.g. 70 × 55 × 38"></div>' : '');
    }
    partFields();
    w.addEventListener('input', function (e) { if (e.target.id === 'f-ref-q') refreshPicks(); });
    w.addEventListener('click', function (e) {
      var k = e.target.closest('[data-kind]');
      if (k) { kind = k.dataset.kind; w.querySelectorAll('#f-kind button').forEach(function (b) { b.classList.toggle('on', b === k); }); partFields(); return; }
      var md = e.target.closest('[data-mode]');
      if (md) {
        generic = md.dataset.mode === 'generic';
        source = generic ? lastGeneric : (linked ? linked.split(':')[0] : (C.tools[0] || {}).id);
        partFields(); return;
      }
      var s = e.target.closest('[data-source]');
      if (s) { source = lastGeneric = s.dataset.source; partFields(); return; }
      var pk = e.target.closest('[data-pick]');
      if (pk) {
        linked = linked === pk.dataset.pick ? '' : pk.dataset.pick;
        if (linked) source = linked.split(':')[0];
        var d = allDesigns().filter(function (x) { return x.tool + ':' + x.id === linked; })[0];
        // The Part takes the design's name and number, unless you've typed your own.
        [['#f-name', 'name'], ['#f-number', 'number']].forEach(function (f) {
          var el = w.querySelector(f[0]);
          if (!el.value.trim() || el.value === el.dataset.auto) { el.value = d ? d[f[1]] || '' : ''; el.dataset.auto = el.value; }
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
      if (kind === 'part') {
        var refId = linked.split(':')[1] || '', mass = val(w, '#f-mass'), qty = parseInt(val(w, '#f-qty'), 10);
        Object.assign(fields, {
          source: source, ref: P.toolById(source) && refId ? { tool: source, id: refId } : null,
          qty: qty > 0 ? qty : 1, massG: mass === '' ? null : Math.max(0, Number(mass)),
          supplier: source === 'purchased' ? val(w, '#f-supplier') : n.supplier || '', mpn: source === 'purchased' ? val(w, '#f-mpn') : n.mpn || '',
          envelopeMm: source === 'purchased' ? val(w, '#f-env') : n.envelopeMm || ''
        });
      }
      if (id) {
        if (parent !== (n.parent || '')) fields.order = P.nextOrder(p, parent);
        closeSheet(); setNode(id, fields); return;
      }
      var node = P.newNode(p, fields, me());
      p.nodes[node.id] = node;
      if (parent) delete ui.closed[parent];
      closeSheet(); touch(p);
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

  function settingsSheet() {
    var token = getToken(), remembered = false;
    try { remembered = !!localStorage.getItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    var w = sheet('<div class="sheet-head"><h2>Settings</h2><p>PL projects sync through a private GitHub repository. The designs they link to are read from Signoff EE and ME’s repositories.</p></div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label for="s-user">Your name</label><input class="input" id="s-user" value="' + esc(settings.user) + '" placeholder="First Last"></div>' +
      '<div class="field"><span class="field-label">Appearance</span><div class="seg full" id="s-theme">' + [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(function (t) {
        return '<button type="button" class="' + (settings.theme === t[0] ? 'on' : '') + '" data-theme="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div></div>' +
      (DEMO ? '<p class="note">Git sync is off in demo mode. <a href="' + esc(location.pathname) + '">Open the full tool</a>.</p>' :
        '<div class="field"><label for="s-token">Access token</label><input class="input" id="s-token" type="password" value="' + esc(token) + '" placeholder="ghp_… or github_pat_…" autocomplete="off">' +
        '<p class="note">Shared with the other Signoff tools in this browser and sent only to api.github.com. It needs to reach the PL data repo and every Signoff EE and ME repository.</p></div>' +
        '<label class="check"><input type="checkbox" id="s-remember"' + (remembered ? ' checked' : '') + '> Remember the token after closing the browser</label>' +
        '<details class="guide" style="margin-top:14px"><summary>Repositories</summary>' +
        '<div class="row2" style="margin-top:10px"><div class="field"><label for="s-owner">Account or organization</label><input class="input" id="s-owner" value="' + esc(settings.owner) + '"></div>' +
        '<div class="field"><label for="s-branch">Branch</label><input class="input" id="s-branch" value="' + esc(settings.branch) + '"></div></div>' +
        '<div class="field"><label for="s-data">PL data repo</label><input class="input" id="s-data" value="' + esc(settings.dataRepo) + '"></div>' +
        '<p class="note">Designs are read from ' + C.tools.map(function (t) { return esc(t.dataRepo) + ' and ' + esc(t.prefix) + '…'; }).join(', ') + ' (set in assets/config.js).</p></details>') +
      '</div><div class="sheet-foot"><span class="spacer"></span><button class="btn" data-sheet="cancel">Cancel</button><button class="btn btn-primary" data-sheet="ok">' + (DEMO ? 'Done' : 'Save & sync') + '</button></div>');
    var theme = settings.theme;
    w.addEventListener('click', function (e) {
      var t = e.target.closest('#s-theme [data-theme]');
      if (t) { theme = t.dataset.theme; w.querySelectorAll('#s-theme button').forEach(function (b) { b.classList.toggle('on', b === t); }); applyTheme(theme); return; }
      var b = e.target.closest('[data-sheet]'); if (!b) return;
      if (b.dataset.sheet === 'cancel') { applyTheme(settings.theme); return closeSheet(); }
      settings.user = val(w, '#s-user'); settings.theme = theme;
      if (!DEMO) {
        settings.owner = val(w, '#s-owner') || C.repos.owner; settings.branch = val(w, '#s-branch') || 'main'; settings.dataRepo = val(w, '#s-data') || C.repos.dataRepo;
        var was = getToken();
        setToken(w.querySelector('#s-token').value, w.querySelector('#s-remember').checked);
        if (getToken() !== was) clearPictures();
      }
      save('settings', settings); saveSharedTheme(theme);
      closeSheet(); render();
      if (!DEMO && getToken()) sync();
    });
  }

  // ── Sync ─────────────────────────────────────────────────
  // 1. Who's signed in: a new token or login hides the projects until this sync confirms it.
  // 2. PL projects: the data repo, merged with PL's merge. A 404 means the token can't open it,
  //    so this isn't an FTE: PL locks and drops the projects the repo holds (P.lockOut).
  // 3. Designs: read again from EE and ME, for FTEs only.
  function sync() {
    if (DEMO) { toast('Demo mode keeps everything in this browser'); return; }
    if (syncing) return;
    if (!getToken()) { settingsSheet(); return; }
    syncing = true; renderSyncState('busy');
    var token = getToken(), tag = P.tokenTag(token), signedIn = false, started = {}, errors = [], pushed = 0;
    var store = new S.GitHubStore({ owner: settings.owner, repo: settings.dataRepo, branch: settings.branch, dataPath: '', token: token, merge: P.merge });
    store.user()
      .then(function (u) {
        var login = String(u.login || '').toLowerCase();
        signedIn = true;
        if (access.tag !== tag || access.login !== login || access.repo !== dataRepo()) { access = { login: login, tag: tag, repo: dataRepo(), state: '' }; save('access', access); render(); }
        started = Object.assign({}, dirty);
        var byId = {}; Object.keys(projects).forEach(function (k) { byId[projects[k].id] = projects[k]; });
        var names = Object.keys(dirty).map(function (id) { return byId[id] ? byId[id].meta.name : id; });
        return store.sync(byId, null, cache, { message: 'PL update' + (names.length ? ': ' + names.join(', ') : '') + ' (' + me() + ')' });
      })
      .then(function (res) {
        access.state = 'fte';
        pushed = res.pushed; cache = res.cache;
        var nowById = {}; Object.keys(projects).forEach(function (k) { nowById[projects[k].id] = projects[k]; });
        var next = {};
        Object.keys(res.projects).forEach(function (id) {
          var doc = nowById[id] ? P.merge(nowById[id], res.projects[id]) : res.projects[id];
          var slug = doc.slug || M.slugify(doc.meta.name), base = slug, n = 2;
          while (next[slug]) slug = base + '-' + n++;
          next[slug] = doc;
        });
        projects = next;
        Object.keys(started).forEach(function (k) { if (dirty[k] === started[k]) delete dirty[k]; });
      }, function (err) {
        if (!signedIn) throw err;   // /user failed: the token itself doesn't work
        if (err.status !== 404) { errors.push({ repo: settings.dataRepo, message: err.message }); return; }
        access.state = 'none';
        projects = P.lockOut(projects, dirty); cache = {}; index = null; clearPictures();
      })
      .then(function () {
        save('access', access);
        if (access.state !== 'fte') return;
        return new S.PLReader({ owner: settings.owner, branch: settings.branch, tools: C.tools, token: token }).refresh(index)
          .then(function (ix) { index = ix; errors = errors.concat(ix.errors); });
      })
      .then(function () {
        syncing = false;
        lastSync = { at: M.now(), errors: errors };
        save('cache', cache); save('index', index); save('lastSync', lastSync); persist();
        if (!projects[ui.slug]) ui.slug = firstSlug();
        render();
        if (access.state === 'none') toast('@' + access.login + ' can’t open ' + settings.owner + '/' + settings.dataRepo + ': Signoff PL is for Dovetail FTEs.');
        else if (errors.length) toast(errors[0].message + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' more)' : ''));
        else toast((pushed ? 'Synced — ' + plural(pushed, 'change') + ' pushed' : 'Up to date') + ' · ' + plural(Object.keys(index.entries).length, 'design') + ' read');
      })
      .catch(function (err) {
        syncing = false; render();
        toast('Sync failed: ' + err.message);
      });
  }
  function firstSlug() { return Object.keys(projects).filter(function (k) { return !projects[k].meta.archived; })[0] || ''; }

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
  window.addEventListener('storage', function (e) {
    if (e.key === TOKEN_KEY) { render(); return; }   // signed in or out in another Signoff tool
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

  // ── Events ───────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#menu')) closeMenu();
    if (e.target.closest('[data-stop]')) return;   // links inside clickable rows
    var el = e.target.closest('[data-act]');
    if (!el || el.closest('#sheet')) return;
    var act = el.dataset.act, id = el.dataset.id;
    if (!allowed() && ['nav', 'theme', 'settings', 'sync'].indexOf(act) < 0) return;
    switch (act) {
      case 'nav': toggleSidebar(); break;
      case 'theme':
        settings.theme = isDark(settings.theme) ? 'light' : 'dark';
        save('settings', settings); saveSharedTheme(settings.theme); applyTheme(settings.theme); break;
      case 'settings': settingsSheet(); break;
      case 'sync': sync(); break;
      case 'new-project': projectSheet(null); break;
      case 'open-project': ui.slug = el.dataset.slug; $('#app').classList.remove('nav-open'); saveUi(); render(); break;
      case 'view': ui.view = el.dataset.view; saveUi(); renderPage(); break;
      case 'add-node': nodeSheet(null, {}); break;
      case 'add-child': e.stopPropagation(); nodeSheet(null, { parent: id }); break;
      case 'edit-node': nodeSheet(id); break;
      case 'select-node': ui.sel = ui.sel === id ? '' : id; ui.pic = ''; saveUi(); renderPage(); break;
      case 'pic': ui.pic = el.dataset.key; renderPage(); break;
      case 'close-ins': ui.sel = ''; saveUi(); renderPage(); break;
      case 'layout': ui.layout = el.dataset.layout; saveUi(); renderPage(); break;
      case 'place-all': placeAll(current()); break;
      case 'place-design': (function () {
        var d = index && index.entries[el.dataset.key];
        if (d) nodeSheet(null, { source: d.tool, ref: { tool: d.tool, id: d.id }, name: d.name || d.id, number: d.number || '' });
      })(); break;
      case 'open-url': if (el.dataset.url) window.open(el.dataset.url, '_blank', 'noopener'); break;
      case 'toggle-node': e.stopPropagation(); if (ui.closed[id]) delete ui.closed[id]; else ui.closed[id] = 1; saveUi(); renderPage(); break;
      case 'move-up': e.stopPropagation(); move(id, -1); break;
      case 'move-down': e.stopPropagation(); move(id, 1); break;
      case 'project-menu':
        menu(el, [['edit', 'Project details…'], ['export', 'Export project (JSON)']].concat(DEMO ? [['reset', 'Reset demo', true]] : [])).then(function (c) {
          var p = current();
          if (c === 'edit') projectSheet(p);
          if (c === 'export') {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([M.stableStringify(p)], { type: 'application/json' }));
            a.download = p.slug + '.pl.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
          }
          if (c === 'reset') resetDemo();
        });
        break;
    }
  });
  $('#project-search').addEventListener('input', renderSidebar);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('#sheet') && !$('#menu') && ui.sel && ui.view === 'structure') { ui.sel = ''; saveUi(); renderPage(); return; }
      closeSheet(); closeMenu(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); sync(); return; }
    if (e.target.closest('input,textarea,select') || $('#sheet')) return;
    if (e.key === '[') toggleSidebar();
    if (allowed() && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); projectSheet(null); }
  });
  function resetDemo() {
    Object.keys(localStorage).forEach(function (k) { if (k.indexOf(C.storage.demoNs) === 0) localStorage.removeItem(k); });
    location.reload();
  }

  function render() { renderSidebar(); renderSyncState(); renderPage(); }

  // ── Start ────────────────────────────────────────────────
  applyTheme(settings.theme);
  if (ui.sideCollapsed && !narrow.matches) $('#app').classList.add('side-collapsed');
  if (DEMO) {
    var banner = $('#demo-banner');
    banner.hidden = false;
    document.body.classList.add('has-banner');
    banner.innerHTML = 'You’re exploring a demo of Signoff PL, Dovetail’s project lead tool. The product and its designs are made up; changes stay in this browser.<button id="reset-demo">Reset demo</button>';
    banner.querySelector('#reset-demo').addEventListener('click', resetDemo);
  }
  if (!projects[ui.slug]) ui.slug = firstSlug();
  render();
  if (!DEMO && getToken()) sync();

  S.app = { sync: sync, render: render };
})(window.Signoff = window.Signoff || {});
