/* Signoff PL: the product-level tool of the Signoff suite. A PL project is a whole product,
   structured as a tree of assemblies whose leaves are Parts. A Part links to a design review
   in another Signoff tool (by tool and project id, never by repository), or is purchased.

   storage.ns:  localStorage namespace for this tool. The GitHub token (signoff.token) and the
                theme (signoff.v1.settings -> theme) are shared by every Signoff tool.
   repos:       where PL keeps its own projects (FTEs only; there are no shared PL repos).
   tools:       the Signoff tools a Part can link to. PL reads each project file's `summary`
                from the tool's data repo and from every repo starting with its prefix.
                Adding Signoff FW later is one more entry here.
   phases:      build phases, for gates (Phase 3 of the plan). */
window.SIGNOFF_CONFIG = {
  "product": "Signoff PL",
  "discipline": "PL",
  "tagline": "Project lead",
  "storage": { "ns": "signoff-pl.v1.", "demoNs": "signoff-pl.demo." },
  "hostedBase": "https://chrismessick-dpd.github.io",
  "repos": {
    "owner": "chrismessick-dpd",
    "toolRepo": "signoff_pl",
    "dataRepo": "signoff_pl_data"
  },
  "ids": { "project": "pl", "node": "n" },
  "phases": ["EVT", "DVT", "PVT"],
  "tools": [
    { "id": "ee", "name": "Signoff EE", "short": "EE", "desc": "Electrical design review",
      "dataRepo": "ee_design_review_data", "prefix": "review-ee-", "app": "../ee_design_review/index.html" },
    { "id": "me", "name": "Signoff ME", "short": "ME", "desc": "Mechanical design review",
      "dataRepo": "me_design_review_data", "prefix": "review-me-", "app": "../me_design_review/index.html" }
  ],
  "demo": {
    "project": {
      "name": "Harbor Water Monitor", "client": "Northwind Marine", "number": "HWM-100", "phase": "EVT",
      "description": "Solar-powered buoy that logs water temperature, turbidity and dissolved oxygen and reports over LTE. First engineering build."
    },
    "tree": [
      { "key": "top", "kind": "assembly", "name": "Buoy assembly", "number": "HWM-100-A" },
      { "key": "elec", "parent": "top", "kind": "assembly", "name": "Electronics module" },
      { "key": "main", "parent": "elec", "kind": "part", "name": "Main board", "source": "ee", "link": "main", "massG": 64 },
      { "key": "sens", "parent": "elec", "kind": "part", "name": "Sensor front end", "source": "ee", "link": "sens", "massG": 18 },
      { "key": "disp", "parent": "elec", "kind": "part", "name": "Status display firmware", "source": "fw" },
      { "key": "batt", "parent": "elec", "kind": "part", "name": "Li-ion battery pack, 3S2P", "source": "purchased", "supplier": "Example Cells Co.", "mpn": "EC-3S2P-7000", "massG": 310, "envelopeMm": "70 × 55 × 38" },
      { "key": "mech", "parent": "top", "kind": "assembly", "name": "Housing" },
      { "key": "hull", "parent": "mech", "kind": "part", "name": "Sealed housing", "source": "me", "link": "hull", "massG": 820 },
      { "key": "brkt", "parent": "mech", "kind": "part", "name": "Board mounting bracket", "source": "me", "link": "brkt", "qty": 2, "massG": 22 },
      { "key": "gland", "parent": "mech", "kind": "part", "name": "Cable gland, M12", "source": "purchased", "supplier": "Example Fittings", "mpn": "CG-M12-IP68", "qty": 3, "massG": 9 }
    ],
    "designs": {
      "main": { "tool": "ee", "name": "Harbor Monitor — Main Board", "number": "HWM-PCB-01", "revision": "A", "stage": "Layout", "total": 512, "reviewed": 341, "pct": 67,
        "checklists": { "schematic": { "name": "Schematic", "total": 150, "reviewed": 146, "pct": 97, "issuesOpen": 1 }, "pcb": { "name": "Layout", "total": 140, "reviewed": 88, "pct": 63, "issuesOpen": 2 } },
        "issues": { "open": { "critical": 1, "major": 1, "minor": 1 }, "fixed": 4, "waived": 1 },
        "open": [
          { "id": "pcb-rf-3", "severity": "critical", "text": "LTE antenna keep-out is violated by the ground pour under the module's feed point.", "checklist": "Layout", "assignee": "R. Ortiz", "ref": "U9, J5" },
          { "id": "sp3", "severity": "major", "text": "Decoupling meets the datasheet recommendation for each supply pin.", "checklist": "Schematic", "assignee": "R. Ortiz", "ref": "U4" },
          { "id": "pt1", "severity": "minor", "text": "Test points on every power rail and key signals.", "checklist": "Layout", "assignee": "", "ref": "3V3_AUX" }
        ],
        "reqs": { "total": 12, "approved": 10, "pass": 4, "fail": 0, "open": 8, "unlinked": 2 },
        "at": "2026-10-24T16:20:00Z", "by": "R. Ortiz" },
      "sens": { "tool": "ee", "name": "Harbor Monitor — Sensor Front End", "number": "HWM-PCB-02", "revision": "A", "stage": "Schematic", "total": 288, "reviewed": 92, "pct": 32,
        "checklists": { "schematic": { "name": "Schematic", "total": 150, "reviewed": 92, "pct": 61, "issuesOpen": 1 } },
        "issues": { "open": { "critical": 0, "major": 1, "minor": 0 }, "fixed": 0, "waived": 0 },
        "open": [ { "id": "adc4", "severity": "major", "text": "ADC reference noise and drift fit the measurement accuracy budget.", "checklist": "Schematic", "assignee": "K. Lin", "ref": "U2 REF" } ],
        "reqs": null, "at": "2026-10-23T11:05:00Z", "by": "K. Lin" },
      "hull": { "tool": "me", "name": "Harbor Monitor — Sealed Housing", "number": "HWM-ME-10", "revision": "B", "stage": "Prototype (EVT)", "total": 420, "reviewed": 260, "pct": 62,
        "checklists": { "enclosure": { "name": "Enclosure", "total": 45, "reviewed": 35, "pct": 78, "issuesOpen": 1 } },
        "issues": { "open": { "critical": 0, "major": 1, "minor": 1 }, "fixed": 2, "waived": 0 },
        "open": [
          { "id": "enc-seal-2", "severity": "major", "text": "Gasket compression stays within the material's recommended range across the tolerance stack.", "checklist": "Enclosure", "assignee": "D. Kim", "ref": "Lid gasket" },
          { "id": "drw-4", "severity": "minor", "text": "Every drawing calls out material, finish and the governing standard.", "checklist": "Drawings", "assignee": "", "ref": "HWM-ME-10 sheet 2" }
        ],
        "reqs": { "total": 6, "approved": 6, "pass": 2, "fail": 1, "open": 3, "unlinked": 0 },
        "at": "2026-10-24T09:40:00Z", "by": "D. Kim" },
      "brkt": { "tool": "me", "name": "Harbor Monitor — Board Bracket", "number": "HWM-ME-14", "revision": "A", "stage": "Detail design", "total": 210, "reviewed": 0, "pct": 0,
        "checklists": {}, "issues": { "open": { "critical": 0, "major": 0, "minor": 0 }, "fixed": 0, "waived": 0 }, "open": [],
        "reqs": null, "at": "2026-10-20T14:00:00Z", "by": "D. Kim", "noSummary": true }
    }
  }
};
