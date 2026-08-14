import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

// ponytail: one-shot loopback per skill invocation — a single in-flight
// exchange (queuedExchange XOR waiter) is all this ever needs.
const MAX_BODY_BYTES = 131072;

function nonceMatches(candidate, expected) {
  if (typeof candidate !== "string") return false;
  const actual = Buffer.from(candidate);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return false;
  return timingSafeEqual(actual, wanted);
}

export async function startLoopback({ nonce, allowedOrigin, timeoutMs }) {
  let port;
  let waiter = null; // { resolve, reject, timer }
  let queuedExchange = null; // { body, res } — a valid callback with no receive() waiting yet
  let heldRes = null; // the response currently held open, awaiting respond()
  let closed = false;

  function makeExchange(body, res) {
    heldRes = res;
    const respond = (value) => {
      if (heldRes !== res) return; // already responded to or closed
      heldRes = null;
      res.writeHead(200, {
        "content-type": "application/json",
        "Access-Control-Allow-Origin": allowedOrigin,
      });
      res.end(JSON.stringify(value));
    };
    return { body, respond };
  }

  function deliver(body, res) {
    if (waiter) {
      const { resolve, timer } = waiter;
      clearTimeout(timer);
      waiter = null;
      resolve(makeExchange(body, res));
      return;
    }
    queuedExchange = { body, res };
  }

  function readBody(req, res) {
    let total = 0;
    const chunks = [];
    let settled = false;

    req.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        settled = true;
        res.writeHead(413);
        res.end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;

      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }

      if (!nonceMatches(parsed?.nonce, nonce)) {
        res.writeHead(403);
        res.end();
        return;
      }

      deliver(parsed, res);
    });

    req.on("error", () => {
      settled = true;
    });
  }

  const server = createServer((req, res) => {
    if (closed) {
      res.destroy();
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Max-Age": "0",
      });
      res.end();
      return;
    }

    // Reject before reading the body: cross-origin and DNS-rebinding defenses.
    if (req.headers.origin !== allowedOrigin || req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(403);
      res.end();
      return;
    }

    readBody(req, res);
  });

  function receive() {
    return new Promise((resolve, reject) => {
      if (queuedExchange) {
        const { body, res } = queuedExchange;
        queuedExchange = null;
        resolve(makeExchange(body, res));
        return;
      }

      const timer = setTimeout(() => {
        waiter = null;
        reject(new Error("Timed out waiting for the browser."));
      }, timeoutMs);

      waiter = { resolve, reject, timer };
    });
  }

  function close() {
    return new Promise((resolve) => {
      if (closed) {
        resolve();
        return;
      }
      closed = true;

      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Loopback closed while waiting for the browser."));
        waiter = null;
      }

      if (heldRes) {
        const res = heldRes;
        heldRes = null;
        res.writeHead(500);
        res.end();
      }

      if (queuedExchange) {
        const { res } = queuedExchange;
        queuedExchange = null;
        res.writeHead(500);
        res.end();
      }

      server.close(() => resolve());
      // Force-close any idle keep-alive sockets so close() settles promptly
      // instead of waiting out the server's keep-alive timeout.
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    });
  }

  await new Promise((resolve) => {
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });

  // Read both back off the real socket rather than echoing the requested host.
  // A literal here would make the "binds loopback only" assertion a tautology:
  // it would keep reporting 127.0.0.1 even if this listened on 0.0.0.0 and were
  // reachable from the network, which is the one failure this must not hide.
  const bound = server.address();
  port = bound.port;

  if (bound.address !== "127.0.0.1") {
    await close();
    throw new Error(
      `Refusing to serve on ${bound.address}: the callback listener must be loopback-only.`,
    );
  }

  return { port, address: bound.address, receive, close };
}
