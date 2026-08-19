import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { parse } from "dotenv";

import { resolveEnvKeys } from "../lib/env-keys";

/**
 * Push `.env` into the linked Vercel project, applying the `_PROD` convention:
 * Development and Preview get the plain values, Production gets the `_PROD`
 * ones where they exist, and everything lands under the plain name.
 *
 * Run after rotating or adding a key: `npx tsx scripts/push-vercel-env.ts`.
 * Existing values are overwritten; values are never printed.
 */

const values = parse(readFileSync(new URL("../.env", import.meta.url), "utf8"));

const byEnvironment = {
  development: resolveEnvKeys(values, { production: false }),
  preview: resolveEnvKeys(values, { production: false }),
  production: resolveEnvKeys(values, { production: true }),
};

function push(name: string, environment: string, value: string): void {
  try {
    execFileSync("npx", ["vercel", "env", "add", name, environment, "--force"], {
      input: value,
      stdio: ["pipe", "ignore", "pipe"],
    });
    console.log(`  ok    ${name} → ${environment}`);
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr;
    const detail = String(stderr ?? error).trim().split("\n").pop();
    console.log(`  FAIL  ${name} → ${environment}: ${detail}`);
    process.exitCode = 1;
  }
}

for (const name of Object.keys(byEnvironment.development)) {
  const differs =
    byEnvironment.production[name] !== byEnvironment.development[name];
  console.log(differs ? `${name}  (separate production key)` : name);

  for (const [environment, resolved] of Object.entries(byEnvironment)) {
    push(name, environment, resolved[name]);
  }
}
