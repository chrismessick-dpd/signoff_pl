# Signoff PL People & access

*2026-11-07, branch `perm-sketches`. Static, clickable pages with made-up data. They aren't wired into
the app yet and write nothing to GitHub.*

**Scope.** This is Signoff PL's settings only. Signoff EE, ME, and FW keep their existing people pages
unchanged, each managing its own people. PL reads all of those lists and can set access in any of
their repos.

Chris asked for "one tab that has a hierarchical type view, somehow with projects, people, and
permissions in sub-repos specified for all the parts in the project". Four layouts were tried. Chris
kept two (2026-11-07), which are now the two tabs at the top of each page: **Person first** and **Tree
with people**. Both use the same made-up data and the same rules (`perm.js`), so only the layout
differs. Serve the tools folder and open `/_pl-perm/lab/permissions/` (preview `signoff-suite-alt`,
port 8774). It opens on Person first.

## The access model

Each person has one of three modes per PL project:

| Mode | Meaning | Where it's recorded |
| --- | --- | --- |
| **Whole system** | The PL project and every linked review, now and anything linked later | PL `users.json`, no `scopes` entry; each tool's `users.json` for the repos |
| **PL + chosen Parts** | The PL project, plus only the Parts ticked | PL `scopes[projectId] = 'project'`; each tool's `users.json` |
| **Parts only** | Not on the PL project; only the reviews ticked | Each tool's `users.json` only (as if added from EE's or ME's People) |

FTEs come from Signoff EE's roster, see everything, and are never editable here. A Part lives in its
tool's FTE-only data repo until it's shared, then in its own `review-<tool>-<slug>` repo. Purchased
Parts have no Signoff tool and nothing to share, so this page leaves them out (Chris, 2026-11-07). They
come with the PL project for whoever has it.

### Roles

People have three roles (Chris, 2026-11-07): **FTE**, **Client**, and **Contractor**, stored in the roster
as `users[login].role` (`'fte'`, `'client'`, or `'contractor'`). A client and a contractor get the same
kind of access, only what's shared with them (`M.isOutside(u)` is true for both), but they're labeled
separately. Each role has its own icon and word, and none relies on color:

| Role | Tag |
| --- | --- |
| FTE | lock, "FTE", gray fill |
| Client | building, "Client", outlined |
| Contractor | wrench, "Contractor", light fill |

