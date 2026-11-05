const API = "http://localhost:4756";

let lastUsers = []; // cached so Edit buttons can look up a user by id without another fetch
let lastStaff = [];
let lastAssets = [];
let lastHistory = [];
//let lastTickets = [];
let staffEditActive = false; // true from the moment someone touches their own IT Team row's controls until Save — prevents the 2s poll from wiping an in-progress edit
let kanbanColumns = [];
let kanbanCards = [];
let kanbanInteracting = false; // true while dragging a card or the Add Card modal is open
let kanbanReminderShownForVisit = false; // resets each time the Process Board tab is opened
const KANBAN_DEFAULT_COLORS = {
  Operations: "#3ecf8e",
  "Talent Acquisition (TA)": "#f5a623",
  "People Solutions (PS)": "#4b9fff",
  "Information Technology (IT)": "#c084fc",
  Facilities: "#f97362",
  "Team Leaders (TL)": "#facc15",
  "End of Process": "#8b93a1",
};

// IT staff who can also bulk-delete records — displayed as Team Leaders of their site.
const TEAM_LEADER_NAMES = ["Ruben Quintino", "Fernando Costa", "Pedro Lopes"];

// --- theme toggle ---
const themeBtn = document.getElementById("theme-toggle-btn");
function applyTheme(theme) {
  document.body.classList.toggle("light-theme", theme === "light");
  themeBtn.textContent = theme === "light" ? "☀️ Light" : "🌙 Dark";
}
applyTheme(localStorage.getItem("itam-theme") || "dark");
themeBtn.addEventListener("click", () => {
  const next = document.body.classList.contains("light-theme")
    ? "dark"
    : "light";
  applyTheme(next);
  localStorage.setItem("itam-theme", next);
});

// --- tabs ---
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.remove("active"));
    document
      .querySelectorAll(".panel")
      .forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
    document.getElementById("add-kit-btn").style.display =
      tab.dataset.tab === "users" ? "inline-block" : "none";
    if (tab.dataset.tab !== "itteam") staffEditActive = false;
    if (tab.dataset.tab !== "kanban") kanbanInteracting = false;
    if (tab.dataset.tab === "kanban") kanbanReminderShownForVisit = false;
  });
});
document.getElementById("add-kit-btn").style.display = "inline-block"; // Users tab is active by default

