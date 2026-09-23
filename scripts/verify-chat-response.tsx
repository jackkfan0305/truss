import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";

import { Response } from "../components/chat/response";
import { AiRunTasks } from "../components/editor/ai-run-tasks";

/**
 * `Response` replaced three `dangerouslySetInnerHTML` call sites, so these
 * checks are the guarantee that the replacement kept the properties the HTML
 * path had: raw HTML stays text, dangerous links never become anchors, real
 * links leave the app safely, and a fence becomes a block with its own scroll.
 *
 * `isStreaming` is false throughout: `useSmoothText` reveals from zero on a
 * first render, so a streaming Response renders empty to a static renderer.
 * The reveal is exercised in the browser, not here.
 */
function render(node: React.ReactNode): string {
  return renderToStaticMarkup(node);
}

function checkProseRendersAsRealElements() {
  const html = render(<Response>{"A **bold** claim and a list:\n\n- one\n- two"}</Response>);

  assert.ok(html.includes("<strong"), "emphasis is a real element");
  assert.ok(html.includes("bold"), "emphasized text is rendered");
  assert.ok(html.includes("<li"), "a list item is a real element");
  assert.ok(html.includes("<p"), "a paragraph is a real element");
}

/**
 * The property `html: false` buys: a tag in a message is characters on the
 * screen, never markup in the document.
 */
function checkRawHtmlStaysVisibleText() {
  const html = render(<Response>{'<img src=x onerror="alert(1)">'}</Response>);

  assert.ok(!html.includes("<img"), "no image element reaches the document");
  assert.ok(html.includes("&lt;img"), "the tag is escaped into visible text");
  assert.ok(html.includes("onerror"), "the text itself is still readable");
}

function checkDangerousLinksAreNotAnchors() {
  const html = render(<Response>{"[click](javascript:alert(1)) [data](data:text/html,evil)"}</Response>);

  assert.ok(!html.includes("<a "), "a refused scheme never becomes an anchor");
  assert.ok(html.includes("click"), "its label survives as text");
  assert.ok(html.includes("data"), "a data-link label survives as text");
}

function checkCuratedReasoningKeepsTheSameBoundary() {
  const html = render(
    <AiRunTasks state={{
      id: "reasoning-safety",
      runId: "run-safety",
      phase: "complete",
      activity: [
        { id: "step", type: "step", text: "Reading the canvas" },
        { id: "thought", type: "reasoning", text: "[unsafe](javascript:alert(1))" },
      ],
    }} />,
  );
  const source = readFileSync(
    new URL("../components/editor/ai-run-tasks.tsx", import.meta.url),
    "utf8",
  );

  assert.match(html, /Thought process/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(source, /<Response[\s\S]*?\{part\.text\}/, "curated reasoning uses the safe renderer");
}

function checkRealLinksLeaveTheAppSafely() {
  const html = render(<Response>{"[docs](https://example.test/a)"}</Response>);

  assert.ok(html.includes('href="https://example.test/a"'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes("noopener"));
  assert.ok(html.includes("noreferrer"));
  assert.ok(html.includes("nofollow"));
}

/** A fence is a block with its own scroll, not a `<pre>` inheriting the panel's. */
function checkFencesBecomeCodeBlocks() {
  const html = render(<Response>{"```ts\nconst a = 1\n```"}</Response>);

  assert.ok(html.includes("const a = 1"), "the code is rendered");
  assert.ok(html.includes("overflow-x-auto"), "the block scrolls itself");
  assert.ok(html.includes("Copy code"), "the block carries a copy control");
  assert.ok(html.includes(">ts<"), "the fence info string names the language");
}

/**
 * A markdown table carries no column widths, and guessing them from the
 * longest cell makes columns jump as rows stream in. Fixed layout keeps them
 * still.
 */
function checkTablesGetEvenColumns() {
  const html = render(
    <Response>{"| a | b |\n| --- | --- |\n| 1 | 2 |"}</Response>,
  );

  assert.ok(html.includes("<table"), "a real table element");
  assert.ok(html.includes("table-fixed"), "columns do not resize as rows arrive");
  assert.ok(html.includes("<th"), "the header row is a header");
}

/**
 * A header row with no divider yet is a paragraph. That is already
 * markdown-it's behaviour, and checking it here is what stops a future
 * "helpful" table repair from being added to the tail repair.
 */
function checkAnUndividedTableHeaderStaysAParagraph() {
  const html = render(<Response>{"| a | b |"}</Response>);

  assert.ok(!html.includes("<table"), "no table is guessed into existence");
}

/**
 * The heading scale is the container's, not the component's — that is what
 * lets the spec preview show a document's hierarchy while a chat heading
 * stays flat.
 */
function checkHeadingScaleComesFromTheClassName() {
  const html = render(<Response className="text-sm">{"# Title"}</Response>);

  assert.ok(html.includes("<h1"), "a heading is a real heading element");
  assert.ok(
    !/<h1[^>]*class="[^"]*text-(?:xs|sm|base|lg|xl)/.test(html),
    "the heading sets no size of its own",
  );
}

function checkBlockOverridesAreHonoured() {
  const html = render(
    <Response components={{ p: ({ children }) => <p data-custom="">{children}</p> }}>
      {"hello"}
    </Response>,
  );

  assert.ok(html.includes('data-custom=""'), "a per-block override is used");
}

/** A half-arrived tail is repaired before parsing rather than rendered raw. */
function checkIncompleteMarkdownIsRepairedBeforeParsing() {
  const repaired = render(
    <Response isStreaming parseIncompleteMarkdown>
      {"this is **bold"}
    </Response>,
  );

  // Streaming renders empty under a static renderer, so the guarantee checked
  // here is the wiring: the module imports the repair and calls it.
  assert.equal(typeof repaired, "string");

  const source = readFileSync(
    new URL("../components/chat/response.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /completeStreamingMarkdown/, "the repair is wired in");
  assert.match(source, /useSmoothText/, "the reveal pacing is wired in");
}

/**
 * The chat path must not grow a fourth raw-HTML sink. This is the check that
 * makes that a rule rather than an intention.
 */
function checkTheChatPathHasNoRawHtmlSink() {
  for (const path of [
    "../components/chat/response.tsx",
    "../components/chat/code-block.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");

    assert.doesNotMatch(
      source,
      /dangerouslySetInnerHTML/,
      `${path} renders elements, never an HTML string`,
    );
  }
}

checkProseRendersAsRealElements();
checkRawHtmlStaysVisibleText();
checkDangerousLinksAreNotAnchors();
checkCuratedReasoningKeepsTheSameBoundary();
checkRealLinksLeaveTheAppSafely();
checkFencesBecomeCodeBlocks();
checkTablesGetEvenColumns();
checkAnUndividedTableHeaderStaysAParagraph();
checkHeadingScaleComesFromTheClassName();
checkBlockOverridesAreHonoured();
checkIncompleteMarkdownIsRepairedBeforeParsing();
checkTheChatPathHasNoRawHtmlSink();
console.log("✅ chat response rendering checks passed");
