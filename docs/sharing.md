# Sharing a PL project (and its Loom harnesses)

*2026-11-07, branch `sharing` in `signoff_pl` and `loom`. Design and the state of the code.*

## The question

Does sharing a PL project share its Loom harnesses? Before this work, no, and a PL project couldn't be
shared at all. Signoff PL was FTE-only: every PL project lived in the one private repo `signoff_pl_data`,
and every Loom harness in the one private repo `loom_data`. Only Signoff EE and ME could give a project
to someone outside the team (a private `review-ee-…` or `review-me-…` repo per shared review, and a
People & access page; EE's is the home of People, ME has its own for `review-me-*`).

With this branch, sharing a PL project shares the product and everything it links: its EE, ME and FW
reviews and its Loom harnesses, each the way its own tool shares it. The person is invited to every one
of those repositories, and Loom's sync reads the shared repos too.

## How Signoff EE shares, in short

GitHub grants access to whole repositories, so EE keeps each audience in its own:

- `ee_design_review_data`: internal reviews and `users.json` (the roster: `users` with a role, and the
  `shared` map saying which review lives in which repo). FTEs only. An FTE is anyone whose token can
  open it.
- `review-ee-<slug>`: one private repo per shared review, holding only that review. The FTEs and that
  review's contractors are on it. Sharing moves the review out of the data repo into the new repo and
  records the move in the shared map; the data repo's copy is deleted at the next sync.
- A contractor's token reaches only their `review-…` repos. Their copy of Signoff lists repos by name
  prefix and syncs those. An FTE syncs the data repo plus every repo in the shared map.

## The same model for PL and Loom

| Repository | Holds | Who's on it |
| --- | --- | --- |
| `signoff_pl_data` | Internal PL projects, their model files (`models/<project>/…`) and `users.json` | FTEs |
| `review-pl-<slug>` | One shared PL project and its model files | FTEs and that project's people |
| `loom_data` | Internal harnesses and `users.json` | FTEs |
| `review-loom-<slug>` | One shared harness | FTEs and the people on the PL projects that use it |

**Per shared thing, not per person.** Each shared PL project, review and harness gets its own repository,
as in EE. Per-person repos (`review-<login>`) would mean a copy of each review per person, and
everyone's edits would no longer meet in one file. One repo per thing keeps "everyone works on the same
copy": a second person is one more invitation, and a harness used by two products is shared once.

**The PL project's repo doesn't hold its harnesses.** It would save repositories (one per product instead
of one per harness), but a harness can belong to more than one product, Loom would have to read PL
repos, and PL's reader would need a second file layout. One pattern across the suite (data repo + prefix
repos + shared map) costs nothing new in PL's reader: Loom just gets a prefix in `config.tools`.

**Who can be given a project.** The people EE's roster knows (`ee_design_review_data/users.json`) and any
other GitHub username. EE stays the home of People & access: PL never makes someone an FTE, and the
FTE list that is invited to every new repository is EE's. Someone added through PL is a **contractor**
in each tool's own roster (`users[login]` with `role: 'contractor'` and the shared id in `projects`), the
record EE's and ME's People pages already show and manage. So after a share, EE's People page lists the
person on the boards PL shared, as if they'd been added there.

**What is shared with a PL project:**

1. The PL project itself: into `review-pl-<slug>`, with its model files (`models/<project id>/`).
2. Each linked EE, ME and FW review: into that tool's `review-<tool>-<slug>` (created, or reused when
   the review is shared already). An EE board's Fabcheck files (`fabcheck/<board id>/`) move with it.
3. Each linked Loom harness: into `review-loom-<slug>`.
4. Purchased Parts have nothing to share.

Each step is the same routine (`assets/share.js`, `S.plShare`), run per tool with that tool's data repo
and prefix, so a tool whose sharing works is a tool whose data repo has a roster:

- read the tool's data repo: the roster and the design's file;
- create the private repo (or adopt one an interrupted share made; GitHub Actions turned off), and put
  the file there **byte for byte**; a file already there is left alone;
