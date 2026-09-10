const API = "http://localhost:4756";

const fileInput = document.getElementById("file-input");
const importBtn = document.getElementById("import-btn");
const statusEl = document.getElementById("status");
const dot = document.getElementById("dot");
const appStatusText = document.getElementById("app-status-text");

let parsedKits = null;

// --- Column header normalization ---
// Maps messy/inconsistent Excel headers to our internal field names.
// Extend this map as you see real-world header variants.
const HEADER_MAP = {
  // simple/flat-sheet fields (legacy /api/import path)
  "workday id": "workday_id",
  workday: "workday_id",
  "wd id": "workday_id",
  "employee id": "workday_id",
  project: "project",
  "project name": "project",
  "team leader": "team_leader",
  tl: "team_leader",
  leader: "team_leader",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  "serial number": "serial_number",
  serial: "serial_number",
  sn: "serial_number",
  "s/n": "serial_number",
  "computer sn": "serial_number",
  "pc sn": "serial_number",
  "pc serial": "serial_number",
  "asset type": "type",
  type: "type",
  status: "status",
  site: "site",
  location: "site",
  "delivered to": "site",

  // kit-sheet fields (real intake sheet layout -> /api/import-kits path)
  rdate: "rdate",
  "agent workday id": "workday_id",
  "agents workday id": "workday_id",
  "agent's workday id": "workday_id",
  "agent name": "agent_name",
  name: "agent_name",
  "employee name": "agent_name",
  "full name": "agent_name",
  "computer model": "computer_model",
  "computer s/n": "computer_serial",
  "m1 model": "monitor1_model",
  "m1 s/n": "monitor1_serial",
  "m2 model": "monitor2_model",
  "m2 s/n": "monitor2_serial",
  webcam: "webcam",
  headset: "headset",
  mfa: "mfa",
  "ethernet cable": "ethernet_cable",
  kbm: "kbm",
  "power/videocables": "power_video_cables",
  "power/video cables": "power_video_cables",
  "power / video cables": "power_video_cables",
  obs: "obs",
  observations: "obs",
  notes: "obs",
  observações: "obs",
  observacoes: "obs",
  "it ticket": "it_ticket",
  ticket: "it_ticket",
  it_ticket: "it_ticket",
  "received by it": "received_by",
  site: "site",
  "agent's team leader": "team_leader",
  "team leader": "team_leader",
  "last agent's project": "project",
  "last agent's project name": "project",
  "last agents project name": "project",
  "agents phone number": "phone",
  "agent's phone number": "phone",
  "agent phone number": "phone",
};

// fields that mark a sheet as "kit shaped" rather than the simple flat shape
const KIT_FIELDS = [
  "computer_serial",
  "monitor1_serial",
  "monitor2_serial",
  "mfa",
  "agent_name",
];
const CHECKBOX_FIELDS = [
  "webcam",
  "headset",
  "ethernet_cable",
  "kbm",
  "power_video_cables",
];

function normalizeHeader(h) {
  const key = String(h || "")
    .trim()
    .toLowerCase();
  return HEADER_MAP[key] || null;
}

function isTruthyCheckbox(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return ["x", "yes", "y", "true", "1", "sim"].includes(s);
}

// For model/serial/MFA fields, some sheets use "X" (or "-", "N/A") as a
// placeholder meaning "not applicable" rather than leaving the cell blank.
// Note this is the OPPOSITE meaning of "X" in a checkbox column (where X
// means true) — so this only applies to identifier/model fields.
function isPlaceholderNone(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "" || ["x", "-", "--", "n/a", "na"].includes(s);
}
function cleanIdentifier(v) {
  return isPlaceholderNone(v) ? "" : String(v).trim();
}

// Excel files sometimes report a "used range" far larger than the real data
// (e.g. from formatting applied to whole rows/columns), which makes
// sheet_to_json return huge numbers of effectively-blank rows. Strip those
// out before we even count "parsed rows", so the count reflects real data.
function stripPhantomEmptyRows(rawRows) {
  return rawRows.filter((raw) =>
    Object.values(raw).some((v) => String(v).trim() !== ""),
  );
}

function normalizeRow(raw) {
  const row = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = normalizeHeader(k);
    if (field && v !== undefined && String(v).trim() !== "") row[field] = v;
  }
  return row;
}