// --- connectivity toggle (demo only) ---
const toggle = document.getElementById("connectivity-toggle");
toggle.addEventListener("change", async () => {
  await fetch(`${API}/api/connectivity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ online: toggle.checked }),
  });
  refreshStatus();
});

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function refreshStatus() {
  const res = await fetch(`${API}/api/status`);
  const s = await res.json();

  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  const sub = document.getElementById("statusbar-sub");

  dot.className = "dot";
  if (s.syncing) {
    dot.classList.add("syncing");
    label.textContent = "SYNCHRONIZING";
    sub.textContent = `Uploading ${s.pendingChanges} changes...`;
  } else if (!s.online) {
    dot.classList.add("offline");
    label.textContent = "OFFLINE";
    sub.textContent = `Local changes: ${s.pendingChanges}   |   Last sync: ${fmtTime(s.lastSync)}`;
  } else {
    label.textContent = "ONLINE";
    sub.textContent = `Last sync: ${fmtTime(s.lastSync)}`;
  }
}

async function refreshTables() {
  const [users, assets, history, staff, kanban, tickets] = await Promise.all([
    fetch(`${API}/api/users`).then((r) => r.json()),
    fetch(`${API}/api/assets`).then((r) => r.json()),
    fetch(`${API}/api/history`).then((r) => r.json()),
    fetch(`${API}/api/staff`).then((r) => r.json()),
    fetch(`${API}/api/kanban`).then((r) => r.json()),
    fetch(`${API}/api/tickets`).then((r) => r.json()),
  ]);
  lastUsers = users;
  lastStaff = staff;
  lastAssets = assets;
  lastHistory = history;
  //lastTickets = tickets;
  kanbanColumns = kanban.columns;
  kanbanCards = kanban.cards;
  renderLoginBar();

  const loggedInStaffForKanban = lastStaff.find(
    (s) => s.id === getLoggedInStaffId(),
  );
  const kanbanTab = document.getElementById("kanban-tab");
  const isLoggedIn = !!loggedInStaffForKanban;
  kanbanTab.style.display = isLoggedIn ? "inline-block" : "none";
  if (
    !isLoggedIn &&
    document.querySelector(".tab.active")?.dataset.tab === "kanban"
  ) {
    document.querySelector('.tab[data-tab="users"]').click();
  }

  /*document.getElementById("tickets-tab").style.display = isLoggedIn
    ? "inline-block"
    : "none";
  document.getElementById("new-ticket-btn").style.display =
    clientCanCreateTicket(loggedInStaffForKanban) ? "inline-block" : "none";
  renderTicketsTable(); */

  const viewOnly = isViewOnlyLoggedIn();

  const usersBody = document.getElementById("users-body");
  usersBody.innerHTML = users.length
    ? users
        .map(
          (u) => `
    <tr>
      <td>${u.it_ticket || ""}</td>
      <td>${u.workday_id || '<span style="opacity:.5">(no Workday ID)</span>'}</td><td>${u.name || ""}</td><td>${u.project || ""}</td>
      <td>${u.team_leader || ""}</td><td>${u.phone || ""}</td><td>${fmtTime(u.updated_at)}</td>
      <td>
        <button class="btn-icon download-return-btn" data-id="${u.id}">Download Return</button>
        ${
          viewOnly
            ? ""
            : `
        <button class="btn-icon edit-user-btn" data-id="${u.id}">Edit</button>
        <button class="btn-icon danger delete-user-btn" data-id="${u.id}">Delete</button>`
        }
      </td>
    </tr>`,
        )
        .join("")
    : `<tr class="empty-row"><td colspan="8">No users yet — import an Excel file, or click + Add User.</td></tr>`;

  document
    .querySelectorAll(".download-return-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () =>
        downloadReturnDoc(Number(btn.dataset.id)),
      ),
    );
  document
    .querySelectorAll(".edit-user-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () =>
        openUserModal(Number(btn.dataset.id)),
      ),
    );
  document
    .querySelectorAll(".delete-user-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () => deleteUser(Number(btn.dataset.id))),
    );

  const addKitBtn = document.getElementById("add-kit-btn");
  const currentTab = document.querySelector(".tab.active")?.dataset.tab;
  addKitBtn.style.display =
    currentTab === "users" && !viewOnly ? "inline-block" : "none";

  const loggedInStaff = lastStaff.find((s) => s.id === getLoggedInStaffId());
  const canBulkDelete =
    loggedInStaff && TEAM_LEADER_NAMES.includes(loggedInStaff.name);
  const deleteAllBtn = document.getElementById("delete-all-btn");
  deleteAllBtn.style.display =
    currentTab === "users" && canBulkDelete ? "inline-block" : "none";

  const assetsBody = document.getElementById("assets-body");
  assetsBody.innerHTML = assets.length
    ? assets
        .map(
          (a) => `
    <tr>
      <td>${a.assigned_workday_id || ""}</td><td>${a.assigned_name || ""}</td>
      <td>${a.type}</td><td>${a.model || ""}</td><td>${a.serial_number}</td><td>${a.status}</td><td>${a.site || ""}</td><td>${fmtTime(a.updated_at)}</td>
    </tr>`,
        )
        .join("")
    : `<tr class="empty-row"><td colspan="8">No assets yet.</td></tr>`;

  const historyBody = document.getElementById("history-body");
  historyBody.innerHTML = history.length
    ? history
        .map(
          (h) => `
    <tr>
      <td>${fmtTime(h.timestamp)}</td><td>${h.entity_type}</td><td>${h.entity_key}</td>
      <td>${h.action}</td><td>${h.detail || ""}</td><td>${h.site || "?"}</td><td>${h.actor || ""}</td>
    </tr>`,
        )
        .join("")
    : `<tr class="empty-row"><td colspan="7">No activity yet.</td></tr>`;
}

// --- Edit User modal (basic profile fields only) ---
const modalBackdrop = document.getElementById("user-modal-backdrop");
const formId = document.getElementById("user-form-id");
const formFields = [
  "it_ticket",
  "workday_id",
  "name",
  "project",
  "team_leader",
  "phone",
];

function openUserModal(id) {
  formId.value = id;
  const u = lastUsers.find((u) => u.id === id);
  formFields.forEach((f) => {
    document.getElementById(`user-form-${f}`).value = (u && u[f]) || "";
  });
  document.getElementById("user-form-received_by").value = ""; // per-action field, not stored on the profile
  modalBackdrop.style.display = "flex";
}
function closeUserModal() {
  modalBackdrop.style.display = "none";
}

document
  .getElementById("user-form-cancel")
  .addEventListener("click", closeUserModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeUserModal();
});

document
  .getElementById("user-form-save")
  .addEventListener("click", async () => {
    const id = formId.value;
    const payload = {};
    formFields.forEach((f) => {
      payload[f] = document.getElementById(`user-form-${f}`).value.trim();
    });
    payload.received_by = document
      .getElementById("user-form-received_by")
      .value.trim();

    if (!payload.name) {
      await showConfirmModal("Name is required.", { alertOnly: true });
      return;
    }

    if (id) {
      await fetch(`${API}/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch(`${API}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    closeUserModal();
    await refreshTables();
  });

// --- Add User & IT Equipment modal (full kit creation) ---
const kitModalBackdrop = document.getElementById("kit-modal-backdrop");
const KIT_TEXT_FIELDS = [
  "it_ticket",
  "workday_id",
  "agent_name",
  "computer_model",
  "computer_serial",
  "monitor1_model",
  "monitor1_serial",
  "monitor2_model",
  "monitor2_serial",
  "mfa",
  "received_by",
  "project",
  "phone",
  "team_leader",
];
const KIT_CHECKBOX_FIELDS = [
  "webcam",
  "headset",
  "ethernet_cable",
  "kbm",
  "power_video_cables",
];

function openKitModal() {
  KIT_TEXT_FIELDS.forEach((f) => {
    document.getElementById(`kit-form-${f}`).value = "";
  });
  KIT_CHECKBOX_FIELDS.forEach((f) => {
    document.getElementById(`kit-form-${f}`).checked = false;
  });
  document.getElementById("kit-form-site").value = "";
  document.getElementById("kit-form-obs").value = "";
  document.getElementById("kit-form-workday_id").value = "WD";
  kitModalBackdrop.style.display = "flex";
}
function closeKitModal() {
  kitModalBackdrop.style.display = "none";
}

document.getElementById("add-kit-btn").addEventListener("click", openKitModal);

document
  .getElementById("delete-all-btn")
  .addEventListener("click", async () => {
    const loggedInStaff = lastStaff.find((s) => s.id === getLoggedInStaffId());
    if (!loggedInStaff) return;

    const confirmed = await showConfirmModal(
      `This will permanently delete ALL Users and ALL Assets. This cannot be undone. Continue as ${loggedInStaff.name}?`,
      { title: "Delete all records" },
    );
    if (!confirmed) return;

    const res = await fetch(`${API}/api/admin/delete-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorName: loggedInStaff.name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      await showConfirmModal(
        err.error || "Not authorized to perform this action.",
        { alertOnly: true },
      );
      return;
    }
    await refreshTables();
  });
document
  .getElementById("kit-form-cancel")
  .addEventListener("click", closeKitModal);
kitModalBackdrop.addEventListener("click", (e) => {
  if (e.target === kitModalBackdrop) closeKitModal();
});

document.getElementById("kit-form-save").addEventListener("click", async () => {
  const payload = {};
  KIT_TEXT_FIELDS.forEach((f) => {
    payload[f] = document.getElementById(`kit-form-${f}`).value.trim();
  });
  if (payload.workday_id.toUpperCase() === "WD") payload.workday_id = ""; // prefix left untouched — treat as blank
  KIT_CHECKBOX_FIELDS.forEach((f) => {
    payload[f] = document.getElementById(`kit-form-${f}`).checked;
  });
  payload.site = document.getElementById("kit-form-site").value;
  payload.obs = document.getElementById("kit-form-obs").value.trim();

  if (!payload.agent_name) {
    await showConfirmModal("Agent's Name is required.", { alertOnly: true });
    return;
  }

  const res = await fetch(`${API}/api/users/create-with-kit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    await showConfirmModal(
      err.error || "Something went wrong saving this record.",
      { alertOnly: true },
    );
    return;
  }
  closeKitModal();
  await refreshTables();
});

async function deleteUser(id) {
  const u = lastUsers.find((u) => u.id === id);
  const label = u ? u.name || u.workday_id || `#${id}` : `#${id}`;
  const confirmed = await showConfirmModal(
    `Delete ${label}? This cannot be undone.`,
  );
  if (!confirmed) return;
  await fetch(`${API}/api/users/${id}`, { method: "DELETE" });
  await refreshTables();
}

// --- Delete confirmation modal (styled replacement for window.confirm) ---
const confirmBackdrop = document.getElementById("confirm-modal-backdrop");
const confirmTitle = document.getElementById("confirm-modal-title");
const confirmMessage = document.getElementById("confirm-modal-message");
const confirmBtn = document.getElementById("confirm-modal-confirm");
const confirmCancelBtn = document.getElementById("confirm-modal-cancel");

function showConfirmModal(message, opts = {}) {
  confirmTitle.textContent =
    opts.title || (opts.alertOnly ? "Notice" : "Delete user");
  confirmMessage.textContent = message;
  confirmBackdrop.style.display = "flex";
  confirmCancelBtn.style.display = opts.alertOnly ? "none" : "inline-block";
  confirmBtn.textContent = opts.alertOnly ? "OK" : "Delete";
  confirmBtn.className = opts.alertOnly ? "btn-primary" : "btn-danger";
  return new Promise((resolve) => {
    const cleanup = (result) => {
      confirmBackdrop.style.display = "none";
      confirmBtn.removeEventListener("click", onConfirm);
      confirmCancelBtn.removeEventListener("click", onCancel);
      confirmBackdrop.removeEventListener("click", onBackdrop);
      resolve(result);
    };
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => {
      if (e.target === confirmBackdrop) cleanup(false);
    };
    confirmBtn.addEventListener("click", onConfirm);
    confirmCancelBtn.addEventListener("click", onCancel);
    confirmBackdrop.addEventListener("click", onBackdrop);
  });
}

async function tick() {
  await refreshStatus();
  await refreshTables();
}

let jobTitlesList = [];
fetch(`${API}/api/job-titles`)
  .then((r) => r.json())
  .then((list) => {
    jobTitlesList = list;
  });

tick();
setInterval(tick, 2000); // poll every 2s so extension imports show up "live" in the demo

// --- Login (identity selection, no password — real AD login is a post-demo item) ---
const LOGIN_KEY = "itam-logged-in-staff-id";
const loginSelect = document.getElementById("login-select");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const loggedOutEl = document.getElementById("login-logged-out");
const loggedInEl = document.getElementById("login-logged-in");
const loginStatusDot = document.getElementById("login-status-dot");
const loginNameLabel = document.getElementById("login-name-label");

function getLoggedInStaffId() {
  const v = localStorage.getItem(LOGIN_KEY);
  return v ? Number(v) : null;
}

function isViewOnlyLoggedIn() {
  const id = getLoggedInStaffId();
  const me = lastStaff.find((s) => s.id === id);
  return !!me && me.role === "manager";
}

function renderLoginBar() {
  const previousSelection = loginSelect.value; // preserve an in-progress pick across the 2s poll rebuild
  loginSelect.innerHTML =
    `<option value="" disabled ${previousSelection ? "" : "selected"}>Select an IT Technician</option>` +
    lastStaff
      .map((s) => {
        const suffix =
          s.role === "stakeholder"
            ? ` (${s.department})`
            : `${TEAM_LEADER_NAMES.includes(s.name) ? " - Team Leader " + s.site : ""} (${s.site})`;
        return `<option value="${s.id}">${s.name}${suffix}</option>`;
      })
      .join("");
  if (
    previousSelection &&
    lastStaff.some((s) => String(s.id) === previousSelection)
  ) {
    loginSelect.value = previousSelection;
  }

  const loggedInId = getLoggedInStaffId();
  const me = lastStaff.find((s) => s.id === loggedInId);

  if (me) {
    loggedOutEl.style.display = "none";
    loggedInEl.style.display = "flex";
    loginNameLabel.textContent = `Logged in as: ${me.name}${me.role === "manager" ? " (Manager — view only)" : ""}`;
    loginStatusDot.className =
      "dot" +
      (me.status === "trainee"
        ? " trainee"
        : me.status === "offline"
          ? " offline"
          : "");
  } else {
    loggedOutEl.style.display = "block";
    loggedInEl.style.display = "none";
  }
}

loginBtn.addEventListener("click", () => {
  const id = loginSelect.value;
  if (!id) return;
  localStorage.setItem(LOGIN_KEY, id);
  renderLoginBar();
  renderItTeamPanel();
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem(LOGIN_KEY);
  staffEditActive = false;
  renderLoginBar();
  renderItTeamPanel();
});

// --- My Profile modal ---
const profileModalBackdrop = document.getElementById("profile-modal-backdrop");
document
  .getElementById("my-profile-btn")
  .addEventListener("click", async () => {
    const me = lastStaff.find((s) => s.id === getLoggedInStaffId());
    if (!me) return;

    const siteFieldHtml =
      me.role === "stakeholder"
        ? `<div class="profile-row"><span class="label">Department</span><span class="value">${me.department || "?"}</span></div>`
        : `<div class="profile-row"><span class="label">Site</span><span class="value">
        <select id="profile-site-select">
          <option value="Lisbon" ${me.site === "Lisbon" ? "selected" : ""}>Lisbon</option>
          <option value="Porto" ${me.site === "Porto" ? "selected" : ""}>Porto</option>
          <option value="Braga" ${me.site === "Braga" ? "selected" : ""}>Braga</option>
        </select>
      </span></div>`;

    let rowsHtml = `
    <div class="profile-row"><span class="label">Name</span><span class="value"><input type="text" id="profile-name-input" value="${me.name}" style="text-align:right; background:var(--panel-alt); border:1px solid var(--border); color:var(--text); border-radius:5px; padding:4px 8px; font-size:13px;" /></span></div>
    ${siteFieldHtml}
    <div class="profile-row"><span class="label">Job Title</span><span class="value">${me.job_title || "?"} <span style="font-size:10px; color:var(--text-dim);">(set by Vasco)</span></span></div>
    <div class="profile-row"><span class="label">Role</span><span class="value">${me.role === "manager" ? "Manager (view only)" : me.role === "stakeholder" ? "Process stakeholder" : me.role === "team_leader" ? "Team Leader" : "Technician"}</span></div>`;

    if (TEAM_LEADER_NAMES.includes(me.name))
      rowsHtml += `<div class="profile-row"><span class="label">Team Leader of</span><span class="value">${me.site || "?"}</span></div>`;
    if (me.role === "technician") {
      rowsHtml += `<div class="profile-row"><span class="label">Status</span><span class="value">${me.status}</span></div>`;
      if (me.status === "offline" && me.reason)
        rowsHtml += `<div class="profile-row"><span class="label">Reason</span><span class="value">${me.reason}</span></div>`;
      rowsHtml += `<div class="profile-row"><span class="label">Tickets closed</span><span class="value">${String(me.ticket_count ?? 0)}</span></div>`;
    }

    if (me.role !== "stakeholder") {
      rowsHtml += `<div class="modal-actions" style="margin:12px 0 0;"><button id="profile-save-btn" class="btn-primary">Save Profile</button></div>`;
    }

    if (me.role === "technician") {
      const tickets = await fetch(
        `${API}/api/staff/${encodeURIComponent(me.name)}/tickets?_=${Date.now()}`,
      ).then((r) => r.json());
      const openTickets = tickets.filter((t) => t.status !== "closed");
      const closedTickets = tickets.filter((t) => t.status === "closed");

      rowsHtml += `<div class="profile-tickets-header">Open tickets (${openTickets.length})</div>`;
      rowsHtml += openTickets.length
        ? openTickets
            .map(
              (t) => `
          <div class="profile-ticket-row">
            <span>#${t.it_ticket} — ${t.entity_key}</span>
            <button class="btn-icon close-ticket-btn" data-id="${t.id}">Close</button>
          </div>`,
            )
            .join("")
        : `<div class="profile-ticket-row" style="color:var(--text-dim);">None — all caught up.</div>`;

      if (closedTickets.length) {
        rowsHtml += `<div class="profile-tickets-header">Closed (${closedTickets.length})</div>`;
        rowsHtml += closedTickets
          .map(
            (t) =>
              `<div class="profile-ticket-row" style="opacity:.6;">#${t.it_ticket} — ${t.entity_key}</div>`,
          )
          .join("");
      }
    }

    document.getElementById("profile-modal-body").innerHTML = rowsHtml;

    const profileSaveBtn = document.getElementById("profile-save-btn");
    if (profileSaveBtn) {
      profileSaveBtn.addEventListener("click", async () => {
        const nameInput = document.getElementById("profile-name-input");
        const siteSelect = document.getElementById("profile-site-select");
        const payload = { name: nameInput.value.trim() };
        if (siteSelect) payload.site = siteSelect.value;
        if (!payload.name) {
          await showConfirmModal("Name cannot be blank.", { alertOnly: true });
          return;
        }
        await fetch(`${API}/api/staff/${me.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await refreshTables();
        document.getElementById("my-profile-btn").click(); // re-open with fresh data
      });
    }
    document.querySelectorAll(".close-ticket-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await fetch(`${API}/api/history/${btn.dataset.id}/close-ticket`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ closedBy: me.name }),
        });
        await refreshTables();
        document.getElementById("my-profile-btn").click(); // re-open with fresh data
      });
    });
    profileModalBackdrop.style.display = "flex";
  });
document.getElementById("profile-modal-close").addEventListener("click", () => {
  profileModalBackdrop.style.display = "none";
});
profileModalBackdrop.addEventListener("click", (e) => {
  if (e.target === profileModalBackdrop)
    profileModalBackdrop.style.display = "none";
});

// --- IT Team panel ---
function renderItTeamPanel() {
  const container = document.getElementById("itteam-groups");
  if (!lastStaff.length) {
    container.innerHTML = `<p style="color:var(--text-dim); font-size:13px;">No IT staff added yet.</p>`;
    return;
  }

  const loggedInId = getLoggedInStaffId();
  const managers = lastStaff
    .filter((s) => s.role === "manager")
    .sort((a, b) => a.name.localeCompare(b.name));
  const preferredOrder = ["Lisboa", "Porto", "Braga"];
  const allSites = [
    ...new Set(
      lastStaff
        .filter((s) => !["manager", "stakeholder"].includes(s.role))
        .map((s) => s.site),
    ),
  ];
  const sites = [
    ...preferredOrder.filter((s) => allSites.includes(s)),
    ...allSites.filter((s) => !preferredOrder.includes(s)).sort(),
  ];

  const managerHtml = managers.length
    ? `<div class="manager-banner">${managers.map((s) => renderStaffRow(s, s.id === loggedInId && !["manager", "stakeholder"].includes(s.role))).join("")}</div>`
    : "";

  const columnsHtml =
    `<div class="itteam-columns">` +
    sites
      .map((site) => {
        const siteMembers = lastStaff.filter(
          (s) =>
            s.site === site && !["manager", "stakeholder"].includes(s.role),
        );
        const leader = siteMembers.find((s) =>
          TEAM_LEADER_NAMES.includes(s.name),
        );
        const others = siteMembers
          .filter((s) => !TEAM_LEADER_NAMES.includes(s.name))
          .sort((a, b) => a.name.localeCompare(b.name));

        const leaderRow = leader
          ? `<div class="team-leader-slot">${renderStaffRow(leader, leader.id === loggedInId)}</div>`
          : "";
        const otherRows = others
          .map((s) => renderStaffRow(s, s.id === loggedInId))
          .join("");

        return `<div class="site-group"><div class="site-group-title">${site} Team</div>${leaderRow}${otherRows}</div>`;
      })
      .join("") +
    `</div>`;

  container.innerHTML = managerHtml + columnsHtml;

  document.querySelectorAll(".staff-name-link").forEach((el) => {
    el.addEventListener("click", () =>
      openStaffEquipmentModal(el.dataset.name),
    );
  });

  document.querySelectorAll(".remove-staff-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const confirmed = await showConfirmModal(
        `Remove ${btn.dataset.name} from the IT roster? This cannot be undone.`,
        { title: "Remove from roster" },
      );
      if (!confirmed) return;
      await fetch(`${API}/api/staff/${btn.dataset.id}`, { method: "DELETE" });
      await refreshTables();
    });
  });

  document.querySelectorAll(".job-title-save-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const select = document.getElementById(
        `job-title-select-${btn.dataset.id}`,
      );
      await fetch(`${API}/api/staff/${btn.dataset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_title: select.value }),
      });
      staffEditActive = false;
      await refreshTables();
    });
  });
  document.querySelectorAll('[id^="job-title-select-"]').forEach((select) => {
    select.addEventListener("focus", () => {
      staffEditActive = true;
    });
    select.addEventListener("change", () => {
      staffEditActive = true;
    });
  });

  // wire up Save buttons for the logged-in person's own row (only one can exist)
  const saveBtn = document.getElementById("staff-save-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const id = saveBtn.dataset.id;
      const status = document.getElementById("staff-status-select").value;
      const reason = document.getElementById("staff-reason-input").value.trim();
      await fetch(`${API}/api/staff/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason }),
      });
      staffEditActive = false; // saved — safe for the poll to re-render again now
      await refreshTables();
    });
    const statusSelect = document.getElementById("staff-status-select");
    const reasonInput = document.getElementById("staff-reason-input");
    if (statusSelect) {
      statusSelect.addEventListener("change", () => {
        staffEditActive = true;
        const reasonWrap = document.getElementById("staff-reason-wrap");
        if (reasonWrap)
          reasonWrap.style.display =
            statusSelect.value === "offline" ? "block" : "none";
      });
      statusSelect.addEventListener("focus", () => {
        staffEditActive = true;
      });
    }
    if (reasonInput) {
      reasonInput.addEventListener("focus", () => {
        staffEditActive = true;
      });
      reasonInput.addEventListener("input", () => {
        staffEditActive = true;
      });
    }
  }
}

function renderStaffRow(s, isSelf) {
  const viewer = lastStaff.find((x) => x.id === getLoggedInStaffId());
  const canRemove = viewer && viewer.role === "manager" && s.id !== viewer.id;
  const canEditTitle = viewer && viewer.role === "manager";
  const dotClass =
    s.status === "trainee"
      ? "trainee"
      : s.status === "offline"
        ? "offline"
        : "";
  const statusLabel =
    s.status === "trainee"
      ? ""
      : `<span class="staff-status-label">${s.status}</span>`;
  const roleBadge =
    s.role === "manager"
      ? `<span class="staff-status-label">manager · view only</span>`
      : "";
  const teamLeaderBadge = TEAM_LEADER_NAMES.includes(s.name)
    ? `<span class="staff-status-label"> - Team Leader ${s.site}</span>`
    : "";
  const ticketCount = s.ticket_count ?? 0;
  const ticketBadge = `<span class="staff-status-label"> · ${ticketCount} closed</span>`;
  const jobTitleBadge = s.job_title
    ? `<span class="staff-status-label"> · ${s.job_title}</span>`
    : "";

  const jobTitleEditorHtml = canEditTitle
    ? `
    <div class="staff-reason">
      <select id="job-title-select-${s.id}">
        <option value="">— No title set —</option>
        ${jobTitlesList.map((t) => `<option value="${t}" ${s.job_title === t ? "selected" : ""}>${t}</option>`).join("")}
      </select>
      <button class="btn-icon job-title-save-btn" data-id="${s.id}" style="margin-top:6px;">Save Title</button>
    </div>`
    : "";

  let reasonHtml;
  if (s.status === "trainee") {
    reasonHtml = "";
  } else if (isSelf) {
    reasonHtml = `
      <div class="staff-reason">
        <select id="staff-status-select">
          <option value="online" ${s.status === "online" ? "selected" : ""}>Online</option>
          <option value="offline" ${s.status === "offline" ? "selected" : ""}>Offline</option>
        </select>
        <div id="staff-reason-wrap" style="display:${s.status === "offline" ? "block" : "none"};">
          <textarea id="staff-reason-input" rows="2" placeholder="Reason (visible to other IT while offline)">${s.reason || ""}</textarea>
        </div>
        <div class="staff-save-btn">
          <button id="staff-save-btn" class="btn-icon" data-id="${s.id}">Save</button>
        </div>
      </div>`;
  } else {
    reasonHtml =
      s.status === "offline"
        ? `<div class="staff-reason">${s.reason || ""}</div>`
        : "";
  }

  return `
    <div class="staff-row">
      <span class="dot ${dotClass}"></span>
      <div class="staff-main">
        <span class="staff-name staff-name-link" data-name="${s.name}">${s.status === "trainee" ? "(trainee) " : ""}${s.name}</span>${statusLabel}${roleBadge}${teamLeaderBadge}${jobTitleBadge}${s.role === "manager" ? "" : ticketBadge}
        ${reasonHtml}
        ${jobTitleEditorHtml}
        ${canRemove ? `<button class="btn-icon danger remove-staff-btn" data-id="${s.id}" data-name="${s.name}" style="margin-top:6px;">Remove from roster</button>` : ""}
      </div>
    </div>`;
}

// --- Staff equipment view (click an IT staffer's name) ---
const staffEqBackdrop = document.getElementById("staff-eq-modal-backdrop");
const staffEqTitle = document.getElementById("staff-eq-modal-title");
const staffEqBody = document.getElementById("staff-eq-modal-body");

function openStaffEquipmentModal(staffName) {
  staffEqTitle.textContent = `Equipment handled by ${staffName}`;

  const deliveries = lastHistory.filter((h) => h.actor === staffName);

  if (!deliveries.length) {
    staffEqBody.innerHTML = `<p style="color:var(--text-dim); font-size:13px;">No deliveries recorded for ${staffName} yet.</p>`;
  } else {
    staffEqBody.innerHTML = deliveries
      .map((h) => {
        const employee = lastUsers.find(
          (u) => u.workday_id === h.entity_key || u.name === h.entity_key,
        );
        const employeeLabel = employee
          ? `${employee.name} (${employee.workday_id || "?"})`
          : h.entity_key;
        const theirAssets = lastAssets.filter(
          (a) =>
            (employee &&
              a.assigned_workday_id &&
              a.assigned_workday_id === employee.workday_id) ||
            (employee && a.assigned_name === employee.name),
        );

        const assetRows = theirAssets.length
          ? theirAssets
              .map(
                (a) =>
                  `<div class="eq-item">${a.type} — ${a.model || "?"} — <span class="mono">${a.serial_number}</span></div>`,
              )
              .join("")
          : `<div class="eq-item" style="color:var(--text-dim);">No serialized equipment on record for this employee.</div>`;

        return `
        <div class="eq-card">
          <div class="eq-card-header">
            <strong>${employeeLabel}</strong>
            <span class="staff-status-label">${fmtTime(h.timestamp)}${h.site ? " · " + h.site : ""}</span>
          </div>
          <div class="eq-detail">${h.detail || ""}</div>
          ${assetRows}
        </div>`;
      })
      .join("");
  }

  staffEqBackdrop.style.display = "flex";
}

document
  .getElementById("staff-eq-modal-close")
  .addEventListener("click", () => {
    staffEqBackdrop.style.display = "none";
  });
staffEqBackdrop.addEventListener("click", (e) => {
  if (e.target === staffEqBackdrop) staffEqBackdrop.style.display = "none";
});

// --- Return of IT Equipment (.docx download) ---
function downloadReturnDoc(userId) {
  const loggedInStaff = lastStaff.find((s) => s.id === getLoggedInStaffId());
  const receivedBy = loggedInStaff ? loggedInStaff.name : "?";
  const url = `${API}/api/users/${userId}/return-docx?receivedBy=${encodeURIComponent(receivedBy)}&_=${Date.now()}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = ""; // filename comes from the server's Content-Disposition header
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// --- Process Board (Kanban) — manager-only ---
function canApproveStage(stage, staff) {
  if (!staff) return false;
  if (stage === "Operations") return staff.name === "Micaela";
  if (stage === "Talent Acquisition (TA)") return staff.name === "Rui Lopes";
  if (stage === "People Solutions (PS)") return staff.name === "Cátia Andrade";
  if (stage === "Information Technology (IT)")
    return staff.role === "technician";
  if (stage === "Facilities") return staff.name === "Jhonathan Gomes";
  if (stage === "Team Leaders (TL)") return true; // no real per-leader login — anyone logged in can approve on their behalf
  return false; // End of Process uses the checkbox flow instead
}

function fmtDeadline(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString([], { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

async function maybeShowKanbanReminder(loggedInStaff, ticketedUsers) {
  const activeTab = document.querySelector(".tab.active")?.dataset.tab;
  if (activeTab !== "kanban" || kanbanReminderShownForVisit || !loggedInStaff)
    return;

  const hasPending = ticketedUsers.some(
    (u) =>
      u.kanban_stage !== "End of Process" &&
      canApproveStage(u.kanban_stage, loggedInStaff),
  );
  if (!hasPending) return;

  kanbanReminderShownForVisit = true;
  await showConfirmModal(
    "Please review this information, you have until 17h from tomorrow to approve.",
    { alertOnly: true, title: "Review needed" },
  );
}

function renderEmployeeCard(u, loggedInStaff) {
  const stage = u.kanban_stage;
  const isEndOfProcess = stage === "End of Process";
  const canApprove = !isEndOfProcess && canApproveStage(stage, loggedInStaff);
  const isManagerLoggedIn = loggedInStaff && loggedInStaff.role === "manager";

  let actionHtml = "";
  if (isEndOfProcess) {
    if (u.kanban_end_checked) {
      actionHtml = `<div class="kanban-card-done">✓ Complete →</div>`;
    } else if (isManagerLoggedIn) {
      actionHtml = `<label class="kanban-end-checkbox"><input type="checkbox" class="end-check-input" data-id="${u.id}" /> Mark complete</label>`;
    } else {
      actionHtml = `<div class="kanban-card-notes">Awaiting Vasco's sign-off</div>`;
    }
  } else if (canApprove) {
    actionHtml = `<button class="btn-icon kanban-approve-btn" data-id="${u.id}">Approve →</button>`;
  } else if (u.kanban_deadline) {
    actionHtml = `<div class="kanban-card-notes">Due ${fmtDeadline(u.kanban_deadline)}</div>`;
  }

  const teamLeaderLine =
    stage === "Team Leaders (TL)" && u.team_leader
      ? `<div class="kanban-card-notes">Team Leader: ${u.team_leader}</div>`
      : "";

  return `
    <div class="kanban-card employee-card" data-user-id="${u.id}">
      <div class="kanban-card-title">🎫 ${u.it_ticket} — ${u.name}</div>
      ${teamLeaderLine}
      ${actionHtml}
    </div>`;
}

function renderKanbanBoard() {
  const board = document.getElementById("kanban-board");
  if (!kanbanColumns.length) {
    board.innerHTML = "";
    return;
  }

  const loggedInStaff = lastStaff.find((s) => s.id === getLoggedInStaffId());
  const ticketedUsers = lastUsers.filter(
    (u) => u.it_ticket && u.it_ticket !== "?",
  );

  board.innerHTML = kanbanColumns
    .map((col) => {
      const cards = kanbanCards.filter((c) => c.column === col);
      const cardsHtml = cards
        .map(
          (c) => `
      <div class="kanban-card" draggable="true" data-id="${c.id}" style="border-left: 4px solid ${c.color || "#3ecf8e"};">
        <div class="kanban-card-title">${c.title || "(untitled)"}</div>
        ${c.notes ? `<div class="kanban-card-notes">${c.notes}</div>` : ""}
        <button class="kanban-card-delete" data-id="${c.id}">Remove</button>
      </div>`,
        )
        .join("");

      const employeesHere = ticketedUsers.filter((u) => u.kanban_stage === col);
      const employeeCardsHtml = employeesHere
        .map((u) => renderEmployeeCard(u, loggedInStaff))
        .join("");

      return `
      <div class="kanban-column" data-column="${col}">
        <div class="kanban-column-title">${col} (${cards.length + employeesHere.length})</div>
        ${employeeCardsHtml}
        ${cardsHtml}
      </div>`;
    })
    .join("");

  // employee card actions
  board.querySelectorAll(".kanban-approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const approverName = loggedInStaff ? loggedInStaff.name : "?";
      await fetch(`${API}/api/users/${btn.dataset.id}/kanban-advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approverName }),
      });
      await refreshTables();
    });
  });
  board.querySelectorAll(".end-check-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const approverName = loggedInStaff ? loggedInStaff.name : "?";
      await fetch(`${API}/api/users/${input.dataset.id}/kanban-end-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: input.checked, approverName }),
      });
      await refreshTables();
    });
  });

  // manual card drag handlers
  board
    .querySelectorAll(".kanban-card:not(.employee-card)")
    .forEach((cardEl) => {
      cardEl.addEventListener("dragstart", (e) => {
        kanbanInteracting = true;
        cardEl.classList.add("dragging");
        e.dataTransfer.setData("text/plain", cardEl.dataset.id);
      });
      cardEl.addEventListener("dragend", () => {
        cardEl.classList.remove("dragging");
        kanbanInteracting = false;
      });
    });

  board.querySelectorAll(".kanban-card-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`${API}/api/kanban/${btn.dataset.id}`, { method: "DELETE" });
      await refreshTables();
    });
  });

  board.querySelectorAll(".kanban-column").forEach((colEl) => {
    colEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      colEl.classList.add("drag-over");
    });
    colEl.addEventListener("dragleave", () =>
      colEl.classList.remove("drag-over"),
    );
    colEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      colEl.classList.remove("drag-over");
      const cardId = e.dataTransfer.getData("text/plain");
      const targetColumn = colEl.dataset.column;
      await fetch(`${API}/api/kanban/${cardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: targetColumn }),
      });
      kanbanInteracting = false;
      await refreshTables();
    });
  });

  maybeShowKanbanReminder(loggedInStaff, ticketedUsers);
}

// --- Add Card modal ---
const cardModalBackdrop = document.getElementById("card-modal-backdrop");
const cardColorInput = document.getElementById("card-form-color");
document.getElementById("add-card-btn").addEventListener("click", () => {
  kanbanInteracting = true;
  document.getElementById("card-form-title").value = "";
  document.getElementById("card-form-notes").value = "";
  const select = document.getElementById("card-form-column");
  select.innerHTML = kanbanColumns
    .map((c) => `<option value="${c}">${c}</option>`)
    .join("");
  cardColorInput.value = KANBAN_DEFAULT_COLORS[select.value] || "#3ecf8e";
  cardModalBackdrop.style.display = "flex";
});
document.getElementById("card-form-column").addEventListener("change", (e) => {
  cardColorInput.value = KANBAN_DEFAULT_COLORS[e.target.value] || "#3ecf8e";
});
document.getElementById("card-form-cancel").addEventListener("click", () => {
  kanbanInteracting = false;
  cardModalBackdrop.style.display = "none";
});
cardModalBackdrop.addEventListener("click", (e) => {
  if (e.target === cardModalBackdrop) {
    kanbanInteracting = false;
    cardModalBackdrop.style.display = "none";
  }
});
document
  .getElementById("card-form-save")
  .addEventListener("click", async () => {
    const title = document.getElementById("card-form-title").value.trim();
    const notes = document.getElementById("card-form-notes").value.trim();
    const column = document.getElementById("card-form-column").value;
    const color = cardColorInput.value;
    if (!title) {
      await showConfirmModal("Title is required.", { alertOnly: true });
      return;
    }
    await fetch(`${API}/api/kanban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, notes, column, color }),
    });
    kanbanInteracting = false;
    cardModalBackdrop.style.display = "none";
    await refreshTables();
  });

