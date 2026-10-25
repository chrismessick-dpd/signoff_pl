# Signoff PL roadmap

Decisions made so far (2026-10-25):
- PL is **FTE-only**.
- Its children are called **Parts**. Signoff EE and ME still say "Projects" on screen.
- Gates use **EVT / DVT / PVT**.
- Each tool keeps its own stage names. Gates will tie them together; PL never maps one tool's
  stages onto another's.

## Phase 0: project summaries — done

Signoff EE and ME write a `summary` block into every project file at sync. That covers stage,
progress per checklist, open issues by severity with the list of issues, requirement counts,
and the latest edit. The format is in Signoff EE's README (*The project summary*).

## Phase 1: structure and roll-up — done

- The product tree, with Parts linked by `{tool, id}`.
- Purchased and firmware Parts.
- Roll-up of progress, issues, stages and mass, and one combined issue list.
- Deep links: EE and ME accept `?project=<id>&item=<check>`.
- A demo built from the EE and ME demos.

## Phase 2: requirements allocation

Product requirements are written in PL and allocated down to the requirements in the Parts'
reviews.

- **Where they live.** Store `reqs` in the PL project document, with the same record shape as
  EE/ME requirements:
  - fields: `ref`, `text`, shall/should, `category`, `source`, method, `status`, `verify`,
    `evidence`
  - `links`: Part requirements, as `{ tool, project, ref }`
  - Reuse the EE/ME import and export (`parseTable`, `importReqs`, CSV), which are already in the
    vendored `model.js`.
- **Data needed.** The summary only counts requirements. Allocation needs the list itself:
  `{ id, ref, text, status, verify }` for each live requirement. Add it to `projectSummary` in the
  EE engine as `summary.reqList`, and keep it small. Readers must cope when it's missing. Then
  regenerate PL's demo snapshot.
- **Roll-up.** A product requirement is:
  - **met** when every allocated requirement passes
  - **failing** when any allocated requirement fails, or traces to an open issue
  - **open** otherwise
- **Views.** A Requirements tab in PL, and a compliance matrix export.

## Phase 3: interfaces, gates and a project checklist

- **Interfaces** between Parts, for example board to enclosure, board to board, and display to
  firmware. Each has an owner on both sides, the agreed values or documents, and a status.
  Interface issues show on both Parts.
- **Gates (EVT, DVT, PVT).** Each gate has criteria. Some are computed from the Part summaries:
  - every linked design at a set stage in its own tool
  - no open critical issues
  - the requirements allocated to that gate verified

  Others are manual sign-offs, such as "certification pre-scan done". A gate shows ready,
  blocked (listing the blockers) or passed, with who signed it off and when.
- **A project-level checklist:** integration, certification, labeling, packaging, service. It
  could be a PL template on the same checklist engine.

## Signoff FW

Firmware reviews belong in a new tool on the shared engine, configured like Signoff ME:
- its own repo, data repo and `review-fw-` prefix
- firmware checklists

When it exists, add it to `config.tools` here. FW Parts then link like EE and ME ones, and the
built-in "FW, no review tool yet" source goes away. Add its repos to every tool's `repos.suite`.

## Smaller items

- Show a Part's linked requirement and checklist detail in the Part sheet, not only counts.
- Export the product structure (indented BOM with mass) to CSV.
- Fabcheck's demo board is a scrubbed real board, not part of the Smart Thermostat story. A
  thermostat board package would make the whole suite demo consistent.
