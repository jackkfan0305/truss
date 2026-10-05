/**
 * OpenRouter OAuth PKCE, entirely in the browser. The key OpenRouter returns
 * is the user's own and never reaches Truss's server (ADR 0006).
 */

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Dispatched on `window` after the stored key changes in this tab. */
export const OPENROUTER_KEY_CHANGE_EVENT = "truss:openrouter-key";
export const OPENROUTER_CALLBACK_PATH = "/openrouter/callback";

const KEY_STORAGE_KEY = "truss.openrouter.key";
const VERIFIER_STORAGE_KEY = "truss.openrouter.verifier";
const RETURN_TO_STORAGE_KEY = "truss.openrouter.returnTo";
const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
const VERIFIER_BYTES = 32;

export class OpenRouterConnectError extends Error {}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Same-origin paths only; anything else would be an open redirect. */
export function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : "/";
}

export async function buildConnectUrl(
  origin: string,
  returnTo: string,
  session: KeyValueStorage,
): Promise<string> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
  session.setItem(VERIFIER_STORAGE_KEY, verifier);
  session.setItem(RETURN_TO_STORAGE_KEY, safeReturnTo(returnTo));

  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set("callback_url", `${origin}${OPENROUTER_CALLBACK_PATH}`);
  url.searchParams.set("code_challenge", await deriveCodeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function startConnect(returnTo: string): Promise<void> {
  window.location.assign(
    await buildConnectUrl(window.location.origin, returnTo, window.sessionStorage),
  );
}

/** Exchanges the callback code for a key. Resolves to where the user started. */
export async function completeConnect(
  code: string,
  deps: { fetch: FetchLike; session: KeyValueStorage; local: KeyValueStorage } = {
    fetch: (input, init) => fetch(input, init),
    session: window.sessionStorage,
    local: window.localStorage,
  },
): Promise<string> {
  const verifier = deps.session.getItem(VERIFIER_STORAGE_KEY);
  const returnTo = safeReturnTo(deps.session.getItem(RETURN_TO_STORAGE_KEY));
  deps.session.removeItem(VERIFIER_STORAGE_KEY);
  deps.session.removeItem(RETURN_TO_STORAGE_KEY);

  if (!verifier) {
    throw new OpenRouterConnectError(
      "This connect link has expired. Start Connect again from the editor.",
    );
  }
  if (!code) {
    throw new OpenRouterConnectError("OpenRouter did not return a code. Try Connect again.");
  }

  const response = await deps.fetch(OPENROUTER_KEYS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  const body: unknown = await response.json().catch(() => null);
  const key =
    body && typeof body === "object" && "key" in body && typeof body.key === "string"
      ? body.key
      : "";

  if (!response.ok || !key) {
    throw new OpenRouterConnectError("OpenRouter refused the connection. Try Connect again.");
  }

  deps.local.setItem(KEY_STORAGE_KEY, key);
  return returnTo;
}

export function getKey(local: KeyValueStorage = window.localStorage): string | null {
  try {
    return local.getItem(KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function disconnect(local: KeyValueStorage = window.localStorage): void {
  try {
    local.removeItem(KEY_STORAGE_KEY);
  } catch {
    // ponytail: storage blocked means there was no key to remove.
  }
}
