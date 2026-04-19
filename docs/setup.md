# Manual Setup

If you're not using Claude Code, follow these steps.

## Prerequisites

- Node.js 20 or later (`node --version`)
- npm 10 or later
- VS Code (recommended)

## Install

From the project root:

```bash
npm install
```

That installs React, Vite, Tailwind, Recharts, and Lucide-react.

## Run

```bash
npm run dev
```

Opens `http://localhost:5173` automatically.

## Sign In

The prototype has three demo accounts:

| Username | Password    | Role    | Pages                          |
|----------|-------------|---------|--------------------------------|
| admin    | admin123    | Admin   | All 11 tabs (incl. SLA config) |
| manager  | manager123  | Manager | 10 tabs (no admin)             |
| viewer   | viewer123   | Viewer  | 4 read-only tabs               |

## Build for Production

```bash
npm run build
```

Output goes to `dist/`.

Serve locally to test:

```bash
npm run preview
```

## Troubleshooting

**"Cannot find module 'recharts'"** → Run `npm install` again.

**Tailwind classes not working** → Check `tailwind.config.js` `content` globs include `./src/**/*.{js,jsx}`.

**Blank screen, no errors** → Open browser DevTools console. Most likely a missing import in `ShippingSLAApp.jsx`.

**Login fails with demo creds** → The creds are hardcoded in the `MOCK_USERS` array inside `ShippingSLAApp.jsx`. Double-check spelling.
