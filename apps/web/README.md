# @hired/web

React dashboard for the Hired agent. Local-only; binds to `127.0.0.1:5173`
and talks to the server on `127.0.0.1:4000` via a `/api` proxy.

## Dev

```bash
# From workspace root
pnpm --filter web dev        # starts the dashboard
pnpm --filter server dev     # starts the API (separate terminal)
```

Copy `.env.example` to `.env.local` and set `VITE_HIRED_SHARED_SECRET` to the
same value as the server's `SHARED_SECRET`.

## Stack

- React 18 + TypeScript (strict)
- Vite 5
- Tailwind 3 (utility-first; see `tailwind.config.ts`)
- TanStack Query 5 (data fetching + caching)
- React Router 6 (`createBrowserRouter`)
- lucide-react (icons)

## Folder structure

```
src/
├── app/            Shell: layout, router, query client
├── shared/         Cross-feature primitives (components, api wrapper)
└── features/       One folder per feature. Pages live here, not under /pages.
```

See `.kiro/specs/hired/design.md § 4` for the organizing principles.
