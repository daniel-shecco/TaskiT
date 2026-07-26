"use strict";

/* ============================================================
   TaskiT — personal kanban with cycle-time stats, voice input,
   recurring tasks, deadlines, and backed-up local storage
   ============================================================ */

const STORAGE_KEY = "taskit.data.v2";
const LEGACY_KEY = "taskit.tasks.v1";
const BACKUP_KEYS = ["taskit.backup.a", "taskit.backup.b", "taskit.backup.c"];
const BACKUP_META_KEY = "taskit.backup.meta";
const SCHEMA_VERSION = 2;

const STATUSES = ["backlog", "progress", "done"];
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const FREQUENCIES = {
  daily: { label: "Daily", advance: (d) => d.setDate(d.getDate() + 1) },
  weekly: { label: "Weekly", advance: (d) => d.setDate(d.getDate() + 7) },
  monthly: { label: "Monthly", advance: (d) => d.setMonth(d.getMonth() + 1) },
  quarterly: { label: "Quarterly", advance: (d) => d.setMonth(d.getMonth() + 3) },
  halfyearly: { label: "Half-yearly", advance: (d) => d.setMonth(d.getMonth() + 6) },
  yearly: { label: "Yearly", advance: (d) => d.setFullYear(d.getFullYear() + 1) },
};

function advanceBy(ts, freq) {
  const d = new Date(ts);
  FREQUENCIES[freq].advance(d);
  return d.getTime();
}

/* Custom weekday recurrence: freq "days" + a set of JS weekday numbers
   (0=Sun … 6=Sat). Occurrences land at 00:00 local on each chosen day. */

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // display Monday-first

function endOfDay(ts) {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function nextOccurrence(fromTs, days) {
  for (let k = 1; k <= 7; k++) {
    const d = new Date(fromTs);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + k);
    if (days.includes(d.getDay())) return d.getTime();
  }
  return endOfDay(fromTs); // unreachable with a non-empty day set
}

function advanceTemplate(template, fromTs) {
  return template.freq === "days"
    ? nextOccurrence(fromTs, template.days)
    : advanceBy(fromTs, template.freq);
}

function freqLabel(template) {
  if (template.freq !== "days") return FREQUENCIES[template.freq].label;
  if (template.days.length === 7) return "Daily";
  return WEEK_ORDER.filter((d) => template.days.includes(d)).map((d) => DAY_SHORT[d]).join(", ");
}

/* ============================================================
   Storage — versioned schema, validation, daily rolling backups,
   auto-recovery, export/import
   ============================================================ */

function sanitizeTask(t) {
  if (!t || typeof t !== "object") return null;
  if (typeof t.id !== "string" || typeof t.title !== "string" || !t.title.trim()) return null;
  return {
    id: t.id,
    title: String(t.title).slice(0, 500),
    status: STATUSES.includes(t.status) ? t.status : "backlog",
    createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
    completedAt: Number.isFinite(t.completedAt) ? t.completedAt : null,
    dueAt: Number.isFinite(t.dueAt) ? t.dueAt : null,
    recurringId: typeof t.recurringId === "string" ? t.recurringId : null,
    notifiedLevel: ["serious", "critical"].includes(t.notifiedLevel) ? t.notifiedLevel : null,
  };
}

