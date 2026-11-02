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
   - It keeps only `meta` and `summary` from each project file, rebuilt from known fields:
     numbers as numbers, severities from the list. Review repos are contractor-writable, so
     nothing in them is shown as is (`cleanSummary` in `reader.js`).
   - A file counts only for the project id in its name. When the tool's data repo has a People
     list, a shared repo counts only for the projects its shared map puts there.
   - It downloads only files whose blob sha changed.
   - It rebuilds the project-to-repo map every time, so a Part keeps working when its review
     moves into a shared repo.
   - It reads the pictures a checker stored next to each review: Fabcheck's board previews,
     `fabcheck/<id>/preview/index.json` (EE's `docs/fabcheck-link.md`, *Board previews*). Only the
     image names and blob shas go in the index. A tile fetches its image the first time it shows
     it, and the image is kept in IndexedDB (`signoff-pl-pictures`) by sha.

**Demo mode:** `index.html?demo` shows the suite's made-up demo product, a Smart Thermostat.
Nothing is read from GitHub.
- Its EE and ME Parts are the Signoff EE and ME demo projects: two boards, an enclosure and a
  wall bracket. Every link, including each issue, opens that design or that check in the other
  tool's demo.
- Their summaries are a snapshot in `assets/demo-designs.js`, so PL's demo still works on its
  own.
- The two boards' pictures are made-up drawings in `assets/demo-previews/`, standing in for
  Fabcheck's stored previews (`config.demo.previews`). The ME parts have none, as in real use.
- When EE's or ME's demo changes, regenerate the snapshot:
  1. Serve the tools folder.
  2. Open `tools/demo_designs.html`, download the file, and save it over
     `assets/demo-designs.js`.

  `tests/test.html` fails while the snapshot is out of date.

### Views

- **System** (once Overview and Structure; a stored `overview` or `structure` view opens it) shows
  the structure on top and the product's status underneath. The structure has four layouts:
  - **Map** (the default): an indented tree. The top assembly is the trunk, a button with the
    product's progress ring, Part count, mass and open issues. Each assembly branches off its
    parent with connector lines, and its Parts sit in a row of tiles on their own branch: a tile
    per Part with its picture (or a plain drawing until it has one), progress, stage and open
    issues. With several top-level nodes the trunk is the product itself. A product of one Part
    shows one tile, which is both the top and the Part.
    - Click a Part for the inspector: the picture (Top/Bottom for boards), checklists, the worst
      open issues, and links.
    - Click the trunk or an assembly for its full detail: rolled-up progress, open issues, mass,
      Part counts, Parts that need attention, the children (click one to select it), stages and
      the worst open issues below it.
    - Drag a tile or an assembly onto another branch to move it.
  - **Gallery:** big pictures, a section per assembly.
  - **Exploded:** the product in 3D, to scale, where you can arrange it (see *Arranging in 3D*).
    Parts with no 3D yet are named, not drawn.
  - **List:** the table. Click a row to edit it, collapse assemblies, add inside an assembly (+),
    reorder siblings (↑ ↓), or move a node by changing **Inside**.

  Underneath the structure:
  - open issues by severity
  - Part counts, mass, and Parts that need attention
  - one card per linked design, with a link that opens it in its tool (`?project=<id>`)
  - stages, listed per tool

  **Building from the client project.** A design whose summary names this product's client
  project (Project details, *Client project*; the product name when empty) and that no Part links
  to yet waits in a tray above the map. Drag it onto an assembly, click it to add it with the
  Part sheet, or **Add all**: boards go under *Electronics* and parts under *Mechanical*, made if
  missing.

  **3D models.** Any Part except firmware can carry a STEP file: Edit the Part, then **Attach
  STEP…** (or drop the file on the field). A board's tiles keep its Fabcheck pictures; its model
  is used in the 3D view.
  - The STEP is read in the browser by OpenCascade (`model3d.js`, run in `occt-worker.js`), which
    loads pinned from jsDelivr.
  - PL keeps a **simplified mesh**: at most 60,000 triangles, 16-bit positions, gzipped (usually
    tens of kB). It also keeps four 480 × 360 **pictures** (iso, top, front, right).
  - The original STEP is kept, gzipped, only if **Also keep the original STEP** stays checked. It
    can't be kept over 10 MB compressed.
  - The sheet shows what will be stored. An empty envelope is filled in from the model's size.
  - The pictures show on the map tile (as a big tile), in Gallery and the BOM.
    The inspector flips between the views and has a **3D** view you drag to turn. A kept STEP can
    be downloaded from there.
  - The files go into the PL data repo at the next sync, before the project file that names them.
    Until then they wait in this browser (IndexedDB `signoff-pl-uploads`). Replaced or removed
    models stay in the repo's git history.

  **Arranging in 3D** (System › Exploded).
  - **What's drawn:**
    - A Part with a model is drawn as its model.
    - A board without one is drawn as a slab carrying its Fabcheck top and bottom pictures, each
      cropped to the board.
    - A board needs its size first. Fabcheck stores it with the pictures from its next Send to
      Signoff; until then, type it in the panel.
    - Nothing else is made up: Parts without 3D are named under the view.
  - **Getting around:** drag to turn, Shift-drag (or right-drag) to pan, scroll to zoom. The view
    buttons are Iso, Top, Front and Right. **Fit** frames everything.
  - **Exploding:** the slider pulls the parts apart: layers by their order from the top, and a
    little outward.
  - **Where parts start:** a Part you haven't moved is stacked in structure order, first on top.
    **CAD position** puts a model where its STEP put it, so parts exported from one CAD assembly
    line up by themselves. **Back to stack** forgets a placement.
  - **Click a part** to arrange it in the panel:
    - **Move:** drag it, or type X, Y and Z (mm).
      - Seen from above, a drag moves it in X and Y; seen from the side, sideways and up or down.
      - Moves keep to a 0.5 mm grid unless you hold Alt.
      - Arrows nudge 1 mm (10 with Shift), and Page Up and Page Down move it in Z.
      - Moving shows the parts assembled.
    - **Turn:** turn it 90° about X, Y or Z, or press R for Z.
    - **Line up with** another part: **Stack on** puts it on top, centered; **Center on** centers it
      in X and Y.
    - **Snap:** pick a corner, edge, hole or flat face on this part, then one on another part. This
      part moves (it never turns):
      - corners meet;
      - flat faces become flush (only the gap between them closes);
      - edges and hole axes line up (a hole keeps its height, so boards drop onto standoffs);
      - crossing edges meet.

      Snapping works in the exploded view too, so you can reach faces the assembly hides. Faces
      come from the STEP's CAD faces. In a faceted STEP (no real faces), neighboring facets in one
      plane, or meeting at under 30°, count as one face. A simplified model snaps to its simplified
      shape, within a grid cell.
  - Each placement is saved on its Part (`place`) and syncs like any edit.

  **Adding a Part** asks first whether it's an existing EE or ME design (cards, this client
  project's first) or a generic Part (purchased or firmware). Picking a design fills in its name
  and number. A node can't be moved under itself. Deleting an assembly deletes what's inside it.
  Linked reviews are never touched.
- **BOM:** the bill of materials.
  - **Indented** follows the structure, numbered 1, 1.1, 1.1.1.
  - **Consolidated** puts each distinct Part on one line, with quantities summed. Parts count as
    the same when they link the same design, else share a number, else an MPN. A name alone never
    merges them.
  - You can pick the columns (picture, number, rev, source, supplier, MPN, quantity, mass, status,
    notes), search, and sort the consolidated list.
  - **CSV** downloads every line in the current layout.
  - **Print** opens a report page (landscape) to print or save as PDF. It uses the columns and
    search in use, with every assembly expanded.
  - The mass total matches System's.
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
  "meta":  { "name", "client", "clientProject", "number", "description", "phase": "EVT", "archived", "updatedAt", "updatedBy" },
  "nodes": { "n…": { "id", "parent": "" , "order": 1, "kind": "assembly | part", "name", "number",
                     "source": "ee | me | fw | purchased", "ref": { "tool": "ee", "id": "p…" },
                     "qty": 1, "massG": 64, "supplier", "mpn", "envelopeMm", "notes", "model",
                     "place": { "x", "y", "z", "rx", "ry", "rz" }, "boardMm": [80, 50, 1.6],
                     "createdAt", "updatedAt", "updatedBy", "deleted" } } }
