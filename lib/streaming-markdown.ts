/**
 * Repairs the tail of a markdown document that is still arriving.
 *
 * The transcript renders every delta, so at any frame the last construct is
 * half typed: an open fence, an odd `**`, a link with no href yet. Rendered
 * raw those show as literal punctuation and the text flickers between styles
 * as the closers land.
 *
 * Only the tail is repaired. Text in the middle of a finished paragraph is
 * left alone, because a document that stopped arriving means what it says.
 *
 * The rule every function here works to: no word already on screen may
 * disappear when the next token arrives. Delimiters may vanish as they are
 * recognised. Words never do.
 *
 * Pure and DOM-free, so `scripts/verify-streaming-markdown.ts` can exercise
 * every rule without a browser.
 */

/** A fence line, allowing markdown's three-space indent. */
const FENCE_LINE = /^ {0,3}(?:```+|~~~+)/;

/** A heading hash or a bullet with no space and content after it. */
const LONE_MARKER = /(^|\n)(?:#{1,6}|-)[ \t]*$/;

export function completeStreamingMarkdown(text: string): string {
  if (text.length === 0) {
    return text;
  }

  const fenced = closeOpenFence(text);

  // Inside a fence every other delimiter is literal, so the fence closer is
  // the whole repair — anything else would edit code the model wrote.
  if (fenced !== text) {
    return fenced;
  }

  return closeOpenDelimiters(stripLoneMarker(dropPartialLink(text)));
}

/**
 * Closes a fence with its own marker: a block opened with ``` closes with ```
 * and one opened with ~~~ closes with ~~~, because markdown does not let one
 * close the other.
 */
function closeOpenFence(text: string): string {
  let open: string | null = null;

  for (const line of text.split("\n")) {
    const match = FENCE_LINE.exec(line);

    if (!match) continue;

    const marker = match[0].trimStart();

    if (open === null) {
      open = marker;
      continue;
    }

    // A closer must be the same character and at least as long as the opener.
    if (marker[0] === open[0] && marker.length >= open.length) {
      open = null;
    }
  }

  if (open === null) {
    return text;
  }

  return text.endsWith("\n") ? `${text}${open}` : `${text}\n${open}`;
}

/**
 * A link whose href has not arrived falls back to its label text.
 *
 * The label is already on screen as words, so it stays as words; what goes is
 * the bracket syntax that would otherwise render literally. Anchored to the
 * end of the string, so a finished link earlier in the text is untouched.
 */
function dropPartialLink(text: string): string {
  const withOpenParen = /\[([^[\]]*)\]\([^()]*$/.exec(text);

  if (withOpenParen) {
    return text.slice(0, withOpenParen.index) + withOpenParen[1];
  }

  const closedLabel = /\[([^[\]]*)\]$/.exec(text);

  if (closedLabel) {
    return text.slice(0, closedLabel.index) + closedLabel[1];
  }

  const openLabel = /\[([^[\]]*)$/.exec(text);

  if (openLabel) {
    return text.slice(0, openLabel.index) + openLabel[1];
  }

  return text;
}

/** A `#` or `-` with nothing after it is a construct that has not arrived. */
function stripLoneMarker(text: string): string {
  return text.replace(LONE_MARKER, "$1");
}

/**
 * Closes every delimiter still open at the end of the document, innermost
 * first. Fenced blocks are skipped: their contents are literal.
 */
function closeOpenDelimiters(text: string): string {
  const open: string[] = [];
  let isInFence = false;

  for (const line of text.split("\n")) {
    if (FENCE_LINE.test(line)) {
      isInFence = !isInFence;
      continue;
    }

    if (!isInFence) {
      scanLine(line, open);
    }
  }

  return text + [...open].reverse().join("");
}

function scanLine(line: string, open: string[]): void {
  let index = 0;

  while (index < line.length) {
    const character = line[index];

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === "`") {
      let run = 1;

      while (line[index + run] === "`") run += 1;

      // A code span closes only on a run of the same length, so the marker
      // carries its length rather than being a bare backtick.
      toggle(open, "`".repeat(run));
      index += run;
      continue;
    }

    // Everything inside a code span is a literal character.
    if (isInCode(open)) {
      index += 1;
      continue;
    }

    if (character === "~" && line[index + 1] === "~") {
      toggle(open, "~~");
      index += 2;
      continue;
    }

    if (character === "*") {
      let run = 1;

      while (line[index + run] === "*") run += 1;

      // `***` is strong plus emphasis: consume two here and let the loop pick
      // up the third on the next pass.
      const marker = run >= 2 ? "**" : "*";

      toggle(open, marker);
      index += marker.length;
      continue;
    }

    index += 1;
  }
}

/** An unmatched marker opens; a matching one closes the most recent pair. */
function toggle(open: string[], marker: string): void {
  const at = open.lastIndexOf(marker);

  if (at === -1) {
    open.push(marker);
    return;
  }

  open.splice(at, 1);
}

function isInCode(open: string[]): boolean {
  return open.some((marker) => marker.startsWith("`"));
}