function sanitizeRecurring(r) {
  if (!r || typeof r !== "object") return null;
  if (typeof r.id !== "string" || typeof r.title !== "string") return null;
  if (!FREQUENCIES[r.freq] && r.freq !== "days") return null;
  const clean = {
    id: r.id,
    title: String(r.title).slice(0, 500),
    freq: r.freq,
    nextAt: Number.isFinite(r.nextAt) ? r.nextAt : 0,
  };
  if (r.freq === "days") {
    const days = Array.isArray(r.days)
      ? [...new Set(r.days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
      : [];
    if (days.length === 0) return null;
    clean.days = days;
  }
  if (!clean.nextAt) clean.nextAt = advanceTemplate(clean, Date.now());
  return clean;
}

function sanitizeData(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(sanitizeTask).filter(Boolean) : null;
  if (tasks === null) return null;
  const recurring = Array.isArray(raw.recurring)
    ? raw.recurring.map(sanitizeRecurring).filter(Boolean)
    : [];
  return {
    version: SCHEMA_VERSION,
    tasks,
    recurring,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

function tryParse(json) {
  try {
    return sanitizeData(JSON.parse(json));
  } catch {
    return null;
  }
}

function loadData() {
  // 1. Current schema
  const main = localStorage.getItem(STORAGE_KEY);
  if (main !== null) {
    const parsed = tryParse(main);
    if (parsed) return parsed;
    // Main store corrupt — fall back to the freshest valid backup
    for (const key of backupKeysNewestFirst()) {
      const restored = tryParse(localStorage.getItem(key) || "");
      if (restored) {
        // Deferred: the toast element isn't in scope yet during boot
        setTimeout(() => showToast("Recovered tasks from the latest backup"), 0);
        return restored;
      }
    }
  }
  // 2. Migrate from the v1 schema (kept in place, not deleted)
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    const parsed = tryParse(`{"tasks": ${legacy}}`);
    if (parsed) return parsed;
  }
  return { version: SCHEMA_VERSION, tasks: [], recurring: [], updatedAt: 0 };
}

function backupMeta() {
  try {
    const meta = JSON.parse(localStorage.getItem(BACKUP_META_KEY));
    if (meta && typeof meta === "object") return meta;
  } catch { /* fall through */ }
  return { lastDay: "", slot: 0, lastAt: null };
}

function backupKeysNewestFirst() {
  const meta = backupMeta();
  const keys = [];
  for (let i = 0; i < BACKUP_KEYS.length; i++) {
    keys.push(BACKUP_KEYS[(meta.slot - 1 - i + 2 * BACKUP_KEYS.length) % BACKUP_KEYS.length]);
  }
  return keys;
}

function maybeBackup(serialized) {
  const today = new Date().toISOString().slice(0, 10);
  const meta = backupMeta();
  if (meta.lastDay === today) return;
  try {
    localStorage.setItem(BACKUP_KEYS[meta.slot % BACKUP_KEYS.length], serialized);
    localStorage.setItem(
      BACKUP_META_KEY,
      JSON.stringify({ lastDay: today, slot: (meta.slot + 1) % BACKUP_KEYS.length, lastAt: Date.now() })
    );
  } catch { /* backups are best-effort; never block a save */ }
}

let data = loadData();

function persistLocal() {
  const serialized = JSON.stringify(data);
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    maybeBackup(serialized);
  } catch {
    showToast("⚠ Couldn't save — browser storage is full or blocked");
  }
}

function save() {
  data.updatedAt = Date.now();
  persistLocal();
  bridge.onLocalChange?.();
}

/* ---------- Export / import ---------- */

document.getElementById("export-btn").addEventListener("click", () => {
  const payload = { app: "TaskiT", exportedAt: new Date().toISOString(), ...data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `taskit-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const importFile = document.getElementById("import-file");
document.getElementById("import-btn").addEventListener("click", () => importFile.click());

importFile.addEventListener("change", () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const incoming = tryParse(reader.result);
    if (!incoming) {
      showToast("⚠ That file isn't a valid TaskiT backup");
      return;
    }
    const ok = confirm(
      `Replace your current data (${data.tasks.length} tasks, ${data.recurring.length} recurring) ` +
      `with the imported file (${incoming.tasks.length} tasks, ${incoming.recurring.length} recurring)?`
    );
    if (!ok) return;
    data = incoming;
    save();
    renderAll();
    showToast("Backup imported");
  };
  reader.readAsText(file);
});

function renderBackupNote() {
  const meta = backupMeta();
  const note = document.getElementById("backup-note");
  const when = meta.lastAt ? ` Last auto-backup: ${formatDate(meta.lastAt)}.` : "";
  note.textContent =
    "Tasks are saved in this browser and auto-backed up daily (last 3 days kept)." +
    when + " Export a JSON file now and then to keep a copy outside the browser.";
}

/* ============================================================
   Tasks
   ============================================================ */

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function addTask(title, { dueAt = null, recurringId = null } = {}) {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const task = {
    id: makeId(),
    title: trimmed,
    status: "backlog",
    createdAt: Date.now(),
    completedAt: null,
    dueAt,
    recurringId,
  };
  data.tasks.unshift(task);
  save();
  renderAll();
  return task;
}

function setStatus(id, status) {
  const task = data.tasks.find((t) => t.id === id);
  if (!task || !STATUSES.includes(status) || task.status === status) return;
  task.status = status;
  task.completedAt = status === "done" ? Date.now() : null;
  save();
  renderAll();
}

function removeTask(id) {
  data.tasks = data.tasks.filter((t) => t.id !== id);
  save();
  renderAll();
}

function renameTask(id, title) {
  const task = data.tasks.find((t) => t.id === id);
  const trimmed = (title || "").trim();
  if (!task || !trimmed) return;
  task.title = trimmed;
  save();
  renderAll();
}

/* ============================================================
   Recurring tasks — a template spawns a fresh card each period
   ============================================================ */

function addRecurring(title, freq, firstDueAt, days = null) {
  const now = Date.now();
  const template = { id: makeId(), title: title.trim(), freq };
  if (freq === "days") template.days = days;
  template.nextAt = advanceTemplate(template, now);
  data.recurring.push(template);
  // First occurrence lands on the board right away. Day-based tasks are
  // due by the end of their day (today if it's a chosen day, else the next one)
  const defaultDue = freq === "days"
    ? (days.includes(new Date(now).getDay()) ? endOfDay(now) : endOfDay(template.nextAt))
    : template.nextAt;
  addTask(title, {
    dueAt: firstDueAt || defaultDue,
    recurringId: template.id,
  });
}

function stopRecurring(id) {
  data.recurring = data.recurring.filter((r) => r.id !== id);
  // Existing cards stay on the board; only future spawns stop
  save();
  renderAll();
}

function hasOpenInstance(recurringId) {
  return data.tasks.some((t) => t.recurringId === recurringId && t.status !== "done");
}

/**
 * Spawns due occurrences. After a long absence, missed periods are
 * skipped rather than piled up — at most one new card per template,
 * and none while a previous instance is still open.
 */
function runRecurrence() {
  const now = Date.now();
  let changed = false;
  for (const template of data.recurring) {
    let due = false;
    while (template.nextAt <= now) {
      template.nextAt = advanceTemplate(template, template.nextAt);
      due = true;
      changed = true;
    }
    if (due && !hasOpenInstance(template.id)) {
      data.tasks.unshift({
        id: makeId(),
        title: template.title,
        status: "backlog",
        createdAt: now,
        completedAt: null,
        // Day-based tasks are for that day; others run until the next occurrence
        dueAt: template.freq === "days" ? endOfDay(now) : template.nextAt,
        recurringId: template.id,
      });
    }
  }
  if (changed) {
    save();
    renderAll();
  }
}

function renderRecurringPanel() {
  const panel = document.getElementById("recurring-panel");
  const list = document.getElementById("recurring-list");
  panel.hidden = data.recurring.length === 0;
  list.innerHTML = "";
  for (const r of data.recurring) {
    const li = document.createElement("li");
    const title = document.createElement("span");
    title.className = "r-title";
    title.textContent = r.title;
    title.title = r.title;
    const meta = document.createElement("span");
    meta.className = "r-meta";
    meta.textContent = `${freqLabel(r)} · next ${formatDate(r.nextAt)}`;
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "r-stop";
    stop.textContent = "Stop";
    stop.setAttribute("aria-label", `Stop repeating "${r.title}"`);
    stop.addEventListener("click", () => {
      if (confirm(`Stop repeating "${r.title}"? Cards already on the board stay.`)) {
        stopRecurring(r.id);
      }
    });
    li.append(title, meta, stop);
    list.appendChild(li);
  }
}

/* ============================================================
   Deadlines — urgency from green to red
   ============================================================ */

function urgencyOf(task, now = Date.now()) {
  if (!task.dueAt || task.status === "done") return null;
  const remaining = task.dueAt - now;
  if (remaining <= 0) return "critical";
  const total = Math.max(task.dueAt - task.createdAt, HOUR_MS);
  const frac = remaining / total;
  if (frac < 0.2 || remaining < 24 * HOUR_MS) return "serious";
  if (frac < 0.5) return "warning";
  return "good";
}

function dueLabel(task, now = Date.now()) {
  const remaining = task.dueAt - now;
  if (remaining <= 0) return `Overdue ${formatDuration(-remaining)}`;
  if (remaining < 24 * HOUR_MS) return `Due in ${formatDuration(remaining)}`;
  const today = new Date(now);
  const due = new Date(task.dueAt);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due.toDateString() === tomorrow.toDateString()) return "Due tomorrow";
  return `Due ${formatDate(task.dueAt)}`;
}

/* ============================================================
   Formatting
   ============================================================ */

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(ms) {
  const minutes = ms / 60000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} d`;
}

/* ============================================================
   Board rendering
   ============================================================ */

function renderBoard() {
  const now = Date.now();
  for (const status of STATUSES) {
    const container = document.querySelector(`.cards[data-status="${status}"]`);
    const items = data.tasks.filter((t) => t.status === status);
    container.innerHTML = "";
    document.querySelector(`[data-count="${status}"]`).textContent = items.length;

    if (items.length === 0) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.textContent =
        status === "backlog" ? "Nothing queued — add a task above."
        : status === "progress" ? "Nothing in progress."
        : "Nothing done yet.";
      container.appendChild(note);
      continue;
    }

    for (const task of items) container.appendChild(buildCard(task, now));
  }
  renderRecurringPanel();
}

function buildCard(task, now) {
  const card = document.createElement("article");
  card.className = "card";
  card.draggable = true;
  card.dataset.id = task.id;

  const urgency = urgencyOf(task, now);
  if (urgency) card.classList.add(`due-${urgency}`);

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = task.title;
  card.appendChild(title);

  const badges = document.createElement("div");
  if (urgency) {
    const badge = document.createElement("span");
    badge.className = `badge due-${urgency}`;
    const dot = document.createElement("span");
    dot.className = "dot";
    badge.append(dot, document.createTextNode(dueLabel(task, now)));
    badges.appendChild(badge);
  }
  if (task.recurringId) {
    const template = data.recurring.find((r) => r.id === task.recurringId);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `↻ ${template ? freqLabel(template) : "Repeats"}`;
    badges.appendChild(badge);
  }
  if (badges.childNodes.length) {
    badges.className = "badges";
    card.appendChild(badges);
  }

  const meta = document.createElement("div");
  meta.className = "card-meta";

  const when = document.createElement("span");
  if (task.status === "done" && task.completedAt) {
    when.className = "card-duration";
    when.textContent = `✓ ${formatDuration(task.completedAt - task.createdAt)}`;
    when.title = `Created ${formatDate(task.createdAt)}, done ${formatDate(task.completedAt)}`;
  } else {
    when.textContent = `Added ${formatDate(task.createdAt)}`;
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const idx = STATUSES.indexOf(task.status);
  const back = actionButton("◀", "Move left", idx === 0, () => setStatus(task.id, STATUSES[idx - 1]));
  const fwd = actionButton("▶", "Move right", idx === STATUSES.length - 1, () => setStatus(task.id, STATUSES[idx + 1]));
  const del = actionButton("✕", "Delete task", false, () => {
    if (confirm(`Delete "${task.title}"?`)) removeTask(task.id);
  });
  del.classList.add("delete-btn");
  actions.append(back, fwd, del);

  meta.append(when, actions);
  card.appendChild(meta);

  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", task.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("dblclick", () => {
    const next = prompt("Rename task:", task.title);
    if (next !== null) renameTask(task.id, next);
  });

  return card;
}

function actionButton(glyph, label, disabled, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = glyph;
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.disabled = disabled;
  btn.addEventListener("click", onClick);
  return btn;
}

/* Drag & drop targets */
for (const zone of document.querySelectorAll(".cards")) {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    setStatus(e.dataTransfer.getData("text/plain"), zone.dataset.status);
  });
}

