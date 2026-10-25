/* Signoff PL: the product-level tool of the Signoff suite. A PL project is a whole product,
   structured as a tree of assemblies whose leaves are Parts. A Part links to a design review
   in another Signoff tool (by tool and project id, never by repository), or is purchased.

   storage.ns:  localStorage namespace for this tool. The GitHub token (signoff.token) and the
                theme (signoff.v1.settings -> theme) are shared by every Signoff tool.
   repos:       where PL keeps its own projects (FTEs only; there are no shared PL repos).
   tools:       the Signoff tools a Part can link to. PL reads each project file's `summary`
                from the tool's data repo and from every repo starting with its prefix.
                Adding Signoff FW later is one more entry here.
   phases:      build phases, for gates (Phase 3 of the plan).
   demo:        the demo product. Its Parts link to Signoff EE's and ME's demo projects; their
                summaries are in assets/demo-designs.js (tools/demo_designs.html builds it). */
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
      "name": "Smart Thermostat", "client": "Acme Climate", "number": "DT-1000", "phase": "EVT",
      "description": "Wi-Fi smart thermostat for 24 V AC HVAC systems: touch display, room temperature and humidity sensing, relay outputs. First engineering build."
    },
    "tree": [
      { "key": "top", "kind": "assembly", "name": "Smart Thermostat", "number": "DT-1000" },
      { "key": "elec", "parent": "top", "kind": "assembly", "name": "Electronics" },
      { "key": "main", "parent": "elec", "kind": "part", "name": "Main PCBA", "source": "ee", "link": "ee:pdemo7", "massG": 48 },
      { "key": "disp", "parent": "elec", "kind": "part", "name": "Display & sensor board", "source": "ee", "link": "ee:pdemo11", "massG": 22 },
      { "key": "tft", "parent": "elec", "kind": "part", "name": "2.8\" TFT display module", "source": "purchased", "supplier": "Example Displays", "mpn": "TFT28-IPS-SPI", "massG": 18, "envelopeMm": "69 × 50 × 3.4" },
      { "key": "ffc", "parent": "elec", "kind": "part", "name": "FFC, 24-pin, 0.5 mm pitch", "source": "purchased", "supplier": "Example Interconnect", "mpn": "FFC-24-05-60", "massG": 1 },
      { "key": "fw", "parent": "elec", "kind": "part", "name": "Thermostat firmware", "source": "fw" },
      { "key": "mech", "parent": "top", "kind": "assembly", "name": "Housing" },
      { "key": "enc", "parent": "mech", "kind": "part", "name": "Enclosure", "source": "me", "link": "me:mdemo5", "massG": 75 },
      { "key": "brkt", "parent": "mech", "kind": "part", "name": "Wall bracket", "source": "me", "link": "me:mdemo13", "massG": 38 },
      { "key": "screw", "parent": "mech", "kind": "part", "name": "Screw, M3.5 × 25, pan head", "source": "purchased", "supplier": "Example Fasteners", "mpn": "M35-25-PH-ZN", "qty": 2, "massG": 1.6 }
    ]
  }
};
