# Requirements tab: design exploration

Status: built 2026-11-01 (Phases 2a to 2c, without field-level merge). The live write to a real
review hasn't been tried yet; see `signoff_pl/CLAUDE.md`, *Requirements tab*. This is Phase 2 of
`roadmap.md` (requirements allocation), reworked for requirements that can be created and edited
in PL, EE, or ME. The mockup is `requirements-mockup.html`. Open it straight from disk; it uses
made-up Smart Thermostat data.

The request (Chris): a Requirements tab that pulls bidirectionally from ME and EE requirements.
Requirements can be created in PL, ME, or EE, assigned to a tool (System, ME, EE, later FW), and
updated in PL or in that tool. The list should be interactive enough that people want to use it.

## Decisions (Chris, 2026-11-01)

1. **PL may write into review files.** It writes only `reqs` records, after a confirm, the same
   way Fabcheck does.
2. **EE/ME may reword a requirement that came down from System.** Rewording marks it `changed`,
   so PL re-approves it.
3. **Contractors see the parent's ref and text** (the `parent` snapshot).
4. **"At risk" and "failing" are separate states in every tool.**
   - *At risk* means an open issue on a linked check.
   - *Failing* means the verification failed.

   EE and ME change to match.
5. **Every requirement is `REQ-###`.**
   - A `discipline` field classifies it: `sys`, `ee`, `me`, `fw`, or `other`.
   - There are no `SYS-` or `FW-` prefixes. Where a sketch below says SYS-00x, read it as a
     REQ- with discipline `sys`.
6. **Conflict cards first.** Field-level merge (`fieldAt`) waits.
7. **No gate tags for now.**

**Later decision (Chris, 2026-11-02): keep it lightweight.** Requirements can be written in each
EE board, ME part, or FW review on their own. When a Part links that review, its requirements show
in PL automatically, as a folding section per tool and a row per design, and the PL project's own
requirements sit on top. Tracing up to a System requirement is optional; an untraced design
requirement is normal, not something waiting for action. Grouping is by the review's tool, not the
record's `discipline`.

**Implementation note.** `summary.reqList` carries each live requirement's display fields:
- `id`, `ref`, `text`, `discipline`, `kind`, `category`, `method`, `status`, `verify`;
- the trace state and linked open issues;
- `parent`.

That's more than the tiny `[{ id, trace, issues }]` proposed in §2. PL's demo is built from
summaries, so the requirements come along for free, and the reader only has to sanitize one
list. PL still reads the full file whenever it writes.

## The recommendation in brief

1. **Each requirement has exactly one home document.**
   - System requirements live in the PL project (`reqs`, the same record shape as EE/ME).
   - An EE or ME requirement lives in the review of the Part it's allocated to.
   - FW requirements, and requirements not yet placed on a Part, wait in the PL project.

   There are no mirror copies to reconcile. Editing in PL writes that one record back to its
   home.
2. **Flow-down is a field on the child,** `parent: { tool: 'pl', project, id }`, keyed by record
   `id`, never by `ref`. PL is the authority on which children it counts.
3. **PL reads `doc.reqs` directly** (sanitized) and takes from `summary.reqList` only what it
   can't compute itself: each requirement's trace state, which needs EE's or ME's checklists.
4. **PL writes into review files** the way Fabcheck's Send to Signoff already does. It asks first,
   patches only `reqs` records, proves the rest of the file is byte-identical, commits with
   `force: false` and re-reads. This reverses "PL never changes a review", so it's the first
   open question.
5. **Each side owns certain fields.** The allocator owns the wording, and the reviewer owns
   verification. In time the engine should merge `reqs` field by field, so a PL reword and a
   contractor's "pass" can't overwrite each other.
6. **The UI** is a traceability tree with roll-up rings and a Parts × requirements coverage
   strip. It has a **Needs you** inbox (untraced, unallocated, parent changed, needs approval,
   at risk) and drag from the inbox onto a Part to allocate.
7. **Phasing.**
   - 2a: System requirements and a read-only view, with no writes to review files.
   - 2b: engine changes in EE, synced to ME.
   - 2c: PL writes back.

