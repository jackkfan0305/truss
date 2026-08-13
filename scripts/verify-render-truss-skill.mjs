import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

const {
  browserCommand,
  buildLaunchUrl,
  formatLauncherSuccess,
  normalizeBaseUrl,
  openLaunchUrl,
  parseLauncherInput,
} = await import(
  "../.agents/skills/render-truss-diagram/scripts/open-truss-diagram.mjs"
);

const input = {
  title: "Global Checkout",
  description: "Show gateways, orders, payments, and queues.",
};
const launchId = "00000000-0000-4000-8000-000000000001";
const launchUrl = buildLaunchUrl(input, {
  baseUrl: "https://truss.example/",
  launchId,
});
const parsedUrl = new URL(launchUrl);

assert.deepEqual(
  parseLauncherInput([
    "--title",
    " Global Checkout ",
    "--description",
    " Show gateways, orders, payments, and queues. ",
  ]),
  input,
);
assert.deepEqual(parseLauncherInput(["--stdin-json"], JSON.stringify(input)), input);
assert.throws(() => parseLauncherInput(["--stdin-json", "--title", input.title], input));
assert.equal(parsedUrl.pathname, "/agent/new");
assert.equal(parsedUrl.search, "");
assert.ok(parsedUrl.hash.length > 1);
assert.deepEqual(
  JSON.parse(Buffer.from(parsedUrl.hash.slice(1), "base64url").toString("utf8")),
  {
    version: 1,
    launchId,
    title: input.title,
    description: input.description,
  },
);
assert.equal(
  JSON.parse(
    Buffer.from(
      new URL(
        buildLaunchUrl(
          { ...input, title: "t".repeat(120) },
          { baseUrl: "https://truss.example", launchId },
        ),
      ).hash.slice(1),
      "base64url",
    ).toString("utf8"),
  ).title.length,
  120,
);
assert.throws(() =>
  buildLaunchUrl(
    { ...input, title: "t".repeat(121) },
    { baseUrl: "https://truss.example", launchId },
  ),
);
assert.equal(
  JSON.parse(
    Buffer.from(
      new URL(
        buildLaunchUrl(
          { ...input, description: "d".repeat(2_000) },
          { baseUrl: "https://truss.example", launchId },
        ),
      ).hash.slice(1),
      "base64url",
    ).toString("utf8"),
  ).description.length,
  2_000,
);
assert.throws(() =>
  buildLaunchUrl(
    { ...input, description: "d".repeat(2_001) },
    { baseUrl: "https://truss.example", launchId },
  ),
);
assert.deepEqual(browserCommand(launchUrl, "darwin"), {
  command: "open",
  args: [launchUrl],
});
assert.deepEqual(browserCommand(launchUrl, "win32"), {
  command: "cmd.exe",
  args: ["/d", "/s", "/c", "start", "", launchUrl],
});

const spawnCalls = [];
const fakeChild = new EventEmitter();
fakeChild.unrefCalled = false;
fakeChild.unref = () => {
  fakeChild.unrefCalled = true;
};

const openPromise = openLaunchUrl(launchUrl, "linux", (...args) => {
  spawnCalls.push(args);
  return fakeChild;
});
queueMicrotask(() => fakeChild.emit("spawn"));
await openPromise;

assert.deepEqual(spawnCalls[0], [
  "xdg-open",
  [launchUrl],
  { detached: true, shell: false, stdio: "ignore" },
]);
assert.equal(fakeChild.unrefCalled, true);

const failedChild = new EventEmitter();
failedChild.unrefCalled = false;
failedChild.unref = () => {
  failedChild.unrefCalled = true;
};
failedChild.on("error", () => {});

const failedOpenPromise = openLaunchUrl(launchUrl, "linux", () => failedChild);
queueMicrotask(() => failedChild.emit("error", new Error(launchUrl)));

await assert.rejects(
  failedOpenPromise,
  (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error.message, "Unable to open Truss in a browser.");
    assert.equal(error.message.includes(input.title), false);
    assert.equal(error.message.includes(input.description), false);
    assert.equal(error.message.includes(parsedUrl.hash), false);

    return true;
  },
);
assert.equal(failedChild.unrefCalled, true);
assert.throws(() => normalizeBaseUrl("javascript:alert(1)"));
assert.throws(() => normalizeBaseUrl("https://user:pass@truss.example"));
assert.throws(() => normalizeBaseUrl("https://truss.example/base"));
assert.throws(() => normalizeBaseUrl("https://truss.example?prompt=secret"));
assert.throws(() => normalizeBaseUrl("https://truss.example#fragment"));
assert.throws(() => normalizeBaseUrl("https://truss.example?"));
assert.throws(() => normalizeBaseUrl("https://truss.example#"));
assert.throws(() => normalizeBaseUrl("https://truss.example/?"));
assert.throws(() => normalizeBaseUrl("https://truss.example/#"));

const success = formatLauncherSuccess("https://truss.example", launchId);
assert.equal(success.includes(input.title), false);
assert.equal(success.includes(input.description), false);
assert.equal(success.includes(parsedUrl.hash), false);

console.info("Render Truss skill checks passed");
