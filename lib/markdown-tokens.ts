/*
 * markdown-it 15 ships its own types, so there is no `@types/markdown-it`
 * here — the DefinitelyTyped package still describes v14 and conflicts with
 * these. The default export is a callable wrapper and the class itself is a
 * separate *type* export, hence the two-part import.
 */
import MarkdownItCallable, { type MarkdownIt } from "markdown-it";

/**
 * The app's one markdown parser, exposed as a token stream.
 *
 * This file is the trust boundary. Chat content is model-authored and arrives
 * from other clients, and there is no second sanitizing pass, so the settings
 * below *are* the sanitizer:
 *
 * - `html: false` is the load-bearing one. markdown-it does not strip raw HTML
 *   in this mode, it refuses to parse it, so `<img onerror=...>` reaches the
 *   renderer as token *content* and lands in a React text node as visible
 *   characters. Never turn this on. If embedded HTML is ever genuinely wanted,
 *   that is the moment this file grows a real sanitizer, not the moment the
 *   flag flips.
 * - Link hrefs are filtered by markdown-it's own `validateLink`, which refuses
 *   `javascript:`, `vbscript:`, `file:` and non-image `data:` URLs — the
 *   schemes that turn a link into script execution. A refused link never
 *   becomes a `link_open` token at all; its text stays literal.
 *
 * Tokens rather than HTML because the chat path renders React elements. That
 * is what removes `dangerouslySetInnerHTML` from this surface rather than
 * adding a fourth use of it.
 *
 * Pure and DOM-free, so `scripts/verify-markdown-tokens.ts` can exercise the
 * settings without a browser.
 */
const markdown: MarkdownIt = new MarkdownItCallable({
  html: false,
  // Bare URLs become links. Chat is where people paste them without syntax.
  linkify: true,
  // A single newline is a line break here. Markdown's "two spaces or it is the
  // same paragraph" rule is a writing convention nobody applies in a chat box.
  breaks: true,
});

/**
 * Derived from the instance rather than deep-imported from
 * `markdown-it/lib/token`, so the type cannot drift from the parser that
 * produces it and no unstable subpath is baked into the app.
 */
export type MarkdownToken = ReturnType<MarkdownIt["parse"]>[number];

/**
 * Links leave the app, so they open in a new tab rather than navigating the
 * editor away from a canvas with unsaved work. `noopener` is the security
 * half: without it the opened page can reach back through `window.opener` and
 * redirect this tab.
 *
 * A constant rather than a `link_open` renderer rule, because nothing here
 * renders HTML — the React renderer spreads this onto every anchor it makes.
 */
export const MARKDOWN_LINK_ATTRS = {
  target: "_blank",
  rel: "noopener noreferrer nofollow",
} as const;

/** Block-level parse of one message or document. */
export function parseMarkdown(text: string): MarkdownToken[] {
  return markdown.parse(text, {});
}