Clients also have a **company** (`users[login].company`), because one company will usually have many
clients (Chris, 2026-11-07):
- **Person first:** each card reads name, then company · projects (for example "Acme Climate · Smart
  Thermostat"; the role is the group heading), then **Access**: "Full project" for Whole system on every project
  they're on, otherwise a badge per tool they can open something in. Clients are split into folding
  company groups, each showing its people's pictures
  when folded. The search box also matches company names.
- **Tree with people:** the add popover lists clients under their company, and chip tooltips and the
  person popover name the company.

How each tab shows the role:
- **Person first:** the cards sit under FTE, Client, and Contractor headings.
- **Tree with people:** each person chip carries the role icon, and the add popover groups people by
  role.

### Cell states

None of the states differ by color alone. Each one has an icon, a word, and a pattern:

| State | Look |
| --- | --- |
| FTE | lock, "FTE", gray |
| Has access | check, "Access" |
| Inherited | arrow, outline only (from Whole system) |
| Invite pending | clock, "Invited", `--warn-hatch` dots |
| Not shared yet | dashed box, "New repo", dashed border (Apply would create a private repo) |
| Invite to an existing repo | plus, "Invite" |
| Remove | minus, struck-through "Remove", `--issue-hatch` stripes |

### Legend

The legend is one compact strip of three labeled groups:
- **Access:** given, inherited, and invited. On Tree with people these are drawn as chip samples.
- **On Apply:** new repo, invite, and remove.
- **Roles:** FTE, Client, and Contractor.

Hovering over a sample shows its full meaning.

Every page has a **changes footer** that lists what Apply would do: repos to create, invitations,
removals, and which roster (`PL users.json`, `ME users.json`, and so on) gets written. One change is
staged when a page loads (Alex Kim → Wall Bracket, an unshared ME part), so the "new repo" path is
visible from the start.

### The data

- **Smart Thermostat** (Acme Climate) is shared. It has Electronics (Main PCBA, Display & Sensor Board,
  Thermostat Firmware, and Display Ribbon Harness) and Housing (Enclosure, and Wall Bracket, which isn't
  shared yet).
- **Air Quality Sensor** is internal.
- **People:**
  - Two FTEs.
  - Clients from **Acme Climate**:
    - **Morgan Hale**, the program manager, has Whole system. Their invite to the harness linked later
      is still pending.
    - **Dana Ortiz**, a quality engineer, has Parts only: the Enclosure.
    - **Lee Wong**, the firmware lead, has PL + chosen Parts: the firmware.
  - **Ari Shah**, a client from **Northwind Retail**, has nothing shared yet.
  - **Jordan Lee**, an EE contractor, has Parts only: Main PCBA, plus a pending invite to the Display
    board.
  - **Alex Kim**, an ME contractor, has PL + chosen Parts.
  - **Casey Wu**, an FW contractor, has PL + chosen Parts, with both invites pending.
  - **Riley Park**, an ME contractor, is on ME's people list with nothing shared in PL.

## The two tabs

### Person first (`people.html`)

There's a card per person (all FTEs share one card). Each card opens to that person's projects, each
with its mode switch, and then the tree with checkboxes.

- **Pros:**
  - Answers "what can Jordan open?" and makes onboarding or offboarding someone easy.
  - Shows a person across several PL projects.
  - Scales with many people.
  - Phone-friendly.
- **Cons:**
  - You can't see who else is on a Part without opening every card.
  - The tree repeats once per person.

### Tree with people (`chips.html`)

This is PL's tree, with avatar chips per node:
- A solid chip means access was given at that node.
- A dashed chip means it's inherited from Whole system.
- On an assembly, a person with only some of its Parts reads "Lee · 1 of 4 Parts".
- FTEs aren't listed on nodes: they see everything.
- A corner badge marks a pending invite, a new repo, an invite, or a removal.
- Each chip also carries the person's role icon.

Clicking a chip explains why the person has access and offers Take away. The + on a node opens a
checklist of people, which on an unshared Part says which repo it would create.

- **Pros:**
  - It's the most "hierarchical": it reads like the System tree Chris already uses.
  - Inheritance is visible right where it applies.
  - Only people with access take up space.
- **Cons:**
  - Absence is invisible: you notice who's missing only by reading names.
  - Every change goes through a popover, which is slow for bulk edits.

The two tabs complement each other: Tree with people answers "who can open this Part?", and Person
first answers "what can this person open?". Keep these in either tab:
- the three modes, worded as Whole system, PL + chosen Parts, and Parts only;
- the changes footer naming repos and rosters before Apply;
- dashed "New repo" for anything not shared yet;
- inherited access drawn as outlines, not fills.

### Dropped (Chris, 2026-11-07)

These two were removed in the commit after `90aa2c0`:
- **Tree × people:** a matrix with a column per person.
- **Tree and detail:** a tree with a detail panel for the selected node.

## Decisions (Chris, 2026-11-07)

1. **Each tool manages its own people, and PL manages them all.**
   - EE, ME, and FW each keep their own people and access page and manage only their own people. For
     example, ME contractors aren't handled in EE.
   - PL reads every tool's people list. Its list is therefore the whole company, and it can set access
     in any tool's repos.
   - In these pages:
     - Every person shows which tools' people lists they're on ("People lists"), with the tool that
       added them outlined.
     - Riley Park is an ME contractor with nothing shared in PL yet.
   - EE, ME, and FW keep their existing people pages as they are. Only PL's settings change.
2. **A newly linked Part waits for Apply**, as long as it's obvious that nothing has happened yet, and
   obvious when it has. The footer has three plain states:
   - **Staged:** "N changes not applied · Nothing has changed on GitHub yet". The footer gets a dashed
     top edge.
   - **Applied:** "N changes done just now". Each step gets a check, and new invites show as Invited
     until they're accepted.
   - **Live:** "No staged changes · Everything shown is what GitHub has".

   Here, Apply is simulated in the page.
3. **Removing someone from a PL project asks what to remove.** There are two choices:
   - **Only the PL project:** they keep their Parts, which are named in the dialog, and stay on those
     tools' people lists.
   - **The PL project and its Parts:** this also takes them off every repo, and the dialog lists the
     repos.

   The question appears whenever someone would leave the PL project: the × on a project, Remove from
   every project, choosing Parts only, or Take away on a PL project chip. Switching from Whole system to
   PL + chosen Parts isn't a removal: what they can open stays ticked.

## Files

| File | What |
| --- | --- |
| `index.html` | Opens Person first |
| `perm.js` | Made-up data, access rules (`cell`, `toggle`, `setMode`), the change planner (`plan`), and shared UI (pills, legend, chrome, footer) |
| `perm.css` | Shared styles: state pills, avatars, repo tags, footer, popover |
| `people.*`, `chips.*` | One tab each (page plus script) |

They load `../../assets/suite.css` and `../../assets/pl.css`. The theme toggle (Auto, Light, Dark) is
kept in `signoff.lab.permTheme` and starts from the suite's shared theme setting.
