import assert from "node:assert/strict";

import {
  handleAgentGraphGet,
  type AgentGraphReadDependencies,
} from "../lib/agent-graph-read-server";
import { indexUsersByEmail } from "../lib/clerk-users";
import {
  DEFAULT_PROJECT_NAME,
  parseCollaboratorEmail,
  parseProjectId,
  parseProjectName,
  readJsonBody,
} from "../lib/project-requests";
import {
  buildRoomId,
  getRetryRoomIdSuffix,
  slugify,
} from "../lib/room-id";
import { CANVAS_NODE_TYPE, NODE_DEFAULT_SIZES } from "../types/canvas";
import type { CanvasNode } from "../types/canvas";

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

function checkCollaboratorEmailParsing() {
  // Lowercased on the way in, because @@unique([projectId, email]) is not.
  assert.equal(
    parseCollaboratorEmail({ email: "  Teammate@Example.COM " }),
    "teammate@example.com",
    "emails are trimmed and lowercased",
  );
  assert.equal(
    parseCollaboratorEmail({ email: "first.last+tag@sub.example.co.uk" }),
    "first.last+tag@sub.example.co.uk",
    "plus addressing and subdomains are legitimate",
  );

  for (const email of [
    "",
    "   ",
    "no-at-sign",
    "no@domain",
    "two@@ats.com",
    "spaced out@example.com",
    "trailing@example.com ext",
    "@example.com",
    "user@",
    "user@.com",
    `${"x".repeat(250)}@example.com`,
  ]) {
    assert.equal(
      parseCollaboratorEmail({ email }),
      null,
      `should reject ${JSON.stringify(email)}`,
    );
  }

  assert.equal(parseCollaboratorEmail({ email: 42 }), null, "non-string email");
  assert.equal(parseCollaboratorEmail({}), null, "absent email");
  assert.equal(parseCollaboratorEmail(null), null, "malformed body");
  assert.equal(parseCollaboratorEmail([{ email: "a@b.com" }]), null, "array body");
}

/**
 * The share dialog attaches a name and avatar to a row by email. Getting the
 * pairing wrong shows one person's face against another's address, so the merge
 * is keyed on the addresses Clerk reports rather than on request order.
 */
function checkClerkUserIndexing() {
  const user = (
    fullName: string | null,
    imageUrl: string,
    emails: string[],
    username: string | null = null,
  ) =>
    ({
      fullName,
      username,
      imageUrl,
      emailAddresses: emails.map((emailAddress) => ({ emailAddress })),
    }) as never;

  const profiles = indexUsersByEmail([
    user("Ada Lovelace", "https://img.clerk.com/ada", [
      "Ada@Example.com",
      "ada.l@work.example.com",
    ]),
    user(null, "https://img.clerk.com/anon", ["anon@example.com"]),
    user(null, "https://img.clerk.com/handle", ["handle@example.com"], "gracehop"),
  ]);

  assert.deepEqual(
    profiles.get("ada@example.com"),
    { name: "Ada Lovelace", imageUrl: "https://img.clerk.com/ada" },
    "the queried address should resolve regardless of the case Clerk reports",
  );
  assert.deepEqual(
    profiles.get("ada.l@work.example.com"),
    { name: "Ada Lovelace", imageUrl: "https://img.clerk.com/ada" },
    "every address a user owns should resolve to them",
  );
  assert.equal(
    profiles.get("anon@example.com"),
    undefined,
    "a user with no display name adds nothing over the email itself",
  );
  assert.equal(
    profiles.get("handle@example.com")?.name,
    "gracehop",
    "username stands in when there is no full name",
  );
  assert.deepEqual(indexUsersByEmail([]), new Map(), "no users, no profiles");
}

function agentGraphNode(id: string): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x: 0, y: 0 },
    ...NODE_DEFAULT_SIZES.rectangle,
    data: { label: "Node", shape: "rectangle", color: "neutral" },
  } as CanvasNode;
}

function agentGraphDependencies(
  overrides: Partial<AgentGraphReadDependencies> = {},
): AgentGraphReadDependencies {
  return {
    authorizeProject: async () => ({
      ok: true,
      role: "owner",
      userId: "user-owner",
      ownerId: "user-owner",
    }),
    readCanvas: async () => ({ nodes: [agentGraphNode("web")], edges: [] }),
    ...overrides,
  };
}

/**
 * `GET /api/projects/:id/agent-graph` is owner-only and reads the live room,
 * not the autosaved snapshot — see `handleAgentGraphGet`. `authorizeProject`'s
 * real implementation depends on Clerk's request-scoped `auth()`, which this
 * script cannot provide, so — matching `verify-agent-graph-import.ts` and
 * `verify-orchestrate-api.ts` — the check runs against injected dependencies
 * instead of a live Next.js request.
 */
async function checkAgentGraphReadAuth(): Promise<void> {
  for (const status of [401, 403]) {
    let readCanvasCalls = 0;
    const response = await handleAgentGraphGet(
      "project-1",
      agentGraphDependencies({
        authorizeProject: async () => ({
          ok: false,
          response: Response.json({ error: "Denied" }, { status }),
        }),
        readCanvas: async () => {
          readCanvasCalls += 1;
          return { nodes: [], edges: [] };
        },
      }),
    );

    assert.equal(response.status, status, `authorization denial surfaces as ${status}`);
    assert.equal(readCanvasCalls, 0, `${status} must not read the live canvas`);
  }
}

/** An authorized read returns the compact graph, opaque IDs and a fingerprint. */
async function checkAgentGraphReadSuccess(): Promise<void> {
  const response = await handleAgentGraphGet("project-1", agentGraphDependencies());

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    graph: { nodes: { id: string }[] };
    opaqueNodeIds: string[];
    opaqueEdgeIds: string[];
    fingerprint: string;
  };

  assert.deepEqual(body.graph.nodes.map((node) => node.id), ["web"]);
  assert.deepEqual(body.opaqueNodeIds, []);
  assert.deepEqual(body.opaqueEdgeIds, []);
  assert.match(body.fingerprint, /^[0-9a-f]{64}$/, "fingerprint is a sha256 hex digest");
}

/** A live-room read failure is a 502, not a thrown error or a silent empty graph. */
async function checkAgentGraphReadUpstreamFailure(): Promise<void> {
  const response = await handleAgentGraphGet(
    "project-1",
    agentGraphDependencies({
      readCanvas: async () => {
        throw new Error("liveblocks unavailable");
      },
    }),
  );

  assert.equal(response.status, 502);
}

async function main() {
  await checkBodyReading();
  checkNameParsing();
  checkIdParsing();
  checkRoomIdsPassValidation();
  checkCollisionRetryUsesFreshSuffix();
  checkCollaboratorEmailParsing();
  checkClerkUserIndexing();
  await checkAgentGraphReadAuth();
  await checkAgentGraphReadSuccess();
  await checkAgentGraphReadUpstreamFailure();
  console.log("✅ Project API request parsing verified");
}

main().catch((error) => {
  console.error("❌ Project API verification failed");
  console.error(error);
  process.exitCode = 1;
});
