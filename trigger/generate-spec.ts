import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AbortTaskRunError, logger, metadata, schemaTask } from "@trigger.dev/sdk";
import { put } from "@vercel/blob";
import { generateText } from "ai";

import { publishAiStatus } from "@/lib/ai-activity";
import { resolveAiChatRunId } from "@/lib/ai-run-chat";
import { readCanvas, readChatHistory } from "@/lib/canvas-read";
import { getGoogleApiKey } from "@/lib/google-ai";
import { prisma } from "@/lib/prisma";
import { SPEC_SYSTEM_PROMPT, buildSpecPrompt } from "@/lib/spec-prompt";
import {
  SPEC_BLOB_ACCESS,
  SPEC_CONTENT_TYPE,
  specBlobPath,
  specFileName,
} from "@/lib/spec-storage";
import { specPayloadSchema, type SpecPayload } from "@/lib/spec-requests";
import { DEFAULT_AI_DESIGN_MODEL_ID } from "@/types/tasks";

/**
 * The model is the same default the design agent uses. A second constant would
 * be a second knob nobody turns — the scope limits rule out a new provider
 * abstraction, and spec writing is the same class of call.
 */
const SPEC_MODEL_ID = DEFAULT_AI_DESIGN_MODEL_ID;

/**
 * Higher than the orchestrator's `low`: a spec is prose reasoned over a whole
 * diagram, not a routing decision or two sentences of summary. Still a level
 * rather than a numeric budget — these are Gemini 3 models (see
 * `AI_DESIGN_MODELS`).
 */
const THINKING_LEVEL = "medium";

/**
 * Spec generation (27-spec-generation-flow).
 *
 * Reads the room's canvas and conversation, asks Gemini for a Markdown technical
 * spec, then stores it: the document in Vercel Blob, a `ProjectSpec` pointer in
 * Prisma (28-spec-persistence-download). Progress is published to the room's
 * shared AI status feed and mirrored onto run metadata.
 *
 * The graph used to arrive in the payload from the browser. It does not any more
 * (35-orchestrator-backend): this task reads the room itself, the same way the
 * design agent does. That is one less client-supplied description of a document
 * the server can read authoritatively, and it means a spec asked for straight
 * after a canvas edit describes the canvas as it *now* is rather than as it was
 * when the request was composed.
 *
 * Backend code triggers this by ID with a type-only import, never by importing
 * the task instance.
 */
