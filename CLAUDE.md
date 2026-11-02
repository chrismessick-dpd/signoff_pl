# Signoff PL (signoff_pl): notes for Claude

Signoff PL (project lead) is the product-level tool. A PL project is a whole product: a tree of
assemblies and **Parts**. Each Part links to a Signoff EE, ME or FW review by `{tool, id}`, or is
purchased. PL rolls up progress, issues, stages and mass from each review's
`summary`. The one thing it writes into EE or ME is requirement records, from the Requirements
tab (Chris, 2026-11-01; see *Requirements tab* below).

When the suite folder is checked out, also read `../CLAUDE.md`. Then read:
- `README.md`: data format and layout
- `docs/guide.md`: users and FTE architecture
- `docs/roadmap.md`: the phases, with design notes for what's next

This repo is public: no client data, tokens or commit messages naming clients.

## Decisions (Chris, 2026-10-25)

- **Naming.** PL is the product-level view. Chris dislikes "systems engineering"; frame it as a
  project.
- **Access.** FTE-only. There are two repos, `signoff_pl` (public, Pages) and `signoff_pl_data`
  (private), and no `review-pl-*` repos.
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
| `assets/reader.js` | Reads `meta` and `summary` from each tool's data repo and its `review-<tool>-*` repos, cached by blob sha. The project-to-repo map is rebuilt on every refresh. |
| `assets/plreqs.js` | Requirements model: System requirements, flow-down, roll-up (fail, risk, gap, open, pass), the inbox, the overlay of unsummarized writes, the compliance CSV |
| `assets/reqs.js`, `assets/reqs.css` | The Requirements tab, created from `app.js` with `S.plReqsView(ctx)`. Its controls use `data-rq`, outside `app.js`'s click handler |
| `assets/app.js` | UI: System (Map tree, Gallery, Exploded, List; inspector; client-project tray; drag to place; status panels underneath), BOM (print, CSV), Issues; sheets with a design picker and STEP attach; pictures (IndexedDB cache); model uploads; sync |
| `assets/model3d.js`, `assets/occt-worker.js` | STEP → simplified mesh (≤ 60k triangles, `PLM1` gzipped), pictures, 3D view. The worker is copied from Partcheck; the occt-import-js hashes match Partcheck's `libs.js` |
| `assets/config.js` | Repos, `tools` (the linkable Signoff tools), phases, demo product |
| `assets/demo.js`, `assets/demo-designs.js`, `tools/demo_designs.html` | The demo, built from the EE, ME and FW demos' summaries |
| `assets/vendor/*`, `assets/suite.css` | Copies from EE; never edit them |

Notes on behavior:
- **Merging.** PL's merge is passed to the engine's `GitHubStore` as `cfg.merge`.
- **FTE lockout.** Projects show only while `P.canSee(access, token, repo)`: a sync confirmed
  this token (by fingerprint) can open the data repo set in Settings. A 404 there locks PL,
  drops the synced projects from the browser (`P.lockOut`) and keeps unsynced ones hidden. No
  designs are read for non-FTEs. There's no local-only mode.
- **Roll-up rules:**
  - A design used by several Parts counts once.
  - Purchased Parts, and Parts whose source has no Signoff tool, are left out of progress.
  - Mass is the sum of `massG × qty` (grams).
  - A missing summary means "not summarized yet", never 0%.

## Before committing

1. Run `python tools/sync_vendor.py --check`, then `python tools/stamp_version.py`. PL uses
   `stamp_version.py`, not a `build.py`.
2. Serve the tools folder and open `tests/test.html`. It should show PASS (129 tests as of
   2026-11-02, after Signoff FW joined).
   - The snapshot test compares `assets/demo-designs.js` with the live EE, ME and FW demos.
   - If that test fails, regenerate the snapshot with `tools/demo_designs.html` and save the
     output over `assets/demo-designs.js`.
3. Real-repo behavior has been verified only through the fake GitHub (`tests/fake-hub.js`) and
   the demo. A live sync needs Chris's token typed into the page, which Claude doesn't do. Ask
   Chris to try it.

## Visual redesign (2026-11-01)

Chris asked for PL to be visual and easy to build, "Apple, but technical". Map stays the default
layout; Gallery and Exploded show stored pictures and models only, never made-up ones (Exploded
names Parts with no 3D). The new look stays in PL: don't port it to the hub, EE or ME (Chris, 2026-11-01).
Board pictures come from Fabcheck's stored runs (`fabcheck/<id>/preview/`); real boards get them the
next time each is sent from Fabcheck. ME parts have none until a mechanical checker exists (see
`../me_fabcheck_exploration/report.md`), which would write the same `preview/` layout.

## 3D models and BOM (2026-11-01)

Chris wanted STEP files on generic Parts, so a purchased item such as a power supply shows next to
the boards. He was worried about repo size, so PL never stores a raw STEP by default. It stores:
- a simplified, quantized, gzipped mesh;
- four PNG views;
- the STEP gzipped only when the box stays checked and it's under 10 MB compressed.

Models can be attached to purchased, ME and EE Parts (`MODEL_SOURCES`). A board's tiles keep
Fabcheck's pictures (`previewFor`); its model is used in the 3D view. Files upload at sync, before the project push (`uploadModels`). Waiting files live in
IndexedDB `signoff-pl-uploads`, which `clearPictures()` doesn't touch.

Testing a STEP in the pane: `Signoff.app.attachModel(nodeId, name, bytes)` with
`../partcheck/demo/...step` (made up). Never put a real or NIST STEP in PL's demo or tests. The
browser caches scripts by their `?v=` stamp, so re-stamp before reloading.

## Exploded in 3D (2026-11-01)

Chris wanted to arrange boards and parts in X, Y and Z with edge and vertex references, without
it becoming CAD software. So it's translation snaps plus 90° turns, and no mates or constraints.
- **Renderer.** All in `model3d.js`, software only: `renderScene` with board textures and a pick
  buffer. It takes about 30–40 ms per quick frame at 1000 × 560 and about 200 ms for the sharp
  redraw; that was measured, and is why there's no WebGL.
- **Snapping.** `features()` finds corners, edge chains, hole circles and flat faces. `alignMove()`
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
  for allocation). A board's, part's or firmware target's requirement lives in its EE, ME or FW review.
  A Part whose source has no Signoff tool can still hold its requirements in PL, with a `parent`
  and `part`. Firmware did until Signoff FW joined `tools` on 2026-11-02; the demo's firmware
  requirements now live in FW's demo (`fdemo3` REQ-001 and REQ-002).
- **IDs.** Every requirement is `REQ-###`, with `discipline` sys / ee / me / fw / other. Links use
  the record `id`, never the `ref`.
- **Flow-down.** It's the child's `parent: { tool: 'pl', project, id, ref, text }`. A child counts
  only when its parent is a live System requirement of this project; anything else is untraced.
- **Reading.** PL reads `summary.reqList`, sanitized in `reader.js` (`cleanReq`).
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

## Next

- **The requirements live write.** Try it on a test review with a real token, then add a PL test
  against `tests/fake-hub.js` that covers the shared-map lookup.
- **Field-level merge for `reqs`** (`fieldAt`), deferred by Chris: conflict cards come first.
- **Phase 3:** gates and interfaces. See `docs/roadmap.md`.
