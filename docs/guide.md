# Signoff PL: user guide

**Part 1** can be shared with customers. **Part 2** is for Dovetail FTEs.

---

## Part 1: Signoff PL at a glance

Signoff PL (project lead) shows where a whole product stands. A product is more than one design.
It can include several boards, an enclosure and brackets, firmware, and bought-in parts. Each
of those designs is reviewed in its own Signoff tool. PL puts them together.

**How it works**

1. **Structure the product.** Build it as assemblies and Parts. Each Part is one of these:
   - a board reviewed in Signoff EE
   - a mechanical part reviewed in Signoff ME
   - firmware
   - a purchased item, with its supplier, part number, mass and envelope
2. **Link the reviews.** Pick each Part's review from a list of the projects PL finds. PL never
   changes a review. It reads the summary each review keeps up to date.
3. **See where it stands.**
   - **Overview:** the share of checks reviewed across every design, open issues by severity,
     each design's stage, total mass, and any Part that needs attention.
   - **Structure:** the tree, with each assembly rolling up the Parts inside it.
   - **Issues:** every open issue in the product, worst first. Each one opens the exact check in
     its review.

**Try it:** the demo (`?demo`) is a made-up Smart Thermostat. Its boards, enclosure and wall bracket
are the Signoff EE and ME demo reviews, so every link opens the real thing. Nothing leaves your
browser.

---

## Part 2: for Dovetail FTEs

### Where things live

| | |
| --- | --- |
| Tool | `signoff_pl` (public, hosted at https://chrismessick-dpd.github.io/signoff_pl/) |
| PL projects | `signoff_pl_data` (private, FTEs only), `projects/<id>.json` |
| What it reads | Signoff EE's and ME's data repos and every `review-ee-…` / `review-me-…` repo |

PL is FTE-only, so there are no shared `review-pl-…` repos. Adding an FTE in Signoff EE or ME
invites them to both PL repos, because the PL repos are listed in each tool's `repos.suite`.
Anyone else who opens PL (a contractor, say) sees a page saying it's for FTEs, and none of the
projects, even ones an FTE left in that browser.

### Architecture

- **Static web app**, like the rest of the suite. It shares the GitHub token, your name and
  light/dark with the other tools on the same origin. Its own storage namespace is
  `signoff-pl.v1.`.
- **Vendored engine.** `assets/vendor/model.js`, `assets/vendor/github.js` and `assets/suite.css`
  are copies from Signoff EE, made by `tools/sync_vendor.py`.
  - PL's projects sync through the engine's `GitHubStore`, with PL's own merge passed in as
    `cfg.merge`.
  - It works in a clone of its own. The vendor check skips when `../ee_design_review` isn't there.
- **Reading designs** (`assets/reader.js`):
  - It lists each tool's repos and reads `projects/*.json`.
  - It keeps only `meta` and `summary` from each file.
  - It downloads only files whose blob sha changed.
  - It rebuilds the project-to-repo map on every sync, so a project that moved into a shared
    repo is still found.
- **References.** A Part points at its review by `{tool, id}`, never by repo.
- **Merging.** PL projects merge record by record (newest wins, tombstones for deletes). Two
  edits can still leave a broken tree, and the tree display handles both cases:
  - a loop from two moves at once, which is broken and the node shown at the top as "Moved to top"
  - a Part whose assembly was deleted, shown at the top as "Orphaned"

### Everyday use

- **Sync** (Ctrl+S) pushes PL projects and reads the designs again. It also runs when the page
  opens.
- **A Part says "Not summarized yet"** when its project file was written before summaries
  existed. Open that project in its tool and sync once.
- **"Not found"** means no repo your token reaches holds that project. Check the token, or
  whether the project was deleted.
- **Deleting** an assembly deletes what's inside it in PL. Linked reviews are never touched.

### Changing the tool

1. Edit `assets/` or `index.html`. Engine fixes go in `ee_design_review` first, then
   `python tools/sync_vendor.py` here.
2. Run `python tools/stamp_version.py`.
3. Serve the tools folder and open `signoff_pl/tests/test.html`. It should say PASS. One test
   compares the demo snapshot with the live EE and ME demos. That comparison only runs when
   those folders are served alongside.
4. If an EE or ME demo changed:
   1. Open `tools/demo_designs.html`.
   2. Download the file and save it over `assets/demo-designs.js`.
   3. Stamp the version again.

See `README.md` for the data format and `docs/roadmap.md` for what comes next.