/* ============================================================
   Add form
   ============================================================ */

const addForm = document.getElementById("add-form");
const taskInput = document.getElementById("task-input");
const dueInput = document.getElementById("due-input");
const recurInput = document.getElementById("recur-input");
const daysPicker = document.getElementById("days-picker");

recurInput.addEventListener("change", () => {
  daysPicker.hidden = recurInput.value !== "days";
});

for (const btn of daysPicker.querySelectorAll("button")) {
  btn.addEventListener("click", () => btn.classList.toggle("is-active"));
}

function pickedDays() {
  return [...daysPicker.querySelectorAll("button.is-active")].map((b) => Number(b.dataset.day));
}

function resetDaysPicker() {
  daysPicker.hidden = true;
  for (const btn of daysPicker.querySelectorAll("button.is-active")) btn.classList.remove("is-active");
}

function pickedDueAt() {
  if (!dueInput.value) return null;
  const [y, m, d] = dueInput.value.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59).getTime(); // end of the chosen day, local time
}

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = taskInput.value.trim();
  if (!title) return;
  if (recurInput.value === "days") {
    const days = pickedDays();
    if (days.length === 0) {
      showToast("Pick at least one day for the repeat");
      return;
    }
    addRecurring(title, "days", pickedDueAt(), days);
  } else if (recurInput.value) {
    addRecurring(title, recurInput.value, pickedDueAt());
  } else {
    addTask(title, { dueAt: pickedDueAt() });
  }
  taskInput.value = "";
  dueInput.value = "";
  recurInput.value = "";
  resetDaysPicker();
  taskInput.focus();
});

