/* ============================================================
   TaskiT cloud sync (optional) — Firebase Auth + Firestore.

   Activates only when firebase-config.json exists next to the
   app. Without it, TaskiT keeps working local-only. Data model:
   one Firestore document per user (users/{uid}) holding the
   whole board; newest updatedAt wins. Firestore's offline cache
   keeps sync working through connection drops.
   ============================================================ */

import { bridge } from "./app.js";

const PUSH_DEBOUNCE_MS = 800;
const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

const syncBtn = document.getElementById("sync-btn");

let db = null;
let auth = null;
let fs = null; // firestore module namespace
let user = null;
let pushTimer = null;
let unsubscribe = null;

init();

async function init() {
  let config;
  try {
    const res = await fetch("firebase-config.json", { cache: "no-store" });
    if (!res.ok) throw new Error("no config");
    config = await res.json();
    if (!config.apiKey || !config.projectId) throw new Error("incomplete config");
  } catch {
    bridge.setSyncNote(
      "Cloud sync: not configured. Add firebase-config.json (see SETUP-SYNC.md) to sync across devices."
    );
    return;
  }

  try {
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    fs = fsMod;
    const app = initializeApp(config);
    auth = authMod.getAuth(app);
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });

    authMod.onAuthStateChanged(auth, (u) => {
      user = u;
      if (u) {
        startSync();
      } else {
        stopSync();
        setUi("Sign in to sync", "Cloud sync: signed out — your tasks stay on this device until you sign in.");
      }
    });

    syncBtn.hidden = false;
    syncBtn.addEventListener("click", async () => {
      if (user) {
        if (confirm(`Signed in as ${user.displayName || user.email}. Sign out?\n(Tasks stay on this device.)`)) {
          await authMod.signOut(auth);
        }
      } else {
        try {
          await authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider());
        } catch (err) {
          if (err && err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
            bridge.showToast("⚠ Sign-in failed — check SETUP-SYNC.md (authorized domains)");
          }
        }
      }
    });

    // Push whenever the app mutates local state
    bridge.onLocalChange = schedulePush;
  } catch {
    bridge.setSyncNote("Cloud sync: couldn't load Firebase — check your connection and firebase-config.json.");
  }
}

function docRef() {
  return fs.doc(db, "users", user.uid);
}

function startSync() {
  setUi(initials(user), `Cloud sync: on, signed in as ${user.displayName || user.email}. Changes sync automatically.`);

  unsubscribe = fs.onSnapshot(docRef(), (snap) => {
    if (snap.metadata.hasPendingWrites) return; // our own write echoing back
    const remote = snap.data();
    const local = bridge.getData();
    if (!remote) {
      // First device: seed the cloud with local data
      if (local.tasks.length || local.recurring.length) push();
      return;
    }
    if ((remote.updatedAt || 0) > (local.updatedAt || 0)) {
      if (bridge.replaceData(remote)) bridge.showToast("Synced from cloud");
    } else if ((local.updatedAt || 0) > (remote.updatedAt || 0)) {
      push();
    }
  }, () => {
    bridge.setSyncNote("Cloud sync: error reading from Firestore — check the security rules in SETUP-SYNC.md.");
  });
}

function stopSync() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  clearTimeout(pushTimer);
}

function schedulePush() {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, PUSH_DEBOUNCE_MS);
}

async function push() {
  if (!user) return;
  try {
    const d = bridge.getData();
    await fs.setDoc(docRef(), {
      version: d.version,
      tasks: d.tasks,
      recurring: d.recurring,
      categories: d.categories || [],
      updatedAt: d.updatedAt || Date.now(),
    });
  } catch {
    bridge.setSyncNote("Cloud sync: last push failed — will retry on your next change.");
  }
}

function initials(u) {
  const name = u.displayName || u.email || "?";
  return "☁ " + name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function setUi(btnText, note) {
  syncBtn.textContent = btnText;
  syncBtn.title = note;
  bridge.setSyncNote(note);
}
