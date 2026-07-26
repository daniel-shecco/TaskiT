# Enabling cloud sync (Firebase)

TaskiT works local-only out of the box. To sync your board across devices
(phone + laptop), connect it to a free Firebase project. Takes about five
minutes, no credit card, and the free "Spark" plan is far more than a personal
task board will ever use.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google
   account.
2. **Add project** → name it (e.g. `taskit`) → Google Analytics can be
   disabled → **Create project**.

## 2. Enable Google sign-in

1. In the left menu: **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Google** and save.
3. Under **Settings → Authorized domains**, make sure the domain you'll open
   TaskiT from is listed. `localhost` is pre-authorized; if you host on GitHub
   Pages, add `<your-username>.github.io`.

## 3. Create the Firestore database

1. **Build → Firestore Database → Create database** → choose a location →
   start in **production mode**.
2. Open the **Rules** tab and replace the contents with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

3. **Publish**. These rules mean each signed-in user can only read and write
   their own board — nobody else's.

## 4. Get your web app config

1. **Project settings** (gear icon) → **Your apps** → add a **Web app**
   (`</>` icon), name it anything, no hosting needed.
2. Firebase shows a `firebaseConfig` object. Copy its values into a file named
   `firebase-config.json` next to `index.html` — use
   `firebase-config.example.json` as the template:

   ```json
   {
     "apiKey": "AIza...",
     "authDomain": "your-project.firebaseapp.com",
     "projectId": "your-project",
     "storageBucket": "your-project.appspot.com",
     "messagingSenderId": "1234567890",
     "appId": "1:1234567890:web:abc123"
   }
   ```

   > This config is safe to commit and publish — these are public
   > identifiers, not secrets. Your data is protected by the security rules
   > from step 3, not by hiding the config.

## 5. Use it

Reload TaskiT. A **Sign in to sync** button appears in the header — sign in
with Google on each device and your board syncs automatically (changes push
within a second; other devices update live). The Stats tab's "Your data"
section shows the current sync status.

Notes:

- Everything keeps working offline; Firestore queues changes and syncs when
  you're back online.
- If two devices are edited while both offline, the most recently changed
  copy of the board wins when they reconnect.
- Signing out leaves your tasks on the device; it only stops syncing.
