/* Signoff PL: the product-level tool of the Signoff suite. A PL project is a whole product,
   structured as a tree of assemblies whose leaves are Parts. A Part links to a design review
   in another Signoff tool (by tool and project id, never by repository), or is purchased.

   storage.ns:  localStorage namespace for this tool. The GitHub token (signoff.token) and the
                theme (signoff.v1.settings -> theme) are shared by every Signoff tool.
   repos:       where PL keeps its own projects (FTEs only; there are no shared PL repos).
   tools:       the Signoff tools a Part can link to. PL reads each project file's `summary`
                from the tool's data repo and from every repo starting with its prefix.
                `previews` is the folder a checker stores pictures in (Fabcheck's board
                previews, ee_design_review/docs/fabcheck-link.md).
   phases:      build phases, for gates (Phase 3 of the plan).
   demo:        the demo product. boardsMm stands in for the board size Fabcheck stores with its
                pictures (w, h, thickness in mm). Its Parts link to Signoff EE's, ME's and FW's demo projects;
                their summaries are in assets/demo-designs.js (tools/demo_designs.html builds it).
                requirements: the demo's System requirements (keys for parents and Parts) and the
                EE/ME/FW demo requirements each flows down to ('tool:design id:requirement id'). */
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
      "dataRepo": "ee_design_review_data", "prefix": "review-ee-", "app": "../ee_design_review/index.html", "previews": "fabcheck/" },
    { "id": "me", "name": "Signoff ME", "short": "ME", "desc": "Mechanical design review",
      "dataRepo": "me_design_review_data", "prefix": "review-me-", "app": "../me_design_review/index.html" },
    { "id": "fw", "name": "Signoff FW", "short": "FW", "desc": "Firmware design review",
      "dataRepo": "fw_design_review_data", "prefix": "review-fw-", "app": "../fw_design_review/index.html" }
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
      { "key": "fw", "parent": "elec", "kind": "part", "name": "Thermostat firmware", "source": "fw", "link": "fw:fdemo3" },
      { "key": "mech", "parent": "top", "kind": "assembly", "name": "Housing" },
      { "key": "enc", "parent": "mech", "kind": "part", "name": "Enclosure", "source": "me", "link": "me:mdemo5", "massG": 75 },
      { "key": "brkt", "parent": "mech", "kind": "part", "name": "Wall bracket", "source": "me", "link": "me:mdemo13", "massG": 38 },
      { "key": "screw", "parent": "mech", "kind": "part", "name": "Screw, M3.5 × 25, pan head", "source": "purchased", "supplier": "Example Fasteners", "mpn": "M35-25-PH-ZN", "qty": 2, "massG": 1.6 }
    ],
    "previews": {
      "ee:pdemo7": [["top", 640, 406], ["bottom", 640, 406]],
      "ee:pdemo11": [["top", 640, 407], ["bottom", 640, 407]]
    },
    "boardsMm": { "ee:pdemo7": [80, 50.7, 1.6], "ee:pdemo11": [72, 45.8, 1.0] },
    "requirements": [
      { "key": "temp", "text": "The thermostat shall measure room temperature to within ±0.5 °C from 5 to 35 °C.", "category": "Sensing", "source": "Acme DT-SPEC-12 §2.3", "method": "test", "status": "approved", "parts": ["disp", "enc"], "children": ["ee:pdemo11:q11-0", "me:mdemo5:q5-1"] },
      { "key": "esd", "text": "Every user-accessible point shall withstand ±8 kV contact and ±15 kV air ESD.", "category": "Interfaces", "source": "Acme DT-SPEC-12 §6.4", "method": "test", "status": "approved", "parts": ["main", "disp", "fw"], "children": ["ee:pdemo7:q7-2", "ee:pdemo11:q11-1", "fw:fdemo3:q3-1"] },
      { "key": "mass", "text": "The installed thermostat shall weigh no more than 250 g.", "category": "Mass", "source": "Acme DT-SPEC-12 §2.1", "method": "analysis", "status": "approved", "parts": ["enc"], "children": ["me:mdemo5:q5-2"] },
      { "key": "mains", "text": "The thermostat shall run from 100–240 V AC, 50/60 Hz mains.", "category": "Power", "source": "Acme DT-SPEC-12 §3.1", "method": "test", "status": "approved", "parts": ["main"], "children": ["ee:pdemo7:q7-0"] },
      { "key": "iso", "text": "Mains shall be separated from user-accessible circuits by reinforced insulation.", "category": "Safety", "source": "Acme DT-SPEC-12 §5.2", "method": "inspection", "status": "approved", "parts": ["main", "enc"], "children": ["ee:pdemo7:q7-1"] },
      { "key": "relay", "text": "Relay outputs shall switch 2 A at 250 V AC resistive for at least 100,000 cycles.", "category": "Outputs", "source": "Acme DT-SPEC-12 §4.3", "method": "analysis", "status": "approved", "parts": ["main"], "children": ["ee:pdemo7:q7-4"] },
      { "key": "cosmetic", "text": "The front cover shall meet the client's Class A cosmetic standard.", "category": "Cosmetic", "source": "Acme DT-SPEC-12 §7.1", "method": "inspection", "status": "approved", "parts": ["enc"], "children": ["me:mdemo5:q5-0"] },
      { "key": "mount", "text": "The thermostat shall mount to a single-gang electrical box.", "category": "Installation", "source": "Acme DT-SPEC-12 §8.2", "method": "inspection", "status": "approved", "parts": ["brkt"], "children": ["me:mdemo13:q13-0"] },
      { "key": "ota", "text": "Firmware shall update over the air and roll back after a failed image.", "category": "Firmware", "source": "Kickoff notes 2026-09-02", "method": "demonstration", "status": "draft", "parts": ["fw"], "children": ["fw:fdemo3:q3-0"] },
      { "key": "ambient", "text": "The thermostat shall operate from 0 to 40 °C ambient.", "category": "Environment", "source": "Acme DT-SPEC-12 §2.2", "method": "test", "status": "draft" }
    ]
  }
};