/* ============================================================
   Voice input
   ============================================================ */

const voiceBtn = document.getElementById("voice-btn");
const voiceStatus = document.getElementById("voice-status");
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;

if (!SpeechRec) {
  voiceBtn.disabled = true;
  voiceBtn.title = "Voice input isn't supported in this browser (try Chrome or Safari)";
} else {
  recognition = new SpeechRec();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    listening = true;
    voiceBtn.classList.add("is-listening");
    setVoiceStatus("Listening… say your task");
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (const result of event.results) {
      if (result.isFinal) {
        const transcript = result[0].transcript.trim();
        if (transcript) {
          addTask(transcript, { dueAt: pickedDueAt() });
          showToast(`Added: ${transcript}`);
        }
        setVoiceStatus("");
      } else {
        interim += result[0].transcript;
      }
    }
    if (interim) setVoiceStatus(`“${interim}”`);
  };

  recognition.onerror = (event) => {
    const messages = {
      "not-allowed": "Microphone access was blocked — allow it in your browser settings.",
      "no-speech": "Didn't catch anything — tap the mic and try again.",
      network: "Speech service unavailable — check your connection.",
    };
    setVoiceStatus(messages[event.error] || `Voice error: ${event.error}`);
  };

  recognition.onend = () => {
    listening = false;
    voiceBtn.classList.remove("is-listening");
  };

  voiceBtn.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch {
        /* start() throws if called while already starting — ignore */
      }
    }
  });
}

