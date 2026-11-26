# REDDOX Clipora AI — Deployment & Configuration Guide

**REDDOX Clipora AI** runs on a strict free-tier architecture combining React + Tailwind CSS v4, a Node.js + Express backend proxy (`/api/*`) for Gemini AI calls and URL verification, Firebase Authentication & Cloud Firestore (Spark plan), and browser-side FFmpeg.wasm video processing.

---

## 1. Architecture Summary

- **Frontend (Vite + React)**: Handles landing marketing pages, authentication flows, customer workspace, manual & AI clip editing, Canvas caption/reframe previews, IndexedDB media caching (`clipora_local_media`), and FFmpeg.wasm rendering.
- **Backend (`server.ts` + `server/`)**:
  - Verifies Firebase ID tokens on all protected endpoints using `firebase-admin`.
  - Executes server-side Gemini transcription (`gemini-3.5-transcribe`) and moment selection (`gemini-4-hydrogen` / `gemini-3.1-flash-lite`) via `@google/genai`.
  - Validates direct remote media URLs against private/internal IPs and restricted social streaming hosts.
  - Optionally generates short-lived Cloudflare R2 presigned upload/download URLs.
- **Database & Auth**: Firebase Spark plan (`firebase-applet-config.json` + hardened `firestore.rules`).

---

## 2. Local Development

```bash
npm install
cp .env.example .env
# Add your GEMINI_API_KEY in .env (or Google AI Studio Secrets)
npm run dev
```

Run checks and tests:

```bash
npm run lint         # TypeScript type-checking
npm run lint:rules   # Firebase security rules ESLint check
npm test             # Unit, integration, and security invariant tests
npm run build        # Production Vite bundle -> dist/
```

---

## 3. Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes (for AI features) | Server-side Google Gemini API key. Never exposed to the browser. |
| `PORT` | Optional (default `3000`) | HTTP listen port for `server.ts`. |
| `APP_URL` | Optional | Public URL of the deployed application. |
| `SUPER_ADMIN_EMAIL` | Optional | Initial Super Admin email allowed for initial setup (defaults to `reddox528@gmail.com`). |
| `SUPER_ADMIN_BOOTSTRAP_SECRET` | Optional | Optional secret prompted during `npm run setup:super-admin` inside Google AI Studio. |
| `R2_ACCOUNT_ID` | Optional | Cloudflare R2 Account ID for optional remote media sync. |
| `R2_ACCESS_KEY_ID` | Optional | Cloudflare R2 S3-compatible Access Key ID. |
| `R2_SECRET_ACCESS_KEY` | Optional | Cloudflare R2 S3-compatible Secret Access Key. |
| `R2_BUCKET_NAME` | Optional | Target Cloudflare R2 bucket name (default `clipora-media`). |

---

## 4. Firebase Spark Setup Checklist

1. **Authentication Providers**:
   - In the Firebase Console under **Authentication > Sign-in method**, ensure **Email/Password** and **Google** providers are enabled.
   - Add your deployed domain under **Authentication > Settings > Authorized domains** for Google Sign-In popups.
2. **Firestore Security Rules**:
   - Rules live in `/firestore.rules` and are already provisioned/deployed for this workspace.
   - If deploying to another Firebase project, deploy rules via Firebase CLI:
     ```bash
     firebase deploy --only firestore:rules
     ```
3. **Initial Super Admin Setup (Google AI Studio Terminal)**:
   - Run `npm run setup:super-admin` inside Google AI Studio to establish the initial `SUPER_ADMIN` email/password account (`reddox528@gmail.com`) and verify your email.
   - Once verified, sign in from any device via the discreet **Admin Access** link in the bottom-right website footer (`/secure-control-panel`).
   - Subsequent customers register with `role: "CUSTOMER"` and `accountStatus: "PENDING"` until approved by an authorized administrator.

---

## 5. Free-Tier Production Hosting Options

### Option A: Single Full-Stack Free-Tier Node Host (Recommended)
Deploy the full repository (`server.ts` + `dist/`) to a free Node.js container host (such as Google Cloud Run free tier or Render Free Web Service):
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start` (runs `NODE_ENV=production tsx server.ts` on `0.0.0.0:$PORT`)
- **Env Vars**: Set `GEMINI_API_KEY` and optional `R2_*` variables in the host's secret settings.

### Option B: Cloudflare Pages + External `/api` Origin
If hosting the static `dist/` frontend on **Cloudflare Pages** (`npm run build` -> `dist`):
- Host `server.ts` on your Node container origin and configure a Cloudflare Pages Function / proxy rule forwarding `/api/*` requests to your Node backend so relative `/api/*` fetches work seamlessly without exposing `GEMINI_API_KEY`.

---

## 6. Optional Cloudflare R2 CORS Policy

If configuring optional Cloudflare R2 free-tier storage for remote uploads and downloads, apply a CORS rule on your R2 bucket permitting `PUT` and `GET` from your deployed origin:

```json
[
  {
    "AllowedOrigins": ["https://your-app-domain.com", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```
