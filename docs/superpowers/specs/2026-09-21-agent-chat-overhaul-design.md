# Agent chat panel overhaul

The right-side AI panel is rebuilt around four ideas taken from the `panelui-native`
component docs and two npm packages. The user approved the design on September 21.

`panelui-native` is React Native and Expo, so nothing from it installs here. Its
AIInput, Response, and Task docs are treated as design specifications ported to
web components this repo owns. `border-beam@1.3.0` and `thinking-orbs@0.3.1` are
React packages and install directly.

Panel width and resize stay out of scope. Run cancellation stays out of scope:
no cancel route or hook exists today, and Submit therefore keeps two states
rather than the three the AIInput doc describes.

## Component layer

A new `components/chat/` directory holds the ported components. It is separate
from `components/editor/`, which already carries fifteen files, and from
`components/ui/`, which `ai-workflow-rules.md` protects as generated shadcn code.

`ai-input.tsx` is the composer as a compound component: a root holding value,
status, and disabled state in context, with `Field`, `Toolbar`, `Pill`, `Spacer`,
and `Submit` parts. `ai-input-settings.tsx` is the model and effort surface,
porting the doc's `Sheet.Choice` rows into a popover. `response.tsx` renders
streaming markdown. `code-block.tsx` renders a fenced block with a copy control,
reusing the existing `use-copy-to-clipboard` hook. `task.tsx` is the work step as
a compound component with `Trigger`, `Content`, `Item`, and `File` parts.
`thinking-orb.tsx` and `border-beam.tsx` are thin wrappers that bind the two
packages to this app's tokens, run state, and motion preference.

Three modules join `lib/`. `streaming-markdown.ts` repairs a half-arrived
markdown tail. `markdown-tokens.ts` holds the configured markdown-it instance
moved out of `lib/markdown.ts`. `run-task-groups.ts` turns an activity timeline
into task groups.

`ai-sidebar.tsx`, `ai-chat-transcript.tsx`, and `chat-entry.tsx` are rewritten.
`ai-run-activity.tsx` is replaced by `ai-run-tasks.tsx`. `lib/markdown.ts` is
deleted once its three consumers migrate.

The settings surface needs a popover primitive, which the repo does not have. It
is added through the shadcn CLI as `components/ui/popover.tsx` rather than
hand-written, so the protected foundation stays generated code.

## Streaming answers

The orchestrator already streams the answer. Every text delta calls
`publisher.appendContent`, and the growing row flushes to Liveblocks on a 400ms
cadence, so every collaborator watches the answer fill. No backend change is
needed for streaming prose.

What fails today is the client. The transcript pipes message content straight
through the markdown renderer, so an unterminated `**` or an open fence renders
as literal punctuation until the next chunk lands, and the text flickers between
styles as its delimiters arrive.

`completeStreamingMarkdown` fixes only the tail. It closes an unterminated
fence, closes an odd run of `**`, `*`, backtick, or `~~`, drops a half-typed
link back to its label text, and strips a lone trailing `#` or `-` that has no
space and content after it. Text in the middle of a finished paragraph is left
alone, because a document that stopped arriving means what it says. A table
header row without its divider stays a paragraph, which is already markdown-it's
behaviour and needs no rule.

The rule the repair works to is that no word already on screen may disappear
when the next token arrives. Delimiters may vanish as they are recognised.
Words never do.

The design agent still lands its `summary` whole at `finish`. That is a single
sentence describing a canvas change rather than a prose answer, so it needs no
streaming treatment.

## Response and the markdown trust boundary

`lib/markdown.ts` is the app's sanitizer. `html: false` is the load-bearing
setting, markdown-it's `validateLink` filters dangerous schemes, and a
`link_open` override adds `target="_blank"` and `rel="noopener noreferrer
nofollow"`. There is no second sanitizing pass. Output currently reaches the DOM
through `dangerouslySetInnerHTML` in three places.

