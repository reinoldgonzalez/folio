# Folio

A rotary-file SPA for business cards. Photograph a card, OCR it in the browser, then file it A–Z by company. Cards persist in `localStorage` via Zustand — no auth, database, or paid APIs.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 (`@tailwindcss/vite`)
- Zustand (persisted card store)
- Tesseract.js (client-side OCR; manual entry always available)
- `qrcode` for vCard QR codes
- `vite-plugin-pwa` for installable PWA

## Run

```bash
npm install
npm run dev
```

Dev server listens on `http://0.0.0.0:5173` with `server.allowedHosts: true` (Cloudflare tunnel friendly).

```bash
npm run build
npm run preview
```

## Features

### Capture & OCR
- Photograph front/back or choose from library
- Client-side OCR proposes company, person, title, phone, email, website, address, notes, and **line of work**
- Manual edit always available — OCR failure never blocks save

### One-tap actions (Details face)
- **Call** (`tel:`), **Text** (`sms:`), **Email** (`mailto:`), **Maps** (Google/Apple)
- **Copy all** — name, company, title, phone, email, website, address, line, notes
- **Share** / **QR / vCard** — download `.vcf`, show QR of vCard text, `navigator.share` when available

### Line of work
- Keyword suggestions from OCR / free text (construction, fishing, glass, design, law, photo, food, wine, interiors, flowers, type, …)
- Custom lines allowed
- **Pinned/favorite lines** persist in the store and appear first for one-tap filter

### Duplicates
- On save, detect likely duplicates by normalized phone, email, or company + person
- Choose **Update existing** (merge fields; keep id/images unless new photos) or **Create new**

### Favorites & recent
- Star a card on Details; horizontal **Favorites** + **Recent** strip (capped ~8) above the wheel
- `lastViewedAt` updates when a card becomes active; tap a chip to jump

### Backup
- Header menu → **Export JSON backup** / **Import JSON…**
- Import conflict handling: skip existing id or replace

### PWA / install
- Web app manifest + service worker via `vite-plugin-pwa`
- Theme color `#121110` (Folio dark UI)
- Deep link: open with `?add=1` to launch **Add card** / camera flow

#### Add to Home Screen

**iPhone / iPad (Safari)**  
1. Open Folio in Safari  
2. Tap the Share button  
3. Choose **Add to Home Screen**  
4. Confirm **Add**

**Android (Chrome)**  
1. Open Folio in Chrome  
2. Tap the ⋮ menu  
3. Choose **Install app** or **Add to Home screen**

**Desktop (Chrome / Edge)**  
Use the install icon in the address bar, or menu → **Install Folio**.

After install, Folio opens standalone. Use `https://your-host/?add=1` (or the same path on your tunnel) to jump straight into capture.

## Sharing Folio

Folio is **private per device/browser**. Cards live only in that browser’s `localStorage` (`folio-cards-v1`). There is no account, no server sync, and no shared backend.

- Share the **same public URL** with anyone — they get the app, not your file.
- Each visitor starts with their own empty Folio (plus optional sample cards on first visit).
- Your cards and theirs never mix across browsers or devices.
- Clearing site data wipes the local file — use **Export JSON backup** from the menu first.
- To move cards to another browser/device, export a backup there and **Import JSON…** on the new one.

### Deploy (static host, free)

Build once, then host the `dist/` folder:

```bash
npm install
npm run build
```

**Cloudflare Pages**
1. Connect the repo (or upload `dist/`).
2. Build command: `npm run build` · Output directory: `dist`
3. Framework preset: None / Vite. Root path `/` — PWA `start_url` and `scope` are `/`.

**GitHub Pages**
1. Enable Pages for the repo (GitHub Actions or deploy from `dist/`).
2. For a **user/org site** (`username.github.io`) or custom domain at the site root, `base: '/'` (already set) is correct.
3. If you publish to a **project subpath** (`username.github.io/folio/`), change Vite `base` to `'/folio/'` and rebuild — otherwise keep `/` for root hosting.

After deploy, open the public URL, install as a PWA if you like, and each browser keeps its own Folio.

## Notes

- Sample cards ship under `public/cards/` and load on first visit.
- Everything stays client-only; clearing site data removes the file (export a backup first).
