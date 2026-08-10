import { issueRunToken } from "@/lib/run-tokens";

/**
 * Run-scoped realtime token for a spec run (27-spec-generation-flow).
 *
 * Identical to the design token route on purpose: ownership lives on the
 * `TaskRun` record, which does not care which task produced the run.
 */
export const POST = issueRunToken;
