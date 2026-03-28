# InterestPro — Deployment Guide

## Step 1 — Copy src files

Replace your project's `src/` folder with the one in this zip.

## Step 2 — Copy icons to public/

Copy these 3 files into your project's `public/` folder:

- `favicon.ico` → replaces the default React favicon
- `logo192.png` → used by manifest.json
- `logo512.png` → used by manifest.json

## Step 3 — Update public/manifest.json

Make sure your `public/manifest.json` has:

```json
{
  "short_name": "InterestPro",
  "name": "InterestPro Loan Manager",
  "icons": [
    {
      "src": "favicon.ico",
      "sizes": "64x64 32x32 24x24 16x16",
      "type": "image/x-icon"
    },
    { "src": "logo192.png", "type": "image/png", "sizes": "192x192" },
    { "src": "logo512.png", "type": "image/png", "sizes": "512x512" }
  ],
  "start_url": ".",
  "display": "standalone",
  "theme_color": "#1a1d2e",
  "background_color": "#1a1d2e"
}
```

## Step 4 — Paste Firebase config

In `src/firebase.js`, replace the placeholders with your project config from
Firebase Console → Project Settings → Your apps → SDK setup.

## Step 5 — Build & Deploy

```bash
npm run build
firebase deploy
```

## Firestore Rules

Publish these rules in Firebase Console → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /admins/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
    }
    match /clients/{clientId} {
      allow read, update, delete: if request.auth != null
        && request.auth.uid == resource.data.adminId;
      allow create: if request.auth != null
        && request.resource.data.adminId == request.auth.uid;
    }
  }
}
```

## Adding Admins

1. Firebase Console → Authentication → Add user → copy UID
2. Firestore → `admins` collection → New document with that UID
3. Add fields: `name` (string), `email` (string)