/*
// --- Ticket Management ---
function clientCanCreateTicket(staff) {
  if (!staff) return false;
  if (staff.role === "team_leader" || staff.role === "technician") return true;
  if (
    staff.role === "stakeholder" &&
    (staff.department === "Operations" || staff.department === "HR")
  )
    return true;
  return false;
}

function priorityBadgeClass(p) {
  return "badge badge-" + String(p || "").toLowerCase();
}
function statusBadgeClass(s) {
  return (
    "badge badge-" +
    String(s || "")
      .toLowerCase()
      .replace(/\s+/g, "-")
  );
}

function renderTicketsTable() {
  const body = document.getElementById("tickets-body");
  body.innerHTML = lastTickets.length
    ? lastTickets
        .map(
          (t) => `
    <tr class="ticket-row-link" data-id="${t.id}">
      <td>${t.ticket_number}</td><td>${t.title}</td><td>${t.category}</td>
      <td><span class="${priorityBadgeClass(t.priority)}">${t.priority}</span></td>
      <td><span class="${statusBadgeClass(t.status)}">${t.status}</span></td>
      <td>${t.requester_name}</td><td>${t.for_employee || ""}</td><td>${t.assigned_to || ""}</td>
      <td>${fmtTime(t.updated_at)}</td>
    </tr>`,
        )
        .join("")
    : `<tr class="empty-row"><td colspan="9">No tickets yet.</td></tr>`;

  body.querySelectorAll(".ticket-row-link").forEach((row) => {
    row.addEventListener("click", () =>
      openTicketDetail(Number(row.dataset.id)),
    );
  });
}

*/