- move the design's extra files (Fabcheck runs, PL models): copy, then delete the originals;
- patch the roster: `shared[id]` and the contractor's `users[login]`. Before committing, the roster
  without those records must re-serialize to the original (normalized when EE never wrote it); the
  commit uses `force: false` and also deletes the data repo's copy of the file, now that the shared
  repo has it; afterwards the roster is read back;
- invite the FTEs and the chosen people.

Every step is safe to repeat: a second share of the same project invites again and changes nothing else.

**What a shared person can see and edit.**

- *Signoff PL:* the PL projects shared with them (PL lists `review-pl-*` repos when its data repo says
  404, as EE does), and the designs their token reaches: the reader already tolerates a missing data repo
  and lists each tool's prefix repos. They can edit the product tree, attach models (uploaded into the
  project's own repo) and write requirements into the reviews they're on. No People link, no New
  project (they have no data repo to put one in). PL still locks a token that reaches nothing.
- *Signoff EE/ME/FW:* exactly what those tools give a contractor today: their reviews, in full.
- *Loom:* the harnesses in the `review-loom-*` repos they reach, in full, synced the same way;
  `loom_data` is skipped on 404.

**Removing someone** from a PL project (the Share sheet's Remove) takes their GitHub access off the
project's repo and the repos of everything it links, and marks them off in each roster. Their copies
disappear at their next sync, as in EE. Removing a person from the suite altogether stays on EE's People
page.

## Contracts

- PL's reader contract (`meta` and `summary` of every design file) is unchanged.
- Loom's envelope (`{ schema, id, meta, summary, harness }`) is unchanged.
- New: `users.json` in `signoff_pl_data` and in `loom_data`, in the engine's roster format
  (`{ schema: 1, users: {}, shared: {} }`, `model.emptyRoster`), written and merged by the engine's
  `GitHubStore` as EE's is.
- PL's `config.repos` gains `prefix: 'review-pl-'` and `peopleRepo: 'ee_design_review_data'`; the Loom
  entry in `config.tools` gains `prefix: 'review-loom-'`. Loom's store gains `prefix: 'review-loom-'`.
- PL's Settings keep per-repo caches (`repoCache`), the project-to-repo map (`homes`) and PL's roster;
  `access.state` can now be `'contractor'`.
- Model files are read from the project's home repo (`homes[id]`), not always the data repo.
- Nothing in the engine (`model.js`, `github.js`) changed.

## Tokens

The owner's fine-grained token (Administration and Contents, All repositories) creates the repos and
invites people, as in EE. Any other FTE's token can share a review only where the repo exists already;
otherwise PL says so and stops. The token never leaves the browser; PL reads it from `signoff.token`
as every tool does.

## Open questions for Chris

1. **One repo per harness.** Sharing a product with five harnesses makes five `review-loom-*` repos next
   to the `review-pl-*` and the `review-ee-*` ones. If that's too many, the alternative is harnesses
   inside the PL project's repo (`loom/projects/<id>.json`), which means Loom reads PL repos and PL's
   reader learns a second layout. The code does per-harness.
2. **Whole product or part of it.** A shared PL project shows the person the whole tree, including
   Parts whose reviews they're not on (as names and numbers, with "Not found" where the summary can't be
   read). Is that acceptable, or should a shared person see only the Parts they were given?
3. **Removing people.** Should PL's Remove also take the person off reviews they reached only through
   this product (the code does), or leave the review shares to EE's and ME's People pages?
4. **One repo per shared thing, or one per client.** Chris's words were "shared as new private client
   repos". The code follows EE: one private repo per shared PL project, review or harness, and a client
   with two products gets two `review-pl-*` repos (plus their reviews' and harnesses' repos). The other
   reading is one private repo per client holding everything shared with them, which would mean a new
   layout every tool reads and writes. Say which you meant.
5. **First live share.** It creates real repositories with your token. Try it on a test product first
   (a PL project linking one test board and one test harness) and check EE's People page afterwards.
