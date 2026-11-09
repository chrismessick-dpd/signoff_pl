/* Signoff PL: the product-level tool of the Signoff suite. A PL project is a whole product,
   structured as a tree of assemblies whose leaves are Parts. A Part links to a design review
   in another Signoff tool (by tool and project id, never by repository), or is purchased.

   storage.ns:  localStorage namespace for this tool. The GitHub token (signoff.token) and the
                theme (signoff.v1.settings -> theme) are shared by every Signoff tool.
   repos:       where PL keeps its own projects: dataRepo (FTEs only) and prefix, the start of the
                name of each shared project's private repo (review-pl-<slug>). peopleRepo is Signoff
                EE's data repo, whose users.json is the home of People & access (docs/sharing.md).
   tools:       the Signoff tools a Part can link to. PL reads each project file's `summary`
                from the tool's data repo and from every repo starting with its prefix (none when
                the prefix is empty). `review: false` marks a tool whose designs aren't reviews
                (Loom's harnesses): they have no checks, so they stay out of progress and stages,
                and their name and number sync both ways (pl.js adoptHarnesses).
                `previews` is the folder a checker stores pictures in (Fabcheck's board
                previews, ee_design_review/docs/fabcheck-link.md; Loom's harness drawings,
                loom/assets/store.js storeDrawings).
   phases:      build phases, for gates (Phase 3 of the plan).
   demo:        the demo product. boardsMm stands in for the board size Fabcheck stores with its
                pictures (w, h, thickness in mm). Its Parts link to Signoff EE's, ME's, and FW's demo projects;
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
    "dataRepo": "signoff_pl_data",
    "prefix": "review-pl-",
    "peopleRepo": "ee_design_review_data"
  },
  "ids": { "project": "pl", "node": "n" },
  "phases": ["EVT", "DVT", "PVT"],
  "tools": [
    { "id": "ee", "name": "Signoff EE", "short": "EE", "desc": "Electrical design review",
      "dataRepo": "ee_design_review_data", "prefix": "review-ee-", "app": "../ee_design_review/index.html", "previews": "fabcheck/" },
    { "id": "me", "name": "Signoff ME", "short": "ME", "desc": "Mechanical design review",
      "dataRepo": "me_design_review_data", "prefix": "review-me-", "app": "../me_design_review/index.html" },
    { "id": "fw", "name": "Signoff FW", "short": "FW", "desc": "Firmware design review",
      "dataRepo": "fw_design_review_data", "prefix": "review-fw-", "app": "../fw_design_review/index.html" },
    { "id": "loom", "name": "Loom", "short": "Loom", "desc": "Harness drawing",
      "dataRepo": "loom_data", "prefix": "review-loom-", "app": "../loom/index.html", "review": false, "previews": "drawing/" }
  ],
  "demo": {
    "project": {
      "name": "Smart Thermostat", "client": "Acme Climate", "number": "DT-1000", "phase": "EVT",
      "description": "Wi-Fi smart thermostat powered from 100–240 V AC mains: touch display, room temperature and humidity sensing, and relays that switch the HVAC system's heat and cool calls. First engineering build (EVT)."
    },
    "tree": [
      { "key": "top", "kind": "assembly", "name": "Smart Thermostat", "number": "DT-1000" },
      { "key": "elec", "parent": "top", "kind": "assembly", "name": "Electronics" },
      { "key": "main", "parent": "elec", "kind": "part", "name": "Main PCBA", "source": "ee", "link": "ee:pdemo7", "massG": 48, "place": { "z": -5 } },
      { "key": "disp", "parent": "elec", "kind": "part", "name": "Display & Sensor Board", "source": "ee", "link": "ee:pdemo11", "massG": 22, "place": { "z": 5 } },
      { "key": "tft", "parent": "elec", "kind": "part", "name": "2.8\" TFT display module", "source": "purchased", "supplier": "Example Displays", "mpn": "TFT28-IPS-SPI", "massG": 18, "envelopeMm": "69 × 50 × 3.4" },
      { "key": "ffc", "parent": "elec", "kind": "part", "name": "FFC, 24-pin, 0.5 mm pitch", "source": "purchased", "supplier": "Example Interconnect", "mpn": "FFC-24-05-60", "massG": 1 },
      { "key": "fw", "parent": "elec", "kind": "part", "name": "Thermostat Firmware", "source": "fw", "link": "fw:fdemo3" },
      { "key": "mech", "parent": "top", "kind": "assembly", "name": "Housing" },
      { "key": "enc", "parent": "mech", "kind": "part", "name": "Front cover", "number": "2100410-011", "source": "me", "link": "me:mdemo5", "massG": 30, "place": { "z": 0 } },
      { "key": "encb", "parent": "mech", "kind": "part", "name": "Back cover", "number": "2100410-012", "source": "me", "link": "me:mdemo5", "massG": 20, "place": { "z": -10 } },
      { "key": "brkt", "parent": "mech", "kind": "part", "name": "Wall Bracket", "source": "me", "link": "me:mdemo13", "number": "2100410-020", "massG": 69.4, "place": { "z": -16 } },
      { "key": "screw", "parent": "mech", "kind": "part", "name": "Screw, M3.5 × 25, pan head", "source": "purchased", "supplier": "Example Fasteners", "mpn": "M35-25-PH-ZN", "qty": 2, "massG": 1.6 }
    ],
    "previews": {
      "ee:pdemo7": [["top", 640, 406], ["bottom", 640, 406]],
      "ee:pdemo11": [["top", 640, 407], ["bottom", 640, 407]],
      "me:mdemo5": [["iso", 640, 480], ["top", 640, 480], ["front", 640, 480], ["right", 640, 480]],
      "me:mdemo13": [["iso", 640, 480], ["top", 640, 480], ["front", 640, 480], ["right", 640, 480]]
    },
    "boardsMm": { "ee:pdemo7": [80, 50.7, 1.6], "ee:pdemo11": [72, 45.8, 1.0] },
    "models": {
      "enc": { "file": "2100410-011_B_front-cover.step", "tris": 1248, "bboxMm": [90, 90, 14], "mesh": ["7b85d57b85f51f084f0193d3f92353257d0a3756", 9332],
        "views": [["iso", "6b592a0cf0267272493980d53a0d201ee050f4c4", 6542], ["top", "ddaae0570a33b3fc8211de99ca2dbab8e9f90291", 3352],
          ["front", "aef3f34110fb009f29b8b41b13ae22410b5dfa04", 1770], ["right", "aef3f34110fb009f29b8b41b13ae22410b5dfa04", 1770]] },
      "encb": { "file": "2100410-012_B_back-cover.step", "tris": 576, "bboxMm": [90, 90, 10], "mesh": ["31f4d8071ae165c2a50fb01fa3fea6946721e707", 4111],
        "views": [["iso", "d2c2ec9c00d39fd16d47a9407cf55a8aa3897223", 6796], ["top", "4ea69a6bce748f8352b9a348153d36d1ca9c5ca5", 3482],
          ["front", "2f73264b4b651559f758921143ab21767cf2ce9c", 1486], ["right", "2f73264b4b651559f758921143ab21767cf2ce9c", 1486]] },
      "brkt": { "file": "2100410-020_B_wall-bracket.step", "tris": 852, "bboxMm": [70, 114.8, 6], "mesh": ["f5ac5ced80c5367225d4198b70cf506ac216a6eb", 6079],
        "views": [["iso", "fc4444721d3584c5549b69caf952c11bfcfb05fd", 6328], ["top", "6265446f91f7229492086f00fc007651074794e7", 3432],
          ["front", "fc34466dd0547ebb7eb542e5794da4cf4a5de29a", 1528], ["right", "b5e0f4a403aec28e13e22efcc07620c46d192647", 1596]] }
    },
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