export const generateSpec = schemaTask({
  id: "generate-spec",
  schema: specPayloadSchema,
  // Safe to retry, unlike the design agent: both writes are keyed on this run's
  // own ID (see `saveSpec`), so a second attempt replaces its predecessor rather
  // than adding a duplicate spec. Capped at two because each attempt is a paid
  // model call, not because it is unsafe.
  retry: { maxAttempts: 2 },
  // Longer than the orchestrator's 180s: a spec is several thousand output
  // tokens of prose, where a routing decision is a sentence.
  maxDuration: 300,
  run: async (payload: SpecPayload, { ctx }) => {
    const { projectId, roomId, promptMessageId, chatRunId, focus } = payload;
    const runId = ctx.run.id;

    metadata.set("kind", "spec").set("status", "started");

    await publishAiStatus(roomId, {
      kind: "spec",
      status: "started",
      runId,
      text: "Reading the canvas…",
    });

    try {
      // In parallel: neither read depends on the other, and both are pure reads
      // against the same room.
      const [context, history] = await Promise.all([
        readCanvas(roomId),
        readChatHistory(roomId, promptMessageId ?? "", resolveAiChatRunId(chatRunId, runId)),
      ]);

      logger.info("Spec requested", {
        projectId,
        nodes: context.nodes.length,
        edges: context.edges.length,
        chatMessages: history.length,
      });

      // Nothing to write about is a bad request, not a flaky one — retrying it
      // would spend two model calls arriving at the same empty answer.
      if (context.nodes.length === 0 && history.length === 0) {
        throw new AbortTaskRunError(
          "The canvas is empty and there is no conversation to write a spec from."
        );
      }

      metadata.set("status", "processing");

      await publishAiStatus(roomId, {
        kind: "spec",
        status: "processing",
        runId,
        text: "Writing the spec…",
      });

      const { text } = await generateText({
        model: createGoogleGenerativeAI({ apiKey: getGoogleApiKey() })(
          SPEC_MODEL_ID
        ),
        system: SPEC_SYSTEM_PROMPT,
        prompt: buildSpecPrompt({ context, history, focus }),
        providerOptions: {
          google: { thinkingConfig: { thinkingLevel: THINKING_LEVEL } },
        },
      });

      const markdown = stripCodeFence(text.trim());

      // An empty document is a failed run, not a successful one: the caller
      // would otherwise be handed "" to save as a spec.
      if (!markdown) {
        throw new Error("The model returned an empty spec");
      }

      logger.info("Spec generated", { projectId, characters: markdown.length });

      // Stored before the room is told the spec is ready: "complete" is what the
      // UI lists specs on, so publishing it ahead of the write would advertise a
      // document that is not retrievable yet — or at all, if the write fails.
      const saved = await saveSpec(projectId, runId, markdown);

      logger.info("Spec saved", { projectId, specId: runId });
      metadata.set("status", "complete");

      await publishAiStatus(roomId, {
        kind: "spec",
        status: "complete",
        runId,
        text: "Spec ready.",
      });

      // The blob URL is deliberately not returned. It is a private pointer the
      // download route resolves with the store token, and the run output is
      // readable by the initiating browser — which has no use for one it cannot
      // fetch. `specId` is what a download URL is built from, and `fileName` is
      // what the orchestrator attaches to the transcript.
      return { markdown, specId: runId, fileName: saved.fileName };
    } catch (error: unknown) {
      logger.error("Spec generation failed", {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });

      metadata.set("status", "error");

      await publishAiStatus(roomId, {
        kind: "spec",
        status: "error",
        runId,
        text: "Spec generation failed.",
      });

      throw error;
    }
  },
});

/**
 * Stores the document, then the pointer to it, and answers with the name the
 * document saves under.
 *
 * Blob first, row second — the same order as the canvas route, for the same
 * reason: a `ProjectSpec` written ahead of the upload would advertise an
 * artifact that does not exist.
 *
 * `specId` is the run ID. An ID has to exist before the upload because it names
 * the blob, and reusing the run's own is what makes a retry idempotent: attempt
 * two overwrites its own blob and upserts its own row, instead of leaving an
 * orphaned document and a second spec behind. `allowOverwrite` is scoped to
 * exactly that case — no other run can produce this pathname.
 *
 * This runs in the worker rather than behind a route the browser calls back
 * into: the spec exists whether or not the initiating tab is still open, and a
 * client-supplied "here is the spec I generated" endpoint would be a way to
 * write arbitrary Markdown into someone's project.
 */
async function saveSpec(
  projectId: string,
  specId: string,
  markdown: string
): Promise<{ fileName: string }> {
  const blob = await put(specBlobPath(projectId, specId), markdown, {
    access: SPEC_BLOB_ACCESS,
    contentType: SPEC_CONTENT_TYPE,
    allowOverwrite: true,
    addRandomSuffix: false,
  });

  const row = await prisma.projectSpec.upsert({
    where: { id: specId },
    create: { id: specId, projectId, filePath: blob.url },
    update: { filePath: blob.url },
  });

  // Named from the stored row's own `createdAt` by the same helper the download
  // route puts in `Content-Disposition`, so the name in the transcript is the
  // name the file saves under rather than a second guess at it.
  return { fileName: specFileName(row.createdAt) };
}

/**
 * The system prompt forbids a wrapping code fence, and the models mostly obey —
 * but "mostly" would put ```markdown into a saved spec, so the fence is removed
 * here instead of being trusted away.
 */
function stripCodeFence(text: string): string {
  const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n?```$/.exec(text);

  return fenced ? fenced[1].trim() : text;
}
