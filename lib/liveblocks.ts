import { Liveblocks } from "@liveblocks/node";

/**
 * Server-side Liveblocks access (10-liveblocks-setup): the node client that
 * issues room tokens, plus the cursor colour every session is stamped with.
 *
 * Node-only — the secret key must never reach a client bundle.
 */

const createLiveblocksClient = () => {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;

  if (!secret) {
    throw new Error("LIVEBLOCKS_SECRET_KEY is not set");
  }

  return new Liveblocks({ secret });
};

const globalForLiveblocks = globalThis as unknown as {
  liveblocks?: Liveblocks;
};

/**
 * Cached across dev hot reloads for the same reason `lib/prisma.ts` is: a new
 * client per reload leaks its connection pool.
 *
 * Constructed lazily via the getter below rather than at module load, so a
 * missing secret fails the request that needs it instead of every import.
 */
export function getLiveblocks(): Liveblocks {
  const client = globalForLiveblocks.liveblocks ?? createLiveblocksClient();

  if (process.env.NODE_ENV !== "production") {
    globalForLiveblocks.liveblocks = client;
  }

  return client;
}

/**
 * Cursor colours, tuned for contrast against the near-black canvas in
 * `ui-context.md`. Raw hex rather than CSS tokens on purpose: these travel
 * inside the auth token as data, so they cannot be resolved from a stylesheet.
 */
const CURSOR_COLORS = [
  "#00c8d4",
  "#6457f9",
  "#34d399",
  "#fbbf24",
  "#ff4d4f",
  "#f472b6",
  "#38bdf8",
  "#a3e635",
] as const;

/**
 * The same user gets the same colour in every room, on every device, forever —
 * so collaborators learn who is who. Colours repeat once past
 * `CURSOR_COLORS.length` users; that is a cosmetic collision, not a bug.
 *
 * djb2, chosen only because it is short and stable across runtimes. `>>> 0`
 * keeps the running value an unsigned 32-bit int so the index is never
 * negative.
 */
export function getCursorColor(userId: string): string {
  let hash = 5381;

  for (let index = 0; index < userId.length; index += 1) {
    hash = ((hash << 5) + hash + userId.charCodeAt(index)) >>> 0;
  }

  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}
