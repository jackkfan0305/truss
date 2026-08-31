/*
 * markdown-it 15 ships its own types, so there is no `@types/markdown-it` here
 * — the DefinitelyTyped package still describes v14 and conflicts with these.
 * The default export is a callable wrapper kept for backward compatibility, and
 * the class itself is a separate *type* export, hence the two-part import.
 */
import MarkdownItCallable, { type MarkdownIt } from "markdown-it";
import sanitizeHtml from "sanitize-html";

/**
 * Panel content, from what an agent writes to what a browser is allowed to see
 * (28-sanitize-panel-html).
 *
 * Panels carry HTML rather than Markdown because a plan needs layout Markdown
 * cannot express, and they are authored by somebody else's terminal agent and
 * rendered into collaborators' browsers. So `html: true` is on and this module
 * is the trust boundary: markdown-it renders, sanitize-html enforces the
 * allowlists below, and nothing reaches the DOM by another route.
 *
 * Pure and DOM-free — `scripts/verify-panel-html.ts` exercises every rule here
 * without a browser, which is the only reason the whole boundary is testable.
 */

/**
 * Blocks are what a thread anchors to, so they are also what carries an `id`.
 * Inline tags are the emphasis and links inside one.
 */
const BLOCK_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "div",
];

const INLINE_TAGS = ["strong", "em", "a", "span", "br", "img"];

/**
 * The vocabulary a panel may style itself with. Deliberately semantic rather
 * than Tailwind utilities: the panel stylesheet owns what these look like, so
 * an agent cannot position, hide or overlay anything, and the set widens by an
 * explicit edit here rather than by a class nobody reviewed. Per ADR 0002,
 * widening it widens it for every panel that already exists.
 */
export const PANEL_CLASS_ALLOWLIST = [
  // Layout
  "columns",
  "column",
  "row",
  "stack",
  "spread",
  "center",
  // Emphasis
  "callout",
  "callout-warn",
  "callout-danger",
  "badge",
  "lead",
  "muted",
];

/**
 * Images come from our own Blob store or are inlined. Anything else would let a
 * panel phone out — an `img` src is a GET the browser makes unasked, which is
 * enough to report who read the plan and when.
 *
 * A suffix rather than one exact host: the store subdomain is assigned by
 * Vercel and differs per environment, so this trusts Vercel Blob rather than
 * our own store specifically. Pin it to the store host once panels have an
 * upload path to pin it against.
 */
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

const markdown: MarkdownIt = new MarkdownItCallable({
  // Panels are HTML. Safe only because of the sanitizing pass below.
  html: true,
  // Bare URLs become links. Agents paste them without syntax.
  linkify: true,
  // A single newline is a line break. Markdown's "two spaces or it is the same
  // paragraph" rule is a writing convention nobody applies when dictating a
  // plan, and a panel should break where its author visibly broke it.
  breaks: true,
});

/**
 * A URL as the browser will resolve it. Browsers drop control characters before
 * matching a scheme, so `java<TAB>script:` runs; dropping them here first means
 * the check sees the string the browser will act on rather than the one the
 * panel was written with.
 */
function normalizeUrl(url: string): string {
  return url.replace(/[\u0000-\u0020]/g, "");
}

/**
 * markdown-it's own link filter, reused so a link written as HTML is refused on
 * exactly the same grounds as one written as Markdown: `javascript:`,
 * `vbscript:`, `file:` and any `data:` that is not an image.
 */
function isSafeLink(url: string): boolean {
  return markdown.validateLink(normalizeUrl(url));
}

function isPanelImageSource(url: string): boolean {
  const normalized = normalizeUrl(url);

  if (!isSafeLink(normalized)) return false;

  // `validateLink` has already refused every `data:` that is not an image.
  if (normalized.toLowerCase().startsWith("data:")) return true;

  try {
    const { protocol, hostname } = new URL(normalized);

    return protocol === "https:" && hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    // Relative and unparseable sources both land here. A panel names its images
    // absolutely; there is nothing app-relative for one to point at.
    return false;
  }
}

/**
 * Renders one panel's content to HTML that is safe to hand
 * `dangerouslySetInnerHTML`.
 *
 * Sanitizing happens here rather than at the call site so there is no way to
 * get the unsanitized string: the render and the scrub are one step.
 */
export function renderPanelHtml(content: string): string {
  /*
   * How deep the tag being transformed sits. `onOpenTag` fires for every open
   * tag before `transformTags`, and `onCloseTag` for every close, so the pair
   * stays balanced even inside subtrees the sanitizer is discarding — which is
   * why the depth is counted here rather than read off the transform.
   */
  let depth = 0;
  let tagDepth = 0;

  return sanitizeHtml(markdown.render(content), {
    allowedTags: [...BLOCK_TAGS, ...INLINE_TAGS],
    allowedAttributes: {
      // `id` survives only where `transformTags` leaves it: a top-level block.
      "*": ["class", "id"],
      a: ["href", "target", "rel"],
      img: ["src", "alt"],
    },
    allowedClasses: { "*": PANEL_CLASS_ALLOWLIST },
    /*
     * Scheme filtering is `isSafeLink`'s job below, not the library's. One rule
     * in one place, and it is markdown-it's rule, so an HTML link and a
     * Markdown link are refused on identical grounds.
     */
    allowedSchemesAppliedToAttributes: [],
    onOpenTag: () => {
      tagDepth = depth;
      depth += 1;
    },
    onCloseTag: () => {
      depth -= 1;
    },
    transformTags: {
      "*": (tagName, attribs) => {
        const next: sanitizeHtml.Attributes = { ...attribs };

        if (tagDepth > 0 || !BLOCK_TAGS.includes(tagName)) delete next.id;

        if (tagName === "a") {
          if (next.href !== undefined && !isSafeLink(next.href)) {
            delete next.href;
          }

          if (next.href === undefined) {
            delete next.target;
            delete next.rel;
          } else {
            /*
             * Links leave the app, so they open in a new tab rather than
             * navigating away from a board someone is reading. `noopener` is
             * the security half: without it the opened page can reach back
             * through `window.opener` and redirect this tab. Assigned rather
             * than defaulted, so an authored `rel` cannot weaken it.
             */
            next.target = "_blank";
            next.rel = "noopener noreferrer nofollow";
          }
        }

        if (
          tagName === "img" &&
          (next.src === undefined || !isPanelImageSource(next.src))
        ) {
          delete next.src;
        }

        return { tagName, attribs: next };
      },
    },
    // An `img` whose source was refused is not a broken image, it is not an
    // image; `exclusiveFilter` drops the element rather than leaving the frame.
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  });
}

/**
 * Panel HTML carries no classes of its own beyond the allowlist above, so it is
 * styled from the container. Arbitrary variants rather than a typography
 * plugin: panels are short surfaces, and a prose preset would have to be
 * half-overridden to stop fighting the palette.
 *
 * Here rather than in a component because every surface rendering this module's
 * output needs the same steps, and a panel and its preview should not drift.
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
