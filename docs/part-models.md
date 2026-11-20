# One model per mechanical part, kept with its Signoff ME review

**Status:** Chris's decisions, 2026-11-19; built 2026-11-19 (not pushed). Moving the real project's attached models waits for the push.

## The rule

A mechanical part's model (its pictures, PL's simplified mesh, and, if kept, the gzipped STEP) lives in
one place: the folder Partcheck's Send already uses, next to the part's Signoff ME review.

```
<ME review's home repo>/partcheck/<review id>/preview/index.json
                                                    <key>-iso.png …  (or .webp)
                                                    <key>.plm.gz
                                                    <key>.step.gz    (optional)
```

There are three writers, and the latest write for a part number wins:

| Writer | When |
| --- | --- |
| Partcheck | *Send to Signoff ME…* (its parts, from a package) |
| Signoff PL | *Attach a STEP* on a Part linked to an ME review (`source: 'me'`, with `ref`) |
| Signoff ME | *Attach a model…* on the overview |

All three read each other's work: ME's overview, PL's tiles, inspector, large 3D view, and Exploded all read
this folder. A Part not linked to an ME review (purchased, or not started) keeps its model in PL's own repo as
before (`models/<project>/<node>/`).

Chris's decisions (2026-11-19):
1. **Visibility.** The model goes wherever the ME review is shared: contractors and the client on a shared
   review see it, as they already see Partcheck's pictures.
2. **ME shows** the pictures and a turning 3D view (PL's viewer), and has *Attach a model…* to add or replace.
3. **Existing models.** The STEPs already attached in PL to Parts with their own ME review move into those reviews in this
   work, with a dry run Chris approves first.

**Rules that keep "latest wins" true everywhere:**
- **One entry per part number.** Writers replace by part number, trimmed and lowercased (as PL's
  `checkerPart` compares), not by `key`; `slug` is shared (`model3d.parts.slug`).
- **PL's own copy never hides a newer one.** For an ME-linked Part that still carries `node.model` (an older
  attach, or another browser's unsynced copy), PL shows whichever of `node.model.at` and the folder part's `at`
  is newer, in every view (a tie goes to the review's: a moved model keeps its time).
- **Partcheck's output doesn't change.** Its entries carry no `source` (missing means Partcheck), so the demo
  files stay byte for byte; its Send only learns to keep a part's `step.gz`.
- **Size.** The STEP is kept only under 10 MB gzipped (PL's cap), since GitHub drops a request that runs past
  about 60 s.

## index.json

Partcheck's `v: 1` index (`partcheck/docs/send-to-signoff-me.md`), with optional fields on each part:

```json
{ "key": "2100410-011", "partNumber": "2100410-011", "revision": "", "name": "Front cover",
  "views": { "iso": "2100410-011-iso", "top": "…", "front": "…", "right": "…" },
  "mesh": { "file": "2100410-011.plm.gz", "size": 9332, "tris": 1248, "srcTris": 1248, "bboxMm": [90, 90, 14] },
  "step": { "file": "2100410-011.step.gz", "size": 41234 }, "file": "2100410-011_B_front-cover.step",
  "source": "pl", "at": "2026-11-19T22:00:00.000Z", "by": "Dana Kim" }
```

- `source`: `partcheck` (the default when missing), `pl`, or `me`. Readers say "From Partcheck", "Attached in
  Signoff PL", or "Attached in Signoff ME".
- `step`: the original STEP, gzipped, when the writer kept it (PL's and ME's *Keep the STEP* box; Partcheck never
  does). Its `file` must match `^[a-z0-9-]{1,32}\.step\.gz$`.
- `at`, `by`: when and who, for that part (the index's own `at` is the last write of any part).
- A part's `key` is its part number as a slug (Partcheck's `slug`), so a later write of the same number replaces
  it, whichever tool wrote it.

## The writer

`S.model3d.parts` in `signoff_pl/assets/model3d.js` (PL owns the mesh format, so it owns this too; Partcheck
and the engine vendor it):

- `put(store, dir, { prep, partNumber, revision, name, source, by, keepStep })`: reads the folder at one
  commit (`store.snapshot()`), replaces or adds the part, keeps the hero if it still exists, removes files no
  part names any more, and writes everything in one commit with `putFiles({ head })`; if the repo moved, it
  reads again and retries (three times).
- `remove(store, dir, key)`: the same, taking one part out.
- `named(index)`: the files an index uses (Partcheck's Send uses it too, so it no longer deletes a stored STEP).

## Signoff PL

- Attaching a STEP to an ME-linked Part writes it into the review's folder at once (not at the next sync), with a
  busy card, and the Part's own `model` is cleared. *Remove* takes the part out of the folder. The review's
  preview in PL's index is rebuilt from the written index, so the Part shows it without a re-read.
- The inspector line says which tool wrote it and when; *Download STEP* reads `step` from the review's repo.
- In the demo, nothing is written: the written index is kept for the page only (as the demo keeps everything).

## Signoff ME (engine, behind `config.previews.models`, ME only)

- The overview picture gets a **3D** side next to Iso, Top, Front, and Right, turning the part's mesh in PL's
  viewer (`model3d.viewer`).
- **Attach a model…** (anyone signed in who can write the review's repo): pick a STEP, choose the part number (the
  review's number by default; an assembly review lists its parts), tick *Keep the STEP*, and it's read in the
  page (`model3d.prepare`) and written with `parts.put`. **Remove model** takes the shown part out.
- The engine vendors PL's `model3d.js` and `occt-worker.js` into `assets/vendor/` (`tools/sync_model3d.py`),
  synced into ME and FW; only ME's `index.html` loads them.

## Moving models already attached in PL

For each PL Part with `source: 'me'`, a `ref`, and an attached `model`:
1. Read its files from PL's repo (mesh, views, STEP if kept).
2. Write them into the ME review's folder as a `source: 'pl'` part (one commit per ME repo).
3. Clear the Part's `model` in PL's project file (one commit), proven to change nothing else.

Dry run first, shown to Chris; each write against the head it read, then read back.
