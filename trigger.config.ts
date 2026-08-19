import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import { defineConfig } from "@trigger.dev/sdk";

import { resolveEnvKeys } from "./lib/env-keys";

/**
 * Deployed tasks run in Trigger.dev's cloud, which never sees `.env`, so every
 * key they need is pushed at deploy time under the `_PROD` convention shared
 * with `scripts/push-vercel-env.ts`. Locally, `npm run dev` reads `.env`
 * straight through and always gets the development keys.
 *
 * `TRIGGER_SECRET_KEY` is deliberately not our problem here: the extension
 * strips every `TRIGGER_`-prefixed name, since the deploy target already
 * determines which environment the tasks land in.
 *
 * Build-time only — `onBuildComplete` never runs inside a task, so the file
 * reads never happen in the cloud.
 */
const syncKeysForEnvironment = syncEnvVars(async ({ environment }) => {
  const { readFile } = await import("node:fs/promises");
  const { parse } = await import("dotenv");

  const file = await readFile(".env", "utf8").catch(() => null);

  // A deploy from CI has no `.env`; leave the environment's existing vars
  // alone rather than wiping them with an empty set.
  if (!file) {
    return;
  }

  return resolveEnvKeys(parse(file), { production: environment === "prod" });
});

export default defineConfig({
  project: "proj_elbcqayjdfyvyvysmclr",
  runtime: "node",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./trigger"],
  build: {
    /*
     * `generate-spec` writes a `ProjectSpec` row, so the worker bundle needs the
     * Prisma client. "modern" is the mode for this setup — Prisma 7 with the
     * `prisma-client` generator and a driver adapter, so there is no query engine
     * binary to ship and generation stays ours (`npm run generate`).
     */
    extensions: [prismaExtension({ mode: "modern" }), syncKeysForEnvironment],
  },
});
