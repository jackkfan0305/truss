/*
 * markdown-it 15 ships its own types, so there is no `@types/markdown-it` here
 * — the DefinitelyTyped package still describes v14 and conflicts with these.
 * The default export is a callable wrapper kept for backward compatibility, and
 * the class itself is a separate *type* export, hence the two-part import.
 */
import MarkdownItCallable, { type MarkdownIt } from "markdown-it";

/**
 * Markdown for assistant chat messages (26-ai-chat-functional).
 *
 * The output of this module is handed to `dangerouslySetInnerHTML`, so the
 * whole file is a trust boundary and the settings below are the sanitizer —
 * there is no second sanitizing pass to catch a mistake made here.
 *
 * - `html: false` is the load-bearing one, and it is why no DOM sanitizer is
 *   needed alongside it. markdown-it does not *strip* raw HTML in this mode, it
 *   escapes it: `<img onerror=...>` in a message renders as visible text. Never
 *   turn this on. If embedded HTML is ever genuinely wanted, that is the moment
 *   this file grows a real sanitizer, not the moment the flag flips.
 * - Link hrefs are filtered by markdown-it's own `validateLink`, which refuses
 *   `javascript:`, `vbscript:`, `file:` and non-image `data:` URLs — the schemes
 *   that turn a link into script execution.
 *
 * Pure and DOM-free, so `scripts/verify-ai-chat.ts` can exercise the escaping
 * without a browser.
 */
const markdown: MarkdownIt = new MarkdownItCallable({
  html: false,
  // Bare URLs become links. Chat is where people paste them without syntax.
  linkify: true,
  // A single newline is a line break here. Markdown's "two spaces or it is the
  // same paragraph" rule is a writing convention nobody applies in a chat box,
  // and the transcript rendered plain text with `whitespace-pre-wrap` before
  // this existed — so this keeps messages breaking where they visibly broke.
  breaks: true,
});

/**
 * Links leave the app, so they open in a new tab rather than navigating the
 * editor away from a canvas with unsaved work. `noopener` is the security half:
 * without it the opened page can reach back through `window.opener` and
 * redirect this tab.
 */
const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer nofollow");

  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Renders one chat message to HTML. Block-level: a message may be a list. */
export function renderChatMarkdown(content: string): string {
  return markdown.render(content);
}
