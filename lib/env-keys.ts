/**
 * The `_PROD` convention documented at the top of `.env`: a plain name carries
 * the development value and an optional `<NAME>_PROD` twin carries the
 * production one.
 *
 * Nothing at runtime reads this — application code just reads
 * `LIVEBLOCKS_SECRET_KEY`, `TRIGGER_SECRET_KEY`, and friends, and gets whatever
 * the environment it is running in was given. The resolution happens once per
 * deploy, in the two places that populate those environments:
 * `scripts/push-vercel-env.ts` and the `syncEnvVars` extension in
 * `trigger.config.ts`. They share this function so a newly added key cannot
 * follow the rule in one and not the other.
 */
export function resolveEnvKeys(
  values: Readonly<Record<string, string>>,
  { production }: { production: boolean },
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      // The `_PROD` entries are inputs to the rule, never keys in their own
      // right — shipping them would leak the production value into every
      // environment under a name nothing reads.
      .filter(([name]) => !name.endsWith("_PROD"))
      .map(([name, value]) => [
        name,
        (production ? values[`${name}_PROD`] : undefined) ?? value,
      ]),
  );
}
