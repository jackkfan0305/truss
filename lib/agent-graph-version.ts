/** Graph contract negotiation shared by the read, import and edit routes. */

export const SUPPORTED_GRAPH_VERSIONS = [1, 2] as const;

/** Omitted `?version` stays 1 for existing clients. Anything else non-numeric is `NaN`. */
export function parseRequestedVersion(url: string): number {
  const raw = new URL(url).searchParams.get("version");
  return raw === null ? 1 : /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

export function isSupportedGraphVersion(version: number): boolean {
  return (SUPPORTED_GRAPH_VERSIONS as readonly number[]).includes(version);
}

export function unsupportedGraphVersionResponse(status: 400 | 409, detail: string): Response {
  return Response.json(
    { code: "unsupportedGraphVersion", requiredVersion: 2, message: `${detail} Request version 2 with ?version=2.` },
    { status },
  );
}

export const NESTED_V1_DETAIL = "This diagram contains AWS services or nested boundaries.";