function setVoiceStatus(text) {
  voiceStatus.textContent = text;
  voiceStatus.hidden = !text;
}

/* ============================================================
   Deadline notifications (browser) — pings once when a task
   turns orange (due soon) and once more if it breaches
   ============================================================ */

const NOTIFY_PREF_KEY = "taskit.notify";
const notifyBtn = document.getElementById("notify-btn");
const NOTIFY_RANK = { serious: 1, critical: 2 };

function notificationsGranted() {
  return "Notification" in window && Notification.permission === "granted";
}

function notifyEnabled() {
  return notificationsGranted() && localStorage.getItem(NOTIFY_PREF_KEY) === "on";
}

function renderNotifyButton() {
  if (!("Notification" in window)) {
    notifyBtn.hidden = true;
    return;
  }
  notifyBtn.hidden = false;
  const on = notifyEnabled();
  notifyBtn.textContent = on ? "🔔 On" : "🔕 Off";
  notifyBtn.classList.toggle("is-on", on);
  notifyBtn.title = on
    ? "Deadline notifications are on — click to turn off"
    : "Get a notification when a task is due soon or overdue";
}

if ("Notification" in window) {
  notifyBtn.addEventListener("click", async () => {
    if (notifyEnabled()) {
      localStorage.setItem(NOTIFY_PREF_KEY, "off");
    } else {
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (permission === "granted") {
        localStorage.setItem(NOTIFY_PREF_KEY, "on");
        showToast("Deadline notifications are on");
        checkDeadlineNotifications();
      } else if (permission === "denied") {
        showToast("⚠ Notifications are blocked — allow them in your browser's site settings");
      }
    }
    renderNotifyButton();
  });
}

