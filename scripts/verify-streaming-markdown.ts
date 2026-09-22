import assert from "node:assert/strict";

import { completeStreamingMarkdown } from "../lib/streaming-markdown";

/**
 * A streamed answer arrives one delta at a time, so at any frame its tail is
 * half a construct. Rendering that raw shows literal `**` until the closer
 * lands, and the text flickers between styles as its delimiters arrive.
 *
 * Every check below is one such construct. The invariant across all of them:
 * the repair only ever *appends* or drops a delimiter — no word that reached
 * the screen may leave it on the next frame.
 */

function checkAnOpenFenceIsClosed() {
  assert.equal(
    completeStreamingMarkdown("Here:\n```ts\nconst a = 1"),
    "Here:\n```ts\nconst a = 1\n```",
  );
  // A fence that already closed is finished text and is left alone.
  assert.equal(
    completeStreamingMarkdown("```\ndone\n```"),
    "```\ndone\n```",
  );
  // Tildes are a fence too, and close with their own marker.
  assert.equal(
    completeStreamingMarkdown("~~~\nopen"),
    "~~~\nopen\n~~~",
  );
}

/** Inside a fence every other delimiter is literal, so nothing else applies. */
function checkFenceContentIsNotOtherwiseRepaired() {
  assert.equal(
    completeStreamingMarkdown("```\nconst a = **b"),
    "```\nconst a = **b\n```",
  );
}

function checkOddEmphasisRunsAreClosed() {
  assert.equal(completeStreamingMarkdown("this is **bold"), "this is **bold**");
  assert.equal(completeStreamingMarkdown("this is *ital"), "this is *ital*");
  assert.equal(completeStreamingMarkdown("this is `cod"), "this is `cod`");
  assert.equal(completeStreamingMarkdown("this is ~~str"), "this is ~~str~~");
  // Nesting closes innermost first.
  assert.equal(completeStreamingMarkdown("**bold *both"), "**bold *both***");
}

function checkBalancedEmphasisIsLeftAlone() {
  assert.equal(
    completeStreamingMarkdown("**done** and *done* too."),
    "**done** and *done* too.",
  );
}

/** A `*` inside a code span is a literal asterisk, not an open delimiter. */
function checkCodeSpansShieldTheirContents() {
  assert.equal(
    completeStreamingMarkdown("use `a * b` here"),
    "use `a * b` here",
  );
}

function checkHalfTypedLinksFallBackToTheirLabel() {
  assert.equal(completeStreamingMarkdown("see [the docs](http"), "see the docs");
  assert.equal(completeStreamingMarkdown("see [the docs]("), "see the docs");
  assert.equal(completeStreamingMarkdown("see [the docs]"), "see the docs");
  assert.equal(completeStreamingMarkdown("see [the do"), "see the do");
  // A finished link is finished text.
  assert.equal(
    completeStreamingMarkdown("see [the docs](https://x.test)"),
    "see [the docs](https://x.test)",
  );
}

function checkLoneTrailingMarkersAreDropped() {
  assert.equal(completeStreamingMarkdown("Intro\n\n#"), "Intro\n\n");
  assert.equal(completeStreamingMarkdown("Intro\n\n### "), "Intro\n\n");
  assert.equal(completeStreamingMarkdown("Intro\n\n-"), "Intro\n\n");
  // A marker with content after it is a real heading or bullet.
  assert.equal(completeStreamingMarkdown("Intro\n\n# Title"), "Intro\n\n# Title");
  assert.equal(completeStreamingMarkdown("Intro\n\n- one"), "Intro\n\n- one");
}

/**
 * The rule that separates "still arriving" from "said what it says": a
 * construct sitting inside finished text is not a broken tail, and a document
 * that stopped arriving means what it says.
 */
function checkFinishedTextInTheMiddleIsUntouched() {
  const finished = "A **bold** claim.\n\nAnd a `span` of code.\n\nDone.";

  assert.equal(completeStreamingMarkdown(finished), finished);
}

/**
 * The load-bearing invariant, checked over every prefix of a realistic answer:
 * the visible words only ever grow.
 */
function checkNoVisibleWordEverDisappears() {
  const answer =
    "The **gateway** owns retries.\n\n" +
    "```ts\nconst retries = 3\n```\n\n" +
    "See [the notes](https://x.test) and `config.ts`.";

  let previousWords: string[] = [];

  for (let length = 1; length <= answer.length; length += 1) {
    const words = visibleWords(completeStreamingMarkdown(answer.slice(0, length)));

    // The previous frame's words must still be a prefix of this frame's.
    for (const [index, word] of previousWords.entries()) {
      if (index < words.length - 1) {
        assert.equal(
          words[index],
          word,
          `word "${word}" vanished at prefix length ${length}`,
        );
      }
    }

    previousWords = words;
  }
}

/** Words as a reader sees them: delimiters stripped, order kept. */
function visibleWords(text: string): string[] {
  return text
    .replace(/[`*~#\[\]()>_-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function checkEmptyInputIsUntouched() {
  assert.equal(completeStreamingMarkdown(""), "");
}

checkAnOpenFenceIsClosed();
checkFenceContentIsNotOtherwiseRepaired();
checkOddEmphasisRunsAreClosed();
checkBalancedEmphasisIsLeftAlone();
checkCodeSpansShieldTheirContents();
checkHalfTypedLinksFallBackToTheirLabel();
checkLoneTrailingMarkersAreDropped();
checkFinishedTextInTheMiddleIsUntouched();
checkNoVisibleWordEverDisappears();
checkEmptyInputIsUntouched();
console.log("✅ streaming markdown tail repair checks passed");