---

## What exists today

These come from reading the engine (`ee_design_review/assets/model.js`, `app.js`, `github.js`),
PL's `pl.js` and `reader.js`, and the EE README.

- **The EE/ME requirement record** (`project.reqs[id]`):
  ```
  { id: 'q…', ref: 'REQ-001', text, kind: shall | should, category, source,
    method: inspection | analysis | demonstration | test,
    status: draft | approved | changed | deprecated, verify: open | pass | fail, evidence,
    links: [check ids], createdAt, updatedAt, updatedBy, deleted }
  ```
  - `id` is a random `uid('q')` and never changes.
  - `ref` is editable in the inspector, and duplicates can happen when two people add
    requirements offline (`reqStats().duplicates`).
  - Comments on a requirement are ordinary comments with `item` set to the requirement's id.
- **Trace state.** `reqTrace(req, checkIndex)` reads the status of each linked check:
  - an open issue makes the requirement `issue` (failing);
  - a fixed issue makes it `open` (needs re-review);
  - a waived issue counts as `pass`.

  This needs the tool's checklists, which PL doesn't load.
- **Approval handshake already exists.** Rewording an approved requirement marks it `changed`
  (`setReq`, and `importReqs` on update).
- **Merging is record by record.** The newer `updatedAt` wins the whole record, and deletions
  are tombstones. `mergeMaps` keeps whole records, so extra fields on a requirement survive, and
  so do `setReq` and `importReqs`, which both use `Object.assign({}, prev, …)`.
  - **Allowlist trap.** `mergeProjects` builds its output from a fixed list of top-level keys.
    A new top-level key in a review file would be dropped by any older copy, such as a
    contractor's package. PL's `pl.merge()` has the same trap: it returns only `meta` and
    `nodes`. So does `reader.cleanSummary()`, which rebuilds the summary from known fields.
- **`summary.reqs`** has counts only: `{ total, approved, pass, fail, open, unlinked }`.
- **Writers without checklists already exist.** Fabcheck's Send to Signoff writes into EE
  project files and keeps the stored summary. The next FTE sync in EE renews it.
- **The repo for a project** comes from the data repo's shared map (`users.json` → `shared`).
  `workspace.homeOf()` treats that map as the authority, and EE's sync deletes stray copies left
  in the data repo (`deleteStrays`).
- **Deep links.** EE and ME accept `?project=<id>&item=<check id>`. A requirement id there isn't
  opened as a requirement today, so a `&req=<id>` link is an engine change.

---

## 1. Data model and ownership

### One home per requirement

| Assigned to | Home document | Who edits it | Repo |
| --- | --- | --- | --- |
| **System** | The PL project, `reqs` | FTEs, in PL | `signoff_pl_data` |
| **EE** (allocated to a board) | That board's EE review, `reqs` | FTEs in PL or EE; the board's contractors in EE | `ee_design_review_data` or `review-ee-*` |
| **ME** (allocated to a part) | That part's ME review, `reqs` | FTEs in PL or ME; the part's contractors in ME | `me_design_review_data` or `review-me-*` |
| **FW** | The PL project, `reqs`, with `owner: 'fw'` | FTEs, in PL | `signoff_pl_data` (moves to Signoff FW once it exists) |
| **EE / ME, not yet on a Part** | The PL project, `reqs`, with `owner: 'ee'` or `'me'` and no Part | FTEs, in PL | `signoff_pl_data` |

So "assigned to EE" really means "allocated to a Part whose `ref` points at an EE review". The
tool comes from the Part. Until it has a Part, a requirement waits in PL, and the UI shows it in
the **Unallocated** pile. Dragging it onto a Part moves it into that review (see *Moves*).

**Why one home and not mirrored copies:**
- A mirror needs a reconciler, and two copies of one record are the classic way to lose an edit.
- With one home, the existing record merge does all the work, and the home repo's permissions
  decide who can edit it. Contractors already have exactly the right access.

### PL record shape

The PL project gains a `reqs` map with the EE/ME record shape, plus:

