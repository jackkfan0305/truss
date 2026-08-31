import assert from "node:assert/strict";

import { PANEL_CLASS_ALLOWLIST, renderPanelHtml } from "../lib/markdown";

/**
 * The panel trust boundary (28-sanitize-panel-html).
 *
 * Panels are authored by a terminal agent and rendered into other people's
 * browsers, so `lib/markdown.ts` runs markdown-it with HTML on and every rule
 * that keeps that safe lives in one module. Each check below is a way a panel
 * turns into script execution, a beacon, or a broken layout — and the module is
 * DOM-free precisely so this file can exercise all of them without a browser.
 */

assert.equal(
  typeof document,
  "undefined",
  "the module under test must render without a DOM",
);

const BLOB_IMAGE =
  "https://s7oe1krhpxfvfnbf.public.blob.vercel-storage.com/panels/wedge.png";

/** Allowed tags survive; everything outside the two lists does not. */

const SURVIVING_TAGS = [
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
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "div",
  "strong",
  "em",
  "a",
  "span",
];

for (const tag of SURVIVING_TAGS) {
  const html = renderPanelHtml(`<${tag}>kept</${tag}>`);

  assert.ok(
    html.includes(`<${tag}`),
    `${tag} is on the allowlist and must survive, got: ${html}`,
  );
}

// The three void tags on the allowlist, which take no closing tag.
for (const [tag, authored] of [
  ["hr", "<hr>"],
  ["br", "<br>"],
  ["img", `<img src="${BLOB_IMAGE}" alt="x">`],
]) {
  const html = renderPanelHtml(authored);

  assert.ok(html.includes(`<${tag}`), `${tag} must survive: ${html}`);
}

const DROPPED_TAGS = [
  "h4",
  "h5",
  "h6",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "form",
  "input",
  "button",
  "select",
  "label",
  "iframe",
  "object",
  "embed",
  "video",
  "audio",
  "svg",
  "math",
  "template",
  "slot",
  "link",
  "meta",
  "base",
  "details",
  "summary",
  "dialog",
  "canvas",
  "s",
  "del",
  "ins",
  "sub",
  "sup",
  "mark",
  "small",
  "big",
  "font",
  "center",
  "marquee",
  "figure",
  "figcaption",
  "picture",
  "source",
  "caption",
  "colgroup",
  "col",
  "tfoot",
  "dl",
  "dt",
  "dd",
];

for (const tag of DROPPED_TAGS) {
  const html = renderPanelHtml(`<${tag}>text</${tag}>`);

  assert.ok(
    !html.includes(`<${tag}`),
    `${tag} is not on the allowlist and must not survive, got: ${html}`,
  );
}

/**
 * Script execution, in the three shapes an agent-authored panel could carry it:
 * a script element, a handler attribute, and a `style` attribute (which is
 * where CSS-based exfiltration and overlay attacks live).
 */

const script = renderPanelHtml('<script>alert("x")</script>after');

assert.ok(!script.includes("<script"), script);
assert.ok(!script.includes("alert"), "script contents must go with the tag");
assert.ok(script.includes("after"), "text beside a script is still panel copy");

for (const handler of ["onclick", "onerror", "onload", "onmouseover"]) {
  const html = renderPanelHtml(`<div ${handler}="alert(1)">hi</div>`);

  assert.ok(!html.includes(handler), `${handler} must not survive: ${html}`);
}

for (const styled of [
  '<div style="position:fixed">hi</div>',
  '<span style="color:red">hi</span>',
  '<p style="background:url(https://evil.example/x)">hi</p>',
]) {
  const html = renderPanelHtml(styled);

  assert.ok(!html.includes("style"), `style must never survive: ${html}`);
}

/**
 * A markdown table renders alignment as a `style` attribute, so the rule above
 * costs column alignment. Asserted so the loss is a decision rather than a
 * surprise found in the UI.
 */
const alignedTable = renderPanelHtml("| a |\n| --: |\n| 1 |");

assert.ok(alignedTable.includes("<th"), alignedTable);
assert.ok(!alignedTable.includes("text-align"), alignedTable);

/** Link schemes, from both markdown syntax and raw HTML. */

for (const href of [
  "javascript:alert(1)",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "data:text/html,<script>alert(1)</script>",
]) {
  const html = renderPanelHtml(`<a href="${href}">go</a>`);

  assert.ok(!html.includes("href"), `${href} must not survive: ${html}`);
  assert.ok(html.includes("go"), "the link text is still panel copy");
}

/**
 * The same refusal after the browser's own URL normalisation: control
 * characters inside a scheme are stripped before a browser resolves it, so they
 * are stripped before the check too.
 */
const obfuscated = renderPanelHtml('<a href="java\tscript:alert(1)">go</a>');

assert.ok(!obfuscated.includes("href"), obfuscated);

