const express = require("express");
const cors = require("cors");
const store = require("./db");
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");

const PORT = 4756; // arbitrary local port for the App A <-> extension bridge

// --- demo-only connectivity mock state (real network detection is a post-demo phase) ---
const appState = {
  online: true,
  lastSync: new Date().toISOString(),
  pendingChanges: 0,
  syncing: false,
};

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function findNearDuplicateSerial(serial) {
  const all = store.getAllAssets();
  for (const a of all) {
    if (a.serial_number === serial) continue; // exact match handled separately
    if (levenshtein(a.serial_number.toUpperCase(), serial.toUpperCase()) <= 1) {
      return a.serial_number;
    }
  }
  return null;
}

function tryUpsertAsset(
  results,
  { type, model, serial_number, assigned_workday_id, assigned_name, site },
) {
  if (!serial_number) return;
  const serial = String(serial_number).trim();
  if (!serial) return;
  const exact = store.getAllAssets().find((a) => a.serial_number === serial);
  if (!exact) {
    const near = findNearDuplicateSerial(serial);
    if (near) {
      results.ambiguous.push({ incoming: serial, closeMatchTo: near });
      return;
    }
  }
  const r = store.upsertAsset({
    type,
    model,
    serial_number: serial,
    assigned_workday_id,
    assigned_name,
    site,
    origin: "extension",
  });
  results[r.action]++;
}

// --- Fictitious/demo data generation ---
// The real intake sheet has no Workday ID, Project, Team Leader, Phone, or
// Site columns. For the demo we fill these in deterministically (same agent
// name always yields the same fake values, so re-importing the same file
// doesn't produce different data each time).
const DEMO_SITES = ["Lisbon", "Porto", "Braga"];
const DEMO_TEAM_LEADERS = [
  "Ana Silva",
  "Carlos Santos",
  "Marta Oliveira",
  "Pedro Costa",
  "Joana Ferreira",
];

function seedHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function pick(arr, seed) {
  return arr[seedHash(seed) % arr.length];
}
function fakeWorkdayId(seed) {
  return "WD" + String(100000 + (seedHash(seed + "wd") % 900000));
}
function fakePhone(seed) {
  const n = seedHash(seed + "ph") % 90000000;
  return "9" + String(10000000 + n);
}

