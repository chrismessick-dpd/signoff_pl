# Signoff PL (signoff_pl): notes for Claude

Signoff PL (project lead) is the product-level tool. A PL project is a whole product: a tree of
assemblies and **Parts**. Each Part links to a Signoff EE or ME review by `{tool, id}`, or is
firmware or purchased. PL rolls up progress, issues, stages and mass from each review's
`summary`, and never writes to EE or ME.

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
| `assets/app.js` | UI: Overview, Structure (Map, Gallery, Exploded, List; inspector; client-project tray; drag to place), Issues; sheets with a design picker; pictures (IndexedDB cache); sync |
| `assets/config.js` | Repos, `tools` (the linkable Signoff tools), phases, demo product |
| `assets/demo.js`, `assets/demo-designs.js`, `tools/demo_designs.html` | The demo, built from the EE and ME demos' summaries |
| `assets/vendor/*`, `assets/suite.css` | Copies from EE; never edit them |

Notes on behavior:
- **Merging.** PL's merge is passed to the engine's `GitHubStore` as `cfg.merge`.
- **FTE lockout.** Projects show only while `P.canSee(access, token, repo)`: a sync confirmed
  this token (by fingerprint) can open the data repo set in Settings. A 404 there locks PL,
  drops the synced projects from the browser (`P.lockOut`) and keeps unsynced ones hidden. No
  designs are read for non-FTEs. There's no local-only mode.
- **Roll-up rules:**
  - A design used by several Parts counts once.
  - Purchased and firmware Parts are left out of progress.
  - Mass is the sum of `massG × qty` (grams).
  - A missing summary means "not summarized yet", never 0%.

## Before committing

1. Run `python tools/sync_vendor.py --check`, then `python tools/stamp_version.py`. PL uses
   `stamp_version.py`, not a `build.py`.
2. Serve the tools folder and open `tests/test.html`. It should show PASS (70 tests as of
   2026-11-01, after board previews).
   - The snapshot test compares `assets/demo-designs.js` with the live EE and ME demos.
   - If that test fails, regenerate the snapshot with `tools/demo_designs.html` and save the
     output over `assets/demo-designs.js`.
3. Real-repo behavior has been verified only through the fake GitHub (`tests/fake-hub.js`) and
   the demo. A live sync needs Chris's token typed into the page, which Claude doesn't do. Ask
   Chris to try it.

## Visual redesign (2026-11-01)

Chris asked for PL to be visual and easy to build, "Apple, but technical". Map stays the default
layout; Gallery and Exploded show stored pictures only, never made-up ones (Exploded names Parts
without a picture). The new look stays in PL: don't port it to the hub, EE or ME (Chris, 2026-11-01).
Board pictures come from Fabcheck's stored runs (`fabcheck/<id>/preview/`); real boards get them the
next time each is sent from Fabcheck. ME parts have none until a mechanical checker exists (see
`../me_fabcheck_exploration/report.md`), which would write the same `preview/` layout.

## Next

Phase 2 is requirements allocation. See `docs/roadmap.md`. It starts with adding
`summary.reqList` to the EE engine's `projectSummary`.
