# Signoff PL (signoff_pl): notes for Claude

Signoff PL (project lead) is the product-level tool. A PL project is a whole product: a tree of
assemblies and **Parts**. Each Part links to a Signoff EE, ME, or FW review by `{tool, id}`, or is
purchased. PL rolls up progress, issues, stages, and mass from each review's
`summary`. The one thing it writes into EE or ME is requirement records, from the Requirements
tab (Chris, 2026-11-01; see *Requirements tab* below).

**Serial comma** (Chris, 2026-11-08): use the Oxford comma in every list of three or more, in UI text, docs, demo data, checklists, and commit messages: "A, B, and C". Never change check ids or data keys to fit it.

When the suite folder is checked out, also read `../CLAUDE.md`. Then read:
- `README.md`: data format and layout
- `docs/guide.md`: users and FTE architecture
- `docs/roadmap.md`: the phases, with design notes for what's next

This repo is public: no client data, tokens, or commit messages naming clients.

## Decisions (Chris, 2026-10-25)

- **Naming.** PL is the product-level view. Chris dislikes "systems engineering"; frame it as a
  project.
- **Access.** FTE-only at first: `signoff_pl` (public, Pages) and `signoff_pl_data` (private). Since
  2026-11-07 (Chris: "full project shareability, the same way Signoff EE shares"),
  a project can be shared into its own private `review-pl-<slug>` repo, with everything it links; see
  *Sharing* below and `docs/sharing.md`.
- **Words.** The children are called **Parts**. Since 2026-11-01 EE says **Boards** and ME says
  **Parts** on screen, and "project" means the client project (`meta.project`, also in each
  summary as `project`).
- **Gates.** EVT / DVT / PVT. PL never maps one tool's stage names onto another's.
- **Independence.** PL stands on its own like EE and ME. It vendors the engine instead of
  depending on sibling folders at runtime.

## Code

