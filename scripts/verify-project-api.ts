import assert from "node:assert/strict";

import {
  DEFAULT_PROJECT_NAME,
  parseProjectId,
  parseProjectName,
  readJsonBody,
} from "../lib/project-requests";
import {
  buildRoomId,
  getRetryRoomIdSuffix,
  slugify,
} from "../lib/room-id";

const jsonRequest = (body: string) =>
  new Request("http://localhost/api/projects", { method: "POST", body });

async function checkBodyReading() {
  assert.deepEqual(await readJsonBody(jsonRequest("")), {}, "empty body");
  assert.deepEqual(await readJsonBody(jsonRequest("   ")), {}, "blank body");
  assert.equal(await readJsonBody(jsonRequest("{oops")), null, "malformed JSON");
  assert.deepEqual(
    await readJsonBody(jsonRequest('{"name":"Checkout"}')),
    { name: "Checkout" },
    "valid JSON",
  );
}

function checkNameParsing() {
  // Create: a missing or blank name falls back to the default.
  const created = (body: unknown) =>
    parseProjectName(body, DEFAULT_PROJECT_NAME);

  assert.equal(created({}), DEFAULT_PROJECT_NAME, "absent name");
  assert.equal(created({ name: "  " }), DEFAULT_PROJECT_NAME, "blank name");
  assert.equal(created({ name: null }), DEFAULT_PROJECT_NAME, "null name");
  assert.equal(created({ name: " Checkout " }), "Checkout", "trimmed name");
  assert.equal(created({ name: 42 }), null, "non-string name");
  assert.equal(created(null), null, "malformed body");
  assert.equal(created([{ name: "x" }]), null, "array body");
  assert.equal(created({ name: "x".repeat(121) }), null, "over-long name");

  // Rename: the same rules, but a missing name is rejected instead.
  assert.equal(parseProjectName({}, null), null, "rename without a name");
  assert.equal(parseProjectName({ name: "" }, null), null, "rename to blank");
  assert.equal(parseProjectName({ name: "Payments" }, null), "Payments");
}

function checkIdParsing() {
  assert.deepEqual(parseProjectId({}), { ok: true, id: undefined }, "absent id");
  assert.deepEqual(parseProjectId({ id: "" }), { ok: true, id: undefined });
  assert.deepEqual(parseProjectId({ id: "checkout-service-a1b2c3" }), {
    ok: true,
    id: "checkout-service-a1b2c3",
  });

  for (const id of [
    "-leading",
    "trailing-",
    "double--hyphen",
    "Upper-Case",
    "has space",
    "has_underscore",
    "../escape",
    "ab",
    "x".repeat(81),
  ]) {
    assert.deepEqual(parseProjectId({ id }), { ok: false }, `rejects ${id}`);
  }

  assert.deepEqual(parseProjectId({ id: 7 }), { ok: false }, "non-string id");
  assert.deepEqual(parseProjectId(null), { ok: false }, "malformed body");
}

/**
 * The contract that actually breaks in production: every room ID the create
 * dialog can build has to survive the API's own validation.
 */
function checkRoomIdsPassValidation() {
  const suffix = "a1b2c3";

  const names = [
    "Checkout Service",
    "  Payments  API  ",
    "Café Service",
    "V2 -- Auth!!",
    "x".repeat(120), // the longest name parseProjectName accepts
    "A".repeat(59) + " tail", // slug truncation lands on a hyphen
    "9",
  ];

  for (const name of names) {
    const roomId = buildRoomId(name, suffix);
    assert.notEqual(roomId, "", `buildRoomId produced nothing for ${name}`);
    assert.deepEqual(
      parseProjectId({ id: roomId }),
      { ok: true, id: roomId },
      `API rejected the room ID for "${name.slice(0, 20)}": ${roomId}`,
    );
  }

  // Names with nothing slugifiable block submission instead of posting a bad ID.
  assert.equal(buildRoomId("!!!", suffix), "");
  assert.equal(buildRoomId("", suffix), "");
  assert.equal(slugify("Checkout Service"), "checkout-service");
}

function checkCollisionRetryUsesFreshSuffix() {
  let generatedSuffixCount = 0;
  const createSuffix = () => {
    generatedSuffixCount += 1;
    return "d4e5f6";
  };

  assert.equal(
    getRetryRoomIdSuffix("a1b2c3", 409, createSuffix),
    "d4e5f6",
    "an ID collision should rotate the room suffix",
  );
  assert.equal(generatedSuffixCount, 1, "a collision should generate once");

  assert.equal(
    getRetryRoomIdSuffix("a1b2c3", 500, createSuffix),
    "a1b2c3",
    "other failures should keep the current room suffix",
  );
  assert.equal(
    generatedSuffixCount,
    1,
    "non-collision failures should not generate a suffix",
  );
}

async function main() {
  await checkBodyReading();
  checkNameParsing();
  checkIdParsing();
  checkRoomIdsPassValidation();
  checkCollisionRetryUsesFreshSuffix();
  console.log("✅ Project API request parsing verified");
}

main().catch((error) => {
  console.error("❌ Project API verification failed");
  console.error(error);
  process.exitCode = 1;
});