| Field | On | Meaning |
| --- | --- | --- |
| `owner` | PL records | `'system'` (default), `'fw'`, `'ee'`, or `'me'`. Anything other than system means it's waiting to be allocated or moved. |
| `parts` | System records | PL node ids this requirement is **allocated** to, which drives the coverage strip. PL-only data, so it's safe to keep here. |
| `parent` | EE/ME/FW records | `{ tool: 'pl', project: 'pl…', id: 'q…', ref, text, at }`. The flow-down link to a System requirement. `ref`, `text`, and `at` are a snapshot for display, so a contractor sees the intent without access to PL. |
| `movedTo` / `movedFrom` | any | `{ tool, project, id }`, set when a requirement changes home (see *Moves*). |

Two different relationships, kept apart:
- **Allocation** (System → Part): "the Enclosure must help meet SYS-001". PL owns it, and it
  lives on the System record as `parts`. It ships in Phase 2a.
- **Flow-down** (System → derived requirement): "Enclosure REQ-002 is how the Enclosure meets
  SYS-001". It lives on the child as `parent`. An allocation with no derived requirement yet
  shows as a **gap** cell in the matrix.

PL's `pl.merge()` must add `reqs: M.mergeMaps(local.reqs || {}, remote.reqs || {})` and keep
any top-level keys it doesn't know (see *Allowlist traps*).

### IDs that stay stable across tools

- **Global key** = `{ tool, project, id }`, where `tool` is `pl`, `ee`, `me`, or later `fw`,
  `project` is the document id, and `id` is the record's `uid`. Every link uses this key.
- **`ref` is for display only.** It can be renamed, and duplicates are possible. The roadmap's
  `links: { tool, project, ref }` should become `{ tool, project, id }`.
- **System refs** use their own prefix, `SYS-001…`, via the existing `nextReqRef`.
  - EE and ME keep `REQ-001…` per review.
  - PL shows a child as **Main PCBA · REQ-003**: Part name plus ref, because a ref is unique
    only within its review.
- **A move keeps `id`.** The key changes only by its `tool` and `project`, and `movedTo` /
  `movedFrom` link the two. Links that point at the old key follow `movedTo`.

### Roll-up (PL computes; for a System requirement)

| State | When |
| --- | --- |
| **Deprecated** | Its own status is deprecated. Left out of counts, as in EE. |
| **Failing** | Its own `verify` is fail, or any live child's `verify` is fail. |
| **At risk** | Any live child's trace state is `issue` (an open issue on a linked check). Issues elsewhere on the Part don't count: they aren't linked to this requirement. EE calls this "failing" too; PL splits it out because "an issue might break this" asks for different action than "a test failed". |
| **Gap** | Allocated to a Part with no derived requirement there. |
| **Met** | Every live child passes and there are no gaps. With no children, its own `verify` is pass. |
| **Open** | Otherwise. |

A child that is deprecated or tombstoned no longer counts. Re-allocating SYS-001 away from a
Part doesn't delete the Part's child requirement; it shows as **orphaned** (it still has a
`parent` but is no longer allocated) until someone deprecates it or re-allocates.

**Computed evidence** (a small, nice touch): a System requirement can name a PL metric, such as
`mass ≤ 250 g` against the BOM roll-up (205.2 g in the demo). PL then shows live evidence and a
margin, "205.2 g, 18 % margin", which updates whenever a Part's mass changes.

---

## 2. Bidirectional sync

### EE/ME → PL (reading)

- **Requirements themselves: read `doc.reqs` directly.** `reader.js` already downloads every
  project file (cached by blob sha) and keeps only `meta` and `summary`. Add a `reqs` keep,
  rebuilt from known fields like `cleanSummary` does:
  - `kind`, `method`, `status`, and `verify` go through `M.oneOf`;
  - text fields are cut to 2,000 characters;
  - `links` must be strings, and at most 200 of them;
  - `parent` is kept only when it's `{ tool: 'pl', … }`.