function checkDeadlineNotifications() {
  if (!notifyEnabled()) return;
  const now = Date.now();
  let changed = false;
  for (const task of data.tasks) {
    const level = urgencyOf(task, now);
    if (!NOTIFY_RANK[level]) continue;
    if ((NOTIFY_RANK[task.notifiedLevel] || 0) >= NOTIFY_RANK[level]) continue;
    const body = level === "critical"
      ? `Overdue: ${dueLabel(task, now).replace("Overdue ", "past deadline by ")}`
      : dueLabel(task, now);
    try {
      const n = new Notification(level === "critical" ? `🔴 ${task.title}` : `⏰ ${task.title}`, {
        body,
        tag: `taskit-${task.id}`, // replaces the earlier ping for the same task
        icon: "icon.svg",
      });
      n.onclick = () => window.focus();
      task.notifiedLevel = level;
      changed = true;
    } catch {
      /* some platforms (e.g. Android tabs) only allow notifications via a
         service worker — fail quietly rather than break the tick */
    }
  }
  if (changed) save();
}

/* ============================================================
   Toast
   ============================================================ */

const toast = document.getElementById("toast");
let toastTimer = null;

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2600);
}

/* ============================================================
   Tabs
   ============================================================ */

const tabBoard = document.getElementById("tab-board");
const tabStats = document.getElementById("tab-stats");
const viewBoard = document.getElementById("view-board");
const viewStats = document.getElementById("view-stats");

function switchTab(showStats) {
  tabBoard.classList.toggle("is-active", !showStats);
  tabStats.classList.toggle("is-active", showStats);
  tabBoard.setAttribute("aria-selected", String(!showStats));
  tabStats.setAttribute("aria-selected", String(showStats));
  viewBoard.hidden = showStats;
  viewStats.hidden = !showStats;
  if (showStats) renderStats();
}

tabBoard.addEventListener("click", () => switchTab(false));
tabStats.addEventListener("click", () => switchTab(true));

/* ============================================================
   Stats
   ============================================================ */

function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d.getTime();
}

function completedTasks() {
  return data.tasks
    .filter((t) => t.status === "done" && t.completedAt)
    .map((t) => ({ ...t, duration: Math.max(0, t.completedAt - t.createdAt) }));
}

function average(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function renderStats() {
  const done = completedTasks();
  const open = data.tasks.length - done.length;

  document.getElementById("stat-done").textContent = done.length;
  document.getElementById("stat-open").textContent = open;

  const avgEl = document.getElementById("stat-avg");
  const deltaEl = document.getElementById("stat-avg-delta");
  const overallAvg = average(done.map((t) => t.duration));
  avgEl.textContent = overallAvg === null ? "—" : formatDuration(overallAvg);

  // Trend: last 28 days vs the 28 days before that
  const now = Date.now();
  const recent = done.filter((t) => t.completedAt > now - 28 * DAY_MS);
  const prior = done.filter(
    (t) => t.completedAt <= now - 28 * DAY_MS && t.completedAt > now - 56 * DAY_MS
  );
  const recentAvg = average(recent.map((t) => t.duration));
  const priorAvg = average(prior.map((t) => t.duration));

  deltaEl.className = "stat-delta";
  if (recentAvg !== null && priorAvg !== null && priorAvg > 0) {
    const pct = Math.round(((recentAvg - priorAvg) / priorAvg) * 100);
    if (pct <= -3) {
      deltaEl.classList.add("good");
      deltaEl.textContent = `▼ ${Math.abs(pct)}% faster than the previous 4 weeks`;
    } else if (pct >= 3) {
      deltaEl.classList.add("bad");
      deltaEl.textContent = `▲ ${pct}% slower than the previous 4 weeks`;
    } else {
      deltaEl.textContent = "≈ steady vs the previous 4 weeks";
    }
  } else {
    deltaEl.textContent = "";
  }

  renderChart(done);
  renderRanking("list-slowest", done, (a, b) => b.duration - a.duration);
  renderRanking("list-fastest", done, (a, b) => a.duration - b.duration);
  renderBackupNote();
}

function renderRanking(elementId, done, comparator) {
  const list = document.getElementById(elementId);
  list.innerHTML = "";
  const top = [...done].sort(comparator).slice(0, 5);
  if (top.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = "No completed tasks yet.";
    list.appendChild(li);
    return;
  }
  for (const t of top) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "t-name";
    name.textContent = t.title;
    name.title = t.title;
    const dur = document.createElement("span");
    dur.className = "t-dur";
    dur.textContent = formatDuration(t.duration);
    li.append(name, dur);
    list.appendChild(li);
  }
}

