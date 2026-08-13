# Truss

A real-time collaborative system design workspace. Describe a system in plain
English, an AI agent draws it onto a shared canvas, your collaborators refine it
live, and the same agent turns the resulting graph into a Markdown technical
spec.

## What it does

- **Projects** — sign in, create a project, invite collaborators by email. The
  owner can rename, delete, and manage members; collaborators can open and edit.
- **Collaborative canvas** — React Flow over Liveblocks Storage. Live cursors,
  presence avatars, shaped/colored nodes, right-angle labelled edges, and
  snapshots persisted to Vercel Blob.
- **Starter templates** — prebuilt system designs (monolith, microservices,
  event-driven, serverless…) that import straight into the live room.
- **AI chat that routes itself** — one composer in the editor sidebar. An
  `orchestrator` background task reads the canvas and the room's chat history,
  then decides per message whether to answer in words, edit the canvas, or write
  a spec. Its work log streams into the transcript and is durable, so every
  member sees the same one after a reload.
- **Spec generation** — the current graph becomes a Markdown spec, stored in
  Vercel Blob with a pointer row in Postgres, attached to the chat turn that
  asked for it, and downloadable as a `.md` file.

## Stack

| Layer            | Technology              |
| ---------------- | ----------------------- |
| Framework        | Next.js 16, React 19, TypeScript |
| UI               | Tailwind v4, shadcn/ui, Base UI |
| Auth             | Clerk                   |
| Database         | Prisma 7 + PostgreSQL   |
| Canvas           | Liveblocks + React Flow (`@xyflow/react`) |
| Background tasks | Trigger.dev v4          |
| Model            | Google Gemini via the AI SDK |
| Artifact storage | Vercel Blob (private access) |

## Prerequisites

- Node.js 20+ (developed on 26)
- A PostgreSQL database
- Accounts for: [Clerk](https://clerk.com),
  [Liveblocks](https://liveblocks.io), [Trigger.dev](https://trigger.dev),
  [Vercel Blob](https://vercel.com/docs/storage/vercel-blob), and
  [Google AI Studio](https://aistudio.google.com) for a Gemini key.

All five have free tiers that are enough to run this locally.

## Setup

```bash
git clone <this repo> && cd truss
npm install
```

### Environment

One file, `.env`. Next.js reads it, and so do `prisma.config.ts` and
`prisma/seed.ts` — those load **`.env` only**, via `dotenv/config`, which is why
everything lives there rather than being split with `.env.local`. Gitignored by
`.env*`, so nothing in it is committed.

```bash
# ---------------------------------------------------------------- Database
DATABASE_URL=postgresql://user:pass@localhost:5432/truss?sslmode=verify-full

# -------------------------------------------------------------------- Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/editor
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/editor

# ------------------------------------------------------------- Liveblocks
# Project → API keys. Server-only, read in lib/liveblocks.ts.
LIVEBLOCKS_SECRET_KEY=sk_...

# Optional. Nothing reads it: the canvas authenticates through
# /api/liveblocks-auth, not through LiveblocksProvider's publicApiKey. Kept
# unprefixed so it stays out of the client bundle.
LIVEBLOCKS_PUBLIC_KEY=pk_...

# ------------------------------------------------------------ Vercel Blob
# Vercel dashboard → Storage → Blob. Server-only: a read-write token in the
# client bundle would let anyone overwrite any project's canvas.
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# ------------------------------------------------------------- Trigger.dev
# API Keys page. Used by tasks.trigger() in route handlers; the CLI dev worker
# does not read it (it authenticates via `trigger.dev login`).
TRIGGER_SECRET_KEY=tr_dev_...

# ------------------------------------------------------------ Google Gemini
GEMINI_API_KEY=...   # GOOGLE_AI_API_KEY is also accepted
```

`proxy.ts` throws at boot if the two Clerk URL vars are missing — with no public
paths, the middleware would protect the sign-in page itself and you would get an
unexplained redirect loop instead of an error.

`sslmode=verify-full` rather than `require`: `pg` currently treats the two as
identical, but in pg v9 a bare `require` drops to libpq semantics and stops
verifying the certificate. Being explicit pins today's behaviour.

If you keep a `.env.local`, Next.js still reads it and it still wins on
conflicts — but the Prisma CLI will not see it, so a key that lives only there
is invisible to migrations and the seed.

### Database

```bash
npx prisma migrate dev     # apply migrations
npm run generate           # regenerate the client into generated/prisma
npx prisma db seed         # optional: three sample projects
```

### Trigger.dev

The AI runs in Trigger.dev tasks. Log the CLI in once — it authenticates
separately from `TRIGGER_SECRET_KEY`:

```bash
npx trigger.dev@latest login
```

Then point `trigger.config.ts`'s `project` at your own project ref from the
dashboard.

## Running it

```bash
npm run dev
```

That starts `next dev` **and** the Trigger.dev dev worker together. Open
<http://localhost:3000>; `/` redirects to `/editor` once you are signed in.
Without the Trigger worker running, the canvas and chat still load but every AI
turn hangs — the tasks have nowhere to execute.

## Render diagrams from an agent

Install the distributable skill after this change reaches the public default
branch:

```bash
npx skills add jackkfan0305/truss \
  --skill render-truss-diagram \
  --agent codex
```

The skill turns the supplied description into a compact positioned graph, then
sends only the title and graph to its launcher over stdin. The launcher uses
`http://localhost:3000` by default. To open another Truss deployment, set
`TRUSS_APP_URL=https://your-truss-host.example`; it must be an HTTP(S) origin
without a path.

## Scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Next.js dev server + Trigger.dev dev worker |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run generate` | Regenerate the Prisma client |
| `npm run doctor` | React Doctor scan |

`scripts/verify-*.ts` are standalone contract checks — no test framework, no
database, no network. Run one with `npx tsx scripts/verify-orchestrator.ts`;
each exits non-zero on failure.

## Layout

```
app/api        Authenticated route handlers: validate → authorize → trigger → persist
app/editor     The workspace (project sidebar, canvas, AI panel)
trigger/       Background tasks: orchestrator, design-agent, generate-spec
lib/           Prisma client, access control, Liveblocks server helpers, prompts
components/    canvas/ (React Flow surface), editor/ (panels & dialogs), ui/ (shadcn)
prisma/        Schema, split models, migrations, seed
context/       Product, architecture, UI, and standards docs — read these first
scripts/       verify-* contract checks
```

`context/architecture-context.md` is the source of truth for storage,
authorization, and the AI generation model. `context/progress-tracker.md` has
the current state, unit by unit.

## Notes and gotchas

- **Restart `next dev` after any `prisma migrate`.** A running server holds the
  pre-migration generated client in memory and fails with
  `Cannot read properties of undefined (reading 'findFirst')`.
- **Blob is private.** Every `@vercel/blob` call passes `access: "private"`;
  stored URLs are pointers, never handed to a browser. Reads go through the
  authorized download route.
- **Deployed Trigger.dev environments need their own env vars.** The workers
  write to Postgres and Blob and call Gemini, so `DATABASE_URL`,
  `BLOB_READ_WRITE_TOKEN`, and `GEMINI_API_KEY` must be set in the Trigger.dev
  dashboard, not only in your local `.env`.
- **A mid-run failure leaves a partial diagram.** The canvas build is paced, not
  atomic — on a shared canvas a rollback would either clobber or miss concurrent
  human edits, so the error path reports how many changes landed instead.
