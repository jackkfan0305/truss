import assert from "node:assert/strict";

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
assert.deepEqual(browserCommand(launchUrl, "darwin"), {
  command: "open",
  args: [launchUrl],
});
assert.deepEqual(browserCommand(launchUrl, "win32"), {
  command: "cmd.exe",
  args: ["/d", "/s", "/c", "start", "", launchUrl],
});

const spawnCalls = [];
const fakeChild = {
  unrefCalled: false,
  unref() {
    this.unrefCalled = true;
  },
};

await openLaunchUrl(launchUrl, "linux", (...args) => {
  spawnCalls.push(args);
  return fakeChild;
});

assert.deepEqual(spawnCalls[0], [
  "xdg-open",
  [launchUrl],
  { detached: true, shell: false, stdio: "ignore" },
]);
assert.equal(fakeChild.unrefCalled, true);
assert.throws(() => normalizeBaseUrl("javascript:alert(1)"));
assert.throws(() => normalizeBaseUrl("https://user:pass@truss.example"));
assert.throws(() => normalizeBaseUrl("https://truss.example/base"));
assert.throws(() => normalizeBaseUrl("https://truss.example?prompt=secret"));
assert.throws(() => normalizeBaseUrl("https://truss.example#fragment"));

const success = formatLauncherSuccess("https://truss.example", launchId);
assert.equal(success.includes(input.title), false);
assert.equal(success.includes(input.description), false);
assert.equal(success.includes(parsedUrl.hash), false);

console.info("Render Truss skill checks passed");
