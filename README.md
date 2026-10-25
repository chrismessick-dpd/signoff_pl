# Signoff PL — project lead

**User guide:** [docs/guide.md](docs/guide.md) (a customer-shareable overview, then an FTE section). **Roadmap:** [docs/roadmap.md](docs/roadmap.md).

Signoff PL is the product-level tool of the Dovetail Signoff suite. A **PL project** is a whole
product. It is structured as a tree of **assemblies** whose leaves are **Parts**:

- a board reviewed in Signoff EE
- a part or enclosure reviewed in Signoff ME
- firmware (tracked here until Signoff FW exists)
- a purchased item

PL shows where the whole product stands:
- progress across the linked reviews
- open issues by severity, rolled up through the tree
- one list of every open issue, worst first
- each design's stage
- total mass

PL never writes to Signoff EE or ME. It reads the `summary` block that those tools write into
each project file at sync. The format is in Signoff EE's README under *The project summary*.

It is FTE-only. Signoff EE and ME call their reviews "projects" on screen. In PL and in the code,
a design linked into a product is a "Part".

## Using it

Open `index.html` in a browser, from a clone or served with `python -m http.server`. It shares
the GitHub token (`signoff.token`) and the light/dark theme with the other Signoff tools on the
same origin, so signing in once covers them all. The token must reach:
- the PL data repo
- Signoff EE's and ME's data repos
- every `review-ee-…` and `review-me-…` repo

**Who sees what.** An FTE is anyone whose token can open the PL data repo. PL shows projects only
while a sync has confirmed that for the token in use:
- PL remembers the login and a fingerprint of the token (`access` in its storage). A token
  changed in any Signoff tool, or a different data repo in Settings, hides the projects until
  the next sync confirms it.
- If the data repo returns 404, PL locks: it says who's signed in and how to get FTE access. It
  drops the projects the repo already holds and keeps unsynced ones, hidden, so an FTE's next
  sync from that browser pushes them. Designs aren't read.
- Signed out, PL shows nothing either.

**Sync** (or Ctrl+S) does three things:
1. It reads who the token belongs to (`/user`).
2. It pulls, merges and pushes the PL projects in the data repo. A 404 locks PL, as above.
3. For FTEs, it reads the designs again from Signoff EE and ME:
   - It lists each tool's data repo and every repo starting with its prefix (`config.tools`).
   - It keeps only `meta` and `summary` from each project file.
   - It downloads only files whose blob sha changed.
   - It rebuilds the project-to-repo map every time, so a Part keeps working when its review
     moves into a shared repo.

**Demo mode:** `index.html?demo` shows the suite's made-up demo product, a Smart Thermostat.
Nothing is read from GitHub.
- Its EE and ME Parts are the Signoff EE and ME demo projects: two boards, an enclosure and a
  wall bracket. Every link, including each issue, opens that design or that check in the other
  tool's demo.
- Their summaries are a snapshot in `assets/demo-designs.js`, so PL's demo still works on its
  own.
- When EE's or ME's demo changes, regenerate the snapshot:
  1. Serve the tools folder.
  2. Open `tools/demo_designs.html`, download the file, and save it over
     `assets/demo-designs.js`.

  `tests/test.html` fails while the snapshot is out of date.

### Views

- **Overview:** the product's progress ring, then:
  - open issues by severity
  - Part counts, mass, and Parts that need attention
  - one card per linked design, with a link that opens it in its tool (`?project=<id>`)
  - stages, listed per tool
- **Structure:** the tree. Click a row to edit it. You can:
  - collapse assemblies
  - add a Part or assembly inside an assembly (+)
  - reorder siblings (↑ ↓)
  - move a node by changing **Inside**. A node can't be moved under itself.

  Deleting an assembly deletes what's inside it. Linked reviews are never touched.
- **Issues:** every open issue across the linked designs, worst first, with its Part. Clicking
  an issue opens that exact check in its tool (`?project=<id>&item=<check>`). A design used by
  several Parts is listed once.

### How a Part stands

| State | Meaning |
| --- | --- |
| Progress bar | Linked, and the design's summary was read |
| Not summarized yet | Linked, but the project file has no summary. Open it in its tool and sync once. |
| Not found | No repo the token reaches holds that project |
| Couldn't read | The tool's repos failed at the last refresh |
| Not linked | A design Part not linked to a review yet |
| Purchased / No review tool yet | Tracked here only |

