# NEXORATECH Clipora AI — Deployment & Configuration Guide

**NEXORATECH Clipora AI** runs on a self-contained full-stack architecture combining React + Tailwind CSS v4, a Node.js + Express backend proxy (`/api/*`) for Gemini AI calls and URL verification, built-in Node SQLite (`node:sqlite`) persistence with `scrypt` password hashing and HMAC-SHA256 signed session tokens, and browser-side FFmpeg.wasm video processing.

---

## 1. Architecture Summary

- **Frontend (Vite + React)**: Handles landing marketing pages, email/password authentication flows, customer workspace, manual & AI clip editing, Canvas caption/reframe previews, IndexedDB media caching (`clipora_local_media`), and FFmpeg.wasm rendering.
- **Backend (`server.ts` + `server/`)**:
  - Verifies signed server session tokens (`Authorization: Bearer` or `HttpOnly; SameSite=None; Partitioned` cookies with anti-CSRF checks) on all protected endpoints.
  - Persists users, projects, source videos, processing jobs, clips, transcripts, exports, brand kits, usage logs, system settings, notifications, and audit logs in SQLite (`data/clipora.db`).
  - Executes server-side Gemini transcription (`gemini-3.5-transcribe`) and moment selection (`gemini-4-hydrogen` / `gemini-3.1-flash-lite`) via `@google/genai`.
  - Validates direct remote media URLs against private/internal IPs and restricted social streaming hosts.
  - Optionally generates short-lived Cloudflare R2 presigned upload/download URLs.

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
| `CLIPORA_DB_PATH` | Optional | SQLite database file path (defaults to `data/clipora.db`). |
| `SUPER_ADMIN_EMAIL` | Optional | Initial Super Admin email allowed for initial setup (defaults to `reddox528@gmail.com`). |
| `SUPER_ADMIN_BOOTSTRAP_SECRET` | Optional | Optional secret prompted during initial Super Admin setup. |
| `R2_ACCOUNT_ID` | Optional | Cloudflare R2 Account ID for optional remote media sync. |
| `R2_ACCESS_KEY_ID` | Optional | Cloudflare R2 S3-compatible Access Key ID. |
| `R2_SECRET_ACCESS_KEY` | Optional | Cloudflare R2 S3-compatible Secret Access Key. |
| `R2_BUCKET_NAME` | Optional | Target Cloudflare R2 bucket name (default `clipora-media`). |

---

## 4. Initial Super Admin Setup

1. **Via `/secure-control-panel` (First-Run Setup)**:
   - Open your deployed app, click the discreet **Admin Access** link in the bottom-right website footer (`/secure-control-panel`).
   - When no Super Admin exists yet, a one-time **Initialize Super Admin** form is displayed for the configured `SUPER_ADMIN_EMAIL` (`reddox528@gmail.com`). Once completed, setup locks permanently.
2. **Or via Terminal**:
   - Run `npm run setup:super-admin` in the server workspace to establish the initial `SUPER_ADMIN` credentials in SQLite.
3. **Customer Registrations**:
   - Public users sign up with `role: "CUSTOMER"` and `accountStatus: "PENDING"` until approved by an authorized administrator.

---

## 5. Free-Tier Production Hosting

Deploy the full repository (`server.ts` + `dist/`) to a Node.js container host (such as Google Cloud Run or Render):
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start` (runs `NODE_ENV=production tsx server.ts` on `0.0.0.0:$PORT`)
- **Env Vars**: Set `GEMINI_API_KEY` and optional `R2_*` / `CLIPORA_DB_PATH` variables in the host's secret settings.

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
