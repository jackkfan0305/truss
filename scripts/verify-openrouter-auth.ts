import assert from "node:assert/strict";

import {
  buildConnectUrl,
  completeConnect,
  deriveCodeChallenge,
  disconnect,
  getKey,
  OpenRouterConnectError,
  safeReturnTo,
  type KeyValueStorage,
} from "../lib/openrouter-auth";

function memoryStorage(): KeyValueStorage & { size: () => number } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    size: () => values.size,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function main() {
  // RFC 7636 appendix B.
  assert.equal(
    await deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );

  // Only same-origin paths survive.
  assert.equal(safeReturnTo("/editor/checkout-abc123"), "/editor/checkout-abc123");
  assert.equal(safeReturnTo("//evil.com"), "/");
  assert.equal(safeReturnTo("/\\evil.com"), "/");
  assert.equal(safeReturnTo("https://evil.com"), "/");
  assert.equal(safeReturnTo(null), "/");

  // The connect URL carries an S256 challenge of the stored verifier.
  {
    const session = memoryStorage();
    const url = new URL(await buildConnectUrl("https://truss.test", "/editor/a-1", session));
    assert.equal(url.origin + url.pathname, "https://openrouter.ai/auth");
    assert.equal(url.searchParams.get("callback_url"), "https://truss.test/openrouter/callback");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const verifier = session.getItem("truss.openrouter.verifier");
    assert.ok(verifier && verifier.length >= 43);
    assert.equal(url.searchParams.get("code_challenge"), await deriveCodeChallenge(verifier));
    assert.equal(session.getItem("truss.openrouter.returnTo"), "/editor/a-1");
  }

  // A successful exchange stores the key, clears the session entries, returns returnTo.
  {
    const session = memoryStorage();
    const local = memoryStorage();
    await buildConnectUrl("https://truss.test", "/editor/a-1", session);
    const verifier = session.getItem("truss.openrouter.verifier");
    let sentBody: unknown = null;
    const returnTo = await completeConnect("the-code", {
      fetch: async (input, init) => {
        assert.equal(input, "https://openrouter.ai/api/v1/auth/keys");
        assert.equal(init?.method, "POST");
        sentBody = JSON.parse(String(init?.body));
        return jsonResponse(200, { key: "sk-or-v1-test", user_id: "u" });
      },
      session,
      local,
    });
    assert.equal(returnTo, "/editor/a-1");
    assert.deepEqual(sentBody, { code: "the-code", code_verifier: verifier, code_challenge_method: "S256" });
    assert.equal(getKey(local), "sk-or-v1-test");
    assert.equal(session.size(), 0);

    // Review focus 1: a second call (Strict Mode double effect) finds no verifier.
    await assert.rejects(
      completeConnect("the-code", { fetch: async () => jsonResponse(200, { key: "x" }), session, local }),
      (error) => error instanceof OpenRouterConnectError && /expired/.test(error.message),
    );

    disconnect(local);
    assert.equal(getKey(local), null);
  }

  // A refused exchange stores nothing.
  {
    const session = memoryStorage();
    const local = memoryStorage();
    await buildConnectUrl("https://truss.test", "/", session);
    await assert.rejects(
      completeConnect("bad", { fetch: async () => jsonResponse(400, { error: "nope" }), session, local }),
      OpenRouterConnectError,
    );
    assert.equal(getKey(local), null);
  }

  console.log("verify-openrouter-auth: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