```

**Placement.** `place` is where the 3D view puts a Part. It's a move in mm from the Part's own
coordinates, after a turn in degrees about X, then Y, then Z, around the middle of its bounding
box. All zeros means the CAD position; no `place` means the automatic stack. `boardMm` is a board's
size typed in PL (width, height, thickness). It wins over the size Fabcheck stores (`board` in its
preview `index.json`). `pl.js` `cleanPlace` and `cleanBoard` check both.

**Models.** `model` is set when a STEP is attached (see *3D models*):

```json
{ "file": "psu.step", "size": 2400000, "srcTris": 81000, "tris": 60000, "bboxMm": [70, 55, 38],
  "dir": "models/<project id>/<node id>/", "at", "by",
  "mesh": { "sha", "size" }, "step": { "sha", "size" } | null,
  "views": [{ "key": "iso | top | front | right", "sha", "w": 480, "h": 360, "size" }] }
```

The files are in the same repo, under `dir`:
- `mesh.plm.gz`: `PLM1` header, JSON (counts, bounding box, palette), 16-bit positions, indices,
  a color index per triangle and, from header `v: 2`, the CAD face each triangle came from (for
  snapping), all gzipped. See `model3d.js`.
- `<view>.png`
- `source.step.gz`

They're read by blob sha, so a reader always gets the version the record names. `pl.js`
`cleanModel` checks a record before it's shown.

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
| `assets/model3d.js`, `assets/occt-worker.js` | 3D models: reads STEP (OpenCascade, pinned, in a worker copied from Partcheck), simplifies, encodes, renders views and the 3D view |
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
