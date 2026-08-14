import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { networkInterfaces } from "node:os";

import { startLoopback } from "../.agents/skills/truss-diagram/scripts/loopback.mjs";

const NONCE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ORIGIN = "http://localhost:3000";

/**
 * A deleted defense does not fail these tests — it makes them hang. The request
 * that should have been rejected gets queued as a valid exchange instead, and
 * the `await` on it never settles because nothing will answer it. A hang in a
 * `&&` chain stalls the whole suite with no diagnostic, so time the file out
 * and say so. The full run takes well under a second.
 */
const watchdog = setTimeout(() => {
  console.error(
    "verify-agent-loopback: TIMED OUT — a request that should have been rejected " +
      "was accepted instead. Check the origin, Host, nonce and body-cap guards.",
  );
  process.exit(1);
}, 20_000);
watchdog.unref();

function post(port, body, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

// A valid callback resolves, and the held response carries the agent's answer.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const pending = post(server.port, { nonce: NONCE, op: "edit", projects: [] });
  const exchange = await server.receive();

  assert.equal(exchange.body.op, "edit");
  exchange.respond({ projectId: "p1" });

  assert.deepEqual(await (await pending).json(), { projectId: "p1" });
  await server.close();
}

// A wrong nonce is a 403 and does NOT consume the one-shot.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const bad = await post(server.port, { nonce: "00000000-0000-4000-8000-000000000000", op: "edit" });

  assert.equal(bad.status, 403);

  const pending = post(server.port, { nonce: NONCE, op: "edit", projects: [] });
  const exchange = await server.receive();

  assert.equal(exchange.body.op, "edit");
  exchange.respond({ projectId: "p1" });
  await pending;
  await server.close();
}

// A foreign origin is refused.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const bad = await post(server.port, { nonce: NONCE }, { origin: "http://evil.example" });

  assert.equal(bad.status, 403);
  await server.close();
}

// A foreign Host header is refused (DNS rebinding).
//
// `fetch()` cannot exercise this: "Host" is a forbidden header name per the
// Fetch spec, so Node's built-in fetch silently drops an attempted override
// and sends the real connection host instead — the request would arrive
// origin-correct, host-correct, and nonce-correct, get queued as a *valid*
// callback, and hang forever with nothing to consume it via receive(). Use
// node:http's request(), which does allow the override, to actually produce
// a mismatched Host header.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const bad = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: server.port,
        method: "POST",
        path: "/",
        headers: { "content-type": "application/json", origin: ORIGIN, host: "evil.example" },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ nonce: NONCE }));
  });

  assert.equal(bad.statusCode, 403);
  await server.close();
}

// Preflight answers the exact origin and nothing else.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const preflight = await fetch(`http://127.0.0.1:${server.port}/`, {
    method: "OPTIONS",
    headers: { origin: ORIGIN, "access-control-request-method": "POST" },
  });

  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  await server.close();
}

// An oversized body is refused.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const big = await post(server.port, { nonce: NONCE, pad: "x".repeat(200_000) });

  assert.equal(big.status, 413);
  await server.close();
}

// The idle timeout rejects rather than hanging forever.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 200 });

  await assert.rejects(() => server.receive());
  await server.close();
}

// It binds loopback only — asserted against the REAL socket, and against every
// non-loopback address this machine has. Trusting a reported string here would
// keep passing if the listener moved to 0.0.0.0 and became reachable from the
// network, which is the one regression this whole file exists to prevent.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 2000 });

  assert.equal(server.address, "127.0.0.1");

  const external = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);

  for (const address of external) {
    await assert.rejects(
      () =>
        fetch(`http://${address}:${server.port}/`, {
          method: "OPTIONS",
          headers: { origin: ORIGIN, "access-control-request-method": "POST" },
          signal: AbortSignal.timeout(1500),
        }),
      `the listener must not answer on ${address}`,
    );
  }

  await server.close();
}

// A wrong-LENGTH nonce is a 403, not a crash. `timingSafeEqual` throws on a
// length mismatch, so the guard in front of it is load-bearing: without it this
// input takes down the whole skill process with an uncaught RangeError.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 2000 });

  assert.equal((await post(server.port, { nonce: "short", op: "edit" })).status, 403);
  assert.equal((await post(server.port, { nonce: `${NONCE}extra`, op: "edit" })).status, 403);
  assert.equal((await post(server.port, { nonce: "", op: "edit" })).status, 403);
  assert.equal((await post(server.port, { op: "edit" })).status, 403);

  // Still armed: none of those consumed the one-shot.
  const pending = post(server.port, { nonce: NONCE, op: "edit", projects: [] });
  const exchange = await server.receive();

  exchange.respond({ projectId: "p1" });
  await pending;
  await server.close();
}

// close() while an exchange is held but unanswered ends it rather than leaving
// the browser hanging on a socket nobody will ever write to.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const pending = post(server.port, { nonce: NONCE, op: "delete", projects: [] });

  await server.receive();
  await server.close();

  assert.equal((await pending).status, 500);
}

console.log("verify-agent-loopback: ok");
