import assert from "node:assert/strict";

import {
  MARKDOWN_LINK_ATTRS,
  parseMarkdown,
  type MarkdownToken,
} from "../lib/markdown-tokens";

/**
 * This module is the trust boundary: chat content is model-authored and
 * arrives from other clients, and there is no second sanitizing pass. The
 * checks here are the settings that make the token stream safe to render as
 * React elements — `html: false`, markdown-it's own `validateLink`, and the
 * attributes every link carries out of the app.
 */

/** Every token in the tree, inline children included. */
function flatten(tokens: readonly MarkdownToken[]): MarkdownToken[] {
  return tokens.flatMap((token) => [
    token,
    ...(token.children ? flatten(token.children) : []),
  ]);
}

function types(markdown: string): string[] {
  return flatten(parseMarkdown(markdown)).map((token) => token.type);
}

function text(markdown: string): string {
  return flatten(parseMarkdown(markdown))
    .filter((token) => token.type === "text")
    .map((token) => token.content)
    .join("");
}

/**
 * `html: false` is load-bearing. markdown-it does not strip raw HTML in this
 * mode, it refuses to parse it — so a tag arrives as text content and a
 * renderer that puts token text into a React text node shows it as visible
 * characters. Never turn this on.
 */
function checkRawHtmlNeverBecomesMarkup() {
  const tokens = types('<img src=x onerror="alert(1)">');

  assert.ok(!tokens.includes("html_block"), "no raw HTML block token");
  assert.ok(!tokens.includes("html_inline"), "no raw inline HTML token");
  assert.ok(
    text('<img src=x onerror="alert(1)">').includes("onerror"),
    "the tag survives as readable text rather than as markup",
  );
}

/** `validateLink` refuses the schemes that turn a link into script execution. */
function checkDangerousSchemesNeverBecomeLinks() {
  for (const href of [
    "javascript:alert(1)",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "data:text/html;base64,PHNjcmlwdD4=",
  ]) {
    assert.ok(
      !types(`[click](${href})`).includes("link_open"),
      `${href} is refused rather than linked`,
    );
  }
}

function checkOrdinarySchemesStillLink() {
  for (const href of ["https://example.test/a", "http://example.test", "mailto:a@b.test"]) {
    assert.ok(
      types(`[click](${href})`).includes("link_open"),
      `${href} is still a link`,
    );
  }
}

function checkLinksCarryTheirHref() {
  const link = flatten(parseMarkdown("[docs](https://example.test/a)")).find(
    (token) => token.type === "link_open",
  );

  assert.ok(link, "a link_open token exists");
  assert.equal(link.attrGet("href"), "https://example.test/a");
}

/**
 * Links leave the app, so they open in a new tab rather than navigating the
 * editor away from a canvas with unsaved work. `noopener` is the security
 * half: without it the opened page can reach back through `window.opener`.
 */
function checkLinkAttributesAreTheSecureSet() {
  assert.deepEqual(MARKDOWN_LINK_ATTRS, {
    target: "_blank",
    rel: "noopener noreferrer nofollow",
  });
}

/** The three settings the chat surface depends on, each with a visible effect. */
function checkChatParsingSettingsSurvive() {
  // `breaks: true` — a single newline is where the line visibly broke.
  assert.ok(types("one\ntwo").includes("softbreak"), "breaks: true");
  // `linkify: true` — a pasted URL is a link without any syntax around it.
  assert.ok(types("see https://example.test").includes("link_open"), "linkify: true");
  // Fences carry their info string so a code block can name its language.
  const fence = flatten(parseMarkdown("```ts\nconst a = 1\n```")).find(
    (token) => token.type === "fence",
  );

  assert.ok(fence, "a fence token exists");
  assert.equal(fence.info.trim(), "ts");
  assert.equal(fence.content, "const a = 1\n");
}

/** A linkified bare URL is filtered by the same rule as an explicit one. */
function checkLinkifyIsFilteredToo() {
  assert.ok(
    !types("see javascript:alert(1)").includes("link_open"),
    "linkify does not smuggle a dangerous scheme past validateLink",
  );
}

checkRawHtmlNeverBecomesMarkup();
checkDangerousSchemesNeverBecomeLinks();
checkOrdinarySchemesStillLink();
checkLinksCarryTheirHref();
checkLinkAttributesAreTheSecureSet();
checkChatParsingSettingsSurvive();
checkLinkifyIsFilteredToo();
console.log("✅ markdown token trust boundary checks passed");
