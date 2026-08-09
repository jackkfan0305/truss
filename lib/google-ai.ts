/**
 * The Gemini API key, shared by every background task that calls the provider.
 *
 * The specs name `GOOGLE_AI_API_KEY`; the project's `.env.local` has
 * `GEMINI_API_KEY`. Both are accepted rather than picking one and leaving a
 * silently key-less task behind.
 */
export function getGoogleApiKey(): string {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;

  if (!key) {
    throw new Error("GEMINI_API_KEY (or GOOGLE_AI_API_KEY) is not set");
  }

  return key;
}
