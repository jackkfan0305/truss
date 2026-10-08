# Truss

Truss is a diagram canvas that your coding agent draws on. Ask Claude Code or Codex to diagram a system or explain a piece of code, and the agent
builds the diagram in Truss through an MCP server. If you have the editor open, you watch it place each block. You can then edit the diagram
by hand or ask the agent to change it.

Truss runs no model of its own for drawing. The agent in your terminal does the thinking; Truss stores and renders the result
([ADR 0001](docs/adr/0001-no-server-side-ai.md)).

**Live:** <https://truss-jet.vercel.app>

## What agents can draw

- **System designs:** services, stores and queues, with AWS icons and nested boundaries (VPCs, subnets, accounts).
- **Code diagrams:** functions, methods, classes, modules, types and enums read from a real codebase. Each block can carry a signature, a
  summary, pseudocode shown on hover, and a link to the source line on GitHub.
- **Edits:** the agent reads the live canvas, changes it, and leaves your hand-placed blocks where you put them.

## Set up the MCP server

The server lives in this repo at `.agents/skills/truss-diagram/scripts/mcp-server.mjs`. It exposes `truss_create_diagram`,
`truss_get_diagram`, `truss_apply_diagram_edit`, `truss_list_diagrams`, `truss_delete_diagram`, `truss_get_catalog` and `truss_login`.

1. Clone the repo and install dependencies (the server uses the repo's `node_modules`):

   ```bash
   git clone https://github.com/jackkfan0305/truss.git && cd truss
   npm install
   ```

2. Add the server to your agent. Use an absolute path, and point `TRUSS_APP_URL` at the deployment (or leave it out to use
   `http://localhost:3000`).

   Claude Code:

   ```bash
   claude mcp add truss-diagram --scope user \
     -e TRUSS_APP_URL=https://truss-jet.vercel.app \
     -- node "$PWD/.agents/skills/truss-diagram/scripts/mcp-server.mjs"
   ```

   Codex:

   ```bash
   codex mcp add truss-diagram \
     --env TRUSS_APP_URL=https://truss-jet.vercel.app \
     -- node "$PWD/.agents/skills/truss-diagram/scripts/mcp-server.mjs"
   ```

   Inside this repo, Claude Code already picks the server up from `.mcp.json`.

3. Install the skill, which tells the agent how to lay out a good diagram:

   ```bash
   npx skills add jackkfan0305/truss --skill truss-diagram
   ```

4. Ask for a diagram, for example "diagram how canvas persistence works in this repo". The first call opens one browser tab to sign in to
   Truss. The agent token is then cached in `~/.truss/credentials.json`, and later calls run without a browser.

## Run it locally

You need Node.js 20+, PostgreSQL, a [Clerk](https://clerk.com) app and a [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) store.

Put everything in `.env` (Prisma reads only `.env`, not `.env.local`):

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/truss?sslmode=verify-full
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/editor
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/editor
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

Then:

```bash
npx prisma migrate dev
npm run generate
npm run dev
```

Open <http://localhost:3000>. Restart `next dev` after any migration, since a running server keeps the old Prisma client.

## Deploy

```bash
npx vercel link
npx tsx scripts/push-vercel-env.ts   # copies .env to Vercel; NAME_PROD values win in production
npx vercel --prod
```

The Vercel build runs `prisma migrate deploy` before `next build`. Keep `.env*` in `.vercelignore`.

## Develop

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Next.js dev server |
| `npm test` | Contract checks in `scripts/verify-*`, no network needed |
| `npm run verify:integration` | Checks that hit the database and APIs |
| `npm run typecheck` / `npm run lint` | `tsc` and ESLint |
| `npm run skills:link` | Link `.agents/skills/` into `.claude/skills/` |

Read `context/` before changing anything: it holds the product, architecture, UI and code standards, plus `progress-tracker.md` with the
current state.

Stack: Next.js 16, React 19, React Flow, Tailwind v4, Clerk, Prisma 7 on PostgreSQL, Vercel Blob.