// --- New Ticket modal ---
const ticketModalBackdrop = document.getElementById("ticket-modal-backdrop");
document.getElementById("new-ticket-btn").addEventListener("click", () => {
  document.getElementById("ticket-form-title").value = "";
  document.getElementById("ticket-form-description").value = "";
  document.getElementById("ticket-form-category").value = "Hardware";
  document.getElementById("ticket-form-priority").value = "Medium";
  document.getElementById("ticket-form-for_employee").value = "";
  ticketModalBackdrop.style.display = "flex";
});
document.getElementById("ticket-form-cancel").addEventListener("click", () => {
  ticketModalBackdrop.style.display = "none";
});
ticketModalBackdrop.addEventListener("click", (e) => {
  if (e.target === ticketModalBackdrop)
    ticketModalBackdrop.style.display = "none";
});
document
  .getElementById("ticket-form-save")
  .addEventListener("click", async () => {
    const title = document.getElementById("ticket-form-title").value.trim();
    if (!title) {
      await showConfirmModal("Title is required.", { alertOnly: true });
      return;
    }
    const loggedInStaff = lastStaff.find((s) => s.id === getLoggedInStaffId());
    const payload = {
      title,
      description: document
        .getElementById("ticket-form-description")
        .value.trim(),
      category: document.getElementById("ticket-form-category").value,
      priority: document.getElementById("ticket-form-priority").value,
      for_employee: document
        .getElementById("ticket-form-for_employee")
        .value.trim(),
      requesterStaffId: loggedInStaff ? loggedInStaff.id : null,
    };
    const res = await fetch(`${API}/api/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      await showConfirmModal(err.error || "Could not create ticket.", {
        alertOnly: true,
      });
      return;
    }
    ticketModalBackdrop.style.display = "none";
    await refreshTables();
    document.querySelector('.tab[data-tab="tickets"]').click();
  });

// --- Ticket Detail modal ---
const ticketDetailBackdrop = document.getElementById("ticket-detail-backdrop");
function openTicketDetail(id) {
  const t = lastTickets.find((x) => x.id === id);
  if (!t) return;
  const loggedInStaff = lastStaff.find((s) => s.id === getLoggedInStaffId());
  const isTech = loggedInStaff && loggedInStaff.role === "technician";

  document.getElementById("ticket-detail-title").textContent =
    `${t.ticket_number} — ${t.title}`;

  const grid = `
    <div class="ticket-detail-grid">
      <div class="profile-row"><span class="label">Category</span><span class="value">${t.category}</span></div>
      <div class="profile-row"><span class="label">Priority</span><span class="value"><span class="${priorityBadgeClass(t.priority)}">${t.priority}</span></span></div>
      <div class="profile-row"><span class="label">Requester</span><span class="value">${t.requester_name}</span></div>
      <div class="profile-row"><span class="label">For Employee</span><span class="value">${t.for_employee || "?"}</span></div>
      <div class="profile-row"><span class="label">Status</span><span class="value"><span class="${statusBadgeClass(t.status)}">${t.status}</span></span></div>
      <div class="profile-row"><span class="label">Assigned To</span><span class="value">${t.assigned_to || "(unassigned)"}</span></div>
    </div>
    <div class="ticket-detail-desc">${t.description || "No description provided."}</div>`;

  const controls = isTech
    ? `
    <div class="ticket-controls">
      <button id="ticket-assign-me-btn" class="btn-icon">Assign to me</button>
      <select id="ticket-status-select">
        ${["New", "Assigned", "In Progress", "Resolved", "Closed", "Cancelled"].map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <button id="ticket-status-save-btn" class="btn-icon">Update Status</button>
    </div>`
    : "";

  const notesHtml = t.work_notes.length
    ? t.work_notes
        .map(
          (n) =>
            `<div class="ticket-note">${n.text}<div class="ticket-note-meta">${n.author} · ${fmtTime(n.timestamp)}</div></div>`,
        )
        .join("")
    : `<div style="color:var(--text-dim); font-size:12px;">No notes yet.</div>`;

  const addNoteHtml = loggedInStaff
    ? `
    <div class="ticket-add-note">
      <textarea id="ticket-note-input" rows="2" placeholder="Add a work note..."></textarea>
      <button id="ticket-note-save-btn" class="btn-icon" style="margin-top:6px;">Add Note</button>
    </div>`
    : "";

  document.getElementById("ticket-detail-body").innerHTML =
    grid +
    controls +
    `<div class="ticket-notes-header">Work Notes</div>${notesHtml}${addNoteHtml}`;

  if (isTech) {
    document
      .getElementById("ticket-assign-me-btn")
      .addEventListener("click", async () => {
        await fetch(`${API}/api/tickets/${t.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assigned_to: loggedInStaff.name,
            status: t.status === "New" ? "Assigned" : t.status,
          }),
        });
        await refreshTables();
        openTicketDetail(id);
      });
    document
      .getElementById("ticket-status-save-btn")
      .addEventListener("click", async () => {
        const status = document.getElementById("ticket-status-select").value;
        await fetch(`${API}/api/tickets/${t.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        await refreshTables();
        openTicketDetail(id);
      });
  }
  if (loggedInStaff) {
    document
      .getElementById("ticket-note-save-btn")
      .addEventListener("click", async () => {
        const text = document.getElementById("ticket-note-input").value.trim();
        if (!text) return;
        await fetch(`${API}/api/tickets/${t.id}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, author: loggedInStaff.name }),
        });
        await refreshTables();
        openTicketDetail(id);
      });
  }

  ticketDetailBackdrop.style.display = "flex";
}
document.getElementById("ticket-detail-close").addEventListener("click", () => {
  ticketDetailBackdrop.style.display = "none";
});
ticketDetailBackdrop.addEventListener("click", (e) => {
  if (e.target === ticketDetailBackdrop)
    ticketDetailBackdrop.style.display = "none";
});