| File | What it does |
| --- | --- |
| `assets/pl.js` | Pure model: documents, merge, tree (breaks loops, flags orphans), part status, roll-up, issues |
| `assets/reader.js` | Reads `meta` and `summary` from each tool's data repo and its `review-<tool>-*` repos, cached by blob sha (`CACHE_V` 4 since Loom harnesses, 2026-11-07). A tool with an empty `prefix` reads only its data repo (Loom's is `review-loom-` since sharing). The project-to-repo map is rebuilt on every refresh. A board's `summary.revisions` shows as *Fab revisions* in the Part inspector. |
| `assets/share.js` | Sharing (`S.PLSharer`): the per-tool share routine (`shareOne`), `plan`, `shareProject`, `revokeProject`, and `syncAll`, PL's sync across the data repo and the shared repos. See *Sharing* below. |
| `assets/access.js`, `assets/access-view.js`, `assets/access.css` | People & access: the model (`S.PLAccess`: people from every roster, modes, cells, `plan`, `run`, the demo's `simulate` and `demoRosters`, live `load`) and PL's tab in the suite's People sheet (`S.plAccessView`). See *People & access* below |
| `assets/plreqs.js` | Requirements model: System requirements, flow-down, roll-up (fail, risk, gap, open, pass), the inbox, the overlay of unsummarized writes, the compliance CSV |
| `assets/reqs.js`, `assets/reqs.css` | The Requirements tab, created from `app.js` with `S.plReqsView(ctx)`. Its controls use `data-rq`, outside `app.js`'s click handler |
| `assets/app.js` | UI: System (Map tree, Gallery, Exploded, List; inspector; client-project tray; drag to place; status panels underneath), BOM (print, CSV), Issues; sheets with a design picker and STEP attach; pictures (IndexedDB cache); model uploads; sync |
| `assets/model3d.js`, `assets/occt-worker.js` | STEP → simplified mesh (≤ 60k triangles, `PLM1` gzipped), pictures, 3D view. The worker is copied from Partcheck; the occt-import-js hashes match Partcheck's `libs.js` |
| `assets/config.js` | Repos, `tools` (the linkable Signoff tools), phases, demo product |
| `assets/demo.js`, `assets/demo-designs.js`, `tools/demo_designs.html` | The demo, built from the EE, ME, and FW demos' summaries |
| `assets/vendor/*`, `assets/suite.css` | Copies from EE; never edit them |

Notes on behavior:
- **Merging.** PL's merge is passed to the engine's `GitHubStore` as `cfg.merge`.
- **FTE lockout.** Projects show only while `P.canSee(access, token, repo)`: a sync confirmed
  this token (by fingerprint) can open the data repo set in Settings. A 404 there locks PL,
  drops the synced projects from the browser (`P.lockOut`) and keeps unsynced ones hidden. No
  designs are read for non-FTEs. There's no local-only mode.
- **Roll-up rules:**
  - A design with nothing to review (no checks: requirements only) is 100%, and so is a roll-up of
    only such designs (2026-11-09). The reader turns older summaries' 0 into 100 (`CACHE_V` 8).
  - A design used by several Parts counts once.
  - Purchased Parts, and Parts whose source has no Signoff tool, are left out of progress.
  - Mass is the sum of `massG × qty` (grams).
  - A missing summary means "not summarized yet", never 0%.

## Before committing

1. Run `python tools/sync_vendor.py --check`, then `python tools/stamp_version.py`. PL uses
   `stamp_version.py`, not a `build.py`.
2. Serve the tools folder and open `tests/test.html`. It should show PASS (213 tests as of 2026-11-08, after waiting Parts; 200 after People & access; 148 as of 2026-11-07, after Loom harnesses; 138 as of
   2026-11-04, after `summary.revisions`).
   - The snapshot test compares `assets/demo-designs.js` with the live EE, ME, and FW demos.
   - If that test fails, regenerate the snapshot with `tools/demo_designs.html` and save the
     output over `assets/demo-designs.js`.
3. Real-repo behavior has been verified only through the fake GitHub (`tests/fake-hub.js`) and
   the demo. A live sync needs Chris's token typed into the page, which Claude doesn't do. Ask
   Chris to try it.

## Visual redesign (2026-11-01)

Chris asked for PL to be visual and easy to build, "Apple, but technical". Map stays the default
layout; Gallery and Exploded show stored pictures and models only, never made-up ones (Exploded
names Parts with no 3D). The new look stays in PL: don't port it to the hub, EE, or ME (Chris, 2026-11-01).
Board pictures come from Fabcheck's stored runs (`fabcheck/<id>/preview/`); real boards get them the
next time each is sent from Fabcheck. Real ME parts have none until a mechanical checker exists (see
`../me_fabcheck_exploration/report.md`), which would write the same `preview/` layout; until then a
STEP attached in PL gives a Part its pictures.

**Demo ME models (2026-11-08, Chris: the mechanical parts had no models).** The demo's Front cover,
Back cover (both Parts link `me:mdemo5`, the Enclosure review, so it counts once) and Wall Bracket carry
models as an attached STEP stores them: PL's own meshes and renders of Partcheck's made-up demo STEPs,
in `assets/demo-models/<tree key>.plm.gz` and `<key>-<view>.webp`, listed in `config.demo.models` by
blob sha; `demo.js` gives the Parts their `model` and `app.js` `fileBlob` serves those shas from the
page (`S.plDemo.file`). `config.demo.previews` also has the ME designs' pictures for the tray and picker
(`demo-previews/mdemo5-*`, the closed enclosure). Every 3D Part has a `place` in the demo tree, where it
sits assembled (+z faces the room): front cover 0, display board 5, main PCBA −5, back cover −10,
bracket −16 mm, so Exploded spreads them front to wall in that order. To remake the files, run
`model3d.readStep`/`simplify`/`encode`/`png` on the Partcheck STEPs in the page, then `gitBlobShaBytes`.

## 3D models and BOM (2026-11-01)

Chris wanted STEP files on generic Parts, so a purchased item such as a power supply shows next to
the boards. He was worried about repo size, so PL never stores a raw STEP by default. It stores:
- a simplified, quantized, gzipped mesh;
- four PNG views;
- the STEP gzipped only when the box stays checked and it's under 10 MB compressed.

Models can be attached to purchased, ME, and EE Parts (`MODEL_SOURCES`). A board's tiles keep
Fabcheck's pictures (`previewFor`); its model is used in the 3D view. Files upload at sync, before the project push (`uploadModels`). Waiting files live in
IndexedDB `signoff-pl-uploads`, which `clearPictures()` doesn't touch.

Testing a STEP in the pane: `Signoff.app.attachModel(nodeId, name, bytes)` with
`../partcheck/demo/...step` (made up). Never put a real or NIST STEP in PL's demo or tests. The
browser caches scripts by their `?v=` stamp, so re-stamp before reloading.

## Exploded in 3D (2026-11-01)

Chris wanted to arrange boards and parts in X, Y, and Z with edge and vertex references, without
it becoming CAD software. So it's translation snaps plus 90° turns, and no mates or constraints.
- **Renderer.** All in `model3d.js`, software only: `renderScene` with board textures and a pick
  buffer. It takes about 30–40 ms per quick frame at 1000 × 560 and about 200 ms for the sharp
  redraw; that was measured, and is why there's no WebGL.
- **Snapping.** `features()` finds corners, edge chains, hole circles, and flat faces. `alignMove()`
  holds the snap rules and is unit-tested. Picking prefers visible features, but a part hidden only
  by the one being moved still counts.
- **Placements.** `node.place` is written only for the Part that moved, never for every Part, so
  concurrent edits survive merge. Unplaced Parts keep their slot in the auto stack.
- **Board sizes.** They come from Fabcheck's preview `index.json` `board` (added to `pcb_dfm`
  `repo.js` 2026-11-01; real boards get it at their next Send) or from `node.boardMm`.
