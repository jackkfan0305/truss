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

/**
 * Markdown output is plain tags with no classes on them, so it is styled from
 * the container. Arbitrary variants rather than a typography plugin: these are
 * short panel surfaces, and a prose preset would have to be half-overridden to
 * stop fighting the palette.
 *
 * Here rather than in a component because three surfaces render this module's
 * output — the chat transcript, the spec preview and the run's thinking
 * disclosure — and the transcript already imports the activity component, so
 * hanging the styles off it would close an import cycle.
 *
 * The spec preview overrides the heading steps for a document; `cn` merges
 * those, since a spec has real hierarchy and a chat message does not.
 */
export const MARKDOWN_STYLES = [
  "[&_p]:my-0 [&_p+p]:mt-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4",
  "[&_li]:my-0.5 [&_li::marker]:text-copy-faint",
  "[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-sm [&_h1]:font-medium",
  "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-medium",
  "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium",
  "[&_strong]:font-medium [&_strong]:text-copy-primary",
  "[&_em]:italic",
  "[&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-copy-faint hover:[&_a]:decoration-copy-primary",
  "[&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-elevated [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:my-2 [&_blockquote]:border-l [&_blockquote]:border-surface-border [&_blockquote]:pl-3 [&_blockquote]:text-copy-muted",
  "[&_hr]:my-3 [&_hr]:border-surface-border",
  "[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto",
  "[&_th]:border [&_th]:border-surface-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-surface-border [&_td]:px-2 [&_td]:py-1",
].join(" ")
