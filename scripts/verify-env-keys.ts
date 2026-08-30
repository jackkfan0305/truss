import assert from "node:assert/strict";

import { resolveEnvKeys } from "../lib/env-keys";

/**
 * The `_PROD` convention that keeps development keys out of production.
 *
 * The deploy path runs through `resolveEnvKeys`, so the failure this guards
 * against is silent and expensive: production quietly served with the
 * development Liveblocks project (rooms in the wrong place, no error anywhere),
 * or `_PROD` leaking into development as a name nothing reads while the real
 * key goes missing.
 */

const values = {
  DATABASE_URL: "postgres://dev",
  LIVEBLOCKS_SECRET_KEY: "sk_dev_1",
  LIVEBLOCKS_SECRET_KEY_PROD: "sk_prod_1",
  BLOB_READ_WRITE_TOKEN: "blob_dev_1",
  BLOB_READ_WRITE_TOKEN_PROD: "blob_prod_1",
};

const development = resolveEnvKeys(values, { production: false });
const production = resolveEnvKeys(values, { production: true });

// A key with a twin switches; a key without one is shared by both.
assert.equal(development.LIVEBLOCKS_SECRET_KEY, "sk_dev_1");
assert.equal(production.LIVEBLOCKS_SECRET_KEY, "sk_prod_1");
assert.equal(development.BLOB_READ_WRITE_TOKEN, "blob_dev_1");
assert.equal(production.BLOB_READ_WRITE_TOKEN, "blob_prod_1");
assert.equal(development.DATABASE_URL, "postgres://dev");
assert.equal(production.DATABASE_URL, "postgres://dev");

// The `_PROD` names are inputs, never outputs.
for (const resolved of [development, production]) {
  assert.deepEqual(
    Object.keys(resolved).filter((name) => name.endsWith("_PROD")),
    [],
  );
}

// A missing twin must fall back rather than resolve to undefined, or a deploy
// would push an empty value over a working one.
assert.deepEqual(resolveEnvKeys({ CLERK_SECRET_KEY: "k" }, { production: true }), {
  CLERK_SECRET_KEY: "k",
});

console.log("✅ env key resolution verified");
