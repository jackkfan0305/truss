import { issueRunToken } from "@/lib/run-tokens";

/**
 * Run-scoped realtime token for an orchestrated turn — see `lib/run-tokens.ts`.
 *
 * The one caller now that the design and spec routes are gone. Ownership lives
 * on the `TaskRun` record, which does not care which task produced the run, so
 * the helper itself is unchanged.
 */
export const POST = issueRunToken;