/* ============================================================
   Weekly average chart (SVG, single series)
   ============================================================ */

const MAX_WEEKS = 12;

function weeklyBuckets(done) {
  if (done.length === 0) return [];
  const byWeek = new Map();
  for (const t of done) {
    const wk = weekStart(t.completedAt);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(t.duration);
  }
  // Continuous run of weeks from first completion (or 12 weeks back) to now
  const thisWeek = weekStart(Date.now());
  const firstWeek = Math.max(
    Math.min(...byWeek.keys()),
    thisWeek - (MAX_WEEKS - 1) * 7 * DAY_MS
  );
  const buckets = [];
  for (let wk = firstWeek; wk <= thisWeek; wk += 7 * DAY_MS) {
    const durations = byWeek.get(wk) || [];
    buckets.push({
      week: wk,
      count: durations.length,
      avgDays: durations.length ? average(durations) / DAY_MS : null,
    });
  }
  return buckets;
}

function renderChart(done) {
  const host = document.getElementById("chart");
  const emptyNote = document.getElementById("chart-empty");
  host.innerHTML = "";
  const buckets = weeklyBuckets(done);
  const hasData = buckets.some((b) => b.count > 0);
  emptyNote.hidden = hasData;
  if (!hasData) return;

  const W = 640, H = 240;
  const pad = { top: 16, right: 12, bottom: 28, left: 40 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const maxVal = Math.max(...buckets.map((b) => b.avgDays || 0), 0.1);
  const yMax = niceCeil(maxVal);
  const barSlot = plotW / buckets.length;
  const barW = Math.min(48, Math.max(10, barSlot - 8));

  const styles = getComputedStyle(document.documentElement);
  const ink = {
    series: styles.getPropertyValue("--series-1").trim(),
    grid: styles.getPropertyValue("--gridline").trim(),
    baseline: styles.getPropertyValue("--baseline").trim(),
    muted: styles.getPropertyValue("--text-muted").trim(),
  };

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Bar chart of average days to complete tasks, per week",
  });

  // Horizontal gridlines + y tick labels
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const value = (yMax / ticks) * i;
    const y = pad.top + plotH - (value / yMax) * plotH;
    if (i > 0) {
      svg.appendChild(el("line", {
        x1: pad.left, x2: W - pad.right, y1: y, y2: y,
        stroke: ink.grid, "stroke-width": 1,
      }));
    }
    svg.appendChild(el("text", {
      x: pad.left - 8, y: y + 4, "text-anchor": "end",
      "font-size": 11, fill: ink.muted,
    }, formatTick(value)));
  }

  // Baseline
  svg.appendChild(el("line", {
    x1: pad.left, x2: W - pad.right,
    y1: pad.top + plotH, y2: pad.top + plotH,
    stroke: ink.baseline, "stroke-width": 1,
  }));

  const labelEvery = buckets.length > 8 ? 2 : 1;

  buckets.forEach((b, i) => {
    const cx = pad.left + barSlot * i + barSlot / 2;

    // X label
    if (i % labelEvery === 0) {
      svg.appendChild(el("text", {
        x: cx, y: H - 8, "text-anchor": "middle",
        "font-size": 11, fill: ink.muted,
      }, formatDate(b.week)));
    }

    if (b.count === 0) return;

    const h = Math.max(2, (b.avgDays / yMax) * plotH);
    const x = cx - barW / 2;
    const y = pad.top + plotH - h;
    const r = Math.min(4, h, barW / 2);

    const bar = el("path", {
      class: "bar",
      d: roundedTopBar(x, y, barW, h, r),
      fill: ink.series,
    });
    svg.appendChild(bar);

    // Oversized invisible hit target for the tooltip
    const hit = el("rect", {
      x: pad.left + barSlot * i, y: pad.top,
      width: barSlot, height: plotH,
      fill: "transparent",
    });
    attachTooltip(hit, () =>
      `<div class="tt-title">Week of ${formatDate(b.week)}</div>` +
      `<div>Avg: ${formatDuration(b.avgDays * DAY_MS)}</div>` +
      `<div class="tt-sub">${b.count} task${b.count === 1 ? "" : "s"} completed</div>`
    );
    svg.appendChild(hit);
  });

  host.appendChild(svg);
}