- **Trace state: from `summary.reqList`.** Only the tool with checklists can compute it. Keep
  the list tiny:
  ```json
  "reqList": [ { "id": "q8f2…", "trace": "issue", "issues": ["usb2"] } ]
  ```
  - `trace` is `reqTrace(...).state`.
  - `issues` holds the linked checks with an open issue, so PL can show the issue itself from
    `summary.open` without a second lookup.
  - Readers must cope when it's missing: an older engine, or a file Fabcheck or PL wrote
    since. Then show "trace not summarized yet".
- **Why not put everything in the summary?** Text and evidence would double each file's size.
  PL needs the full record anyway to edit it, and the summary is meant to hold only what readers
  can't derive.

### PL → EE/ME (writing)

PL becomes a **writer without checklists**, like Fabcheck. A write changes only records in
`reqs`, plus `comments` later.

1. **Resolve the home repo fresh.** Read `users.json` from the tool's data repo, and use
   `M.sharedRepo(roster, id)` if the project is shared, otherwise the data repo.
   - Never use the reader's cached map. A project that has just moved to `review-ee-*` leaves a
     stray in the data repo that EE's next sync deletes, along with any edit written there.
2. **Read** the file at the branch head (sha and text). Check that
   `stableStringify(JSON.parse(text)) === text`. If it doesn't round-trip, refuse: the file
   was written by something PL doesn't understand.
3. **Patch, don't merge.**
   - For each changed record, set `doc.reqs[id] = M.newer(doc.reqs[id], ours)`.
   - Never run the whole document through PL's vendored `mergeProjects`. If EE ever adds a
     top-level key that PL's older copy doesn't know, a full merge would drop it.
   - Keep the stored `summary` as it is.
4. **Prove it's additive (dry-run).**
   - Delete the patched ids from both the original and the patched documents, then
     re-serialize both. They must be byte-identical.
   - Each patched record must either be new or `newer()` than the one it replaces.
   - Any other difference aborts the write.
5. **Confirm with the user.** Show what will change and where, such as "Main PCBA (EE, shared
   with contractors): REQ-003 text, parent", as Fabcheck does.
6. **Commit** one commit per repo with `force: false` against the head read in step 2. On a
   422 or 409, go back to step 2 and redo the patch on the new head.
7. **Re-read** and check that each record is present and equal. Then keep an **overlay** of
   the written records until the home tool's next sync renews `summary.reqList`. The counts
   in `summary.reqs` stay stale until then; that's acceptable, and the same as Fabcheck.

These steps belong in the engine as `GitHubStore.patchRecords(path, kind, records)`, so PL and
any later writer share one audited path. PL vendors it via `sync_vendor.py`.

### Conflicts

Today newer wins the **whole record**. With two tools editing the same requirement, that loses
edits in an ordinary case:

> PL rewords REQ-003 at 10:00. A contractor, working from a copy synced at 09:00, sets
> `verify: pass` at 10:05 and syncs. Their record is newer, so it wins, and the reword is gone.

That counts as review data being lost, so the design has three layers:

1. **Field ownership, as a convention in the UI.**
   - The *definition* belongs to the allocator: `text`, `kind`, `category`, `source`, `parent`,
     `method`.
   - The *verification* belongs to the reviewer: `verify`, `evidence`, `links`.
   - Either side can still edit everything. EE/ME show a flowed-down requirement's definition
     with a note, "Set in the project plan; changing it asks PL to re-approve". Editing it
     marks it `changed`, through the handshake that already exists.
2. **Detection before writing (PL, in 2c).**
   - PL remembers the `updatedAt` of each record it started editing.
   - If the head's record is newer and differs, PL doesn't write. It shows a conflict card
     with both versions, field by field, and "keep mine", "keep theirs" or "combine". The
     user's choice becomes a new, newer record.