const linked = renderPanelHtml("[docs](https://example.com/docs)");

assert.ok(linked.includes('href="https://example.com/docs"'), linked);
assert.ok(linked.includes('target="_blank"'), linked);
assert.ok(linked.includes('rel="noopener noreferrer nofollow"'), linked);

const rawAnchor = renderPanelHtml('<a href="mailto:ada@example.com">mail</a>');

assert.ok(rawAnchor.includes('href="mailto:ada@example.com"'), rawAnchor);
assert.ok(rawAnchor.includes('target="_blank"'), rawAnchor);
assert.ok(rawAnchor.includes('rel="noopener noreferrer nofollow"'), rawAnchor);

const overriddenRel = renderPanelHtml('<a href="https://x.example" rel="me" target="_self">x</a>');

assert.ok(overriddenRel.includes('target="_blank"'), overriddenRel);
assert.ok(
  overriddenRel.includes('rel="noopener noreferrer nofollow"'),
  "an authored rel cannot weaken the rewrite",
);

/** Image sources: our own Blob origin and inline data, nothing else. */

const blobImage = renderPanelHtml(`<img src="${BLOB_IMAGE}" alt="Wedge">`);

assert.ok(blobImage.includes(`src="${BLOB_IMAGE}"`), blobImage);
assert.ok(blobImage.includes('alt="Wedge"'), "alt text is accessibility, not decoration");

const dataImage = renderPanelHtml(
  '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot">',
);

assert.ok(dataImage.includes("data:image/png"), dataImage);

for (const src of [
  "https://evil.example/beacon.png",
  "https://public.blob.vercel-storage.com.evil.example/x.png",
  "http://s7oe1krhpxfvfnbf.public.blob.vercel-storage.com/x.png",
  "data:text/html,<script>alert(1)</script>",
  "/panels/local.png",
]) {
  const html = renderPanelHtml(`<img src="${src}" alt="x">`);

  assert.ok(!html.includes("<img"), `${src} must be dropped whole: ${html}`);
}

/** Classes: a fixed vocabulary the panel stylesheet owns. */

assert.ok(PANEL_CLASS_ALLOWLIST.length > 0, "the allowlist is the contract");

const authored = PANEL_CLASS_ALLOWLIST.join(" ");
const kept = renderPanelHtml(`<div class="${authored}">hi</div>`);

assert.ok(kept.includes(`class="${authored}"`), `every listed name survives: ${kept}`);

const [firstClass] = PANEL_CLASS_ALLOWLIST;
const mixed = renderPanelHtml(`<div class="${firstClass} fixed inset-0 z-50">hi</div>`);

assert.ok(
  mixed.includes(`class="${firstClass}"`),
  `an unlisted name is stripped and the listed one is not: ${mixed}`,
);

const noClass = renderPanelHtml('<div class="fixed inset-0">hi</div>');

assert.ok(!noClass.includes("class"), `nothing allowed leaves no class: ${noClass}`);

/** Ids: a thread anchors to a top-level block, so only those carry one. */

const topLevelId = renderPanelHtml('<div id="wedge">hi</div>');

assert.ok(topLevelId.includes('id="wedge"'), topLevelId);

const nestedId = renderPanelHtml('<div><p id="inner">hi</p></div>');

assert.ok(!nestedId.includes("id="), `only a top-level block is addressable: ${nestedId}`);

const inlineId = renderPanelHtml('<span id="inline">hi</span>');

assert.ok(!inlineId.includes("id="), `an inline element is not a block: ${inlineId}`);

const secondTopLevelId = renderPanelHtml(
  '<p id="one">a</p>\n<p id="two"><em id="three">b</em></p>',
);

assert.ok(secondTopLevelId.includes('id="one"'), secondTopLevelId);
assert.ok(secondTopLevelId.includes('id="two"'), secondTopLevelId);
assert.ok(!secondTopLevelId.includes('id="three"'), secondTopLevelId);

/*
 * Depth is counted as the sanitizer walks, so a discarded subtree must not
 * leave the count off by one — otherwise the block after a `<select>` silently
 * stops being addressable, which is the kind of bug found months later by a
 * thread that will not attach.
 */
const afterDiscard = renderPanelHtml(
  '<select><option><strong id="skipped">x</strong></option></select>\n<p id="still-top">after</p>',
);

assert.ok(afterDiscard.includes('id="still-top"'), afterDiscard);
assert.ok(!afterDiscard.includes('id="skipped"'), afterDiscard);

/** Markdown still renders, since that is what the agent writes most of. */

const prose = renderPanelHtml("# Title\n\n- one\n- two\n\n`code`");

assert.ok(prose.includes("<h1>Title</h1>"), prose);
assert.ok(prose.includes("<li>one</li>"), prose);
assert.ok(prose.includes("<code>code</code>"), prose);

console.log("panel html verified");