function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  // Every response from this local API is dynamic data the UI polls every
  // ~2s — none of it should ever be cached by Electron/Chromium. Applying
  // this once here, instead of per-endpoint, avoids repeating the same
  // stale-data bug on every new route we add.
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  app.get("/api/status", (req, res) => res.json(appState));

  app.post("/api/connectivity", (req, res) => {
    // demo-only toggle, simulates going offline/online
    const { online } = req.body;
    appState.online = !!online;
    if (online && appState.pendingChanges > 0) {
      appState.syncing = true;
      setTimeout(() => {
        appState.syncing = false;
        appState.pendingChanges = 0;
        appState.lastSync = new Date().toISOString();
      }, 1200); // simulated sync delay for the demo
    }
    res.json(appState);
  });

  app.get("/api/users", (req, res) => {
    store.sweepOverdueKanbanStages();
    res.json(store.getAllUsers());
  });
  app.get("/api/assets", (req, res) => res.json(store.getAllAssets()));
  app.get("/api/history", (req, res) => res.json(store.getHistory(100)));

  // IT staff roster — login identity + availability status.
  // No password/auth here (real AD login is a post-demo item); this is
  // purely "pick who you are" so the app knows whose row is editable.
  app.get("/api/job-titles", (req, res) => res.json(store.JOB_TITLES));

  app.get("/api/staff", (req, res) => {
    store.syncTeamLeaderLogins();
    res.json(store.getAllStaff());
  });

  // Full (non-truncated) ticket list for one IT staff member, plus closing one.
  app.get("/api/staff/:name/tickets", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.json(store.getTicketsForStaff(decodeURIComponent(req.params.name)));
  });

  app.post("/api/history/:id/close-ticket", (req, res) => {
    const closedBy = (req.body && req.body.closedBy) || "?";
    const updated = store.closeTicket(req.params.id, closedBy);
    if (!updated) return res.status(404).json({ error: "Ticket not found" });
    res.json(updated);
  });

  app.post("/api/staff", (req, res) => {
    const created = store.createStaff(req.body || {});
    res.status(201).json(created);
  });

  app.put("/api/staff/:id", (req, res) => {
    const updated = store.updateStaffById(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Staff not found" });
    res.json(updated);
  });

  app.delete("/api/staff/:id", (req, res) => {
    const ok = store.deleteStaffById(req.params.id);
    if (!ok) return res.status(404).json({ error: "Staff not found" });
    res.json({ deleted: true });
  });

  // Bulk delete all Users & Assets — restricted to a specific allow-list,
  // checked here server-side (not just a hidden button) so the restriction
  // holds even if someone calls the API directly.
  const BULK_DELETE_ALLOWED = [
    "Ruben Quintino",
    "Fernando Costa",
    "Pedro Lopes",
  ];
  app.post("/api/admin/delete-all", (req, res) => {
    const actorName = (req.body && req.body.actorName) || "";
    if (!BULK_DELETE_ALLOWED.includes(actorName)) {
      return res
        .status(403)
        .json({ error: "Not authorized to perform this action" });
    }
    const result = store.deleteAllUsersAndAssets(actorName);
    res.json(result);
  });

  // Manual user CRUD (Add/Edit/Delete buttons in the app UI)
  // Manual "Add User & IT Equipment" — unlike Excel import, blank fields are
  // saved as "?" rather than fictitious data, since this is a deliberate
  // manual entry the IT staffer can edit later.
  app.post("/api/users/create-with-kit", (req, res) => {
    const b = req.body || {};
    const orMark = (v) => (v && String(v).trim() ? String(v).trim() : "?");
    const orNA = (v) => (v && String(v).trim() ? String(v).trim() : "N/A");
    const results = { created: 0, updated: 0, ambiguous: [], errors: [] };

    try {
      const agentName = (b.agent_name || "").trim();
      if (!agentName)
        return res.status(400).json({ error: "Agent name is required" });

      const workdayId = orMark(b.workday_id);
      const site = orNA(b.site);
      const itTicket = orMark(b.it_ticket);
      const r = store.upsertUser(
        {
          name: agentName,
          workday_id: workdayId,
          project: orMark(b.project),
          team_leader: orMark(b.team_leader),
          phone: orMark(b.phone),
          it_ticket: itTicket,
          origin: "app",
        },
        /* forceMatchByName */ true,
      );
      results[r.action]++;

      // Assets only get created if a real serial is provided — a serial of
      // "?" would collide across every incomplete kit, so blank stays blank.
      tryUpsertAsset(results, {
        type: "pc",
        model: orMark(b.computer_model),
        serial_number: b.computer_serial,
        assigned_workday_id: workdayId,
        assigned_name: agentName,
        site,
      });
      tryUpsertAsset(results, {
        type: "monitor",
        model: orMark(b.monitor1_model),
        serial_number: b.monitor1_serial,
        assigned_workday_id: workdayId,
        assigned_name: agentName,
        site,
      });
      tryUpsertAsset(results, {
        type: "monitor",
        model: orMark(b.monitor2_model),
        serial_number: b.monitor2_serial,
        assigned_workday_id: workdayId,
        assigned_name: agentName,
        site,
      });
      tryUpsertAsset(results, {
        type: "mfa_key",
        model: "YubiKey",
        serial_number: b.mfa,
        assigned_workday_id: workdayId,
        assigned_name: agentName,
        site,
      });

      const accessories = [];
      if (b.webcam) accessories.push("Webcam");
      if (b.headset) accessories.push("Headset");
      if (b.ethernet_cable) accessories.push("Ethernet cable");
      if (b.kbm) accessories.push("Keyboard/mouse");
      if (b.power_video_cables) accessories.push("Power/video cables");

      const detailParts = [];
      detailParts.push(`IT Ticket: ${itTicket}`);
      detailParts.push(
        accessories.length
          ? `Accessories: ${accessories.join(", ")}`
          : "Accessories: ?",
      );
      detailParts.push(`Notes: ${orMark(b.obs)}`);
      store.logHistory(
        "user",
        r.key,
        "kit_delivered",
        detailParts.join(" | "),
        site,
        orMark(b.received_by),
        itTicket,
      );

      if (!appState.online)
        appState.pendingChanges += results.created + results.updated;
      else appState.lastSync = new Date().toISOString();

      res.status(201).json(results);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/users", (req, res) => {
    const created = store.createUser(req.body || {});
    const { it_ticket, received_by } = req.body || {};
    if (it_ticket && it_ticket !== "?" && received_by) {
      store.logHistory(
        "user",
        created.workday_id || created.name,
        "ticket_logged",
        `IT Ticket ${it_ticket} logged via manual entry`,
        null,
        received_by,
        it_ticket,
      );
    }
    if (!appState.online) appState.pendingChanges += 1;
    else appState.lastSync = new Date().toISOString();
    res.status(201).json(created);
  });

  app.put("/api/users/:id", (req, res) => {
    const updated = store.updateUserById(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "User not found" });
    const { it_ticket, received_by } = req.body || {};
    if (it_ticket && it_ticket !== "?" && received_by) {
      store.logHistory(
        "user",
        updated.workday_id || updated.name,
        "ticket_logged",
        `IT Ticket ${it_ticket} logged via manual edit`,
        null,
        received_by,
        it_ticket,
      );
    }
    if (!appState.online) appState.pendingChanges += 1;
    else appState.lastSync = new Date().toISOString();
    res.json(updated);
  });

  app.delete("/api/users/:id", (req, res) => {
    const ok = store.deleteUserById(req.params.id);
    if (!ok) return res.status(404).json({ error: "User not found" });
    if (!appState.online) appState.pendingChanges += 1;
    else appState.lastSync = new Date().toISOString();
    res.json({ deleted: true });
  });

  // Legacy simple import: one row = one user (by workday_id) + one asset (by serial_number).
  // Kept for flat/simple sheets. For the real intake-sheet layout, see /api/import-kits below.
  app.post("/api/import", (req, res) => {
    const rows = req.body.rows || [];
    const results = { created: 0, updated: 0, ambiguous: [], errors: [] };
    for (const row of rows) {
      try {
        if (row.workday_id) {
          const r = store.upsertUser({
            workday_id: String(row.workday_id).trim(),
            name: row.name,
            project: row.project,
            team_leader: row.team_leader,
            phone: row.phone,
            origin: "extension",
          });
          results[r.action]++;
        }
        tryUpsertAsset(results, {
          type: row.type,
          serial_number: row.serial_number,
          assigned_workday_id: row.workday_id,
          assigned_name: row.name,
          site: row.site,
        });
      } catch (e) {
        results.errors.push({ row, error: e.message });
      }
    }
    if (!appState.online)
      appState.pendingChanges += results.created + results.updated;
    else appState.lastSync = new Date().toISOString();
    res.json(results);
  });

  // Kit import: one row = one agent's full delivery kit (PC + up to 2 monitors + MFA key
  // + accessory checkboxes), matching the real intake-sheet layout.
  app.post("/api/import-kits", (req, res) => {
    const kits = req.body.kits || [];
    const results = { created: 0, updated: 0, ambiguous: [], errors: [] };

    for (const kit of kits) {
      try {
        let userKey = null;
        let site = null;
        let resolvedWorkdayId = null;
        if (kit.agent_name) {
          site = kit.site || pick(DEMO_SITES, kit.agent_name);
          resolvedWorkdayId = kit.workday_id || fakeWorkdayId(kit.agent_name);
          const r = store.upsertUser(
            {
              name: kit.agent_name,
              workday_id: resolvedWorkdayId,
              project: kit.project || "?",
              team_leader:
                kit.team_leader || pick(DEMO_TEAM_LEADERS, kit.agent_name),
              phone: kit.phone || fakePhone(kit.agent_name), // real phone from sheet when present, fictitious fallback otherwise
              it_ticket: kit.it_ticket || "?",
              origin: "extension",
            },
            /* forceMatchByName */ true,
          );
          results[r.action]++;
          userKey = r.key;
        }

        tryUpsertAsset(results, {
          type: "pc",
          model: kit.computer_model,
          serial_number: kit.computer_serial,
          assigned_workday_id: resolvedWorkdayId,
          assigned_name: kit.agent_name,
          site,
        });
        tryUpsertAsset(results, {
          type: "monitor",
          model: kit.monitor1_model,
          serial_number: kit.monitor1_serial,
          assigned_workday_id: resolvedWorkdayId,
          assigned_name: kit.agent_name,
          site,
        });
        tryUpsertAsset(results, {
          type: "monitor",
          model: kit.monitor2_model,
          serial_number: kit.monitor2_serial,
          assigned_workday_id: resolvedWorkdayId,
          assigned_name: kit.agent_name,
          site,
        });
        tryUpsertAsset(results, {
          type: "mfa_key",
          model: "YubiKey",
          serial_number: kit.mfa,
          assigned_workday_id: resolvedWorkdayId,
          assigned_name: kit.agent_name,
          site,
        });

        const accessories = [];
        if (kit.webcam) accessories.push("Webcam");
        if (kit.headset) accessories.push("Headset");
        if (kit.ethernet_cable) accessories.push("Ethernet cable");
        if (kit.kbm) accessories.push("Keyboard/mouse");
        if (kit.power_video_cables) accessories.push("Power/video cables");

        if (
          userKey &&
          (accessories.length || kit.obs || kit.rdate || kit.it_ticket)
        ) {
          const detailParts = [];
          if (kit.it_ticket) detailParts.push(`IT Ticket: ${kit.it_ticket}`);
          if (kit.rdate) detailParts.push(`Delivered ${kit.rdate}`);
          if (accessories.length)
            detailParts.push(`Accessories: ${accessories.join(", ")}`);
          if (kit.obs) detailParts.push(`Notes: ${kit.obs}`);
          store.logHistory(
            "user",
            userKey,
            "kit_delivered",
            detailParts.join(" | "),
            site,
            kit.received_by || undefined,
            kit.it_ticket || undefined,
          );
        }
      } catch (e) {
        results.errors.push({ kit, error: e.message });
      }
    }

    if (!appState.online)
      appState.pendingChanges += results.created + results.updated;
    else appState.lastSync = new Date().toISOString();
    res.json(results);
  });

  // Return of IT Equipment — generates a .docx for one employee, listing
  // their assigned equipment. receivedBy comes from whoever is logged in
  // when the download is triggered (or "?" if nobody is).
  app.get("/api/users/:id/return-docx", async (req, res) => {
    try {
      const user = store
        .getAllUsers()
        .find((u) => u.id === Number(req.params.id));
      if (!user) return res.status(404).json({ error: "User not found" });

      const norm = (v) =>
        String(v || "")
          .trim()
          .toLowerCase();
      const theirAssets = store
        .getAllAssets()
        .filter(
          (a) =>
            (a.assigned_workday_id &&
              user.workday_id &&
              norm(a.assigned_workday_id) === norm(user.workday_id)) ||
            (a.assigned_name && norm(a.assigned_name) === norm(user.name)),
        );
      const pc = theirAssets.find((a) => a.type === "pc");
      const monitors = theirAssets.filter((a) => a.type === "monitor");
      const monitor1 = monitors[0];
      const mfa = theirAssets.find((a) => a.type === "mfa_key");
      const site = pc?.site || monitor1?.site || mfa?.site || "?";

      const receivedBy = req.query.receivedBy
        ? String(req.query.receivedBy)
        : "?";
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-GB");

      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                text: "Return of IT Equipment",
                heading: HeadingLevel.HEADING_1,
              }),
              new Paragraph({ text: "" }),
              new Paragraph({
                children: [
                  new TextRun(
                    `The employee named ${user.name} with WorkdayID ${user.workday_id || "?"}, from the project ${user.project || "?"} returned the following IT equipment on day ${dateStr}, with her/him Team Leader being ${user.team_leader || "?"}:`,
                  ),
                ],
              }),
              new Paragraph({ text: "" }),
              new Paragraph({
                children: [
                  new TextRun(
                    `Computer Model ${pc?.model || "?"} with SN (${pc?.serial_number || "?"}), monitor 1 ${monitor1?.model || "?"} with SN of the monitor 1 (${monitor1?.serial_number || "?"}), Yubikey with the number (${mfa?.serial_number || "?"}) on site ${site}, on the date ${dateStr}`,
                  ),
                ],
              }),
              new Paragraph({ text: "" }),
              new Paragraph({
                children: [
                  new TextRun(`The equipment was received by IT ${receivedBy}`),
                ],
              }),
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      const safeName = user.name.replace(/[^a-z0-9]+/gi, "_");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="Return_${safeName}.docx"`,
      );
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Process Board (Kanban) — manager-only view in the UI; the API itself
  // isn't restricted here since there's no real auth in this demo, matching
  // how the rest of the app's permission gating works (UI-level, not server-enforced).
  app.get("/api/kanban", (req, res) =>
    res.json({
      columns: store.KANBAN_COLUMNS,
      cards: store.getAllKanbanCards(),
    }),
  );

  app.post("/api/kanban", (req, res) => {
    const created = store.createKanbanCard(req.body || {});
    res.status(201).json(created);
  });

  app.put("/api/kanban/:id", (req, res) => {
    const updated = store.updateKanbanCard(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Card not found" });
    res.json(updated);
  });

  app.delete("/api/kanban/:id", (req, res) => {
    const ok = store.deleteKanbanCard(req.params.id);
    if (!ok) return res.status(404).json({ error: "Card not found" });
    res.json({ deleted: true });
  });

  // Employee Process Board — advance the employee's stage by one (Operations
  // -> TA -> PS -> IT -> Facilities -> Team Leaders -> End of Process).
  // Not server-enforced per-department (matches the rest of this demo's
  // UI-level permission gating) — the frontend only shows the approve
  // action to whoever is authorized for that specific card's stage.
  app.post("/api/users/:id/kanban-advance", (req, res) => {
    const approverName = (req.body && req.body.approverName) || "?";
    const updated = store.advanceUserKanbanStage(req.params.id, approverName);
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json(updated);
  });

  // End of Process checkbox — manager-only in the UI, locks the card once checked.
  app.post("/api/users/:id/kanban-end-check", (req, res) => {
    const { checked, approverName } = req.body || {};
    const updated = store.setEndOfProcessChecked(
      req.params.id,
      checked,
      approverName || "?",
    );
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json(updated);
  });

  // Ticket Management — creation restricted to Team Leaders, Operations,
  // HR, and IT itself (enforced server-side, not just a hidden button).
  app.get("/api/tickets", (req, res) => res.json(store.getAllTickets()));

  app.post("/api/tickets", (req, res) => {
    const { requesterStaffId } = req.body || {};
    const requester = store
      .getAllStaff()
      .find((s) => s.id === Number(requesterStaffId));
    if (!store.canCreateTicket(requester)) {
      return res
        .status(403)
        .json({ error: "You are not authorized to create tickets" });
    }
    const created = store.createTicket(req.body || {}, requester);
    res.status(201).json(created);
  });

  app.put("/api/tickets/:id", (req, res) => {
    const updated = store.updateTicket(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Ticket not found" });
    res.json(updated);
  });

  app.post("/api/tickets/:id/notes", (req, res) => {
    const { text, author } = req.body || {};
    if (!text) return res.status(400).json({ error: "Note text required" });
    const updated = store.addTicketNote(req.params.id, text, author);
    if (!updated) return res.status(404).json({ error: "Ticket not found" });
    res.json(updated);
  });

  app.listen(PORT, () => {
    console.log(`ITAM local bridge API listening on http://localhost:${PORT}`);
  });
}

module.exports = { startServer, PORT, appState };