3. **Field-level merge for `reqs` (engine).**
   - Each requirement record carries `fieldAt: { text: t, verify: t, … }`.
   - `mergeReqs` takes each field from the side whose `fieldAt` is newer, and falls back to
     record-level `newer()` for records without `fieldAt`.
   - Old copies keep `fieldAt` as an unknown field and stamp only `updatedAt`. So the rule is:
     when a record's `updatedAt` is newer than every entry in its `fieldAt`, treat every field
     as stamped at `updatedAt`. Merges then treat an old copy's edit as touching every field,
     which is no worse than today. Without this rule, an old copy's unchanged `fieldAt.verify`
     looks like a tie, and a contractor's "pass" could disappear.
   - This closes the gap for good. It's the one engine change worth doing before writes are
     common.

Concurrent **moves**, where two FTEs drag the same requirement to different Parts, end up with
the record in two homes. PL detects a requirement id live in more than one home and shows
"moved twice; pick one".

### Moves (re-assigning or re-allocating)

A move from one home to another is two writes, in this order, each safe to repeat:
1. Write the record into the target home with the same `id`, plus `movedFrom`.
2. Tombstone it in the source (`deleted: true`, `movedTo`). The text stays in the tombstone.

If the second write never happens, PL sees the same `id` live in two homes, with `movedFrom`
pointing at the other. It finishes the move, like EE's interrupted share move. Nothing is ever
hard-deleted. Comments on the requirement stay in the source document, and PL links to them
("3 comments in the earlier home").

### What goes where: the short version

| Data | Written by | PL reads it from |
| --- | --- | --- |
| Requirement records (all fields) | Home tool, or PL via patch | the file, `doc.reqs` (sanitized) |
| Trace state and linked open issues | EE/ME at sync | `summary.reqList` |
| Counts | EE/ME at sync | `summary.reqs` (existing) |
| Allocation to Parts | PL | PL doc, `reqs[id].parts` |
| Flow-down link | PL (or EE/ME later) | the child's `parent` |
| Overlay of PL's own unsummarized writes | PL | localStorage, until the next summary |

### Allowlist traps (required, or data silently vanishes)

- `pl.merge()` must merge `reqs`, and should carry unknown top-level keys through.
- `reader.cleanSummary()` must keep `reqList` (sanitized).
- `reader.keep()` must keep `reqs` (sanitized).
- New requirement data goes on records and never into new top-level keys of review files. Older
  contractor copies of `mergeProjects` would drop such keys.

---

## 3. Contractor access

- **Contractors never see PL.** They have no access to `signoff_pl_data`, and PL locks out
  non-FTEs. Everything a contractor sees comes through their `review-*` repo.
- **What reaches them:** the requirements allocated to their board or part, including ones
  created in PL. A child's `parent` snapshot shows the System ref and text, so the contractor
  knows where it comes from.
  - Nothing about other Parts or sibling requirements is copied in, and nothing about the
    product roll-up.
  - Whether even the parent's text should go to contractors is an open question.
- **What they can do:** edit those requirements in EE/ME as today, and add new ones.
  - New ones arrive in PL's **Untraced** inbox for an FTE to trace up.
  - They can't create System requirements or see PL's other Parts.
- **What PL doesn't trust.** A contractor can write any JSON into their repo, so:
  - **Parents.** A child counts toward a System requirement only if its review is linked by a
    Part of that PL project, the System requirement exists, and is allocated to that Part.
    Otherwise PL shows it with "claims parent SYS-003", and an FTE confirms it.
  - **Verification.** A child's `verify: pass` with no evidence and no linked checks shows a
    small "unsupported" mark in PL. It's a nudge, not a block.
  - **Writes.** Writes from PL into a `review-*` repo are visible to that repo's contractors,
    by design. The confirm step names the repo and says it's shared.

---

## 4. The UI: making the list something people want to open

### Ideas considered

