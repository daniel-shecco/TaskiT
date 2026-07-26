"use strict";

/* ============================================================
   TaskiT — personal kanban with cycle-time stats & voice input
   ============================================================ */

const STORAGE_KEY = "taskit.tasks.v1";
const STATUSES = ["backlog", "progress", "done"];
const DAY_MS = 24 * 60 * 60 * 1000;

/* ---------- Store ---------- */

let tasks = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => t && t.id && t.title) : [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function addTask(title) {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: trimmed,
    status: "backlog",
    createdAt: Date.now(),
    completedAt: null,
  };
  tasks.unshift(task);
  save();
  renderAll();
  return task;
}

function setStatus(id, status) {
  const task = tasks.find((t) => t.id === id);
  if (!task || !STATUSES.includes(status) || task.status === status) return;
  task.status = status;
  task.completedAt = status === "done" ? Date.now() : null;
  save();
  renderAll();
}

function removeTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  save();
  renderAll();
}

function renameTask(id, title) {
  const task = tasks.find((t) => t.id === id);
  const trimmed = (title || "").trim();
  if (!task || !trimmed) return;
  task.title = trimmed;
  save();
  renderAll();
}

/* ---------- Formatting ---------- */

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

/* ---------- Board rendering ---------- */

function renderBoard() {
  for (const status of STATUSES) {
    const container = document.querySelector(`.cards[data-status="${status}"]`);
    const items = tasks.filter((t) => t.status === status);
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

    for (const task of items) container.appendChild(buildCard(task));
  }
}

function buildCard(task) {
  const card = document.createElement("article");
  card.className = "card";
  card.draggable = true;
  card.dataset.id = task.id;

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = task.title;

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
  card.append(title, meta);

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

/* ---------- Add form ---------- */

const addForm = document.getElementById("add-form");
const taskInput = document.getElementById("task-input");

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (addTask(taskInput.value)) {
    taskInput.value = "";
    taskInput.focus();
  }
});

/* ---------- Voice input ---------- */

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
          addTask(transcript);
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

/* ---------- Toast ---------- */

const toast = document.getElementById("toast");
let toastTimer = null;

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2600);
}

/* ---------- Tabs ---------- */

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

/* ---------- Stats ---------- */

function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d.getTime();
}

function completedTasks() {
  return tasks
    .filter((t) => t.status === "done" && t.completedAt)
    .map((t) => ({ ...t, duration: Math.max(0, t.completedAt - t.createdAt) }));
}

function average(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function renderStats() {
  const done = completedTasks();
  const open = tasks.length - done.length;

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

/* ---------- Weekly average chart (SVG, single series) ---------- */

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

/* ---------- Tooltip ---------- */

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

/* ---------- Boot ---------- */

function renderAll() {
  renderBoard();
  if (!viewStats.hidden) renderStats();
}

renderAll();
