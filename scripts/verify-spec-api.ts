import assert from "node:assert/strict";

import { specPayloadSchema } from "../lib/spec-requests";
import { specBlobPath, specFileName } from "../lib/spec-storage";

const valid = {
  projectId: "checkout-flow-a1b2",
  roomId: "checkout-flow-a1b2",
};

/**
 * The payload is four identifiers now (35-orchestrator-backend). The canvas
 * graph and the transcript used to arrive here from the browser; the task reads
 * the room itself, so what is left to validate is who the run is for.
 */
function checkSpecPayloadParsing() {
  const parsed = specPayloadSchema.parse(valid);

  assert.equal(parsed.projectId, valid.projectId);
  assert.equal(parsed.roomId, valid.roomId);
  assert.equal(parsed.focus, undefined, "focus is optional");
  assert.equal(parsed.chatRunId, undefined, "chatRunId is optional");

  const full = specPayloadSchema.parse({
    ...valid,
    promptMessageId: "  chat-abc  ",
    chatRunId: "run_parent",
    focus: "  the failure modes  ",
  });

  assert.equal(full.promptMessageId, "chat-abc", "trims every field");
  assert.equal(full.focus, "the failure modes");
  assert.equal(full.chatRunId, "run_parent");

  const rejected: unknown[] = [
    null,
    undefined,
    "a string body",
    [valid],
    {},
    { roomId: valid.roomId },
    { projectId: valid.projectId },
    { ...valid, roomId: "another-project-b2c3" },
    { ...valid, roomId: "" },
    { ...valid, roomId: "ab" },
    { ...valid, roomId: "x".repeat(81) },
    { ...valid, roomId: 42 },
    { ...valid, projectId: 42 },
    // A focus long enough to be a second prompt is refused: it is an emphasis
    // hint, and the system prompt is where the brief lives.
    { ...valid, focus: "x".repeat(501) },
    { ...valid, chatRunId: "x".repeat(257) },
  ];

  for (const body of rejected) {
    assert.equal(
      specPayloadSchema.safeParse(body).success,
      false,
      `rejected: ${JSON.stringify(body)?.slice(0, 80)}`,
    );
  }
}

function checkSpecStorage() {
  // The pathname the download route resolves. Namespaced by project, one
  // document per spec — matching the storage model in architecture-context.md.
  assert.equal(
    specBlobPath("proj_a1b2", "run_c3d4"),
    "specs/proj_a1b2/run_c3d4.md",
  );

  // Two specs of the same project never share a pathname, so nothing overwrites
  // anything but its own retry.
  assert.notEqual(
    specBlobPath("proj_a1b2", "run_c3d4"),
    specBlobPath("proj_a1b2", "run_e5f6"),
  );

  // The download filename goes into a `Content-Disposition` header, so it must
  // carry nothing that needs escaping there — no colons from the timestamp, no
  // quotes, no path separators. The same name is now shown in the transcript
  // and used as the `download` attribute, so it has three readers, not one.
  const name = specFileName(new Date("2026-08-08T14:32:07.123Z"));

  assert.equal(name, "spec-2026-08-08-14-32.md");
  assert.match(name, /^spec-[\d-]+\.md$/, "safe in a header, unquoted");

  // Minute precision, so two specs from one afternoon do not collide.
  assert.notEqual(
    specFileName(new Date("2026-08-08T14:32:00Z")),
    specFileName(new Date("2026-08-08T14:33:00Z")),
  );
}

checkSpecPayloadParsing();
checkSpecStorage();

console.log("✅ Spec task payload and spec storage paths verified");