`Response` parses with the same markdown-it instance and renders the resulting
token stream as React elements instead of an HTML string. The parsing settings,
the link filter, and the link attributes all carry over unchanged. `html_block`
and `html_inline` token content renders as React text nodes, so raw HTML in a
message stays visible text exactly as it does now. The result removes
`dangerouslySetInnerHTML` from the chat path rather than adding a fourth use of
it.

`Response` accepts the text as children, plus `isStreaming`,
`parseIncompleteMarkdown` defaulting to true, `components` for per-block
overrides, and `showLineNumbers`. The doc's `onLinkPress` and
`allowedLinkPrefixes` props are dropped, because `validateLink` and the
`link_open` override are the web equivalents and already ship. `useSmoothText`
supplies the reveal pacing with `settled` set to the negation of `isStreaming`.
The component memoises on text, streaming flag, and class name, so a long answer
does not re-parse when a sibling moves.

A fenced block becomes a real `CodeBlock` with a copy control and horizontal
scroll. A table becomes real table elements with even column widths, because a
markdown table carries no widths and guessing them from the longest cell makes
columns jump as rows stream in.

All three current consumers migrate: the chat transcript, the spec preview in
`spec-attachment.tsx`, and the reasoning disclosure. `renderChatMarkdown` and
`MARKDOWN_STYLES` are then deleted, leaving one renderer.

The spec preview is a document rather than a chat message, and today it
overrides the heading steps that `MARKDOWN_STYLES` sets for a panel surface.
`Response` keeps that possible: heading scale comes from the component's own
class name, so the preview passes a document scale and the transcript passes
nothing. Losing that override would flatten a spec's hierarchy to the flat
`text-sm` every chat heading uses.

## Task and the run model

`run-task-groups.ts` walks the activity timeline. Each `step` part opens a
group. Every `action` and `reasoning` part after it joins that group until the
next `step`. `artifact` parts stay out of the grouping and remain attached under
the message, because a document is the result of a turn rather than a step
inside it.

Status comes from position and run phase together. The last group in a live run
is `running`. Earlier groups in a live run are `complete`. Every group in a
finished run is `complete`. On a failed run the last group is `error`. An
`incomplete` run uses the error glyph with wording that says the work stopped
rather than that it failed. The doc's `pending` status goes unused, because no
part exists before its step fires.

Inside a group, an `action` part becomes a `Task.Item` carrying the operation
name as text and `part.detail` as a bordered `Task.File` chip. The chip is what
makes a stack of canvas edits scannable by which node or edge each one touched.
A `reasoning` part keeps a collapsed disclosure inside the task content,
rendered through `Response`. This satisfies the rule in `ui-context.md` that raw
provider chain of thought is never displayed and only curated summaries appear.

Tasks stay open. Unlike a reasoning trace, which stops being interesting once
the answer starts, the steps are the record of what the agent did to the canvas
and are worth scrolling back through. The trigger still folds a task away when
pressed, so a reader can collapse a long run by hand. Only the default changes.

The live step line above the composer is deleted, along with its sweep style and
its call to `selectLiveRunStep`. The running task now carries the same verb in
place, and two live regions announcing one verb read it twice to a screen
reader. `selectLiveRunStep` in `lib/ai-run-turns.ts` loses its only caller and is
deleted with its cases in `scripts/verify-design-agent.ts`.

The live region moves with the verb. The running task's trigger carries
`role="status"` and `aria-live="polite"`, so the step a screen reader hears is
the one the transcript shows, and exactly one element announces it. A task that
is not running carries neither.

The remote run status row stays. When a collaborator's agent is working, this
client has no activity stream and only the room status message, so that case
keeps its single line rather than being forced into an empty task stack. It
takes the 20px orb in place of its spinner.

## Step vocabulary

Six step strings exist as literals across `trigger/orchestrator.ts` and
`trigger/design-agent.ts`: reading the canvas, designing the canvas, designing,
validating the proposed changes, applying to the canvas, and writing the spec.

