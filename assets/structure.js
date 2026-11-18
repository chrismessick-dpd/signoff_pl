/* Tool Structure: how the Signoff tools pass data to each other and keep track of a whole project, drawn
   several ways: a tool graph, the project as Signoff PL's tree, a lifecycle in swimlanes, where the data lives,
   and a matrix. Every view draws from the same TOOLS and FLOWS below, which follow the contracts in the suite's
   CLAUDE.md. Made-up Smart Thermostat demo only; reads and writes nothing. Review numbers come from Signoff PL's
   demo snapshot (demo-designs.js) when it's loaded.

   SignoffStructure.mount(root, opts) fills root (styles: structure.css, all under .ss). Options:
     img       folder of PL's demo pictures (default 'assets/demo-previews/')
     views     the view ids to offer, in order (default all: graph, project, life, store, matrix)
     theme     true to draw an Auto / Light / Dark switch (the hub's lab; PL has its own)
     storeKey  localStorage key for the last view
   Signoff PL's Tool Structure page and the hub's lab (signoff/lab/flows.html) both mount it. */
(function () {
  'use strict';

  function mount(root, opts) {
    opts = opts || {};
    root.classList.add('ss');
    root.innerHTML =
      '<div class="ctl"><div class="seg" data-ss="views" role="group" aria-label="View"></div>' +
      '<button class="btn-s" data-ss="play" type="button">▶ Play the story</button>' +
      '<button class="btn-s" data-ss="labels" type="button" aria-pressed="false">Labels</button><span class="grow"></span>' +
      (opts.theme ? '<div class="seg" data-ss="theme" role="group" aria-label="Theme"></div>' : '') + '</div>' +
      '<div class="ctl"><div class="kinds" data-ss="kinds"></div></div>' +
      '<div class="grid"><section class="card view-card"><div class="story" data-ss="story"></div><div data-ss="view"></div></section>' +
      '<aside class="card side" data-ss="side"></aside></div>';

    var $ = function (id) { return root.querySelector('[data-ss="' + id + '"]'); };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    var SVGNS = 'http://www.w3.org/2000/svg';
    var IMG = opts.img || 'assets/demo-previews/';
    var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- Demo numbers (PL's snapshot, else these) ---------------------------------------------------
    var FALLBACK = {
      'ee:pdemo7': { name: 'Main PCBA', number: 'DT-1042', revision: 'B', stage: 'Pre-fab', pct: 64, open: { critical: 1, major: 5, minor: 5 }, reqs: 5, revs: ['B.1'], rework: 5 },
      'ee:pdemo11': { name: 'Display & Sensor Board', number: 'DT-1043', revision: 'A', stage: 'Layout', pct: 29, open: { critical: 1, major: 2, minor: 0 }, reqs: 4, revs: [] },
      'me:mdemo5': { name: 'Enclosure', number: '2100410-001', revision: 'B', stage: 'Prototype (EVT)', pct: 60, open: { critical: 1, major: 4, minor: 0 }, reqs: 4, revs: [] },
      'me:mdemo13': { name: 'Wall Bracket', number: '2100410-020', revision: 'B', stage: 'Detailed design', pct: 35, open: { critical: 0, major: 3, minor: 0 }, reqs: 2, revs: [] },
      'fw:fdemo3': { name: 'Thermostat Firmware', number: 'DT-1042-FW', revision: '0.9.0', stage: 'Integration (EVT)', pct: 47, open: { critical: 1, major: 4, minor: 0 }, reqs: 5, revs: [], rels: ['0.8.0 withdrawn', '0.9.0 released', '0.9.1 draft'] }
    };
    var SNAP = (window.SIGNOFF_PL_DEMO_DESIGNS || {}).designs || {};
    var FROM_SNAPSHOT = !!window.SIGNOFF_PL_DEMO_DESIGNS;
    function design(key) {
      var fb = FALLBACK[key], d = SNAP[key];
      if (!d || !d.summary) return fb;
      var s = d.summary;
      return {
        name: d.name || fb.name, number: d.number || fb.number, revision: d.revision || fb.revision, stage: d.stage || fb.stage,
        pct: s.pct != null ? s.pct : fb.pct, open: (s.issues && s.issues.open) || fb.open, reqs: (s.reqList || []).length,
        revs: (s.revisions || []).map(function (r) { return r.rev || r.label || r.name; }).filter(Boolean),
        rework: s.rework ? s.rework.total : fb.rework,
        rels: (s.releases || []).map(function (r) { return r.version + ' ' + r.state; })
      };
    }

    // ---- Tools ---------------------------------------------------------------------------------------
    var MARKS = {
      pl: '<svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="1.8" width="5" height="4" rx="1"/><rect x="1.8" y="12.2" width="5" height="4" rx="1"/><rect x="11.2" y="12.2" width="5" height="4" rx="1"/><path d="M9 5.8v3.2M4.3 12.2V9h9.4v3.2"/></svg>',
      ee: '<svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><rect x="4.5" y="4.5" width="9" height="9" rx="1.5"/><path d="M7 1.5v3M11 1.5v3M7 13.5v3M11 13.5v3M1.5 7h3M1.5 11h3M13.5 7h3M13.5 11h3"/></svg>',
      me: '<svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"><path d="M9 1.8l6.5 3.6v7.2L9 16.2l-6.5-3.6V5.4zM2.5 5.4L9 9l6.5-3.6M9 9v7.2"/></svg>',
      fw: '<svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="11" height="11" rx="1.8"/><path d="M6.5 1.5v2M11.5 1.5v2M6.5 14.5v2M11.5 14.5v2"/><path d="M7.6 7.2L6 9l1.6 1.8M10.4 7.2L12 9l-1.6 1.8"/></svg>',
      fabcheck: '<svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.8"><rect x="1.5" y="1.5" width="15" height="15" rx="2.5"/><circle cx="6" cy="6" r="1.4" fill="#fff" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="#fff" stroke="none"/></svg>',
      pincheck: '<svg viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"><rect x="6" y="5" width="8" height="10" rx="1.5"/><path d="M3 8h3M3 12h3M14 8h3M14 12h3"/></svg>',
      partcheck: '<svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"><path d="M9 1.8l6.5 3.6v7.2L9 16.2l-6.5-3.6V5.4zM2.5 5.4L9 9l6.5-3.6M9 9v7.2"/><path d="M12.5 13.5l1.6 1.6 2.9-3" stroke-linecap="round"/></svg>',
      loom: '<svg viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"><path d="M2.5 6.5h3.5c3 0 3 7 6 7h5.5M2.5 13.5h3.5c3 0 3-7 6-7h5.5"/></svg>',
      flasher: '<svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="11" height="11" rx="2"/><path d="M9.8 5.8L7.4 9.2h3.2L8.2 12.4"/></svg>',
      hub: '<svg viewBox="0 0 59.21 98.68"><path d="M0 0h18.19v41.88H0zM0 56.79h18.19v41.88H0zM18.2 41.89h1.59v14.91H18.2zM19.79 0v41.89l24.96-6.63v28.16L19.79 56.79v41.89l39.42-10.47V10.47z" fill="#fff"/></svg>'
    };
    function mark(id) { return '<span class="mark">' + MARKS[id] + '</span>'; }
    function img(file, alt) { return '<img src="' + IMG + file + '" alt="' + esc(alt || '') + '" loading="lazy">'; }

    var ART = {
      fw: '<svg viewBox="0 0 120 60"><text class="pa-fw" x="60" y="40" text-anchor="middle">{ }</text></svg>',
      loom: '<svg viewBox="0 0 120 60"><rect class="pa-box" x="6" y="18" width="22" height="24" rx="3"/><rect class="pa-box" x="92" y="10" width="22" height="16" rx="3"/><rect class="pa-box" x="92" y="34" width="22" height="16" rx="3"/>' +
        '<path class="pa-wire" d="M28 26c30 0 32-8 64-8"/><path class="pa-wire2" d="M28 34c30 0 32 8 64 8"/><path class="pa-line" d="M56 18v24" stroke-dasharray="2 3"/></svg>',
      flasher: '<svg viewBox="0 0 120 60"><rect class="pa-board" x="52" y="10" width="58" height="40" rx="4"/><rect class="pa-part" x="70" y="20" width="18" height="18" rx="2"/>' +
        '<rect class="pa-box" x="8" y="24" width="20" height="12" rx="2"/><path class="pa-wire" d="M28 30h24"/><path class="pa-line" d="M96 16l-4 7h6l-4 7"/></svg>',
      pincheck: '<svg viewBox="0 0 120 60"><rect class="pa-part" x="46" y="12" width="28" height="36" rx="2"/><path class="pa-line" d="M34 20h12M34 30h12M34 40h12M74 20h12M74 30h12M74 40h12M20 20h14M86 30h16M102 24v12M98 36h8"/>' +
        '<text class="pa-text" x="60" y="33" text-anchor="middle">U7</text><circle cx="34" cy="20" r="2" fill="var(--accent)"/></svg>',
      hub: '<svg viewBox="0 0 120 60"><g transform="translate(48 8) scale(.44)"><path d="M0 0h18.19v41.88H0zM0 56.79h18.19v41.88H0zM18.2 41.89h1.59v14.91H18.2zM19.79 0v41.89l24.96-6.63v28.16L19.79 56.79v41.89l39.42-10.47V10.47z" fill="var(--text-3)"/></g></svg>'
    };

    var TOOLS = {
      pl: { name: 'Signoff PL', role: 'The whole product: Parts, requirements, and roll-up', art: '<div class="art quad">' + img('pdemo7-top.webp') + img('mdemo5-iso.webp') + img('mdemo13-iso.webp') + '</div>', repo: 'signoff_pl_data', note: 'FTEs only.' },
      ee: { name: 'Signoff EE', role: 'Board reviews, revisions, and rework', art: '<div class="art">' + img('pdemo7-top.webp', 'Main PCBA') + '</div>', repo: 'ee_design_review_data', note: 'Home of the shared engine.' },
      me: { name: 'Signoff ME', role: 'Part and assembly reviews', art: '<div class="art">' + img('mdemo5-iso.webp', 'Enclosure') + '</div>', repo: 'me_design_review_data', note: 'Engine copied from EE.' },
      fw: { name: 'Signoff FW', role: 'Firmware reviews and releases', art: '<div class="art">' + ART.fw + '</div>', repo: 'fw_design_review_data', note: 'Prototype; engine copied from EE.' },
      fabcheck: { name: 'Fabcheck', role: 'Fab package DFM', art: '<div class="art">' + img('pdemo11-top.webp', 'Display board render') + '</div>', repo: '(the board’s EE repo)', note: 'Writes only to project repos.' },
      pincheck: { name: 'Pincheck', role: 'Schematic against a part library', art: '<div class="art">' + ART.pincheck + '</div>', repo: 'pincheck_data', note: 'Prototype.' },
      partcheck: { name: 'Partcheck', role: 'Mechanical package check', art: '<div class="art">' + img('mdemo13-iso.webp', 'Wall Bracket') + '</div>', repo: '(the part’s ME repo)', note: 'Prototype; its send is on branch me-send.', badge: 'branch' },
      loom: { name: 'Loom', role: 'Harness drawings and systems', art: '<div class="art">' + ART.loom + '</div>', repo: 'loom_data', note: 'Prototype.' },
      flasher: { name: 'Flasher', role: 'Firmware onto boards from the browser', art: '<div class="art">' + ART.flasher + '</div>', repo: 'flasher_data', note: 'Prototype.' },
      hub: { name: 'Hub', role: 'Sign in, People & access, and Tickets', art: '<div class="art">' + ART.hub + '</div>', repo: 'signoff_tickets', note: 'Shared by every tool.' }
    };

    // ---- Link kinds (told apart by dash and arrowhead, never by hue alone) --------------------------
    var KINDS = {
      summary: { label: 'Summary at sync', dash: '', w: 2.2 },
      send: { label: 'Send (stores a run)', dash: '9 6', w: 2 },
      open: { label: 'Opens in the browser', dash: '0.5 6', w: 2.6, open: true },
      reqs: { label: 'Requirements', dash: '12 4 2 4', w: 1.8 },
      tray: { label: 'Placeholder tray', dash: '3 3', w: 1.6 }
    };
    var STORE_KINDS = { write: { label: 'Writes', dash: '', w: 1.8 }, read: { label: 'Reads', dash: '6 5', w: 1.6 } };
    var PROJ_KINDS = {
      elec: { label: 'Electrical', dash: '', w: 2 },
      mech: { label: 'Mechanical', dash: '10 5', w: 2 },
      fw: { label: 'Runs on', dash: '0.5 6', w: 2.4, open: true },
      req2: { label: 'Requirements', dash: '12 4 2 4', w: 1.8 }
    };
    function kindSample(k, kinds) {
      var K = (kinds || KINDS)[k];
      return '<svg class="ks" viewBox="0 0 32 10"><path d="M2 5H24" fill="none" stroke="currentColor" stroke-width="' + K.w + '" stroke-linecap="round"' + (K.dash ? ' stroke-dasharray="' + K.dash + '"' : '') + '/>' +
        (K.open ? '<path d="M25 1.5l4 3.5-4 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M24 1.5l6 3.5-6 3.5z" fill="currentColor"/>') + '</svg>';
    }

    // ---- Flows between tools -------------------------------------------------------------------------
    var M7 = design('ee:pdemo7'), M11 = design('ee:pdemo11'), ENC = design('me:mdemo5'), BRK = design('me:mdemo13'), FWD = design('fw:fdemo3');
    var FLOWS = [
      { id: 'pin-ee', from: 'pincheck', to: 'ee', kind: 'send', label: 'Schematic findings',
        what: ['Findings as items in the Schematic Review checklist (Info notes stay unticked)', 'The stored run: the parsed design, gzipped, and its part files (about 250 KB for a 1,031-part board)', 'Checker names on tags and reference rows'],
        where: 'The board’s review repo, in Pincheck’s folder (moved with the review when it’s shared).', how: 'Send to Signoff EE in Pincheck.' },
      { id: 'ee-pin', from: 'ee', to: 'pincheck', kind: 'open', label: 'Open in Pincheck',
        what: ['A stored run, handed over in the browser'], where: 'IndexedDB dovetail-handoff, entry tool: pincheck.', how: 'Open in Pincheck on the From Pincheck card.' },
      { id: 'fab-ee', from: 'fabcheck', to: 'ee', kind: 'send', label: 'Fab package run',
        what: ['The run record and package.zip (split into .001, .002, … over 4 MB)', 'One structured fab package zip, Fabrication and Assembly', 'Board pictures and the board size', 'Findings as Fabcheck: items; waived ones as reference rows that count nowhere'],
        where: 'The board’s review repo, one commit.', how: 'Send to Signoff EE in Fabcheck. EE’s Revisions tab then tags a run as a revision (B.1 in the demo).' },
      { id: 'ee-fab', from: 'ee', to: 'fabcheck', kind: 'open', label: 'Open in Fabcheck',
        what: ['A stored run, its parts joined', 'Lands on the CAM viewer at the finding'], where: 'IndexedDB dovetail-handoff.', how: 'Open in Fabcheck from a finding or from Revisions.' },
      { id: 'part-me', from: 'partcheck', to: 'me', kind: 'send', label: 'Part views and mesh', branch: true,
        what: ['Four views of each part (front, right, top, and iso)', 'A PLM1 mesh for PL’s Exploded and 3D views'],
        where: 'partcheck/<review>/preview/ in the part’s ME repo.', how: 'Send to Signoff ME in Partcheck. Not merged yet: branch me-send.' },
      { id: 'ee-pl', from: 'ee', to: 'pl', kind: 'summary', label: 'Board summary',
        what: ['Progress (' + M7.pct + '% on the Main PCBA) and open issues by severity', 'Requirements (reqList), revisions (' + (M7.revs.join(', ') || 'none') + '), and rework counts', 'Recent discussion (the six latest comments) and Scribe gists'],
        where: 'project.summary in each review file. PL reads only meta and summary.', how: 'Written at every sync where someone edited the review; never merged, always derived.' },
      { id: 'me-pl', from: 'me', to: 'pl', kind: 'summary', label: 'Part summary',
        what: ['Progress and open issues', 'Part or assembly (summary.kind)', 'Requirement evidence, such as the enclosure’s mass, which matches PL’s 205.2 g'],
        where: 'project.summary in each ME review.', how: 'At sync, as EE.' },
      { id: 'fw-pl', from: 'fw', to: 'pl', kind: 'summary', label: 'Firmware summary',
        what: ['Progress and open issues', 'Releases (' + ((FWD.rels || []).join(', ') || 'none') + ')', 'Scribe gists and review notes'],
        where: 'project.summary, including summary.releases.', how: 'At sync. PL shows Firmware releases in a Part’s inspector.' },
      { id: 'loom-pl', from: 'loom', to: 'pl', kind: 'summary', label: 'Harness as a Part',
        what: ['A harness file shaped like a review, so PL’s reader reads it', 'The wiring diagram as PNGs, light and dark', 'Name and part number, both ways, newer wins'],
        where: 'loom_data, drawings under drawing/<id>/preview/.', how: 'The harness names its client project, waits in PL’s tray, and becomes a Part under Harnesses.' },
      { id: 'ee-loom', from: 'ee', to: 'loom', kind: 'summary', label: 'Board connectors',
        what: ['The stored fab package of the latest tagged revision (else the latest run)', 'Connectors from the pick-and-place, with net names', 'The board outline for a system'],
        where: 'Read from the board’s review repo; Loom never writes there.', how: 'From a board in Loom, and Refresh from Signoff EE on a system.' },
      { id: 'fab-pl', from: 'fabcheck', to: 'pl', kind: 'summary', label: 'Board pictures and size', route: 'gap',
        what: ['Top and bottom renders for the Part’s tile', 'The board size, for the 3D Exploded view'], where: 'The run’s preview index.json, in the board’s review repo.', how: 'PL picks them up through the EE review it links.' },
      { id: 'fw-flash', from: 'fw', to: 'flasher', kind: 'summary', label: 'Firmware releases',
        what: ['release.json and the image files (parts over 4 MB)', 'The target board, so a bootloader for another board stops before any write'],
        where: 'releases/<review>/<release>/ in the firmware’s review repo.', how: 'Open in Flasher on a release (?release=<review>/<release>), or pick it in Flasher’s sidebar.' },
      { id: 'pl-ee-req', from: 'pl', to: 'ee', kind: 'reqs', label: 'Flow-down',
        what: ['Requirement records with discipline and parent (the system requirement)', 'Written into the review, record by record'], where: 'The board’s review file (GitHubStore.patchRecords).', how: 'Allocate a system requirement to a Part in PL’s Requirements tab.' },
      { id: 'pl-me-req', from: 'pl', to: 'me', kind: 'reqs', label: 'Flow-down',
        what: ['Requirement records with a parent', 'The mass requirement on the enclosure, for one'], where: 'The part’s review file.', how: 'As for EE.' },
      { id: 'pl-fw-req', from: 'pl', to: 'fw', kind: 'reqs', label: 'Flow-down',
        what: ['REQ-001 and REQ-002, the OTA and ESD flow-down in the demo'], where: 'The firmware’s review file.', how: 'As for EE.' },
      { id: 'pl-ee-tray', from: 'pl', to: 'ee', kind: 'tray', label: 'Placeholders',
        what: ['Parts marked Placeholder for EE wait under From Signoff PL', 'Start opens New design review, filled in'], where: 'Read from signoff_pl_data at sync (FTEs).', how: 'PL links the Part at its next sync (summary.plPart).' },
      { id: 'pl-me-tray', from: 'pl', to: 'me', kind: 'tray', label: 'Placeholders', what: ['Parts marked Placeholder for ME'], where: 'As for EE.', how: 'As for EE.' },
      { id: 'pl-fw-tray', from: 'pl', to: 'fw', kind: 'tray', label: 'Placeholders', what: ['Parts marked Placeholder for FW'], where: 'As for EE.', how: 'As for EE.' },
      { id: 'pl-loom-tray', from: 'pl', to: 'loom', kind: 'tray', label: 'Placeholders', what: ['Parts marked Placeholder for Loom, such as a harness still to draw'], where: 'As for EE.', how: 'Start makes the harness, which names the Part.' }
    ];
    var FLOW = {}; FLOWS.forEach(function (f) { FLOW[f.id] = f; });

    var SERVICES = [
      { id: 'signin', name: 'Sign in with GitHub', tools: ['hub', 'pl', 'ee', 'me', 'fw', 'fabcheck', 'pincheck', 'partcheck', 'loom', 'flasher'],
        text: 'One sign-in for the suite: a GitHub App and a token exchange Worker. Each tool keeps the same token keys, so signing in from one signs in everywhere on the same site.' },
      { id: 'people', name: 'People & access', tools: ['hub', 'pl', 'ee', 'me', 'fw', 'fabcheck', 'loom', 'partcheck'],
        text: 'One sheet over the current page with a tab per review tool; each tool keeps its own users.json. FTE, Client, and Contractor; a client or contractor sees only what’s shared.' },
      { id: 'tickets', name: 'Tickets', tools: ['hub', 'pl', 'ee', 'me', 'fw', 'fabcheck', 'partcheck', 'loom', 'flasher'],
        text: 'Open ticket… from the ⋯ menu on any page. One file per ticket in signoff_tickets.' },
      { id: 'history', name: 'History and version tags', tools: ['ee', 'me', 'fw', 'pl', 'loom'],
        text: 'One History engine (history.js): git versions of a review, compared record by record, with version tags and Version comparison.' },
      { id: 'engine', name: 'The shared engine', tools: ['ee', 'me', 'fw', 'pl', 'fabcheck', 'loom', 'flasher', 'pincheck', 'partcheck', 'hub'],
        text: 'EE is the source of model.js, github.js, auth.js, and styles.css. ME and FW copy all of it; PL, Fabcheck, Loom, Flasher, Pincheck, Partcheck, and the hub vendor what they use. So every tool merges, syncs, and draws the same way.' }
    ];

    // ---- The story (drives Play in every view) -------------------------------------------------------
    var STORY = [
      { t: 'Requirements first', x: 'Signoff PL holds the system requirements and allocates them to Parts. Each allocation is written into that design’s review as a requirement with a parent.', flows: ['pl-ee-req', 'pl-me-req', 'pl-fw-req'], arts: ['reqs', 'eerev', 'enc', 'fwrev'], nodes: ['prod', 'm7', 'enc', 'fw'] },
      { t: 'Placeholders wait in each tool', x: 'A Part that has no design yet is a Placeholder for EE, ME, FW, or Loom. It waits in that tool’s tray until someone starts it, and PL links it at its next sync.', flows: ['pl-ee-tray', 'pl-me-tray', 'pl-fw-tray', 'pl-loom-tray'], arts: ['reqs', 'har'], nodes: ['har'] },
      { t: 'Check the schematic', x: 'Pincheck checks the Main PCBA’s schematic against its part library and sends what it found into EE’s Schematic Review checklist.', flows: ['pin-ee', 'ee-pin'], arts: ['sch', 'eerev'], nodes: ['m7'] },
      { t: 'Review the board', x: 'EE’s checklists, Scribe, and comments. Every sync writes the board’s summary, which is all PL reads.', flows: ['ee-pl'], arts: ['eerev', 'whole'], nodes: ['m7', 'm11', 'prod'] },
      { t: 'Check the fab package', x: 'Fabcheck runs the package; Send stores the run, the zip, and pictures in the board’s repo. EE tags it as revision B.1, and Open in Fabcheck takes any finding back to the CAM viewer.', flows: ['fab-ee', 'ee-fab'], arts: ['fab', 'revb'], nodes: ['m7', 'm11'] },
      { t: 'Pictures for the whole product', x: 'The run’s renders and board size reach PL through the EE review, for the Part’s tile and the 3D Exploded view.', flows: ['fab-pl'], arts: ['fab', 'whole'], nodes: ['m7', 'm11', 'prod'] },
      { t: 'Wire it', x: 'Loom’s From a board reads revision B.1’s connectors. The thermostat harness starts at Main PCBA J1 (AC_N, AC_L) and becomes a Part in PL.', flows: ['ee-loom', 'loom-pl'], arts: ['revb', 'har', 'whole'], nodes: ['har', 'm7'] },
      { t: 'Mechanical parts', x: 'Partcheck sends the enclosure’s views and mesh into its ME review (still on a branch). ME’s summary carries the mass evidence PL totals to 205.2 g.', flows: ['part-me', 'me-pl'], arts: ['pcv', 'enc', 'whole'], nodes: ['enc', 'brk', 'prod'] },
      { t: 'Release firmware', x: 'Signoff FW publishes release 0.9.0. Flasher lists it and writes it to a Main PCBA over USB; PL shows it under Firmware releases.', flows: ['fw-flash', 'fw-pl'], arts: ['fwrev', 'fwr', 'fl', 'whole'], nodes: ['fw', 'm7'] },
      { t: 'Bring-up', x: 'EE’s Rework list tracks the board changes on the bench. Its counts ride in the summary.', flows: ['ee-pl'], arts: ['revb', 'rw', 'whole'], nodes: ['m7'] },
      { t: 'One place to see it all', x: 'PL rolls every design up: progress, open issues, requirements, discussion, revisions, and releases, with the tools still the home of their own data.', flows: ['ee-pl', 'me-pl', 'fw-pl', 'loom-pl', 'fab-pl'], arts: ['whole'], nodes: ['prod', 'm7', 'm11', 'enc', 'brk', 'fw', 'har'] }
    ];

    // ---- State ---------------------------------------------------------------------------------------
    var VIEWS = [['graph', 'Tool graph'], ['project', 'Project tree'], ['life', 'Lifecycle'], ['store', 'Where it lives'], ['matrix', 'Matrix']];
    if (opts.views) VIEWS = opts.views.map(function (id) { return VIEWS.filter(function (v) { return v[0] === id; })[0]; }).filter(Boolean);
    var STORE = opts.storeKey || 'signoff.structure.view';
    var st = { view: VIEWS[0][0], sel: null, hover: null, step: -1, labels: false, kinds: {} };
    Object.keys(KINDS).forEach(function (k) { st.kinds[k] = true; });
    try { var saved = localStorage.getItem(STORE); if (saved && VIEWS.some(function (v) { return v[0] === saved; })) st.view = saved; } catch (e) { /* no storage */ }

    function flowOn(f) { return st.kinds[f.kind] !== false; }
    function storyStep() { return st.step >= 0 ? STORY[st.step] : null; }

    // The flows and tools to light, from the selection, the hover, or the story step.
    function focus() {
      var flows = {}, tools = {}, any = false, s = st.hover || st.sel, step = storyStep();
      if (step) { any = true; step.flows.forEach(function (id) { flows[id] = 1; tools[FLOW[id].from] = 1; tools[FLOW[id].to] = 1; }); }
      if (s) {
        any = true;
        if (s.type === 'tool') { tools[s.id] = 2; FLOWS.forEach(function (f) { if (flowOn(f) && (f.from === s.id || f.to === s.id)) { flows[f.id] = 1; tools[f.from] = tools[f.from] || 1; tools[f.to] = tools[f.to] || 1; } }); }
        if (s.type === 'flow') { flows[s.id] = 2; tools[FLOW[s.id].from] = 1; tools[FLOW[s.id].to] = 1; }
        if (s.type === 'service') { SERVICES.filter(function (x) { return x.id === s.id; })[0].tools.forEach(function (t) { tools[t] = 1; }); }
      }
      return { any: any, flows: flows, tools: tools };
    }

    // ---- Geometry helpers ----------------------------------------------------------------------------
    function el(tag, attrs, parent) { var n = document.createElementNS(SVGNS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; }
    // Anchor on the side of box b facing point p, shifted along that side by off.
    function anchor(b, p, off) {
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = p.x - cx, dy = p.y - cy;
      if (Math.abs(dy) * b.w > Math.abs(dx) * b.h) { var sy = dy > 0 ? 1 : -1; return { x: cx + off, y: cy + sy * b.h / 2, nx: 0, ny: sy }; }
      var sx = dx > 0 ? 1 : -1; return { x: cx + sx * b.w / 2, y: cy + off, nx: sx, ny: 0 };
    }
    function curve(a, b, A, B) {
      var p0 = anchor(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, A || 0), p3 = anchor(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 }, B || 0);
      var gap = 3; p3 = { x: p3.x + p3.nx * gap, y: p3.y + p3.ny * gap, nx: p3.nx, ny: p3.ny };
      var d = Math.hypot(p3.x - p0.x, p3.y - p0.y), k = Math.max(30, d * 0.38);
      var c1 = { x: p0.x + p0.nx * k, y: p0.y + p0.ny * k }, c2 = { x: p3.x + p3.nx * k, y: p3.y + p3.ny * k };
      // Links that share a pair of boxes put their labels at different points along the curve.
      var mid = bez(p0, c1, c2, p3, Math.max(0.25, Math.min(0.75, 0.5 + (A || 0) / 60)));
      return { d: 'M' + p0.x + ' ' + p0.y + 'C' + c1.x + ' ' + c1.y + ' ' + c2.x + ' ' + c2.y + ' ' + p3.x + ' ' + p3.y, p3: p3, c2: c2, mid: mid };
    }
    function bez(a, b, c, d, t) { var u = 1 - t; return { x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y }; }

    // Draw one link into g: path, arrowhead, hit line, label, and beads when lit.
    var edgeSeq = 0;
    function drawEdge(g, geo, opts) {
      var grp = el('g', { class: 'eg' + (opts.hl ? ' hl' : '') + (opts.branch ? ' branch' : '') }, g);
      var id = 'ss-ep' + (++edgeSeq);
      var K = opts.kinds[opts.kind];
      el('path', { id: id, class: 'e k-' + opts.kind, d: geo.d }, grp);
      var ux = geo.p3.x - geo.c2.x, uy = geo.p3.y - geo.c2.y, L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
      var tip = { x: geo.p3.x + ux * 1, y: geo.p3.y + uy * 1 }, bx = tip.x - ux * 9, by = tip.y - uy * 9, px = -uy * 5, py = ux * 5;
      if (K && K.open) el('path', { class: 'head open', d: 'M' + (bx + px) + ' ' + (by + py) + 'L' + tip.x + ' ' + tip.y + 'L' + (bx - px) + ' ' + (by - py) }, grp);
      else el('path', { class: 'head', d: 'M' + tip.x + ' ' + tip.y + 'L' + (bx + px) + ' ' + (by + py) + 'L' + (bx - px) + ' ' + (by - py) + 'Z' }, grp);
      if (opts.hl && !REDUCED) {
        for (var i = 0; i < 2; i++) {
          var c = el('circle', { class: 'bead', r: 3.6 }, grp);
          var am = el('animateMotion', { dur: '2.4s', repeatCount: 'indefinite', begin: (-i * 1.2) + 's' }, c);
          el('mpath', { href: '#' + id }, am);
        }
      }
      if (opts.label) {
        var lab = el('g', { class: 'elab' }, grp), w = opts.label.length * 6.2 + 14;
        el('rect', { x: geo.mid.x - w / 2, y: geo.mid.y - 10, width: w, height: 20, rx: 6 }, lab);
        var tx = el('text', { x: geo.mid.x, y: geo.mid.y + 4, 'text-anchor': 'middle' }, lab); tx.textContent = opts.label;
      }
      if (opts.onHit) {
        var hit = el('path', { class: 'hit', d: geo.d, fill: 'none', stroke: 'transparent', 'stroke-width': 14 }, grp);
        hit.addEventListener('mouseenter', function () { opts.onHit('enter'); });
        hit.addEventListener('mouseleave', function () { opts.onHit('leave'); });
        hit.addEventListener('click', function (e) { e.stopPropagation(); opts.onHit('click'); });
      }
      return grp;
    }

    // Offsets for links that share a pair of boxes.
    function pairOffsets(list) {
      var groups = {};
      list.forEach(function (f) { var k = [f.from, f.to].sort().join('|'); (groups[k] = groups[k] || []).push(f); });
      var off = {};
      Object.keys(groups).forEach(function (k) { var g = groups[k]; g.forEach(function (f, i) { var o = (i - (g.length - 1) / 2) * 18; off[f.id] = f.from < f.to ? o : -o; }); });
      return off;
    }

    // ---- Fixed stages, scaled to fit -----------------------------------------------------------------
    function stage(W, H) {
      var wrap = document.createElement('div'); wrap.className = 'stage-wrap';
      var sizer = document.createElement('div'); sizer.style.overflow = 'hidden';
      var s = document.createElement('div'); s.className = 'stage'; s.style.width = W + 'px'; s.style.height = H + 'px';
      sizer.appendChild(s); wrap.appendChild(sizer);
      // The sizer takes the scaled size, so the page scrolls sideways only below the smallest scale.
      function fit() {
        var avail = wrap.clientWidth || W, k = Math.max(0.5, Math.min(1, avail / W));
        s.style.transform = 'scale(' + k + ')'; sizer.style.width = (W * k) + 'px'; sizer.style.height = (H * k) + 'px';
      }
      return { wrap: wrap, el: s, fit: fit };
    }

    // A grid: four columns and three rows, every card the same size, so rows share their tops and bottoms.
    var GCOL = [110, 380, 650, 920], GROW = [100, 390, 660];
    var GPOS = {
      loom: [GCOL[1], GROW[0]], pl: [GCOL[2], GROW[0]], hub: [GCOL[3], GROW[0]],
      pincheck: [GCOL[0], GROW[1]], ee: [GCOL[1], GROW[1]], me: [GCOL[2], GROW[1]], fw: [GCOL[3], GROW[1]],
      fabcheck: [GCOL[1], GROW[2]], partcheck: [GCOL[2], GROW[2]], flasher: [GCOL[3], GROW[2]]
    };
    var GSW = 1030, GSH = 760;
    var GW = 172, GH = 146;

    function toolCard(id, cls, x, y) {
      var t = TOOLS[id], b = document.createElement('button');
      b.type = 'button'; b.className = 'gnode' + (cls || ''); b.dataset.tool = id;
      b.style.left = x + 'px'; b.style.top = y + 'px';
      b.innerHTML = (cls ? '' : t.art) + '<div class="nm">' + mark(id) + esc(t.name) + '</div>' + (cls ? '' : '<div class="rl">' + esc(t.role) + '</div>') +
        (t.badge && !cls ? '<span class="badge">' + esc(t.badge) + '</span>' : '');
      b.addEventListener('click', function (e) { e.stopPropagation(); select({ type: 'tool', id: id }); });
      b.addEventListener('mouseenter', function () { hover({ type: 'tool', id: id }); });
      b.addEventListener('mouseleave', function () { hover(null); });
      return b;
    }

    function renderGraph(root) {
      var svc = document.createElement('div'); svc.className = 'services';
      svc.innerHTML = '<span>Shared by the tools:</span>' + SERVICES.map(function (s) {
        return '<button class="svc' + (st.sel && st.sel.type === 'service' && st.sel.id === s.id ? ' sel' : '') + '" data-svc="' + s.id + '">' + esc(s.name) + '</button>';
      }).join('');
      svc.addEventListener('click', function (e) { var b = e.target.closest('[data-svc]'); if (b) { e.stopPropagation(); select({ type: 'service', id: b.dataset.svc }); } });
      root.appendChild(svc);

      var S = stage(GSW, GSH); root.appendChild(S.wrap);
      var F = focus();
      S.el.classList.toggle('dim', F.any); S.el.classList.toggle('labels-on', st.labels);
      var svg = el('svg', { class: 'edges', width: GSW, height: GSH }); S.el.appendChild(svg);
      var box = {};
      Object.keys(GPOS).forEach(function (id) {
        var p = GPOS[id], x = p[0] - GW / 2, y = p[1] - GH / 2; box[id] = { x: x, y: y, w: GW, h: GH };
        var c = toolCard(id, '', x, y);
        if (F.tools[id] === 2) c.classList.add('sel-node'); else if (F.tools[id]) c.classList.add('hl-node');
        S.el.appendChild(c);
      });
      var list = FLOWS.filter(flowOn), off = pairOffsets(list);
      // Lit links last, so they draw on top.
      list.sort(function (a, b) { return (F.flows[a.id] ? 1 : 0) - (F.flows[b.id] ? 1 : 0); });
      list.forEach(function (f) {
        var o = off[f.id] || 0, geo = f.route === 'gap' ? gapRoute(box[f.from], box[f.to], box.ee, box.me) : curve(box[f.from], box[f.to], o, -o);
        drawEdge(svg, geo, { kind: f.kind, kinds: KINDS, hl: !!F.flows[f.id], branch: f.branch, label: f.label + (f.branch ? ' (branch)' : ''), onHit: hitFlow(f.id) });
      });
      S.fit(); fitters.push(S.fit);
    }

    // Out of a's right side, swinging up through the gap between the columns of l and r, and into the bottom
    // of b where the other summaries arrive: a curve that runs clear of the cards in its way. Two curves that meet
    // upright in the gap. (Fabcheck to PL: a plain curve from under EE clips EE's corner.)
    function gapRoute(a, b, l, r) {
      var x0 = a.x + a.w, y0 = a.y + a.h / 2 + 24, gx = (l.x + l.w + r.x) / 2, bx = b.x + b.w / 2, by = b.y + b.h + 3;
      var my = l.y + l.h / 2;
      var d = 'M' + x0 + ' ' + y0 + 'C' + (gx - 20) + ' ' + y0 + ' ' + gx + ' ' + (y0 - 40) + ' ' + gx + ' ' + my +
        'C' + gx + ' ' + (my - (my - by) * 0.55) + ' ' + bx + ' ' + (by + 60) + ' ' + bx + ' ' + by;
      return { d: d, p3: { x: bx, y: by }, c2: { x: bx, y: by + 60 }, mid: { x: gx, y: my + 40 } };
    }

    function hitFlow(id) {
      return function (what) { if (what === 'enter') hover({ type: 'flow', id: id }); else if (what === 'leave') hover(null); else select({ type: 'flow', id: id }); };
    }

    // ---- Measured views ------------------------------------------------------------------------------
    // links: [{ a, b, kind, label, flow, hl }] between elements with data-key a and b inside root.
    function drawMeasured(root, links, kinds) {
      var old = root.querySelector(':scope > svg.links'); if (old) old.remove();
      var r0 = root.getBoundingClientRect();
      var svg = el('svg', { class: 'links' }); root.appendChild(svg);
      function boxOf(k) { var n = root.querySelector('[data-key="' + k + '"]'); if (!n || !n.offsetParent) return null; var r = n.getBoundingClientRect(); return { x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height }; }
      var off = pairOffsets(links.map(function (l, i) { return { id: i, from: l.a, to: l.b }; }));
      links.slice().sort(function (p, q) { return (p.hl ? 1 : 0) - (q.hl ? 1 : 0); }).forEach(function (l) {
        var a = boxOf(l.a), b = boxOf(l.b); if (!a || !b) return;
        var o = off[links.indexOf(l)] || 0;
        drawEdge(svg, curve(a, b, o, -o), { kind: l.kind, kinds: kinds, hl: l.hl, branch: l.branch, label: l.label, onHit: l.flow ? hitFlow(l.flow) : null });
      });
    }

    // Project tree: Signoff PL's map, with where each Part's data comes from and how the Parts relate.
    var NODES = {
      prod: { lane: null },
      m7: { lane: 'Electronics', tool: 'ee', d: M7, art: img('pdemo7-top.webp', 'Main PCBA'), chips: [['pincheck', 'Schematic check', 'pin-ee'], ['fabcheck', 'Run rdemo1042b', 'fab-ee'], ['ee', 'Revision ' + (M7.revs[0] || 'B.1'), 'fab-ee'], ['ee', (M7.rework || 5) + ' reworks', 'ee-pl']], flows: ['ee-pl', 'fab-ee', 'pin-ee', 'fab-pl', 'pl-ee-req'] },
      m11: { lane: 'Electronics', tool: 'ee', d: M11, art: img('pdemo11-top.webp', 'Display & Sensor Board'), chips: [['fabcheck', 'Run rdemo1043a', 'fab-ee']], flows: ['ee-pl', 'fab-ee', 'fab-pl'] },
      enc: { lane: 'Mechanical', tool: 'me', d: ENC, sub: 'Front cover and back cover', art: img('mdemo5-iso.webp', 'Enclosure'), chips: [['partcheck', 'Views and mesh', 'part-me'], ['me', 'Mass evidence', 'me-pl']], flows: ['me-pl', 'part-me', 'pl-me-req'] },
      brk: { lane: 'Mechanical', tool: 'me', d: BRK, art: img('mdemo13-iso.webp', 'Wall Bracket'), chips: [['partcheck', 'Views and mesh', 'part-me']], flows: ['me-pl', 'part-me'] },
      fw: { lane: 'Firmware', tool: 'fw', d: FWD, art: ART.fw, chips: [['fw', 'Release 0.9.0', 'fw-pl'], ['flasher', 'In Flasher', 'fw-flash']], flows: ['fw-pl', 'fw-flash', 'pl-fw-req'] },
      har: { lane: 'Harnesses', tool: 'loom', ph: true, d: { name: 'Thermostat harness', number: 'Placeholder for Loom' }, art: ART.loom, chips: [['loom', 'From Main PCBA J1', 'ee-loom']], flows: ['pl-loom-tray', 'ee-loom', 'loom-pl'] }
    };
    var PLINKS = [
      { a: 'm11', b: 'm7', kind: 'elec', label: 'FFC' },
      { a: 'har', b: 'm7', kind: 'elec', label: 'J1: AC_N, AC_L' },
      { a: 'fw', b: 'm7', kind: 'fw', label: 'Runs on' },
      { a: 'm7', b: 'enc', kind: 'mech', label: 'Mounts in' },
      { a: 'brk', b: 'enc', kind: 'mech', label: 'Holds' },
      { a: 'prod', b: 'fw', kind: 'req2', label: 'REQ-001, REQ-002' },
      { a: 'enc', b: 'prod', kind: 'req2', label: 'Mass evidence, 205.2 g' }
    ];

    function sevs(o) {
      o = o || {}; var h = '';
      if (o.critical) h += '<span class="sev c">' + o.critical + ' critical</span>';
      if (o.major) h += '<span class="sev m">' + o.major + ' major</span>';
      return h;
    }
    function chip(tool, text) { return '<span class="chip">' + mark(tool) + esc(text) + '</span>'; }

    function renderProject(root) {
      var F = focus(), step = storyStep();
      var lit = {};
      if (step) step.nodes.forEach(function (k) { lit[k] = 1; });
      if (st.sel && st.sel.type === 'node') lit[st.sel.id] = 2;
      // A selected tool or flow lights the Parts it touches.
      Object.keys(NODES).forEach(function (k) { var n = NODES[k]; if (!n.flows) return; if (n.flows.some(function (f) { return F.flows[f]; }) || (st.sel && st.sel.type === 'tool' && n.tool === st.sel.id)) lit[k] = lit[k] || 1; });
      var any = Object.keys(lit).length > 0;
      var wrap = document.createElement('div'); wrap.className = 'measured' + (any ? ' dim' : '') + ' labels-on';
      var total = [M7, M11, ENC, BRK, FWD].reduce(function (a, d) { a.n += d.pct; return a; }, { n: 0 }).n / 5;
      var crit = [M7, M11, ENC, BRK, FWD].reduce(function (a, d) { return a + ((d.open || {}).critical || 0); }, 0);
      var maj = [M7, M11, ENC, BRK, FWD].reduce(function (a, d) { return a + ((d.open || {}).major || 0); }, 0);
      var h = '<div class="prod' + cls('prod') + '" data-key="prod" data-node="prod"><div class="art quad">' + img('pdemo7-top.webp') + img('mdemo5-iso.webp') + img('mdemo13-iso.webp') + '</div>' +
        '<div style="flex:1;min-width:0"><div class="t-pn">Acme Climate · Signoff PL</div><h2>Smart Thermostat</h2><div class="sub">5 linked designs, about ' + Math.round(total) + '% reviewed on average, 205.2 g</div>' +
        '<div class="t-meta" style="margin-top:6px">' + sevs({ critical: crit, major: maj }) + '<span>open across the designs</span></div></div></div>';
      var lanes = ['Electronics', 'Mechanical', 'Firmware', 'Harnesses'];
      h += '<div class="lanes">' + lanes.map(function (ln) {
        return '<div class="lane"><div class="lane-h">' + ln + '</div>' + Object.keys(NODES).filter(function (k) { return NODES[k].lane === ln; }).map(function (k) {
          var n = NODES[k], d = n.d;
          return '<button type="button" class="tile' + (n.ph ? ' ph' : '') + cls(k) + '" data-key="' + k + '" data-node="' + k + '"><div class="art">' + n.art + '</div>' +
            '<div><div class="t-name">' + esc(d.name) + ' <span class="tool-pill">' + esc(TOOLS[n.tool].name.replace('Signoff ', '')) + '</span></div>' +
            '<div class="t-pn">' + esc(d.number) + (d.revision ? ' · rev ' + esc(d.revision) : '') + (n.sub ? ' · ' + esc(n.sub) : '') + '</div></div>' +
            (d.pct != null ? '<div class="pbar"><i style="width:' + d.pct + '%"></i></div><div class="t-meta"><span>' + d.pct + '% · ' + esc(d.stage) + '</span>' + sevs(d.open) + '</div>' : '') +
            '<div class="chips">' + n.chips.map(function (c) { return chip(c[0], c[1]); }).join('') + '</div></button>';
        }).join('') + '</div>';
      }).join('') + '</div>';
      wrap.innerHTML = h;
      function cls(k) { return lit[k] === 2 ? ' sel-node' : lit[k] ? ' hl-node' : ''; }
      wrap.addEventListener('click', function (e) { var t = e.target.closest('[data-node]'); if (t) { e.stopPropagation(); select({ type: 'node', id: t.dataset.node }); } });
      root.appendChild(wrap);
      var links = PLINKS.map(function (l) { return { a: l.a, b: l.b, kind: l.kind, label: l.label, hl: lit[l.a] === 2 || lit[l.b] === 2 || (!!step && lit[l.a] && lit[l.b]) }; });
      var draw = function () { drawMeasured(wrap, links, PROJ_KINDS); };
      requestAnimationFrame(draw); fitters.push(draw);
      wrap.querySelectorAll('img').forEach(function (i) { if (!i.complete) i.addEventListener('load', draw, { once: true }); });
    }

    // Lifecycle: tools as lanes, stages left to right, what each makes as a tile.
    var LANES = ['pl', 'pincheck', 'ee', 'fabcheck', 'partcheck', 'me', 'loom', 'fw', 'flasher'];
    var STAGES = ['Requirements and schematic', 'Layout and fab', 'Build', 'Bring-up and release', 'Product'];
    var ARTS = [
      { id: 'reqs', lane: 'pl', col: 0, t: 'System requirements', s: 'Allocated to Parts' },
      { id: 'sch', lane: 'pincheck', col: 0, t: 'Schematic check', s: 'Main PCBA' },
      { id: 'eerev', lane: 'ee', col: 0, t: 'Main PCBA review', s: M7.pct + '% reviewed' },
      { id: 'fwrev', lane: 'fw', col: 1, t: 'Firmware review', s: FWD.pct + '%, Scribe and requirements' },
      { id: 'fab', lane: 'fabcheck', col: 1, t: 'Fab package run', s: 'rdemo1042b' },
      { id: 'pcv', lane: 'partcheck', col: 1, t: 'Enclosure views', s: 'Four views and a mesh' },
      { id: 'revb', lane: 'ee', col: 2, t: 'Revision ' + (M7.revs[0] || 'B.1'), s: 'Tagged from the run' },
      { id: 'enc', lane: 'me', col: 2, t: 'Enclosure review', s: ENC.stage + ', ' + ENC.pct + '%' },
      { id: 'har', lane: 'loom', col: 2, t: 'Thermostat harness', s: 'From Main PCBA J1' },
      { id: 'rw', lane: 'ee', col: 3, t: 'Bring-up rework', s: (M7.rework || 5) + ' reworks' },
      { id: 'fwr', lane: 'fw', col: 3, t: 'Release 0.9.0', s: 'Released' },
      { id: 'fl', lane: 'flasher', col: 3, t: 'Flash a Main PCBA', s: 'Release 0.9.0 over USB' },
      { id: 'whole', lane: 'pl', col: 4, t: 'The whole product', s: 'Roll-up, BOM, and 205.2 g' }
    ];
    var ALINKS = [
      { a: 'reqs', b: 'eerev', flow: 'pl-ee-req' }, { a: 'reqs', b: 'fwrev', flow: 'pl-fw-req' }, { a: 'reqs', b: 'enc', flow: 'pl-me-req' },
      { a: 'sch', b: 'eerev', flow: 'pin-ee' }, { a: 'fab', b: 'revb', flow: 'fab-ee' }, { a: 'revb', b: 'fab', flow: 'ee-fab' },
      { a: 'pcv', b: 'enc', flow: 'part-me' }, { a: 'revb', b: 'har', flow: 'ee-loom' },
      { a: 'eerev', b: 'revb', kind: 'local', label: 'Same review' }, { a: 'revb', b: 'rw', kind: 'local', label: 'Same review' }, { a: 'fwrev', b: 'fwr', kind: 'local', label: 'Publish' },
      { a: 'fwr', b: 'fl', flow: 'fw-flash' }, { a: 'rw', b: 'whole', flow: 'ee-pl' }, { a: 'enc', b: 'whole', flow: 'me-pl' },
      { a: 'har', b: 'whole', flow: 'loom-pl' }, { a: 'fwr', b: 'whole', flow: 'fw-pl' }, { a: 'reqs', b: 'har', flow: 'pl-loom-tray' }
    ];
    function renderLife(root) {
      var F = focus(), step = storyStep(), lit = {};
      if (step) step.arts.forEach(function (k) { lit[k] = 1; });
      if (st.sel && st.sel.type === 'art') lit[st.sel.id] = 2;
      var links = ALINKS.filter(function (l) { return !l.flow || flowOn(FLOW[l.flow]); }).map(function (l) {
        var f = l.flow && FLOW[l.flow], hl = !!(f && F.flows[f.id]) || lit[l.a] === 2 || lit[l.b] === 2;
        if (hl && !step) { lit[l.a] = lit[l.a] || 1; lit[l.b] = lit[l.b] || 1; }
        return { a: l.a, b: l.b, kind: l.kind || f.kind, label: l.label || f.label, flow: l.flow, branch: f && f.branch, hl: hl };
      });
      if (st.sel && st.sel.type === 'tool') ARTS.forEach(function (a) { if (a.lane === st.sel.id) lit[a.id] = lit[a.id] || 1; });
      var any = Object.keys(lit).length > 0 || F.any;
      var sc = document.createElement('div'); sc.className = 'life-scroll';
      var wrap = document.createElement('div'); wrap.className = 'measured life' + (any ? ' dim' : '') + (st.labels ? ' labels-on' : '');
      var h = '<div></div>' + STAGES.map(function (s) { return '<div class="lh">' + s + '</div>'; }).join('');
      LANES.forEach(function (ln) {
        h += '<div class="ll">' + mark(ln) + esc(TOOLS[ln].name.replace('Signoff ', '')) + '</div>';
        for (var c = 0; c < STAGES.length; c++) {
          h += '<div class="lc">' + ARTS.filter(function (a) { return a.lane === ln && a.col === c; }).map(function (a) {
            return '<button type="button" class="art-tile' + (lit[a.id] === 2 ? ' sel-node' : lit[a.id] ? ' hl-node' : '') + '" data-key="' + a.id + '" data-art="' + a.id + '"><b>' + esc(a.t) + '</b><span>' + esc(a.s) + '</span></button>';
          }).join('') + '</div>';
        }
      });
      wrap.innerHTML = h;
      wrap.addEventListener('click', function (e) { var t = e.target.closest('[data-art]'); if (t) { e.stopPropagation(); select({ type: 'art', id: t.dataset.art }); } });
      sc.appendChild(wrap); root.appendChild(sc);
      var draw = function () { drawMeasured(wrap, links, Object.assign({ local: { label: 'Within a tool', dash: '', w: 1.4 } }, KINDS)); };
      requestAnimationFrame(draw); fitters.push(draw);
    }

    // Where it lives: tool pages over the browser over the private data repos.
    var REPOS = [
      { id: 'r-pl', name: 'signoff_pl_data', items: ['projects/<id>.json', 'models/ (meshes, views, STEP)', 'users.json'], shared: 'review-pl-<slug>' },
      { id: 'r-ee', name: 'ee_design_review_data', items: ['projects/<id>.json', 'Fabcheck and Pincheck runs', 'rework/ pictures', 'users.json'], shared: 'review-ee-<slug>' },
      { id: 'r-me', name: 'me_design_review_data', items: ['projects/<id>.json', 'partcheck/<review>/preview/', 'users.json'], shared: 'review-me-<slug>' },
      { id: 'r-fw', name: 'fw_design_review_data', items: ['projects/<id>.json', 'releases/<review>/<release>/', 'users.json'], shared: 'review-fw-<slug>' },
      { id: 'r-loom', name: 'loom_data', items: ['projects/ (harnesses)', 'systems/, formboards/', 'parts/', 'drawing/<id>/preview/'], shared: 'review-loom-<slug>' },
      { id: 'r-pin', name: 'pincheck_data', items: ['The part library', 'scans/'] },
      { id: 'r-flash', name: 'flasher_data', items: ['manifest.json', 'firmware/<board>/', 'users.json'], shared: 'review-flasher-<project>' },
      { id: 'r-tk', name: 'signoff_tickets', items: ['One file per ticket'] }
    ];
    var BCHIPS = [
      { id: 'b-handoff', name: 'dovetail-handoff', text: 'IndexedDB. A stored run, passed from EE to Fabcheck or Pincheck in the same tab.' },
      { id: 'b-settings', name: 'signoff.v1.*', text: 'localStorage. Settings, theme, and the sign-in every tool shares.' },
      { id: 'b-copies', name: 'Each tool’s working copy', text: 'Edits live here until Sync; a reload never loses them.' }
    ];
    var RW = [
      ['pl', 'r-pl', 'write', 'Projects and models'], ['pl', 'r-ee', 'read', 'Summaries'], ['pl', 'r-me', 'read', 'Summaries'], ['pl', 'r-fw', 'read', 'Summaries'], ['pl', 'r-loom', 'read', 'Harnesses'],
      ['pl', 'r-ee', 'write', 'Requirements'], ['pl', 'r-me', 'write', 'Requirements'], ['pl', 'r-fw', 'write', 'Requirements'],
      ['ee', 'r-ee', 'write', 'Reviews'], ['ee', 'r-pl', 'read', 'Placeholders'], ['me', 'r-me', 'write', 'Reviews'], ['me', 'r-pl', 'read', 'Placeholders'],
      ['fw', 'r-fw', 'write', 'Reviews and releases'], ['fw', 'r-pl', 'read', 'Placeholders'],
      ['fabcheck', 'r-ee', 'write', 'Runs and packages'], ['pincheck', 'r-ee', 'write', 'Runs'], ['pincheck', 'r-pin', 'write', 'Library and scans'],
      ['partcheck', 'r-me', 'write', 'Views and mesh (branch)', true],
      ['loom', 'r-loom', 'write', 'Harnesses and systems'], ['loom', 'r-ee', 'read', 'Fab packages'], ['loom', 'r-pl', 'read', 'Placeholders'],
      ['flasher', 'r-flash', 'read', 'Firmware list'], ['flasher', 'r-fw', 'read', 'Releases'],
      ['hub', 'r-tk', 'write', 'Tickets'],
      ['ee', 'b-handoff', 'write', 'Hand a run over'], ['fabcheck', 'b-handoff', 'read', 'Open a run'], ['pincheck', 'b-handoff', 'read', 'Open a run']
    ];
    function renderStore(root) {
      var S = stage(1200, 740); root.appendChild(S.wrap);
      var sel = st.hover || st.sel, step = storyStep(), litT = {}, litR = {}, active = [];
      var stepTools = {}; if (step) step.flows.forEach(function (id) { stepTools[FLOW[id].from] = 1; stepTools[FLOW[id].to] = 1; });
      RW.forEach(function (r, i) {
        var on = (sel && sel.type === 'tool' && sel.id === r[0]) || (sel && sel.type === 'repo' && sel.id === r[1]) || (!sel && step && stepTools[r[0]]);
        if (on) { active.push(i); litT[r[0]] = 1; litR[r[1]] = 1; }
      });
      if (sel && sel.type === 'tool') litT[sel.id] = 2;
      if (sel && sel.type === 'repo') litR[sel.id] = 2;
      var any = active.length > 0;
      S.el.classList.toggle('dim', any); S.el.classList.toggle('labels-on', st.labels);
      function lbl(text, x, y) { var d = document.createElement('div'); d.className = 'band-label'; d.textContent = text; d.style.left = x + 'px'; d.style.top = y + 'px'; S.el.appendChild(d); }
      function band(x, y, w, h) { var d = document.createElement('div'); d.className = 'band'; Object.assign(d.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); S.el.appendChild(d); }
      band(0, 24, 1200, 104); lbl('Tool pages (public, GitHub Pages)', 12, 4);
      band(0, 238, 1200, 92); lbl('Your browser', 12, 218);
      band(0, 470, 1200, 250); lbl('Private data repos (one per tool, plus review-* repos for what’s shared)', 12, 450);
      var box = {}, ids = ['hub', 'pl', 'ee', 'me', 'fw', 'fabcheck', 'pincheck', 'partcheck', 'loom', 'flasher'];
      ids.forEach(function (id, i) {
        var x = 14 + i * 118, y = 44; box[id] = { x: x, y: y, w: 112, h: 64 };
        var c = toolCard(id, ' small', x, y);
        if (litT[id] === 2) c.classList.add('sel-node'); else if (litT[id]) c.classList.add('hl-node');
        S.el.appendChild(c);
      });
      BCHIPS.forEach(function (b, i) {
        var x = 120 + i * 340, y = 254, d = document.createElement('div'); d.className = 'bchip' + (litR[b.id] ? ' hl-node' : ''); d.style.left = x + 'px'; d.style.top = y + 'px';
        d.innerHTML = '<b>' + esc(b.name) + '</b>' + esc(b.text); S.el.appendChild(d); box[b.id] = { x: x, y: y, w: 250, h: 60 };
      });
      REPOS.forEach(function (r, i) {
        var x = 18 + i * 147, y = 492, d = document.createElement('div');
        d.className = 'repo' + (litR[r.id] === 2 ? ' sel-node' : litR[r.id] ? ' hl-node' : ''); d.style.left = x + 'px'; d.style.top = y + 'px';
        d.innerHTML = '<b>' + esc(r.name) + '</b><ul>' + r.items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' + (r.shared ? '<div class="shared">+ ' + esc(r.shared) + '</div>' : '');
        d.addEventListener('click', function (e) { e.stopPropagation(); select({ type: 'repo', id: r.id }); });
        d.addEventListener('mouseenter', function () { hover({ type: 'repo', id: r.id }); });
        d.addEventListener('mouseleave', function () { hover(null); });
        S.el.appendChild(d); box[r.id] = { x: x, y: y, w: 132, h: 190 };
      });
      var svg = el('svg', { class: 'edges', width: 1200, height: 740 }); S.el.insertBefore(svg, S.el.querySelector('.gnode'));
      var list = RW.map(function (r, i) { return { id: i, from: r[0], to: r[1], r: r }; });
      var off = pairOffsets(list);
      list.sort(function (a, b) { return (active.indexOf(a.id) >= 0) - (active.indexOf(b.id) >= 0); }).forEach(function (l) {
        var r = l.r, write = r[2] === 'write', a = write ? box[r[0]] : box[r[1]], b = write ? box[r[1]] : box[r[0]];
        var o = off[l.id] || 0;
        drawEdge(svg, curve(a, b, o, -o), { kind: r[2], kinds: STORE_KINDS, hl: active.indexOf(l.id) >= 0, branch: r[4], label: r[3] });
      });
      S.fit(); fitters.push(S.fit);
    }

    // Matrix: who sends what to whom.
    function renderMatrix(root) {
      var ids = ['pl', 'ee', 'me', 'fw', 'fabcheck', 'pincheck', 'partcheck', 'loom', 'flasher'];
      var h = '<p class="note" style="margin:0 0 8px">Rows send, columns receive. Each button is one flow; the line beside it is its kind.</p><div class="mx-scroll"><table class="mx"><thead><tr><th></th>' +
        ids.map(function (c) { return '<th>' + mark(c) + '<div>' + esc(TOOLS[c].name.replace('Signoff ', '')) + '</div></th>'; }).join('') + '</tr></thead><tbody>';
      ids.forEach(function (r) {
        h += '<tr><th>' + esc(TOOLS[r].name) + '</th>' + ids.map(function (c) {
          if (r === c) return '<td class="self"></td>';
          return '<td>' + FLOWS.filter(function (f) { return flowOn(f) && f.from === r && f.to === c; }).map(function (f) {
            return '<button data-flow="' + f.id + '" title="' + esc(KINDS[f.kind].label) + '">' + kindSample(f.kind) + esc(f.label) + '</button>';
          }).join('') + '</td>';
        }).join('') + '</tr>';
      });
      root.innerHTML = h + '</tbody></table></div>';
      root.addEventListener('click', function (e) { var b = e.target.closest('[data-flow]'); if (b) { e.stopPropagation(); select({ type: 'flow', id: b.dataset.flow }); } });
    }

    // ---- Inspector -----------------------------------------------------------------------------------
    function flowRow(f, from) {
      return '<button class="fl" data-flow="' + f.id + '">' + kindSample(f.kind) + '<span>' + (from ? '<span class="arrow">from</span> ' + esc(TOOLS[f.from].name) : '<span class="arrow">to</span> ' + esc(TOOLS[f.to].name)) +
        ': ' + esc(f.label) + (f.branch ? ' (branch)' : '') + '</span></button>';
    }
    function legend() {
      var h = '<h3>Lines</h3><div class="legend">';
      var K = st.view === 'project' ? PROJ_KINDS : st.view === 'store' ? STORE_KINDS : KINDS;
      Object.keys(K).forEach(function (k) { h += kindSample(k, K) + '<span>' + esc(K[k].label) + '</span>'; });
      return h + '</div><p class="note" style="margin-top:8px">Lines differ by dash and arrowhead, not color. A faded line is work on a branch. The lit line is teal and heavier, with beads moving the way the data goes.</p>';
    }
    function renderSide() {
      var s = st.sel, h = '';
      if (!s) {
        h = '<h2>The suite</h2><p class="sub">Nine tools, each the home of its own data, linked by small contracts. Signoff PL sees the whole product by reading only each design’s summary.</p>' +
          '<p>Click a tool, a Part, a stage, a repo, or a line. <b>Play the story</b> walks the thermostat from requirements to a flashed board.</p>' +
          (FROM_SNAPSHOT ? '' : '<div class="warnbox">PL’s demo snapshot didn’t load, so the numbers are the built-in ones.</div>') + legend();
      } else if (s.type === 'tool') {
        var t = TOOLS[s.id];
        h = '<button class="x" data-x aria-label="Close">×</button><h2>' + mark(s.id) + esc(t.name) + '</h2><p class="sub">' + esc(t.role) + '. ' + esc(t.note) + '</p><div class="ins-art">' + t.art + '</div>' +
          '<h3>Data repo</h3><p><code>' + esc(t.repo) + '</code></p>';
        var out = FLOWS.filter(function (f) { return f.from === s.id; }), inn = FLOWS.filter(function (f) { return f.to === s.id; });
        if (out.length) h += '<h3>Sends</h3><div class="flist">' + out.map(function (f) { return flowRow(f, false); }).join('') + '</div>';
        if (inn.length) h += '<h3>Receives</h3><div class="flist">' + inn.map(function (f) { return flowRow(f, true); }).join('') + '</div>';
        var sv = SERVICES.filter(function (x) { return x.tools.indexOf(s.id) >= 0; });
        if (sv.length) h += '<h3>Shares</h3><p>' + sv.map(function (x) { return esc(x.name); }).join(', ') + '</p>';
      } else if (s.type === 'flow') {
        var f = FLOW[s.id];
        h = '<button class="x" data-x aria-label="Close">×</button><h2>' + esc(f.label) + '</h2><p class="sub">' + mark(f.from) + ' ' + esc(TOOLS[f.from].name) + ' → ' + esc(TOOLS[f.to].name) + ' · ' + esc(KINDS[f.kind].label) + '</p>' +
          (f.branch ? '<div class="warnbox">Built on branch me-send; not merged or pushed yet.</div>' : '') +
          '<h3>What moves</h3><ul class="what">' + f.what.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' +
          '<h3>Where it’s kept</h3><p>' + esc(f.where) + '</p><h3>How it starts</h3><p>' + esc(f.how) + '</p>' +
          '<h3>Ends</h3><div class="flist"><button class="fl" data-tool="' + f.from + '">' + mark(f.from) + esc(TOOLS[f.from].name) + '</button><button class="fl" data-tool="' + f.to + '">' + mark(f.to) + esc(TOOLS[f.to].name) + '</button></div>';
      } else if (s.type === 'service') {
        var x = SERVICES.filter(function (v) { return v.id === s.id; })[0];
        h = '<button class="x" data-x aria-label="Close">×</button><h2>' + esc(x.name) + '</h2><p class="sub">Shared, not passed along a line</p><p>' + esc(x.text) + '</p>' +
          '<h3>Used by</h3><div class="flist">' + x.tools.map(function (t) { return '<button class="fl" data-tool="' + t + '">' + mark(t) + esc(TOOLS[t].name) + '</button>'; }).join('') + '</div>';
      } else if (s.type === 'node') {
        if (s.id === 'prod') {
          h = '<button class="x" data-x aria-label="Close">×</button><h2>' + mark('pl') + 'Smart Thermostat</h2><p class="sub">Acme Climate, in Signoff PL</p>' +
            '<p>The product node rolls up every linked design from its summary, and owns the system requirements that flow down to them.</p><h3>Receives</h3><div class="flist">' +
            FLOWS.filter(function (f) { return f.to === 'pl'; }).map(function (f) { return flowRow(f, true); }).join('') + '</div><h3>Sends</h3><div class="flist">' +
            FLOWS.filter(function (f) { return f.from === 'pl'; }).map(function (f) { return flowRow(f, false); }).join('') + '</div>';
        } else {
          var n = NODES[s.id], d = n.d;
          h = '<button class="x" data-x aria-label="Close">×</button><h2>' + esc(d.name) + '</h2><p class="sub">' + esc(d.number) + (d.revision ? ' · rev ' + esc(d.revision) : '') + ' · ' + esc(TOOLS[n.tool].name) + (d.stage ? ' · ' + esc(d.stage) : '') + '</p>' +
            '<div class="art ins-art">' + n.art + '</div>' +
            (d.pct != null ? '<div class="pbar"><i style="width:' + d.pct + '%"></i></div><div class="t-meta" style="margin:6px 0 4px"><span>' + d.pct + '% reviewed</span>' + sevs(d.open) + '</div>' : '<p>Not started: waiting in Loom’s From Signoff PL tray.</p>') +
            '<h3>Where its data comes from</h3><div class="flist">' + n.flows.map(function (id) { var f = FLOW[id]; return '<button class="fl" data-flow="' + id + '">' + kindSample(f.kind) + '<span>' + esc(TOOLS[f.from].name) + ' → ' + esc(TOOLS[f.to].name) + ': ' + esc(f.label) + '</span></button>'; }).join('') + '</div>' +
            '<h3>Related Parts</h3><p>' + PLINKS.filter(function (l) { return l.a === s.id || l.b === s.id; }).map(function (l) { var o = l.a === s.id ? l.b : l.a; return esc(l.label) + ' · ' + esc(o === 'prod' ? 'Smart Thermostat' : NODES[o].d.name); }).join('<br>') + '</p>';
        }
      } else if (s.type === 'art') {
        var a = ARTS.filter(function (v) { return v.id === s.id; })[0];
        var rel = ALINKS.filter(function (l) { return l.flow && (l.a === a.id || l.b === a.id); });
        h = '<button class="x" data-x aria-label="Close">×</button><h2>' + mark(a.lane) + esc(a.t) + '</h2><p class="sub">' + esc(a.s) + ' · ' + esc(TOOLS[a.lane].name) + ', ' + esc(STAGES[a.col].toLowerCase()) + '</p>' +
          '<h3>Linked by</h3><div class="flist">' + rel.map(function (l) { var f = FLOW[l.flow]; return '<button class="fl" data-flow="' + f.id + '">' + kindSample(f.kind) + '<span>' + esc(TOOLS[f.from].name) + ' → ' + esc(TOOLS[f.to].name) + ': ' + esc(f.label) + '</span></button>'; }).join('') + '</div>';
      } else if (s.type === 'repo') {
        var r = REPOS.filter(function (v) { return v.id === s.id; })[0];
        var rw = RW.filter(function (v) { return v[1] === s.id; });
        h = '<button class="x" data-x aria-label="Close">×</button><h2><code style="font-size:15px">' + esc(r.name) + '</code></h2><p class="sub">Private' + (r.shared ? '. Shared work moves to ' + esc(r.shared) + '.' : '.') + '</p>' +
          '<h3>Holds</h3><ul class="what">' + r.items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
          '<h3>Written by</h3><div class="flist">' + rw.filter(function (v) { return v[2] === 'write'; }).map(function (v) { return '<button class="fl" data-tool="' + v[0] + '">' + mark(v[0]) + esc(TOOLS[v[0]].name) + ': ' + esc(v[3]) + '</button>'; }).join('') + '</div>' +
          '<h3>Read by</h3><div class="flist">' + (rw.filter(function (v) { return v[2] === 'read'; }).map(function (v) { return '<button class="fl" data-tool="' + v[0] + '">' + mark(v[0]) + esc(TOOLS[v[0]].name) + ': ' + esc(v[3]) + '</button>'; }).join('') || '<p class="note">Only its own tool.</p>') + '</div>';
      }
      if (s) h += legend();
      $('side').innerHTML = h;
    }
    $('side').addEventListener('click', function (e) {
      var t = e.target.closest('[data-x],[data-flow],[data-tool]'); if (!t) return;
      if (t.hasAttribute('data-x')) select(null);
      else if (t.dataset.flow) select({ type: 'flow', id: t.dataset.flow });
      else select({ type: 'tool', id: t.dataset.tool });
    });

    // ---- Story caption -------------------------------------------------------------------------------
    function renderStory() {
      var box = $('story'), s = storyStep();
      box.classList.toggle('on', !!s);
      $('play').textContent = s ? '■ Stop the story' : '▶ Play the story';
      if (!s) { box.innerHTML = ''; return; }
      box.innerHTML = '<span class="story-n">' + (st.step + 1) + '</span><div class="story-t"><b>' + esc(s.t) + '</b>' + esc(s.x) + '</div>' +
        '<div class="story-nav"><button class="btn-s" data-st="-1"' + (st.step === 0 ? ' disabled' : '') + '>Back</button><button class="btn-s" data-st="1">' + (st.step === STORY.length - 1 ? 'Done' : 'Next') + '</button></div>';
    }
    $('story').addEventListener('click', function (e) {
      var b = e.target.closest('[data-st]'); if (!b) return;
      var n = st.step + Number(b.dataset.st);
      st.step = n >= STORY.length ? -1 : Math.max(0, n); render();
    });
    $('play').addEventListener('click', function () { st.step = st.step >= 0 ? -1 : 0; st.sel = null; if (st.view === 'matrix') st.view = VIEWS[0][0]; render(); });
    document.addEventListener('keydown', function (e) {
      if (!root.isConnected) return;
      if (e.key === 'Escape') { st.sel = null; st.step = -1; render(); }
      if (st.step >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { st.step = Math.min(STORY.length - 1, Math.max(0, st.step + (e.key === 'ArrowRight' ? 1 : -1))); render(); }
    });

    // ---- Controls ------------------------------------------------------------------------------------
    function select(s) { st.sel = s; st.hover = null; render(); }
    var hoverTimer = null;
    function hover(h) {
      // Hover only previews when nothing is selected, so a selection stays put while the pointer moves.
      if (st.sel || st.step >= 0) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () { var k = JSON.stringify(h), o = JSON.stringify(st.hover); if (k !== o) { st.hover = h; renderView(true); } }, h ? 40 : 80);
    }

    $('views').innerHTML = VIEWS.map(function (v) { return '<button data-v="' + v[0] + '">' + v[1] + '</button>'; }).join('');
    $('views').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      st.view = b.dataset.v; st.hover = null;
      try { localStorage.setItem(STORE, st.view); } catch (err) { /* no storage */ }
      render();
    });
    $('labels').addEventListener('click', function () { st.labels = !st.labels; render(); });
    function renderKinds() {
      var show = st.view === 'graph' || st.view === 'life' || st.view === 'matrix';
      $('kinds').innerHTML = show ? Object.keys(KINDS).map(function (k) { return '<button class="kind" data-k="' + k + '" aria-pressed="' + (st.kinds[k] !== false) + '">' + kindSample(k) + esc(KINDS[k].label) + '</button>'; }).join('') : '';
      $('kinds').parentNode.style.display = show ? '' : 'none';
    }
    $('kinds').addEventListener('click', function (e) { var b = e.target.closest('[data-k]'); if (b) { st.kinds[b.dataset.k] = !st.kinds[b.dataset.k]; render(); } });
    $('view').addEventListener('click', function () { if (st.sel) select(null); });

    if (opts.theme) {
    var THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
    var theme = 'auto';
    try { theme = (JSON.parse(localStorage.getItem('signoff.v1.settings') || '{}').theme) || 'auto'; } catch (e) { /* no storage */ }
    function setTheme(t) {
      theme = t;
      if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
      $('theme').innerHTML = THEMES.map(function (x) { return '<button data-t="' + x[0] + '" aria-pressed="' + (x[0] === t) + '">' + x[1] + '</button>'; }).join('');
    }
    $('theme').addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (b) setTheme(b.dataset.t); });
    setTheme(theme);
    }

    // ---- Render --------------------------------------------------------------------------------------
    var fitters = [];
    function renderView(keepSide) {
      fitters = []; edgeSeq = 0;
      var root = $('view'); root.innerHTML = '';
      ({ graph: renderGraph, project: renderProject, life: renderLife, store: renderStore, matrix: renderMatrix })[st.view](root);
      if (!keepSide) renderSide();
    }
    function render() {
      Array.prototype.forEach.call($('views').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === st.view)); });
      $('labels').setAttribute('aria-pressed', String(st.labels));
      renderKinds(); renderStory(); renderView(false);
    }
    var rt = null;
    window.addEventListener('resize', function () { if (!root.isConnected) return; clearTimeout(rt); rt = setTimeout(function () { fitters.forEach(function (f) { f(); }); }, 60); });
    render();
    return { render: render };
  }

  window.SignoffStructure = { mount: mount };
})();