function niceCeil(value) {
  // Ceilings divisible by 4 so the gridline ticks land on round values
  const steps = [0.25, 0.5, 1, 2, 4, 8, 12, 16, 24, 48, 96, 180, 360];
  for (const s of steps) if (value <= s) return s;
  return Math.ceil(value / 100) * 100;
}

function formatTick(days) {
  if (days === 0) return "0";
  if (days < 1) {
    const hours = days * 24;
    return `${hours % 1 ? hours.toFixed(1) : hours}h`;
  }
  return `${days % 1 === 0 ? days : days.toFixed(1)}d`;
}

function roundedTopBar(x, y, w, h, r) {
  return (
    `M ${x} ${y + h} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} ` +
    `L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h} Z`
  );
}

function el(tag, attrs, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ============================================================
   Tooltip
   ============================================================ */

const tooltip = document.getElementById("tooltip");

function attachTooltip(target, html) {
  const move = (e) => {
    tooltip.innerHTML = html();
    tooltip.hidden = false;
    const rect = tooltip.getBoundingClientRect();
    let x = e.clientX + 12;
    let y = e.clientY - rect.height - 10;
    if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - 12;
    if (y < 8) y = e.clientY + 14;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };
  target.addEventListener("pointerenter", move);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerleave", () => (tooltip.hidden = true));
}

/* ============================================================
   Boot
   ============================================================ */

function renderAll() {
  renderBoard();
  if (!viewStats.hidden) renderStats();
}

/* ============================================================
   Sync bridge — the optional cloud-sync module (sync.js) hooks
   in here; the app is fully functional without it
   ============================================================ */

export const bridge = {
  /** Set by sync.js: called (debounced there) after every local mutation */
  onLocalChange: null,
  getData: () => data,
  /** Replace state with a remote copy — persists locally WITHOUT
      bumping updatedAt or echoing back through onLocalChange */
  replaceData(remote) {
    const clean = sanitizeData(remote);
    if (!clean) return false;
    data = clean;
    persistLocal();
    renderAll();
    return true;
  },
  showToast,
  setSyncNote(text) {
    const note = document.getElementById("sync-note");
    if (note) note.textContent = text;
  },
};

runRecurrence();
renderAll();
save(); // persist any v1 migration and trigger the daily backup
renderNotifyButton();
checkDeadlineNotifications();

bridge.setSyncNote("Cloud sync: not configured — see SETUP-SYNC.md to enable it.");
import("./sync.js").catch(() => {
  /* sync module missing or failed to load — local-only mode is fine */
});

// Keep recurrence, deadline colors, and notifications fresh while open
setInterval(() => {
  runRecurrence();
  renderAll();
  checkDeadlineNotifications();
}, 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    runRecurrence();
    renderAll();
    checkDeadlineNotifications();
  }
});
