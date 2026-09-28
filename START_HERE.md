# CoolSense SUSS — Final Website

This ZIP contains the complete source code for the final CoolSense Circuit Twin website.

## Requirements

- Node.js 22.13 or newer
- pnpm

## 1. Open the project

Extract the ZIP, open the extracted folder in Visual Studio Code, then open **Terminal → New Terminal**.

## 2. Install dependencies

```powershell
corepack enable
pnpm install
```

## 3. Add the SUSS API key

Create a file named `.env.local` in the project root:

```env
ECOVOLT_API_KEY=PASTE_YOUR_SUSS_API_KEY_HERE
```

The real API key is intentionally excluded from this ZIP. Never upload `.env.local` to GitHub.

## 4. Run the website

```powershell
pnpm dev
```

Open the local URL printed in the terminal, normally:

```text
http://localhost:5173
```

## Production checks

```powershell
pnpm lint
pnpm build
```

## Important files

- `app/page.tsx` — full interactive dashboard
- `app/globals.css` — futuristic visual design and responsive layout
- `app/api/ecovolt/route.ts` — secure server-side SUSS API integration
- `components/ui/` — interface components
- `public/favicon.svg` — CoolSense favicon
- `package.json` and `pnpm-lock.yaml` — dependencies and commands

The API key is read only by the server route. It is never placed in the frontend bundle.
