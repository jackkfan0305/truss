# AI Elements chat migration

The right-side Truss chat should use Vercel AI Elements wherever a component
matches the existing web behavior. The September 21 panel overhaul shipped and
is the baseline for this migration. Its `panelui-native` references explained a
visual direction, but that library is for React Native. The new source of web
components is `components/ai-elements/`, installed from the AI Elements
registry. Border Beam and Thinking Orbs remain part of the panel.

This is a UI migration. Liveblocks remains the source of shared chat and run
history. Trigger.dev remains the durable worker and the initiator's run
subscription. Neither is replaced by `useChat`, a new chat route, or a second
client-side transcript store. The design preserves the existing chat message
IDs, activity part values, run phases, stale-run handling, model allowlist, and
server-side validation.

## Component choices

| Truss area | AI Elements component | Fit and boundary |
| --- | --- | --- |
| Transcript viewport | `Conversation`, `ConversationContent`, `ConversationScrollButton` | Use its stick-to-bottom behavior after checking the existing older-message paging, reader scroll-up, streaming follow, and reduced-motion behavior. |
| Human and assistant turns | `Message`, `MessageContent` | Adapt the validated Liveblocks `ChatMessage` into presentation props. Keep collaborator avatar, name, timestamp, and own-message treatment in `ChatEntry`. |
| Assistant Markdown | `MessageResponse` | Replace the custom `Response` only after its HTML, URL, link-attribute, code-block, table, partial-Markdown, and spec-preview behavior pass the current trust-boundary checks. Until then, keep the existing renderer for those uses. |
| Composer | `PromptInput`, `PromptInputTextarea`, `PromptInputSubmit`, and relevant toolbar parts | The sidebar still owns draft, disabled state, submit callback, and run lifecycle. Text submission works first. Hidden attachment, screenshot, speech, or stop controls stay absent until Truss has working backend behavior for them. |
| Model picker | `ModelSelector` | Offer only `AI_DESIGN_MODELS`. Keep thinking effort in the existing setting control unless a matching AI Elements composition works without creating a second model source. |
| Work log | `Task`, `TaskTrigger`, `TaskContent`, `TaskItem`, `TaskItemFile` | Adapt `selectRunTaskGroups` output. App-level markup keeps complete, running, error, and incomplete labels and icons because the installed `TaskTrigger` has no status prop. |
| Loading text | `Shimmer` | Apply to the one active run label or thinking label. It is decoration around visible status text, never the only status cue. |
| Curated reasoning | `Reasoning` | Show only the existing validated `reasoning` activity parts. Keep them collapsed by default, including while streaming, so the panel does not open private work automatically. |
| Structured phase summaries | `ChainOfThought` | Use only if distinct app-authored phase summaries add information beyond Task titles. Do not render the same phase twice or label raw provider thought as a chain of thought. |
| Tool calls | `Tool` | Use only after a run supplies a real typed tool-call event with input, output, and state. Canvas action lines remain Task items. |
| Context usage | `Context` | Use only after real per-run token usage and the model context limit are available. Do not estimate token counts or cost from text length. |
| Accent motion | existing `ComposerBeam` and `ThinkingOrb` | Keep the beam around the composer and the orb in the empty state and remote working status. Both honor reduced motion and remain the only AI-accent exceptions in the sidechat. |

AI Elements registry files stay in `components/ai-elements/`. The shadcn files
the CLI added stay in `components/ui/`. App-specific mapping, layout, and style
overrides belong in `components/editor/` or small `components/chat/` adapters.
The generated files may receive narrow compatibility fixes when current Base UI
or AI SDK types require them; do not rewrite them into Truss business logic.

## Data and interaction flow

`AiSidebar` continues to call `useAiPromptSubmission`. `PromptInput` calls the
same submission function with text, the selected allowlisted model ID, and the
thinking level. The app continues to reject an empty prompt and disables the
composer while sending or while a run is active. AI Elements' submit control
must display a non-interactive working state in this period. It must not show a
stop action, because Truss has no cancellation route.

`AiChatTranscript` continues to read the validated `ai-chat` feed, arrange
messages, and join a durable assistant work turn to the prompt that started it.
It keeps the initiator-only `DesignRunObserver` mounted for settlement, without
using that token as the source of visible shared activity. A collaborator who
opens the room later sees the same persisted activity and summary. The 315
second incomplete-state display rule still applies to abandoned running rows.

The conversation viewport must preserve the current scroll contract. A reader
who scrolls up stays in place while messages stream. A jump control returns to
the latest entry. Fetching older feed pages does not throw the reader to the
bottom. A new message follows automatically when the reader was already near
the bottom. The implementation should replace the custom scroll loop only if
`Conversation` meets all four behaviors in browser tests.

`AiRunTasks` maps each saved step group to an AI Elements Task. Action parts
remain text and file/detail chips. A saved reasoning part becomes a Reasoning
disclosure within its task. The current run phase determines the visible
status; color never carries that meaning alone. Exactly one live region
announces the active task. An error before any step still shows a clear outcome
line. Spec attachments stay after the assistant's answer, outside task details.

## Rendering and safety

The existing `lib/markdown-tokens.ts` plus `components/chat/response.tsx` path
is the current chat Markdown trust boundary. A migration to `MessageResponse`
must preserve raw HTML as text, reject dangerous links, add safe attributes to
external links, render code fences and tables, and keep partial Markdown stable
while text streams. Verify long and malformed messages as well as ordinary
ones. If AI Elements cannot meet one of these requirements cleanly, keep the
current renderer and use AI Elements for the surrounding message layout.

The panel uses the neutral page, surface, border, and copy tokens from
`context/ui-context.md`. Border Beam and Thinking Orbs retain their existing AI
accent. Generated defaults are overridden at composition sites so this remains
one coherent Truss panel. Loading and completion must have text or an icon as
well as any animation. Every animation respects `prefers-reduced-motion`.

The registered components are available now, but installation alone does not
change the live sidebar. The installed `Context` reads AI SDK 7 usage fields,
and the installed Base UI wrappers use the project's current event and hover
card APIs. Those compatibility changes have already passed typecheck, lint,
and a production build.

## Implementation slices and verification

1. Replace the composer and model picker. Keep the same prompt submission and
   error behavior. Verify Enter, Shift+Enter, empty text, disabled states,
   allowed models, thinking level, and the absence of a false stop action.
2. Replace the transcript viewport and message framing. Verify paging,
   streaming scroll, manual scroll-up, jump-to-latest, identity cues, and
   responsive panel width.
3. Move the work log to AI Elements Task, Shimmer, and Reasoning while preserving
   the current run grouping and status semantics. Check active, complete,
   error, incomplete, and no-step runs, including a reload on another client.
4. Evaluate `MessageResponse` against the current Markdown safety and partial
   streaming tests. Migrate only if it passes. Remove obsolete custom UI
   modules and dependencies only after their last consumer is gone.
5. Add Chain of Thought, Tool, and Context only where the existing data meets
   the component contract. If it does not, leave the components installed but
   unused and record the missing data requirement rather than adding fake UI.

Run typecheck, lint, unit verification, and a production build for changed
slices. Browser review covers the signed-in sidebar at desktop and narrow
width, keyboard navigation, reduced motion, and two-client shared activity.
Update `context/progress-tracker.md` after each implemented slice. The old
September 21 spec and plan remain historical records of the shipped version;
the implementation plan for this migration will be a new document.