They move to an `AI_RUN_STEPS` constant in `types/tasks.ts`. Both task files and
the orb state map import it, so the strings are named once. The values do not
change, so persisted history maps correctly.

The map sends reading to `searching`, both designing steps to `shaping`,
validating to `solving`, applying to `weaving`, and spec writing to `composing`.
Any string the map does not recognise falls back to `working`, which covers both
a future step and an old persisted row.

This change touches trigger tasks rather than UI, so it ships as its own
implementation step. `ai-workflow-rules.md` requires that split.

## Composer

The field opens one row tall and grows with its content to five rows. Past that
it holds its height and scrolls its own content, so a long prompt never pushes
the send control out of the panel.

The toolbar carries one pill showing the model as its label and the thinking
effort as its detail. Pressing it opens a popover of choice rows for both
settings. The two bare shadcn selects that sit inside the composer border today
are removed, because a second bordered control inside the composer reads as a
nested box rather than as a setting on the thing it belongs to.

Submit has two states. It is disabled with an empty field, sends when there is
text, and shows a non-interactive working indicator while a run is in flight.
The doc's third state is a stop button, which this app cannot honour yet.

BorderBeam wraps the composer with `colorVariant="mono"` tinted to the AI
accent, `active` bound to whether a run is live, and `active` forced false under
reduced motion. It decorates a state that the working indicator and the running
task already state in words.

## Shell, empty state, and messages

A header replaces the `pt-14` padding that currently reserves space for a
floating close control. It names the active provider and exact model ID on the
leading edge and carries the close control on the trailing edge. `ui-context.md`
already describes this header; it does not exist yet.

The empty state is rebuilt around a 64px orb in its `breathing` state, replacing
the bot glyph in a rounded square. The three starter prompts stay, restyled to
read as prompts rather than as a stack of generic outline buttons.

Own prompts, collaborator prompts with their avatar rail, and spec attachment
cards are restyled to sit with the new task and response blocks. The collaborator
identity treatment and the own-prompt treatment both stay as `ui-context.md`
specifies them.

## Colour

`ui-context.md` declares the sidechat monochrome. That rule is amended, not
dropped. The composer beam and the thinking orb may use `--accent-ai` and
`--accent-ai-text`, which the palette already defines and which no sidechat
surface currently uses. Everything else stays on the page, surface, border, and
copy tokens.

The hard rule survives intact: no state is communicated by colour alone.
Complete, failed, stopped, and pending all read as an icon and text, and the
beam and orb annotate a state that is already stated.

## Verification

Pure logic gets `scripts/verify-*.ts` files in the existing style. Tail repair
covers each rule plus the case where a construct sits in the middle of finished
text and must be left alone. Token rendering covers raw HTML staying as text,
link scheme filtering, and link attributes. Task grouping covers step
boundaries, artifact exclusion, and status derivation across live, complete,
error, and incomplete runs. Step mapping covers all six strings plus an
unrecognised one.

`scripts/verify-ai-chat.ts` extends rather than being replaced, so the existing
escaping cases keep running against the new path. `scripts/verify-design-agent.ts`
loses its `selectLiveRunStep` cases along with the function.

Accessibility is checked directly: exactly one element announces the current
step, the task triggers reach by keyboard and fold, the composer popover traps
and restores focus, and every status still reads as an icon and text with colour
removed.

Component behaviour is checked in the browser through the `truss-dev-server`
skill: a streaming answer with a fence and a table arriving mid-token, a run
producing several task groups, the composer growing and then scrolling, the
popover, the empty state, and reduced motion holding the beam and orb still.

## Documentation

`context/ui-context.md` takes three amendments. The accent exception is added
with the colour-alone rule restated. The header description is corrected to
match what will exist. The work-log paragraph is rewritten from a shadcn
accordion to a task stack.

`context/progress-tracker.md` records the completed unit.