- **Bottom pictures.** Fabcheck mirrors the bottom side left to right, and the slab maps it that
  way.
- **Test hooks.** `Signoff.app.scene` (`get`, `draw`, `commit`, `stackOn`, `centerOn`,
  `featureAt`, `startSnap`) drives it from the console. Clicking by coordinates is fragile.

## System tab and tree Map (2026-11-01)

Chris merged Overview and Structure into one **System** tab: the structure views on top, the old
Overview panels (`infoPanels`) underneath. A stored `ui.view` of `overview` or `structure` opens
System. PL has no view deep link.
- **Map is a tree** (`treeMap`): the trunk is the top assembly (`P.topAssembly`), or the product
  itself when there are several top-level nodes. The product's selection id is then `PRODUCT`
  (`'@product'`), which `systemPage` keeps even though it's not a node.
- **Branches.** Assemblies branch off with CSS connector lines (`.tm-kids`/`.tm-item` `::before`
  and `::after`). Runs of Parts are a leaf row of the old tiles.
- **Drop targets.** Every branch is a drop target, and the innermost wins. Assembly buttons can be
  dragged too.
- **Inspectors.** The trunk and assemblies open `asmInspector`, the full roll-up. In Exploded,
  only Parts get `arrangePanel`; assemblies and the product get the inspector.
- **Panels.** Map and Gallery sit in a gray `.sys-diagram` panel. Underneath, Designs is one compact
  card with a row per design (`.sys-design`), and Stages is a row of chips (Chris, 2026-11-01).
- **One Part** (`P.soloPart`), alone or in the one top assembly: the map shows a single tile that
  is both the top and the Part. Its inspector adds *Edit assembly* and *Add Part*.

The BOM is `pl.js` `bom()`. Its mass equals `rollup()`'s while assemblies have no qty. The UI
never sets one, but `bom()` multiplies by it if present.

## Requirements tab (2026-11-01)

The design is `docs/requirements-tab.md`, with Chris's decisions at the top. In short:
- **One home per requirement.** System requirements live in the PL project (`reqs`, with `parts`
  for allocation). A board's, part's, or firmware target's requirement lives in its EE, ME, or FW review.
  A Part whose source has no Signoff tool can still hold its requirements in PL, with a `parent`
  and `part`. Firmware did until Signoff FW joined `tools` on 2026-11-02; the demo's firmware
  requirements now live in FW's demo (`fdemo3` REQ-001 and REQ-002).
- **IDs.** Every requirement is `REQ-###`, with `discipline` sys / ee / me / fw / other. Links use
  the record `id`, never the `ref`.
- **Flow-down.** It's the child's `parent: { tool: 'pl', project, id, ref, text }`. A child counts
  only when its parent is a live System requirement of this project; anything else is untraced.
- **Reading.** PL reads `summary.reqList`, sanitized in `reader.js` (`cleanReq`). The reader's
  blob cache carries a shape version (`CACHE_V`); bump it whenever `keep()` or `cleanSummary()`
  keeps a new field, or files that haven't changed never gain it. That's why real projects
  showed no requirements on 2026-11-02: their cached entries predated `reqList`.