The roll-up rules:
- **Progress** is checks reviewed out of total checks, over the linked designs that have a
  summary.
- **A design used twice** (two of the same board) counts once in progress and issues. Its
  quantity multiplies its mass.
- **Stages** stay per tool, because EE and ME stages have different names. EVT, DVT and PVT
  gates will tie them together.
- **Mass** is in grams, entered per Part.

## Data

A PL project is one JSON document in the PL data repo (`projects/<id>.json`):

```json
{ "schema": 1, "id": "pl…", "slug": "…", "createdAt": "…", "createdBy": "…",
  "meta":  { "name", "client", "number", "description", "phase": "EVT", "archived", "updatedAt", "updatedBy" },
  "nodes": { "n…": { "id", "parent": "" , "order": 1, "kind": "assembly | part", "name", "number",
                     "source": "ee | me | fw | purchased", "ref": { "tool": "ee", "id": "p…" },
                     "qty": 1, "massG": 64, "supplier", "mpn", "envelopeMm", "notes",
                     "createdAt", "updatedAt", "updatedBy", "deleted" } } }
```

**References.** A Part refers to a design by `{tool, id}`, never by repo, because a project
moves out of a tool's data repo into its own `review-…` repo when a contractor is added.

**Merging.** Nodes merge record by record like every Signoff document: the newer record wins,
and deletions are tombstones. The merge is PL's own (`pl.js` `merge`), passed to the engine's
`GitHubStore` as `cfg.merge`. Edits that conflict can still produce two problem cases, and
`tree()` handles both:
- **A loop.** Two people moving nodes at once can make each the other's parent. The loop is
  broken at its lowest id, and that node is shown at the top as "Moved to top".
- **An orphan.** Deleting an assembly while someone adds to it leaves the new node without a
  parent. It is shown at the top as "Orphaned".

## Repositories

| Repository | Holds | Who's on it |
| --- | --- | --- |
| `signoff_pl` (tool) | This tool | FTEs |
| `signoff_pl_data` (data) | PL projects (`projects/<id>.json`) | FTEs |

There are no shared `review-pl-…` repos.

## Layout

| Path | Contents |
| --- | --- |
| `index.html`, `assets/app.js` | The tool (no build step, no dependencies) |
| `assets/config.js` | PL settings: repos, storage namespace, the tools a Part can link to, phases, demo data |
| `assets/pl.js` | Data model: documents, merge, tree (cycles, orphans), part status, roll-up, issues |
| `assets/reader.js` | Reads design summaries from the EE and ME repos |
| `assets/demo.js` | Builds the demo product from `config.js`, linked to the designs in `demo-designs.js` |
| `assets/demo-designs.js`, `tools/demo_designs.html` | Snapshot of the EE and ME demo designs' summaries, and the page that generates it |
| `assets/pl.css` | The few PL-only styles |
| `assets/suite.css`, `assets/vendor/model.js`, `assets/vendor/github.js` | Vendored from Signoff EE by `tools/sync_vendor.py` (don't edit here) |
| `tools/stamp_version.py` | Stamps `assets/version.js` and the `?v=` cache-busters in `index.html` |
| `tests/test.html`, `tests/fake-hub.js` | Model, reader and sync tests against a fake GitHub (open over http) |

## Changing it

1. Edit `assets/` or `index.html`. Fix engine code (`model.js`, `github.js`, `styles.css`) in
   `ee_design_review`, then run `python tools/sync_vendor.py` here.
2. Run `python tools/sync_vendor.py --check`. It passes when `../ee_design_review` isn't next
   to this folder.
3. Run `python tools/stamp_version.py`. It writes `assets/version.js` and the `?v=` stamps
   that make browsers load fresh files. `--check` fails if the stamp is stale.
4. Open `tests/test.html` over http. It should say PASS.

**Adding Signoff FW** is one more entry in `config.tools`, with its data repo, prefix and app
path. Firmware Parts then link like EE and ME ones.

## Roadmap

Phases 0 and 1 are done. Requirements allocation, interfaces, EVT/DVT/PVT gates and Signoff FW
are next; see [docs/roadmap.md](docs/roadmap.md).
