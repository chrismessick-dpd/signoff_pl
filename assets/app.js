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
  var index = load('index', null);        // designs read from EE/ME (reader.js)
  var lastSync = load('lastSync', null);  // { at, errors, dataRepo: 'ok' | 'missing' }
  var ui = Object.assign({ slug: '', view: 'overview', closed: {} }, load('ui', {}));
  var syncing = false;

  if (DEMO && !Object.keys(projects).length) {
    var demo = S.plDemo.build();
    projects[demo.project.slug] = demo.project;
    index = demo.index;
    save('projects', projects); save('index', index);
  }

  function persist() { save('projects', projects); save('dirty', dirty); }
  function saveUi() { save('ui', { slug: ui.slug, view: ui.view, closed: ui.closed, sideCollapsed: !!ui.sideCollapsed }); }
  function me() { return settings.user || 'Anonymous'; }

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

  function ring(pct, size, stroke, label, sub) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return '<div class="ring" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg width="' + size + '" height="' + size + '"><circle class="ring-track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '"/>' +
      '<circle class="ring-val" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - pct / 100)) + '"/></svg>' +
      (label != null ? '<div class="ring-label"><div><b>' + label + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div></div>' : '') + '</div>';
  }
  function pbar(pct) { return '<div class="pbar"><div class="bar"><i style="width:' + pct + '%"></i></div><span>' + pct + '%</span></div>'; }
  function sevs(open) {
    var parts = P.SEVERITIES.filter(function (s) { return open[s]; }).map(function (s) { return '<span class="sev ' + s + '" title="' + cap(s) + '"><b>' + open[s] + '</b></span>'; });
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
  // Where a linked design opens. Demo designs are made up, so they open the tool's demo.
  function designUrl(node) {
    var tool = P.toolById(node.source);
    if (!tool) return '';
    if (DEMO) return tool.app + '?demo';
    return tool.app + (node.ref && node.ref.id ? '?project=' + encodeURIComponent(node.ref.id) : '');
  }

  // ── Current project ──────────────────────────────────────
  function current() { return projects[ui.slug] || null; }
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
    var list = Object.keys(projects).map(function (k) { return projects[k]; })
      .filter(function (p) { return !q || [p.meta.name, p.meta.client, p.meta.number].join(' ').toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''); });
    var html = list.filter(function (p) { return !p.meta.archived; }).map(function (p) {
      var r = P.rollup(p, index)[''];
      return '<button class="proj' + (p.slug === ui.slug ? ' active' : '') + '" data-act="open-project" data-slug="' + esc(p.slug) + '" title="' + esc(p.meta.name) + '">' +
        ring(r.pct, 26, 3.5) + '<span class="proj-body"><span class="proj-name">' + esc(p.meta.name) + '</span>' +
        '<span class="proj-sub">' + esc([p.meta.number, p.meta.phase].filter(Boolean).join(' · ')) + '</span></span>' +
        (dirty[p.id] ? '<span class="proj-dirty" title="Not synced yet"></span>' : '') + '</button>';
    }).join('') || '<div class="side-empty">' + (q ? 'No matching projects.' : 'No projects yet.') + '</div>';
    var archived = list.filter(function (p) { return p.meta.archived; });
    if (archived.length) {
      html += '<div class="side-archived"><div class="side-head"><span class="side-label">Archived</span></div>' +
        archived.map(function (p) { return '<button class="proj" data-act="open-project" data-slug="' + esc(p.slug) + '"><span class="proj-body"><span class="proj-name">' + esc(p.meta.name) + '</span></span></button>'; }).join('') + '</div>';
    }
    $('#project-list').innerHTML = html;
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
    if (!getToken()) { dot.dataset.tone = n ? 'warn' : 'idle'; title.textContent = n ? plural(n, 'unsynced change') : 'Local only'; sub.textContent = 'Set up Git sync'; return; }
    if (lastSync && lastSync.dataRepo === 'missing') { dot.dataset.tone = 'warn'; title.textContent = n ? plural(n, 'change') + ' kept here' : 'Designs read'; sub.textContent = settings.dataRepo + ' doesn’t exist yet'; return; }
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
      var extra = v.id === 'issues' && r.openTotal ? '<span class="count">' + r.openTotal + '</span>' : '';
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
    if (!p) { page.innerHTML = emptyPage(); return; }
    if (ui.view === 'structure') page.innerHTML = structurePage(p);
    else if (ui.view === 'issues') page.innerHTML = issuesPage(p);
    else page.innerHTML = overviewPage(p);
    $('#main').scrollTop = scroll;
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

  function headBlock(p, eyebrow) {
    var m = p.meta;
    var sub = [m.client, m.number].filter(Boolean).map(esc).join('<span class="sep">·</span>');
    return '<div class="eyebrow">' + esc(eyebrow) + '</div><h1 class="page-title">' + esc(m.name) + '</h1>' +
      '<div class="page-sub">' + (sub ? '<span>' + sub + '</span>' : '') + (m.phase ? '<span class="chip accent">' + esc(m.phase) + '</span>' : '') + '</div>';
  }
  function stat(n, label, cls, detail) {
    return '<div class="card stat ' + (cls || '') + '"><div class="stat-num">' + n + '</div><div class="stat-label">' + esc(label) + '</div>' + (detail ? '<div class="stat-detail">' + detail + '</div>' : '') + '</div>';
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

  function structurePage(p) {
    var t = P.tree(p), rolls = P.rollup(p, index);
    var html = '<div class="page"><div class="cl-head"><div><div class="eyebrow">' + esc(p.meta.name) + '</div><h1 class="page-title">Structure</h1>' +
      '<div class="page-sub"><span>' + plural(rolls[''].parts, 'Part') + '</span><span class="sep">·</span><span>' + fmtMass(rolls[''].massG) + '</span></div></div>' +
      '<button class="btn" data-act="add-node">' + ICON.plus + ' Add</button></div>';
    var ids = P.flatten(t);
    if (!ids.length) return html + '<div class="card empty"><div class="empty-art">' + ICON.tree + '</div><h2>No Parts yet</h2><p>Start with the top assembly.</p><button class="btn btn-primary" data-act="add-node">Add</button></div></div>';
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
    html += '<p class="note" style="margin-top:12px">Mass is per Part times quantity, over the Parts that have one. Progress counts linked designs once, however many Parts use them.</p></div>';
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
        return '<tr data-act="edit-node" data-id="' + esc(i.node.id) + '"><td><span class="sev ' + esc(i.severity) + '">' + cap(i.severity) + '</span></td>' +
          '<td>' + esc(i.text) + '<div class="muted">' + esc([i.checklist, i.ref].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td>' + srcChip(i.tool) + ' ' + esc(i.node.name) + '<div class="muted">' + esc(where) + '</div></td>' +
          '<td class="muted">' + esc(i.assignee || '—') + '</td>' +
          '<td><a class="open-link" href="' + esc(designUrl(i.node)) + '" target="_blank" rel="noopener" data-stop="1">Open ›</a></td></tr>';
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
      '<div class="field"><label for="f-name">Product name</label><input class="input" id="f-name" value="' + esc(m.name) + '" placeholder="e.g. Water quality buoy" maxlength="120"></div>' +
      '<div class="row2"><div class="field"><label for="f-client">Client</label><input class="input" id="f-client" value="' + esc(m.client) + '" placeholder="Optional"></div>' +
      '<div class="field"><label for="f-number">Product number</label><input class="input" id="f-number" value="' + esc(m.number) + '" placeholder="e.g. PRD-1042"></div></div>' +
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
      var fields = { name: name, client: val(w, '#f-client'), number: val(w, '#f-number'), phase: val(w, '#f-phase'), description: val(w, '#f-desc') };
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
    var p = current(), t = P.tree(p), n = id ? p.nodes[id] : Object.assign({ kind: 'part', name: '', number: '', source: (C.tools[0] || {}).id || 'purchased', ref: null, qty: 1 }, preset || {});
    var banned = id ? Object.assign(P.descendants(t, id), (function () { var o = {}; o[id] = 1; return o; })()) : {};
    var parents = P.flatten(t).filter(function (x) { return t.nodes[x].kind === 'assembly' && !banned[x]; });
    var st = id ? P.partStatus(n, index) : null;
    var w = sheet('<div class="sheet-head"><h2>' + (id ? esc(n.name || 'Part') : 'Add to ' + esc(p.meta.name)) + '</h2>' +
      (id ? '<p>' + esc(P.path(t, id).map(function (x) { return x.name; }).join(' › ') || 'Top level') + '</p>' : '<p>An assembly groups Parts. A Part links to its design review, or is purchased.</p>') + '</div>' +
      '<div class="sheet-body">' +
      '<div class="field"><span class="field-label">Kind</span><div class="seg full" id="f-kind">' + [['part', 'Part'], ['assembly', 'Assembly']].map(function (k) {
        return '<button type="button" class="' + (n.kind === k[0] ? 'on' : '') + '" data-kind="' + k[0] + '">' + k[1] + '</button>';
      }).join('') + '</div></div>' +
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
    function partFields() {
      var box = w.querySelector('#f-part');
      if (kind !== 'part') { box.innerHTML = ''; return; }
      var tool = P.toolById(source);
      var list = tool ? S.plReader.designs(index, source) : [];
      var linked = n.ref && n.ref.tool === source ? n.ref.id : '';
      var linkField = '';
      if (tool) {
        var known = list.some(function (d) { return d.id === linked; });
        linkField = '<div class="field"><label for="f-ref">' + esc(tool.name) + ' project</label><select class="input" id="f-ref"><option value="">Not linked yet</option>' +
          (linked && !known ? '<option value="' + esc(linked) + '" selected>' + esc(linked) + ' (not found)</option>' : '') +
          list.map(function (d) {
            return '<option value="' + esc(d.id) + '"' + (d.id === linked ? ' selected' : '') + '>' + esc([d.name, d.number, d.revision && 'Rev ' + d.revision].filter(Boolean).join(' · ')) + (d.summary ? '' : ' (not summarized yet)') + (d.archived ? ' (archived)' : '') + '</option>';
          }).join('') + '</select>' +
          (!index ? '<p class="note">Designs haven’t been read yet. ' + (DEMO ? '' : 'Sync to read them from GitHub.') + '</p>' : !list.length ? '<p class="note">No ' + esc(tool.name) + ' projects found. Sync to read them again.</p>' : '') + '</div>';
      }
      box.innerHTML = '<div class="field"><span class="field-label">Source</span><div class="seg full" id="f-source">' + P.sources().map(function (s) {
        return '<button type="button" class="' + (source === s.id ? 'on' : '') + '" data-source="' + esc(s.id) + '" title="' + esc(s.name) + '">' + esc(s.label) + '</button>';
      }).join('') + '</div></div>' + linkField +
      '<div class="row2"><div class="field"><label for="f-qty">Quantity</label><input class="input" id="f-qty" type="number" min="1" step="1" value="' + esc(n.qty || 1) + '"></div>' +
      '<div class="field"><label for="f-mass">Mass each (g)</label><input class="input" id="f-mass" type="number" min="0" step="0.1" value="' + esc(n.massG == null ? '' : n.massG) + '" placeholder="Optional"></div></div>' +
      (source === 'purchased' ? '<div class="row2"><div class="field"><label for="f-supplier">Supplier</label><input class="input" id="f-supplier" value="' + esc(n.supplier || '') + '"></div>' +
        '<div class="field"><label for="f-mpn">Manufacturer part number</label><input class="input" id="f-mpn" value="' + esc(n.mpn || '') + '"></div></div>' +
        '<div class="field"><label for="f-env">Envelope (mm)</label><input class="input" id="f-env" value="' + esc(n.envelopeMm || '') + '" placeholder="e.g. 70 × 55 × 38"></div>' : '');
    }
    partFields();
    w.addEventListener('click', function (e) {
      var k = e.target.closest('[data-kind]');
      if (k) { kind = k.dataset.kind; w.querySelectorAll('#f-kind button').forEach(function (b) { b.classList.toggle('on', b === k); }); partFields(); return; }
      var s = e.target.closest('[data-source]');
      if (s) { source = s.dataset.source; partFields(); return; }
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
        var refId = val(w, '#f-ref'), mass = val(w, '#f-mass'), qty = parseInt(val(w, '#f-qty'), 10);
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
        setToken(w.querySelector('#s-token').value, w.querySelector('#s-remember').checked);
      }
      save('settings', settings); saveSharedTheme(theme);
      closeSheet(); render();
      if (!DEMO && getToken()) sync();
    });
  }

  // ── Sync ─────────────────────────────────────────────────
  // 1. PL projects: the data repo, merged with PL's merge. A missing repo isn't an error yet:
  //    projects stay in this browser. 2. Designs: read again from EE and ME.
  function sync() {
    if (DEMO) { toast('Demo mode keeps everything in this browser'); return; }
    if (syncing) return;
    if (!getToken()) { settingsSheet(); return; }
    syncing = true; renderSyncState('busy');
    var token = getToken(), started = Object.assign({}, dirty), errors = [], dataState = 'ok', pushed = 0;
    var byId = {}; Object.keys(projects).forEach(function (k) { byId[projects[k].id] = projects[k]; });
    var store = new S.GitHubStore({ owner: settings.owner, repo: settings.dataRepo, branch: settings.branch, dataPath: '', token: token, merge: P.merge });
    var names = Object.keys(dirty).map(function (id) { return byId[id] ? byId[id].meta.name : id; });
    store.sync(byId, null, cache, { message: 'PL update' + (names.length ? ': ' + names.join(', ') : '') + ' (' + me() + ')' })
      .then(function (res) {
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
        if (err.status === 404) { dataState = 'missing'; return; }
        errors.push({ repo: settings.dataRepo, message: err.message });
      })
      .then(function () {
        return new S.PLReader({ owner: settings.owner, branch: settings.branch, tools: C.tools, token: token }).refresh(index)
          .then(function (ix) { index = ix; errors = errors.concat(ix.errors); });
      })
      .then(function () {
        syncing = false;
        lastSync = { at: M.now(), errors: errors, dataRepo: dataState };
        save('cache', cache); save('index', index); save('lastSync', lastSync); persist();
        if (!projects[ui.slug]) ui.slug = firstSlug();
        render();
        if (dataState === 'missing') toast(settings.dataRepo + ' doesn’t exist yet: PL projects stay in this browser. Designs were read.');
        else if (errors.length) toast(errors[0].message + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' more)' : ''));
        else toast((pushed ? 'Synced — ' + plural(pushed, 'change') + ' pushed' : 'Up to date') + ' · ' + plural(Object.keys(index.entries).length, 'design') + ' read');
      })
      .catch(function (err) {
        syncing = false; renderSyncState();
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
    if (e.key === 'Escape') { closeSheet(); closeMenu(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); sync(); return; }
    if (e.target.closest('input,textarea,select') || $('#sheet')) return;
    if (e.key === '[') toggleSidebar();
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); projectSheet(null); }
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