- **Sections (Chris, 2026-11-02).** Requirements should be lightweight. Each review's own
  requirements are pulled in automatically whenever its Part is in the tree, with no tracing
  needed. The list is a **System** section (PL's own), then one folding section per review tool
  (`rollup().sections`, grouped by the review's tool, never by `discipline`), with a folding row
  per design that starts closed. Rows that trace up name their System parent (`↑ REQ-001`);
  untraced is normal and is no longer in Needs you. Deprecated rows hide unless shown
  (`ui.rqDep`). Export CSV is the full list in List layout (`listCsv`) and the compliance matrix
  in Matrix layout (`csv`).
- **State filters (Chris, 2026-11-08).** The header's failing / at risk / gap / open / met counters
  are on/off toggles like Fabcheck's severity chips: all on, a click hides that state everywhere
  (System rows, their children and gap rows, PL-held rows, and every review section; `ui.rqFilter.off`).
  A System row whose own state is off stays, dimmed (`rq-ctx`), while a child or gap of it shows.
  Show all turns them back on. Deprecated has no counter and shows only when asked for.
- **Writing.** It goes through the engine's `GitHubStore.patchRecords`, after a confirm:
  - only `reqs` records change;
  - the file must round-trip;
  - `force: false`;
  - a record changed since PL read it comes back as a conflict card (keep mine or keep theirs).

  The review's repo is resolved fresh from the tool's data repo's shared map (`users.json`),
  never from the reader's cache.
- **Overlay.** PL can't rebuild a review's summary, so what it wrote is laid over `reqList`
  (`reqOverlay` in localStorage) until the review's own sync catches up.
- **States.** At risk (an open issue on a linked check) and failing (verification failed) are
  separate, the same as in EE and ME.
- **Demo.** The demo's System requirements are `config.demo.requirements`. `demo.js` gives the
  EE/ME demo requirements the parent links PL would have written. Writes in the demo stay in the
  browser.
- **Not tried live yet.** The live write path (`homeStore`, `writeToReview`) has run only in the
  demo, and `patchRecords` against the fake GitHub in EE's tests. Ask Chris to try it on a test
  review first.

## Loom harnesses (2026-11-07, Chris; branch `loom`, with Loom's branch `store`)

Chris: a harness belongs with a PL project (not a board: copies of one board may use different
cables), and moves around the tree like any Part. Loom keeps every harness in one private repo,
`loom_data` (`projects/<id>.json`, shaped like a review file; see `loom/CLAUDE.md`), and PL treats Loom
as one more tool in `config.tools` with `prefix: ''` (no shared repos) and `review: false`.
- **Getting into a project.** A harness names its client project in Loom, so it waits in that PL
  project's tray like an EE board; Add all puts harnesses under a *Harnesses* assembly (`GROUPS`). The
  PL node (`source: 'loom'`, `ref: { tool: 'loom', id }`) is the link of record; Loom only reads PL.
  Chris (2026-11-07): keep the tray, so adding a harness is deliberate; don't auto-add harnesses.
- **No checks.** `P.isDrawing(source)`: a harness Part is counted as `harnesses` in the roll-up and stays
  out of progress, designs, issues, and stages; the BOM shows no progress for it. Tiles, the tray, the
  Designs panel, List, and the picker show "N wires · M ends" (`designStat`); the inspector shows what
  it holds and Loom's check counts (`harnessHtml`). `reader.js` keeps `summary.harness` and
  `summary.identAt`, and reads the number from `meta.number` when there's no `meta.board`.
- **Name and number go both ways** without either tool writing the other's repo: the Part sheet stamps
  `node.identAt` when Name or Number change (or copies the harness's stamp when they match it), and
  after reading designs `P.adoptHarnesses` brings over a harness whose `summary.identAt` is newer,
  marking the project dirty so the next sync pushes it. Loom does the reverse at its sync. Chris
  (2026-11-07): newest-wins after each tool syncs is fine for now.
- **Parts waiting to be started (2026-11-08, Chris: some purchased harnesses turned out to need building;
  new things wait in a tray in the tool they belong to, to be added on purpose, across the suite).** The
  Part sheet has three modes: Existing design, **Placeholder for EE, ME, FW, or Loom** (Chris renamed it
  from Not started yet; pick the tool), and Generic Part. A placeholder saves `source: <tool>`, `ref: null`, which `partStatus` calls `planned`
  (it was `unlinked`): "Placeholder" on the tile, counted in `roll.planned`, never as needing attention.
  Loom lists such Parts under *From Signoff PL* (`loom/assets/store.js` `waiting`); its Start makes the
  harness with the Part's name and number and writes `summary.plPart: { project, node }`. PL keeps it
  (`reader.js`, `CACHE_V` 5) and `P.claimPlanned` links the waiting Part to it after every designs read and
  at load (`claimAll` in `app.js`): the earliest started (`plPart.at`, stamped at Start; Loom's copies drop `plPart`), only while the Part still waits for
  that tool, never an archived design. Until then `P.claimedElsewhere` keeps it out of every tray. Switching
  a purchased Part to another kind keeps its supplier, MPN, envelope, and model on the node, hidden
  (`modelOf` and `mpnOf` in `app.js`, the BOM in `pl.js`), so switching back brings them back. EE, ME, and FW
  list them too (the engine's From Signoff PL, `config.pl`; see `ee_design_review/CLAUDE.md`), and Start
  there writes the same `summary.plPart`. Tests: 213. Not tried live. The `me-send` branch also set `CACHE_V` to 5:
  make it 6 when merging.
- **Drawings (2026-11-09, Chris; pushed `edca05e`, with `loom` `6f25017`).** A harness with wires has a picture of its wiring diagram, which Loom
  stores at sync next to the harness (`drawing/<id>/preview/`, Fabcheck's preview layout; `loom/CLAUDE.md`).
  The Loom tool in `config.js` has `previews: 'drawing/'`, so the reader attaches it as the entry's
  `preview` and tiles, the inspector, and Gallery show it as they show a board's (`previewFor`). No
  `CACHE_V` bump: previews are read on every refresh. `share.js` doesn't move `drawing/<id>/`; Loom's next
  sync draws it into the shared repo. Tests: 232. Tried in the demo with a hand-added harness entry.
- **Not done:** the demo has no harness Part (the snapshot generator would need Loom's demo summary).
  Tested in the demo by adding a `loom:hdemo1` entry to the stored index by hand: the tray offered it,
  Add it made *Harnesses*, and progress stayed 49%.

## Assemblies with their own review (2026-11-08, Chris)

A mechanical part may be an assembly: Signoff ME's details window marks it (`summary.kind:
'assembly'`, kept by `reader.js`, `CACHE_V` 7), and PL shows that review on an assembly's branch.
- **Model.** An assembly node may carry `source: 'me'` and `ref` like a Part. `partStatus` still returns
  null for every assembly; `linkStatus` is `partStatus` for a Part and the linked review's status for a
  linked assembly (`isLinkedAssembly`). Use `linkStatus` anywhere that walks the tree to reach designs.
  It's used in `rollup` (counts in the assembly's roll and every roll above, not as a Part and with no
  mass), `issues`, `unlistedIssues`, `bom`, `plreqs.js` `items`, `share.js` `items`, `access.js` (a
  `<node>~review` leaf inside the assembly), and the System panels.
- **Map heads (2026-11-09, Chris).** Every assembly's branch shows its number under its name (`asmNumber`:
  its own, else its review's), and a linked one has *Open in ME ›* beside it (`ownOpen`, also on the trunk).
- **UI.** The branch head and trunk show the tool chip and stage (`ownChip`); the assembly inspector shows
  the review (`ownReviewHtml`) and Open in Signoff ME. The tray marks assembly reviews and adds them as
  assemblies. An assembly's sheet picks only assembly reviews and offers to remove Parts that link the same
  review. Picking one for a Part turns the sheet into an assembly. A Part linked to an assembly review
  offers *Link to an assembly…* (`asmLinkSheet`): an existing assembly, or a new one where the Part is.
  The assembly takes the review's name and number, and the Part is removed.
  A Part with a mass, model, or quantity above one (`partCarries`) is never removed that way: the sheet
  leaves it, and *Link to an assembly…* moves it inside the assembly (ticked by default).
- **Not done:** the Requirements tab's allocation, matrix, and derive columns still list Parts only
  (`reqs.js`, `kind === 'part'`), so a System requirement can't be allocated to an assembly's review yet.
- **Tests:** 227. Tried in the demo with `me:mdemo5` marked an assembly in the stored index. The demo
  itself is unchanged.

## Sharing (2026-11-07, merged to `main` and pushed with Loom's `fa25c7d`)

Chris asked whether sharing a PL project shares its Loom harnesses, and for PL to share projects the
way EE does, on a branch. Before: no, and PL wasn't shareable. Now (`docs/sharing.md` has the design and
the open questions):
- **⋯ → Share…** (`shareSheet`, FTEs only, project synced) lists who has the project, what goes with it
  (the project, each linked review, each harness, each with the repo it's in or "gets its own private
  repository"), and adds a person by GitHub username (names Signoff EE knows are offered). Remove takes
  them off everything.
- **`share.js`** does the work per tool with that tool's data repo and prefix: create or adopt the repo,
  copy the file byte for byte, move the files stored next to it (`fabcheck/<id>/` for EE, `models/<id>/`
  for PL), patch the roster (`shared[id]`, `users[login]` as a contractor; proof that nothing else in
  the file changes, `force: false`, read back) and delete the data repo's copy in the same commit, then
  invite EE's FTEs (`config.repos.peopleRepo`, the home of People) and the person. Safe to repeat.
- **Sync** is `syncAll`: the data repo with PL's roster (`roster`, `homes`, `repoCache` in storage;
  the old `cache` key migrates), then the shared repos from the shared map (FTE) or listed by
  `review-pl-` (contractor, `access.state === 'contractor'`; `P.canSee` allows it, `P.isFte` doesn't).
  A token that reaches nothing still locks PL. Model files live in a project's home repo
  (`homeOf(p)`); the Requirements write falls back to the reader's repo when the data repo is closed.
- **Tests:** 176 (sharing a product with an internal EE board with Fabcheck files, a shared ME part,
  a Loom harness and models; rosters; invitations; idempotence; the contractor's sync, reader and
  edit; revoke; the roster proof). Loom: 19.
- **Not tried live.** The first live share creates real repos; Chris should try a test product first.

## People & access (2026-11-08, Chris)

PL's own tab in the suite's People & access sheet (`signoff/assets/people.js` takes a host tab with a
label, shown first and only in PL). Designed from lab sketches (branch `perm-sketches`, `lab/permissions/`);
Chris kept two layouts, as sub-tabs: **Person first** and **Tree with people**.
- **Scope (Chris).** This is PL's settings only. EE, ME, and FW keep their own People pages as they are,
  each managing its own people. PL's list is the whole company: everyone on any tool's roster (PL, EE,
  ME, FW, Loom), and PL can set access in any of their repos. FTEs come from EE's roster and aren't
  editable here.
- **Model.** Per person per PL project: Whole system (on the PL project, every Part now and later; no
  scope entry), PL + chosen Parts (PL roster `users[login].scopes[projectId] = 'project'`), or Parts only
  (not on the PL project). A Part is held when that tool roster's `users[login].projects` has the design
  id. Clients have a `company` in PL's roster (Person first groups clients by it). Purchased Parts aren't
  listed (nothing to share). "Invited" is read from GitHub (each shared repo's pending invitations).
- **Staged until Apply (Chris).** The footer says Staged (nothing has changed on GitHub yet), Applied
  (done just now) or Live. A Whole-system person missing a Part linked since sharing shows as staged on
  load ("Linked since the project was shared"). Apply lists every repo to create, invitation, and roster
  write, then runs `run()`: shares (`shareOne`, PL project first), removals (`revokeOne`), then scopes and
  companies (`setScope`, `setCompany` through `patchPlUser`, which uses `patchRoster`'s proof). Each step
  is safe to repeat. Apply is blocked while a project to share has unsynced edits. In `?demo` it's
  simulated against made-up rosters (`accessDemo` in storage, reset with the demo).
- **Removing (Chris).** Leaving a PL project asks: only the PL project (they keep their Parts), or the
  project and its Parts. The Share sheet's Remove opens People & access with that question.
- **share.js.** `shareOne` now keeps user fields it doesn't own (scopes, company); it used to rebuild the
  record. `revokeProject` is `revokeOne` per item.
- **Not tried live.** The first live Apply creates real repos and needs the owner's token; try a test
  product first. Removing someone doesn't touch their records in other PL projects' scopes.

## Next

- **The requirements live write.** Try it on a test review with a real token, then add a PL test
  against `tests/fake-hub.js` that covers the shared-map lookup.
- **Field-level merge for `reqs`** (`fieldAt`), deferred by Chris: conflict cards come first.
- **Phase 3:** gates and interfaces. See `docs/roadmap.md`.
