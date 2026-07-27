import "dotenv/config";

import assert from "node:assert/strict";

import { getCursorColor, getLiveblocks } from "../lib/liveblocks";

/**
 * Checks the one piece of real logic in 10-liveblocks-setup — the user ID →
 * cursor colour map — plus a live call proving `LIVEBLOCKS_SECRET_KEY` actually
 * authenticates. The auth *route* still needs a Clerk request context, so it is
 * exercised against a running server instead.
 */

const HEX_COLOR = /^#[0-9a-f]{6}$/;

function checkColorsAreDeterministic() {
  const ids = ["user_2abc", "user_2xyz", "", "üñî", "a".repeat(200)];

  for (const id of ids) {
    const color = getCursorColor(id);

    assert.match(color, HEX_COLOR, `hex colour for ${JSON.stringify(id)}`);
    assert.equal(
      getCursorColor(id),
      color,
      `stable colour for ${JSON.stringify(id)}`,
    );
  }
}

/**
 * With 8 colours and 200 IDs, a hash that collapsed (a constant, or one keyed
 * only on length) would show up as a single bucket. Not a uniformity test —
 * just a guard against the hash silently degenerating.
 */
function checkColorsSpreadAcrossThePalette() {
  const colors = new Set(
    Array.from({ length: 200 }, (_, index) => getCursorColor(`user_${index}`)),
  );

  assert.ok(colors.size >= 4, `expected a spread of colours, got ${colors.size}`);
}

/**
 * `getRooms` is the cheapest authenticated read there is: a bad or missing
 * secret answers 401 rather than an empty list, which is the whole point.
 */
async function checkSecretAuthenticates() {
  const { data } = await getLiveblocks().getRooms({ limit: 1 });

  assert.ok(Array.isArray(data), "expected a room list from the Liveblocks API");
  console.log(`   authenticated — ${data.length} room(s) visible`);
}

async function main() {
  checkColorsAreDeterministic();
  checkColorsSpreadAcrossThePalette();
  console.log("✅ Liveblocks cursor colours verified");

  await checkSecretAuthenticates();
  console.log("✅ LIVEBLOCKS_SECRET_KEY verified");
}

// `.catch()` rather than top-level await: tsx transforms these scripts to CJS,
// which has no top-level await.
main().catch((error: unknown) => {
  console.error("❌ Liveblocks verification failed");
  console.error(error);
  process.exitCode = 1;
});