function formatRdate(v) {
  if (v instanceof Date) return v.toLocaleDateString("pt-PT");
  return String(v || "").trim();
}

function buildKit(row) {
  return {
    rdate: formatRdate(row.rdate),
    workday_id: cleanIdentifier(row.workday_id),
    agent_name: row.agent_name || "",
    site: row.site || "",
    team_leader: row.team_leader || "",
    project: row.project || "",
    phone: row.phone || "",
    received_by: row.received_by || "",
    it_ticket: cleanIdentifier(row.it_ticket),
    computer_model: cleanIdentifier(row.computer_model),
    computer_serial: cleanIdentifier(row.computer_serial),
    monitor1_model: cleanIdentifier(row.monitor1_model),
    monitor1_serial: cleanIdentifier(row.monitor1_serial),
    monitor2_model: cleanIdentifier(row.monitor2_model),
    monitor2_serial: cleanIdentifier(row.monitor2_serial),
    mfa: cleanIdentifier(row.mfa),
    webcam: isTruthyCheckbox(row.webcam),
    headset: isTruthyCheckbox(row.headset),
    ethernet_cable: isTruthyCheckbox(row.ethernet_cable),
    kbm: isTruthyCheckbox(row.kbm),
    power_video_cables: isTruthyCheckbox(row.power_video_cables),
    obs: row.obs || "",
  };
}

async function checkAppStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const s = await res.json();
    dot.className = "dot " + (s.online ? "" : "off");
    appStatusText.textContent = s.online
      ? "App online — imports sync immediately"
      : `App offline — will queue (${s.pendingChanges} pending)`;
  } catch (e) {
    dot.className = "dot unknown";
    appStatusText.textContent = "ITAM app not detected — open the app first";
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const wb = XLSX.read(data, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRowsAll = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const rawRows = stripPhantomEmptyRows(rawRowsAll);
    const normalized = rawRows.map(normalizeRow);

    const detectedHeaders = rawRows.length ? Object.keys(rawRows[0]) : [];
    const recognized = detectedHeaders.filter((h) => normalizeHeader(h));
    const unrecognized = detectedHeaders.filter((h) => !normalizeHeader(h));

    const isKitSheet = normalized.some((r) => KIT_FIELDS.some((f) => r[f]));

    let msg = `Sheet reported ${rawRowsAll.length} rows; ${rawRows.length} had real data.\n`;
    msg += `Detected columns: ${detectedHeaders.join(", ") || "(none)"}\n`;
    if (unrecognized.length)
      msg += `\n⚠ Not recognized: ${unrecognized.join(", ")}\n`;

    if (isKitSheet) {
      parsedKits = normalized
        .map(buildKit)
        .filter((k) => k.agent_name || k.computer_serial || k.mfa);
      msg += `\nDetected kit-style sheet -> ${parsedKits.length} delivery kits ready to import.`;
    } else {
      parsedKits = normalized
        .filter((r) => r.workday_id || r.serial_number)
        .map((r) => ({ __flat: r }));
      msg += `\n-> ${parsedKits.length} matchable rows (have Workday ID or Serial #).`;
    }

    statusEl.textContent = msg;
    importBtn.disabled = parsedKits.length === 0;
  };
  reader.readAsArrayBuffer(file);
});

importBtn.addEventListener("click", async () => {
  if (!parsedKits || !parsedKits.length) return;
  importBtn.disabled = true;
  statusEl.textContent = "Importing...";
  try {
    const isFlat = parsedKits[0].__flat !== undefined;
    const endpoint = isFlat ? "/api/import" : "/api/import-kits";
    const body = isFlat
      ? { rows: parsedKits.map((k) => k.__flat) }
      : { kits: parsedKits };

    const res = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    let msg = `Created: ${result.created}   Updated: ${result.updated}`;
    if (result.ambiguous?.length) {
      msg += `\n\n⚠ ${result.ambiguous.length} ambiguous serial(s) need review:\n`;
      msg += result.ambiguous
        .map((a) => `  "${a.incoming}" close to existing "${a.closeMatchTo}"`)
        .join("\n");
    }
    if (result.errors?.length) msg += `\n\n${result.errors.length} error(s).`;
    statusEl.textContent = msg;
  } catch (e) {
    statusEl.textContent = "Import failed — is the ITAM app running?";
  }
  await checkAppStatus();
  importBtn.disabled = false;
});

checkAppStatus();