| Idea | What it gives | Cost | Verdict |
| --- | --- | --- | --- |
| **Traceability tree** (System → derived requirements → checks → issues), expandable rows | The core picture: why each requirement exists and how it's proven | Medium | **Core** |
| **Roll-up ring** per System requirement, with segments for each child's state | Status at a glance, without reading | Low | **Core** |
| **Coverage strip** (Parts × requirements, one cell each, colored by state, gaps hatched) | Shows where the holes are; it's the compliance matrix folded small | Low | **Core**, under the header |
| **Needs you inbox**: untraced, unallocated, at risk, needs approval (`changed`), parent changed since the child was derived | The reason to open the tab every day. Each item is one action | Medium | **Core**, the pull-in feature |
| **Click-through**: every check and issue opens in EE/ME at the exact item | Turns PL into the front door for the whole review | Low (needs `&req=` in the engine) | **Core** |
| **Inline editing**: click the text, status, or verify chip | Fast; makes PL a place to work, not only to read | Medium | **Core** for PL-homed records; 2c for review-homed ones |
| **Drag to allocate**: drag a requirement onto a Part in a Parts rail | Matches the System tab's tray and drag-to-place. Allocating feels physical | Medium | **Core** |
| **Filters**: tool, Part, status, category, gate; search; and "only mine" | Expected; keeps the long list usable | Low | **Core** |
| **Full compliance matrix** (big grid, export CSV or print) | What the client asks for at a gate | Low (CSV already in the engine) | View toggle |
| **"Since you last looked" marks** (a dot on rows changed elsewhere since this browser's last visit, with who and what) | A reason to come back, and quiet awareness of contractor activity | Low (per-viewer localStorage) | **Core** |
| **Suggested parent** (match on `source`, such as "DT-SPEC-12 §6.4", and keywords) | Makes tracing up a one-click job | Low | In the Untraced inbox |
| **Computed evidence** (mass from the BOM, later others) | Live margin numbers, the kind of thing people screenshot | Low for mass | Nice, small |
| **Gate tags** (verify by EVT, DVT, or PVT) and a burndown per gate | Ties into Phase 3 gates | Medium | Later, with gates |
| **Flow (Sankey-style) diagram**, System to Parts | Pretty, but adds little beyond the tree and matrix | High | No |

### Recommended design

Illustrative sketch; the numbers differ from the mockup.

```
┌ Requirements ─────────────────────────────────────────────────────────── Smart Thermostat ┐
│  ◔ 31% verified    12 System · 15 derived     ● 2 met  ● 5 at risk  ● 1 failing  ○ 4 open  │
│  Coverage  Main PCBA ▮▮▯▮▮░  Display ▮▮░▯  Enclosure ▮▮▮░▯  Bracket ▮░  Firmware ░░        │
├──────────────────────────────────────────────────────────────┬────────────────────────────┤
│ [All tools ▾] [All Parts ▾] [Status ▾] [Category ▾]  search… │  Needs you (7)             │
│                                                              │  ▸ 4 untraced              │
│ ▾ ◕ SYS-001 Room temperature ±0.5 °C, 5–35 °C   Test  ⚠ risk │    Display · REQ-003 15 mA │
│     ├ EE Display & sensor · REQ-001  ⚠ sch-therm-4 open      │    suggested: none  [Trace]│
│     └ ME Enclosure · REQ-002         ⚠ enc-thm-4 open        │  ▸ 1 unallocated           │
│ ▾ ◑ SYS-002 ESD ±8 kV contact, ±15 kV air       Test  ⚠ risk │    SYS-011 0–40 °C ambient │
│     ├ EE Main PCBA · REQ-003         ⚠ usb2 critical         │    drag onto a Part ↘      │
│     ├ EE Display & sensor · REQ-002  ⚠ disp8 major           │  ▸ 1 needs approval        │
│     └ FW (in PL) · FW-001 recover without reset   ○          │  ▸ 5 at risk               │
│ ▸ ● SYS-003 Mass ≤ 250 g   205.2 g · 18% margin   ✓ met      │                            │
│ ...                                                          │  Parts  (drop to allocate) │
│                                                              │  [Main PCBA] [Display] …   │
├──────────────────────────────────────────────────────────────┴────────────────────────────┤
│ Inspector (on select): definition | verification | trace chain → checks → issues | history │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Header.**
  - A single product ring shows verified ÷ live, counting System requirements by roll-up.
  - State counters double as filters.
  - The **coverage strip** has one cell per (Part, System requirement allocated to it):
    - green for met or pass;
    - amber for at risk;
    - red for failing;
    - outlined for open;
    - hatched for a gap (allocated, no derived requirement).

    Hovering a cell names it, and clicking filters the list to that pair.
- **List: the tree.**
  - Each System requirement is a row with its ring, ref, text, method, and roll-up state.
  - Children are indented, each with a tool badge, Part name, ref, and state. Where they're at
    risk, a pill shows the blocking issue's check id and severity, and opens it in EE/ME.
  - Untraced EE/ME requirements sit at the bottom under "Not traced to a System requirement".
  - Deprecated requirements are lined out under All, as in EE.
- **Inline editing.**
  - Clicking a ref opens the inspector.
  - Clicking the text edits it in place.
  - The status and verify chips are small menus.
  - Rows homed in a review show a lock icon until 2c, then edit with the confirm-on-sync flow.
- **Needs you rail.** This is the hook. Every item is a one-step action:
  - **Untraced:** trace it up. A suggested parent comes pre-selected when `source` matches.
  - **Unallocated:** drag it onto a Part chip below.
  - **Needs approval:** approve, or open the diff of what changed.
  - **Parent changed:** the System text changed after the child's `parent.at`. Mark it
    reviewed, or edit the child.
  - **At risk:** open the issue.

  The count shows on the tab label, like EE's red dot.
- **Inspector.** It matches PL's existing inspector, with four parts:
  - Definition, editable.
  - Verification: verify and evidence. For System requirements it's the roll-up and computed
    evidence.
  - The **trace chain**: System → child → linked checks with status dots → open issues, each a
    deep link.
  - History: who changed what, from `updatedBy` and `updatedAt`, plus "since you last looked".
- **Matrix view** (a toggle next to List): rows are System requirements, columns are Parts.
  Each cell shows the derived requirement's ref and state, or gap, or blank (not allocated).
  Export CSV is `reqsCsv`-style, with Part columns, and it prints for gate reviews.
- **Keyboard.** `j` / `k` to move, `Enter` to open, `e` to edit text, `a` to allocate (it opens
  a Part picker), `/` to search. These match EE's keys where they overlap.

The look follows PL's 2026-11-01 redesign ("Apple, but technical") and stays in PL.

---

## 5. Phasing and engine changes

### Phase 2a: System requirements, read-only roll-up (PL only, plus one small engine change)

- PL: `reqs` in the PL document, through the same editor as EE (from the vendored model).
  Fix `pl.merge()`.
- PL: `owner` and `parts` on System records, and drag to allocate onto Parts.
- PL reader: keep `reqs` from each review (sanitized). Keep `summary.reqList` once it exists.
- PL UI: the tree, ring, coverage strip, matrix, filters, Needs you (untraced, unallocated, at
  risk), deep links, "since you last looked" and CSV export.
- Review-homed requirements are **read-only** in PL, with an "Open in EE" link.
- Flow-down links can't be written yet. Untraced shows *suggested* parents, from matching
  `source`, as dashed links. They count as "suggested", not met.
- **Engine (EE, then synced to ME):** add `summary.reqList: [{ id, trace, issues }]`. Then
  regenerate PL's demo snapshot.

### Phase 2b: engine changes in EE (synced to ME)

1. Render `parent` on requirements:
   - a read-only "↑ SYS-002 · ESD ±8 kV…" chip;
   - a "From the project plan" filter;
   - a "Parent changed" banner when `parent.at` is newer than the child's last approval;
   - the definition-ownership note (editing marks it `changed`).
2. Deep link `?project=<id>&req=<req id>` that opens the requirement inspector.
3. `GitHubStore.patchRecords(path, kind, records)` with the additive proof, `force: false`,
   retry and re-read. PL and later writers share it.
4. Field-level merge for `reqs` (`fieldAt`).
5. Bump nothing in the demo unless demo data changes. If the thermostat demo gains `parent`
   fields, bump `demo.js` `VERSION` and regenerate PL's snapshot.

Order: EE `build.py` and tests, then `sync_engine.py` into ME with its build and tests, then
`sync_vendor.py` and `stamp_version.py` in PL and Fabcheck, then PL's tests. Fabcheck changes
only if it vendors the new github.js.

### Phase 2c: PL writes back

- Create, edit, flow down (drag a System requirement onto a Part creates a derived child with
  pre-filled text) and move requirements across homes, through `patchRecords`.
- Conflict cards.
- "Moved twice" repair, and the overlay until the next summary.
- Update `signoff_pl/CLAUDE.md`, `guide.md` and the README: PL now writes `reqs` records into
  review files.

### Later

- FW requirements move to Signoff FW when it exists. PL-homed records with `owner: 'fw'` each
  move into the FW review of their Part, using the same move protocol.
- Gate tags (EVT, DVT, PVT) on requirements and a burndown per gate (Phase 3).
- Comments on requirements from PL (patching `comments` records the same way).

---

## 6. Open questions for Chris

1. **May PL write into review files?** Today `signoff_pl/CLAUDE.md` and `guide.md` both say PL
   never changes a review. Bidirectional editing needs it to: only `reqs` records, after a
   confirm, the way Fabcheck's Send to Signoff does. Yes, or keep PL read-only and send people to
   EE/ME to edit?
2. **Field ownership.** Should EE/ME be able to reword a flowed-down requirement freely (which
   marks it `changed` for PL to re-approve, as proposed)? Or should the definition be locked
   outside PL?
3. **What contractors see of the parent.** The System ref and text (proposed), the ref only, or
   nothing?
4. **"At risk" vs. "failing".** EE counts an open issue on a linked check as failing. PL would
   split it into *at risk* (an issue is open) and *failing* (a verification failed). Is it OK
   for the two tools to word this differently?
5. **Ref prefixes.** `SYS-` for System and `FW-` for firmware held in PL? Should EE/ME children
   keep their own `REQ-` numbering (proposed), or take a derived ref like `SYS-002.1`?
6. **Field-level merge** (`fieldAt`) is the engine change that makes two-way editing safe. Do it
   in 2b before writes, or accept conflict cards alone at first?
7. **Gates.** Should requirements carry a "verify by EVT, DVT, or PVT" tag now, or wait for
   Phase 3?

## Appendix: the demo trace map used in the mockup

This is made up, built on the existing thermostat demo requirements. Children are the real
demo refs; System refs are new and live only in the mockup.

| System | Text (short) | Allocated to and derived as |
| --- | --- | --- |
| SYS-001 | Room temperature ±0.5 °C, 5–35 °C (§2.3) | Display · REQ-001 (sch-therm-4 issue), Enclosure · REQ-002 (enc-thm-4 issue) |
| SYS-002 | ESD ±8 kV contact, ±15 kV air at user-accessible points (§6.4) | Main · REQ-003 (usb2 critical), Display · REQ-002 (disp8), FW-001 (in PL) |
| SYS-003 | Installed mass ≤ 250 g (§2.1) | Enclosure · REQ-003 (pass); computed 205.2 g |
| SYS-004 | Runs from 100–240 V AC, 50/60 Hz (§3.1) | Main · REQ-001 (pass) |
| SYS-005 | Reinforced insulation, mains to user circuits (§5.2) | Main · REQ-002 (pcb-iso-1 issue); Enclosure allocated, gap |
| SYS-006 | Relay outputs 2 A, 250 V AC, 100k cycles (§4.3) | Main · REQ-005 (changed, needs approval) |
| SYS-007 | Class A cosmetic front cover (§7.1) | Enclosure · REQ-001 |
| SYS-008 | Mounts to a single-gang box (§8.2) | Bracket · REQ-001 |
| SYS-009 | Firmware updates over the air | FW-002 (in PL) |
| SYS-010 | Operating ambient 0–40 °C | Unallocated |
| — | Untraced | Display · REQ-003 (15 mA), Display · REQ-004 (2 m readability), Enclosure · REQ-004 (service), Bracket · REQ-002 (fasteners) |

Main PCBA · REQ-004 (pre-certified Wi-Fi module, from kickoff notes) is untraced too. It's a
good example of a design-level requirement that never needed a System parent.
