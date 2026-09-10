const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "itam-demo-data.json");

function loadData() {
  if (!fs.existsSync(dataPath)) {
    return {
      users: [],
      assets: [],
      history: [],
      itStaff: [],
      kanban: [],
      tickets: [],
      nextId: 1,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  } catch (e) {
    console.error("Failed to parse data file, starting fresh:", e.message);
    return {
      users: [],
      assets: [],
      history: [],
      itStaff: [],
      kanban: [],
      tickets: [],
      nextId: 1,
    };
  }
}

let data = loadData();

// Migration: older data files won't have itStaff yet.
if (!data.itStaff) data.itStaff = [];
if (!data.kanban) data.kanban = [];
if (!data.tickets) data.tickets = [];

// Pedro Almeida left the company — remove him from the IT roster entirely.
data.itStaff = data.itStaff.filter((s) => s.name !== "Pedro Almeida");

// Fixed stage order for the Process Board (manager-only view)
const KANBAN_COLUMNS = [
  "Operations",
  "Talent Acquisition (TA)",
  "People Solutions (PS)",
  "Information Technology (IT)",
  "Facilities",
  "Team Leaders (TL)",
  "End of Process",
];

// Job title / rank shown on each technician's profile — distinct from the
// internal permission `role` field (technician/manager/stakeholder/team_leader),
// which controls what they can access. Only Vasco can assign this.
const JOB_TITLES = [
  "Sr. Technical Representative",
  "Technical I",
  "Technical II",
  "IT Team Lead",
  "IT Manager",
  "IT Director",
];

// Seed the initial IT roster on first run (empty itStaff array).
// More IT staff can be added later via the IT Team CRUD endpoints.
if (data.itStaff.length === 0) {
  const seedStaff = [
    {
      name: "Eduardo M",
      site: "Lisbon",
      status: "online",
      reason: "",
      role: "technician",
    },
    {
      name: "Francisco Martins",
      site: "Lisbon",
      status: "offline",
      reason: "Going to marry, offline from 23-28 August",
      role: "technician",
    },
    {
      name: "Jesuivan da Silva Filipe",
      site: "Lisbon",
      status: "online",
      reason: "",
      role: "technician",
    },
    {
      name: "Ruben Quintino",
      site: "Lisbon",
      status: "offline",
      reason: "Vacations from 22-29 August",
      role: "technician",
    },
    {
      name: "Vasco Rosa",
      site: "Lisbon",
      status: "online",
      reason: "",
      role: "manager",
    },
  ];
  for (const s of seedStaff) {
    data.itStaff.push({ id: data.nextId++, ...s, updated_at: nowIso() });
  }
}

// Migration: existing staff records from before the role field existed
// default to 'technician'; add Vasco Rosa if this data file predates him.
for (const s of data.itStaff) {
  if (!s.role) s.role = "technician";
  if (s.site === "Lisboa") s.site = "Lisbon"; // renamed for consistency with the rest of the app's English UI
}
if (!data.itStaff.some((s) => s.name === "Vasco Rosa")) {
  data.itStaff.push({
    id: data.nextId++,
    name: "Vasco Rosa",
    site: "Lisbon",
    status: "online",
    reason: "",
    role: "manager",
    updated_at: nowIso(),
  });
}

// Migration: add Porto and Braga rosters if this data file predates them.
const additionalStaff = [
  { name: "Leonardo Ribeiro", site: "Porto" },
  { name: "António Cruz", site: "Porto" },
  { name: "Fernando Costa", site: "Porto" },
  { name: "Andre Gonçalves", site: "Porto" },
  { name: "Márcio Sena", site: "Braga" },
  { name: "Gonçalo Azevedo", site: "Braga" },
  { name: "Cláudio Santos", site: "Braga" },
  { name: "Pedro Lopes", site: "Braga" },
];
for (const s of additionalStaff) {
  if (!data.itStaff.some((x) => x.name === s.name)) {
    data.itStaff.push({
      id: data.nextId++,
      name: s.name,
      site: s.site,
      status: "online",
      reason: "",
      role: "technician",
      updated_at: nowIso(),
    });
  }
}

// Process Board stakeholders — one per stage that needs a specific named
// approver. They log in through the same identity picker as IT staff, but
// don't belong to a site/team and can't touch Users/Assets CRUD — their
// only permission is approving cards at their own department's stage.
const stakeholderSeed = [
  { name: "Micaela", department: "Operations" },
  { name: "Rui Lopes", department: "Talent Acquisition (TA)" },
  { name: "Cátia Andrade", department: "People Solutions (PS)" },
  { name: "Jhonathan Gomes", department: "Facilities" },
  { name: "HR Team", department: "HR" }, // placeholder name — rename via the Edit staff flow once you have a real person
];
for (const s of stakeholderSeed) {
  if (!data.itStaff.some((x) => x.name === s.name)) {
    data.itStaff.push({
      id: data.nextId++,
      name: s.name,
      site: "N/A",
      status: "online",
      reason: "",
      role: "stakeholder",
      department: s.department,
      updated_at: nowIso(),
    });
  }
}

// Migration: existing users from before the Process Board existed start
// at Operations (stage 1) — there's no way to infer a past stage from data
// that never tracked one.
for (const u of data.users) {
  if (!u.kanban_stage) {
    u.kanban_stage = "Operations";
    u.kanban_stage_entered_at = nowIso();
    u.kanban_end_checked = false;
  }
}

// Migration: existing history entries with a real ticket but no status yet
// (from before ticket open/closed tracking existed) default to open.
for (const h of data.history) {
  if (h.it_ticket && h.it_ticket !== "?" && !h.ticket_status)
    h.ticket_status = "open";
}

// One-time cleanup: earlier test imports stored the generic placeholder
// "demo-user" as the actor. Replace those with "?" so History reads
// correctly for anyone opening the app now, without losing the entries.
(function migrateDemoUserPlaceholder() {
  let changed = false;
  for (const h of data.history) {
    if (h.actor === "demo-user") {
      h.actor = "?";
      changed = true;
    }
  }
  if (changed) save();
})();

function save() {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");
}

function nowIso() {
  return new Date().toISOString();
}

function normName(n) {
  return String(n || "")
    .trim()
    .toLowerCase();
}

function logHistory(
  entity_type,
  entity_key,
  action,
  detail,
  site,
  actor,
  itTicket,
) {
  const hasRealTicket = itTicket && itTicket !== "?";
  data.history.unshift({
    id: data.nextId++,
    entity_type,
    entity_key,
    action,
    detail: detail || "",
    actor: actor || "?", // '?' means no known IT staff recorded this action yet — editable via the Users CRUD
    site: site || null,
    it_ticket: itTicket || null,
    ticket_status: hasRealTicket ? "open" : null, // only real tickets have a status; closing is what makes them count toward the IT's tally
    timestamp: nowIso(),
  });
  if (data.history.length > 500) data.history = data.history.slice(0, 500); // cap growth
}

function closeTicket(historyId, closedBy) {
  const entry = data.history.find((h) => h.id === Number(historyId));
  if (!entry || !entry.it_ticket) return null;
  entry.ticket_status = "closed";
  entry.closed_by = closedBy || "?";
  entry.closed_at = nowIso();
  save();
  return entry;
}

function getTicketsForStaff(name) {
  const norm = (v) =>
    String(v || "")
      .trim()
      .toLowerCase();
  const target = norm(name);
  return data.history
    .filter(
      (h) => norm(h.actor) === target && h.it_ticket && h.it_ticket !== "?",
    )
    .map((h) => ({
      id: h.id,
      it_ticket: h.it_ticket,
      entity_key: h.entity_key,
      detail: h.detail,
      status: h.ticket_status,
      timestamp: h.timestamp,
    }));
}

// --- Users ---
// Matches by workday_id when present; falls back to name (case-insensitive)
// when the source sheet has no Workday ID column. Name-matching is a known
// reliability gap (names aren't guaranteed unique) — fine for demo, worth
// upgrading once Workday ID is available in the real import file.
// forceMatchByName: even if row.workday_id is set (e.g. a demo-generated
// fake one), still match/find the existing record by name — used so a
// fictitious Workday ID doesn't cause a duplicate user record on re-import.
function upsertUser(row, forceMatchByName = false) {
  const matchByName = forceMatchByName || !row.workday_id;
  const key = matchByName
    ? { field: "name", value: normName(row.name) }
    : { field: "workday_id", value: row.workday_id };
  const existing =
    key.field === "workday_id"
      ? data.users.find((u) => u.workday_id === key.value)
      : data.users.find((u) => normName(u.name) === key.value);

  if (existing) {
    existing.workday_id = row.workday_id ?? existing.workday_id;
    existing.name = row.name ?? existing.name;
    existing.project = row.project ?? existing.project;
    existing.team_leader = row.team_leader ?? existing.team_leader;
    existing.phone = row.phone ?? existing.phone;
    existing.it_ticket = row.it_ticket ?? existing.it_ticket;
    existing.updated_at = nowIso();
    existing.origin = row.origin || "extension";
    logHistory(
      "user",
      existing.workday_id || existing.name,
      "updated",
      `Profile updated via ${row.origin || "app"}`,
    );
    save();
    return { action: "updated", key: existing.workday_id || existing.name };
  } else {
    const newUser = {
      id: data.nextId++,
      workday_id: row.workday_id || "",
      name: row.name || "",
      project: row.project || "",
      team_leader: row.team_leader || "",
      phone: row.phone || "",
      it_ticket: row.it_ticket || "",
      kanban_stage: "Operations",
      kanban_stage_entered_at: nowIso(),
      kanban_end_checked: false,
      updated_at: nowIso(),
      origin: row.origin || "extension",
    };
    data.users.push(newUser);
    logHistory(
      "user",
      newUser.workday_id || newUser.name,
      "created",
      `Profile created via ${row.origin || "app"}`,
    );
    save();
    return { action: "created", key: newUser.workday_id || newUser.name };
  }
}

// --- Assets ---
function upsertAsset(row) {
  const existing = data.assets.find(
    (a) => a.serial_number === row.serial_number,
  );
  if (existing) {
    const siteChanged = row.site && existing.site && row.site !== existing.site;
    existing.type = row.type ?? existing.type;
    existing.model = row.model ?? existing.model;
    existing.status = row.status ?? existing.status;
    existing.assigned_workday_id =
      row.assigned_workday_id ?? existing.assigned_workday_id;
    existing.assigned_name = row.assigned_name ?? existing.assigned_name;
    existing.site = row.site ?? existing.site;
    existing.updated_at = nowIso();
    existing.origin = row.origin || "extension";
    logHistory(
      "asset",
      row.serial_number,
      "updated",
      siteChanged
        ? `Delivered/moved to site ${row.site} (was ${existing.site})`
        : `Updated via ${row.origin || "app"}`,
      row.site,
    );
    save();
    return { action: "updated", serial_number: row.serial_number };
  } else {
    data.assets.push({
      id: data.nextId++,
      type: row.type || "other",
      model: row.model || "",
      serial_number: row.serial_number,
      status: row.status || "assigned",
      assigned_workday_id: row.assigned_workday_id || "",
      assigned_name: row.assigned_name || "",
      site: row.site || "",
      updated_at: nowIso(),
      origin: row.origin || "extension",
    });
    logHistory(
      "asset",
      row.serial_number,
      "created",
      `Asset created via ${row.origin || "app"}`,
      row.site,
    );
    save();
    return { action: "created", serial_number: row.serial_number };
  }
}

// --- Manual CRUD (Add/Edit/Delete User buttons in the app UI) ---
// Operates on the internal numeric id, independent of the workday_id/name
// matching used by the Excel-import upsert path above.
function createUser(fields) {
  const newUser = {
    id: data.nextId++,
    workday_id: fields.workday_id || "",
    name: fields.name || "",
    project: fields.project || "",
    team_leader: fields.team_leader || "",
    phone: fields.phone || "",
    it_ticket: fields.it_ticket || "",
    kanban_stage: "Operations",
    kanban_stage_entered_at: nowIso(),
    kanban_end_checked: false,
    updated_at: nowIso(),
    origin: "app",
  };
  data.users.push(newUser);
  logHistory(
    "user",
    newUser.workday_id || newUser.name,
    "created",
    "Created manually in app",
  );
  save();
  return newUser;
}

function updateUserById(id, fields) {
  const existing = data.users.find((u) => u.id === Number(id));
  if (!existing) return null;
  existing.workday_id = fields.workday_id ?? existing.workday_id;
  existing.name = fields.name ?? existing.name;
  existing.project = fields.project ?? existing.project;
  existing.team_leader = fields.team_leader ?? existing.team_leader;
  existing.phone = fields.phone ?? existing.phone;
  existing.it_ticket = fields.it_ticket ?? existing.it_ticket;
  existing.updated_at = nowIso();
  existing.origin = "app";
  logHistory(
    "user",
    existing.workday_id || existing.name,
    "updated",
    "Edited manually in app",
  );
  save();
  return existing;
}

function deleteUserById(id) {
  const idx = data.users.findIndex((u) => u.id === Number(id));
  if (idx === -1) return false;
  const [removed] = data.users.splice(idx, 1);
  logHistory(
    "user",
    removed.workday_id || removed.name,
    "deleted",
    "Deleted manually in app",
  );
  save();
  return true;
}

// --- IT Staff (login roster, availability status) ---
function createStaff(fields) {
  const newStaff = {
    id: data.nextId++,
    name: fields.name || "",
    site: fields.site || "",
    status: fields.status || "offline", // 'online' | 'offline' | 'trainee'
    reason: fields.reason || "",
    updated_at: nowIso(),
  };
  data.itStaff.push(newStaff);
  save();
  return newStaff;
}

function updateStaffById(id, fields) {
  const existing = data.itStaff.find((s) => s.id === Number(id));
  if (!existing) return null;
  existing.name = fields.name ?? existing.name;
  existing.site = fields.site ?? existing.site;
  existing.status = fields.status ?? existing.status;
  existing.role = fields.role ?? existing.role;
  existing.job_title = fields.job_title ?? existing.job_title;
  existing.reason = fields.reason ?? existing.reason;
  existing.updated_at = nowIso();
  save();
  return existing;
}

function deleteStaffById(id) {
  const idx = data.itStaff.findIndex((s) => s.id === Number(id));
  if (idx === -1) return false;
  data.itStaff.splice(idx, 1);
  save();
  return true;
}

// --- Bulk delete (restricted to specific IT staff via the server-side check) ---
function deleteAllUsersAndAssets(actorName) {
  const usersRemoved = data.users.length;
  const assetsRemoved = data.assets.length;
  data.users = [];
  data.assets = [];

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB"); // DD/MM/YYYY
  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  logHistory(
    "system",
    "all",
    "bulk_delete",
    `${actorName} deleted all records from Users & Assets on ${dateStr} at ${timeStr} (${usersRemoved} users, ${assetsRemoved} assets removed)`,
    "N/A",
    actorName,
  );
  save();
  return { usersRemoved, assetsRemoved };
}

// --- Process Board (Kanban) — manager-only view of process cards moving through fixed stages ---
function createKanbanCard(fields) {
  const column = KANBAN_COLUMNS.includes(fields.column)
    ? fields.column
    : KANBAN_COLUMNS[0];
  const newCard = {
    id: data.nextId++,
    title: fields.title || "",
    notes: fields.notes || "",
    column,
    color: fields.color || "#3ecf8e",
    updated_at: nowIso(),
  };
  data.kanban.push(newCard);
  save();
  return newCard;
}

function updateKanbanCard(id, fields) {
  const existing = data.kanban.find((c) => c.id === Number(id));
  if (!existing) return null;
  if (fields.title !== undefined) existing.title = fields.title;
  if (fields.notes !== undefined) existing.notes = fields.notes;
  if (fields.color !== undefined) existing.color = fields.color;
  if (fields.column !== undefined && KANBAN_COLUMNS.includes(fields.column))
    existing.column = fields.column;
  existing.updated_at = nowIso();
  save();
  return existing;
}

function deleteKanbanCard(id) {
  const idx = data.kanban.findIndex((c) => c.id === Number(id));
  if (idx === -1) return false;
  data.kanban.splice(idx, 1);
  save();
  return true;
}

// --- Process Board stage tracking (per-employee, driven by their User record) ---
// Auto-generates a login identity for every distinct Team Leader name found
// on employee records (Users tab), so they can log in and create tickets
// for their own reports without needing to be manually added one by one.
function syncTeamLeaderLogins() {
  const names = new Set(
    data.users.map((u) => u.team_leader).filter((n) => n && n !== "?"),
  );
  let changed = false;
  for (const name of names) {
    if (!data.itStaff.some((s) => s.name === name)) {
      data.itStaff.push({
        id: data.nextId++,
        name,
        site: "N/A",
        status: "online",
        reason: "",
        role: "team_leader",
        updated_at: nowIso(),
      });
      changed = true;
    }
  }
  if (changed) save();
}

// --- Ticket Management (Helix-style queue) ---
function ticketPrefixFor(requesterRole, requesterDepartment) {
  if (requesterRole === "team_leader") return "TL";
  if (requesterRole === "technician") return "IT";
  if (requesterRole === "stakeholder" && requesterDepartment === "Operations")
    return "OPS";
  if (requesterRole === "stakeholder" && requesterDepartment === "HR")
    return "HR";
  return "GEN";
}

function canCreateTicket(staff) {
  if (!staff) return false;
  if (staff.role === "team_leader" || staff.role === "technician") return true;
  if (
    staff.role === "stakeholder" &&
    (staff.department === "Operations" || staff.department === "HR")
  )
    return true;
  return false; // Vasco (manager), TA/PS/Facilities stakeholders, and agents (no login) can't create tickets
}

function createTicket(fields, requesterStaff) {
  const prefix = ticketPrefixFor(
    requesterStaff?.role,
    requesterStaff?.department,
  );
  const year = new Date().getFullYear();
  const seq = String(
    data.tickets.filter((t) => t.ticket_number.startsWith(`${prefix}-${year}`))
      .length + 1,
  ).padStart(3, "0");
  const ticket = {
    id: data.nextId++,
    ticket_number: `${prefix}-${year}-${seq}`,
    title: fields.title || "(no title)",
    description: fields.description || "",
    category: fields.category || "Other",
    priority: fields.priority || "Medium",
    status: "New",
    for_employee: fields.for_employee || "",
    requester_name: requesterStaff?.name || "?",
    requester_role: requesterStaff?.role || "?",
    assigned_to: "",
    work_notes: [],
    created_at: nowIso(),
    updated_at: nowIso(),
    resolved_at: null,
  };
  data.tickets.unshift(ticket);
  logHistory(
    "ticket",
    ticket.ticket_number,
    "ticket_created",
    `${ticket.title} (${ticket.category}, ${ticket.priority})`,
    null,
    ticket.requester_name,
  );
  save();
  return ticket;
}

function updateTicket(id, fields) {
  const t = data.tickets.find((x) => x.id === Number(id));
  if (!t) return null;
  if (fields.status !== undefined) {
    t.status = fields.status;
    if (["Resolved", "Closed", "Cancelled"].includes(fields.status))
      t.resolved_at = nowIso();
  }
  if (fields.assigned_to !== undefined) t.assigned_to = fields.assigned_to;
  if (fields.priority !== undefined) t.priority = fields.priority;
  t.updated_at = nowIso();
  save();
  return t;
}

function addTicketNote(id, text, author) {
  const t = data.tickets.find((x) => x.id === Number(id));
  if (!t) return null;
  t.work_notes.push({ text, author: author || "?", timestamp: nowIso() });
  t.updated_at = nowIso();
  save();
  return t;
}

function nextKanbanStage(current) {
  const idx = KANBAN_COLUMNS.indexOf(current);
  if (idx === -1 || idx >= KANBAN_COLUMNS.length - 1) return null;
  return KANBAN_COLUMNS[idx + 1];
}

function kanbanDeadlineFor(enteredAtIso) {
  // Deadline is 17:00 the day after the card entered its current stage.
  const d = new Date(enteredAtIso);
  d.setDate(d.getDate() + 1);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
}

function advanceUserKanbanStage(userId, approverName) {
  const user = data.users.find((u) => u.id === Number(userId));
  if (!user) return null;
  const next = nextKanbanStage(user.kanban_stage);
  if (!next) return user; // already at End of Process
  const prev = user.kanban_stage;
  user.kanban_stage = next;
  user.kanban_stage_entered_at = nowIso();
  user.updated_at = nowIso();
  logHistory(
    "user",
    user.workday_id || user.name,
    "kanban_advanced",
    `${approverName || "?"} approved "${prev}" — moved to "${next}"`,
    null,
    approverName,
  );
  save();
  return user;
}

function setEndOfProcessChecked(userId, checked, approverName) {
  const user = data.users.find((u) => u.id === Number(userId));
  if (!user) return null;
  if (user.kanban_stage !== "End of Process") return user; // only meaningful at the final stage
  user.kanban_end_checked = !!checked;
  user.updated_at = nowIso();
  if (checked) {
    logHistory(
      "user",
      user.workday_id || user.name,
      "kanban_completed",
      `${approverName || "?"} marked End of Process complete`,
      null,
      approverName,
    );
  }
  save();
  return user;
}

// Runs on every kanban/users fetch: reverts any card that missed its
// stage's review deadline back to Operations (stage 1). There's no real
// background scheduler here — this sweep is what stands in for one.
function sweepOverdueKanbanStages() {
  let changed = false;
  const now = new Date();
  for (const user of data.users) {
    if (!user.kanban_stage) continue;
    if (
      user.kanban_stage === "Operations" ||
      user.kanban_stage === "End of Process"
    )
      continue;
    const deadline = new Date(kanbanDeadlineFor(user.kanban_stage_entered_at));
    if (now > deadline) {
      const prev = user.kanban_stage;
      user.kanban_stage = "Operations";
      user.kanban_stage_entered_at = nowIso();
      user.updated_at = nowIso();
      logHistory(
        "user",
        user.workday_id || user.name,
        "kanban_reverted",
        `Reverted to Operations — "${prev}" review deadline passed without approval`,
        null,
        "?",
      );
      changed = true;
    }
  }
  if (changed) save();
}

module.exports = {
  upsertUser,
  upsertAsset,
  logHistory,
  createUser,
  updateUserById,
  deleteUserById,
  createStaff,
  updateStaffById,
  deleteStaffById,
  deleteAllUsersAndAssets,
  createKanbanCard,
  updateKanbanCard,
  deleteKanbanCard,
  advanceUserKanbanStage,
  setEndOfProcessChecked,
  sweepOverdueKanbanStages,
  kanbanDeadlineFor,
  closeTicket,
  getTicketsForStaff,
  syncTeamLeaderLogins,
  createTicket,
  updateTicket,
  addTicketNote,
  canCreateTicket,
  getAllTickets: () => [...data.tickets],
  KANBAN_COLUMNS,
  JOB_TITLES,
  getAllKanbanCards: () => [...data.kanban],
  getAllStaff: () =>
    [...data.itStaff]
      .map((s) => ({
        ...s,
        ticket_count: data.history.filter(
          (h) =>
            String(h.actor || "")
              .trim()
              .toLowerCase() ===
              String(s.name || "")
                .trim()
                .toLowerCase() && h.ticket_status === "closed",
        ).length,
      }))
      .sort(
        (a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name),
      ),
  getAllUsers: () =>
    [...data.users]
      .map((u) => ({
        ...u,
        kanban_deadline:
          u.kanban_stage &&
          u.kanban_stage !== "Operations" &&
          u.kanban_stage !== "End of Process"
            ? kanbanDeadlineFor(u.kanban_stage_entered_at)
            : null,
      }))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
  getAllAssets: () =>
    [...data.assets].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
  getHistory: (limit = 50) => data.history.slice(0, limit),
};
