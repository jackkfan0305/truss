import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AbortTaskRunError, logger, metadata, schemaTask } from "@trigger.dev/sdk";
import { put } from "@vercel/blob";
import { generateText } from "ai";

import { publishAiStatus } from "@/lib/ai-activity";
import { getGoogleApiKey } from "@/lib/google-ai";
import { prisma } from "@/lib/prisma";
import {
  SPEC_BLOB_ACCESS,
  SPEC_CONTENT_TYPE,
  specBlobPath,
} from "@/lib/spec-storage";
import {
  specPayloadSchema,
  type SpecEdge,
  type SpecNode,
  type SpecPayload,
} from "@/lib/spec-requests";
import { DEFAULT_AI_DESIGN_MODEL_ID } from "@/types/tasks";

/**
 * The model is the same default the design agent uses. A second constant would
 * be a second knob nobody turns — the scope limits rule out a new provider
 * abstraction, and spec writing is the same class of call.
 */
const SPEC_MODEL_ID = DEFAULT_AI_DESIGN_MODEL_ID;

/**
 * Higher than the design agent's `low`: a spec is prose reasoned over a whole
 * diagram, not a handful of canvas edits. Still a level rather than a numeric
 * budget — these are Gemini 3 models (see `AI_DESIGN_MODELS`).
 */
const THINKING_LEVEL = "medium";

const SYSTEM_PROMPT = [
  "You are a staff engineer writing the technical specification for a system that a team has diagrammed on a shared canvas.",
  "",
  "Write the spec in Markdown, and return only the Markdown document — no preamble, no commentary, and no surrounding code fence.",
  "",
  "Structure it as:",
  "# <System name>",
  "## Overview — what the system is for, in a short paragraph.",
  "## Architecture — the components from the canvas and how they fit together.",
  "## Components — one subsection per significant node: responsibility, inputs, outputs.",
  "## Data Flow — the paths through the system, following the canvas connections.",
  "## Interfaces & Integrations — boundaries with external systems.",
  "## Open Questions & Risks — what the canvas and conversation leave undecided.",
  "",
  "Node shapes carry meaning: rectangle is a general component, diamond a decision or gateway,",
  "circle an event or endpoint, pill a service or process, cylinder a datastore, hexagon an external system.",
  "",
  "Describe the system the canvas and conversation actually show. Where they are silent, say so under",
  "Open Questions rather than inventing a component, a technology choice, or a requirement.",
].join("\n");

/**
 * Spec generation (27-spec-generation-flow).
 *
 * Reads the canvas graph and chat context the route passed through, asks Gemini
 * for a Markdown technical spec, then stores it: the document in Vercel Blob, a
 * `ProjectSpec` pointer in Prisma (28-spec-persistence-download). Progress is
 * published to the room's shared AI status feed and mirrored onto run metadata,
 * which is what the initiating client subscribes to over its run-scoped token.
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
  // Longer than the design agent's 180s: a spec is several thousand output
  // tokens of prose, where a design plan is a short structured object.
  maxDuration: 300,
  run: async (payload: SpecPayload, { ctx }) => {
    const { projectId, roomId, nodes, edges, chatHistory } = payload;
    const runId = ctx.run.id;

    logger.info("Spec requested", {
      projectId,
      nodes: nodes.length,
      edges: edges.length,
      chatMessages: chatHistory.length,
    });

    // Nothing to write about is a bad request, not a flaky one — retrying it
    // would spend two model calls arriving at the same empty answer.
    if (nodes.length === 0 && chatHistory.length === 0) {
      throw new AbortTaskRunError(
        "The canvas is empty and there is no conversation to write a spec from."
      );
    }

    metadata.set("kind", "spec").set("status", "started");

    await publishAiStatus(roomId, {
      kind: "spec",
      status: "started",
      runId,
      text: "Reading the canvas…",
    });

    try {
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
        system: SYSTEM_PROMPT,
        prompt: describeSpecInput(payload),
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
      const filePath = await saveSpec(projectId, runId, markdown);

      logger.info("Spec saved", { projectId, specId: runId, filePath });
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
      // fetch. `specId` is what a download URL is built from.
      return { markdown, specId: runId };
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
 * Stores the document, then the pointer to it, and answers with the blob URL.
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
): Promise<string> {
  const blob = await put(specBlobPath(projectId, specId), markdown, {
    access: SPEC_BLOB_ACCESS,
    contentType: SPEC_CONTENT_TYPE,
    allowOverwrite: true,
    addRandomSuffix: false,
  });

  await prisma.projectSpec.upsert({
    where: { id: specId },
    create: { id: specId, projectId, filePath: blob.url },
    update: { filePath: blob.url },
  });

  return blob.url;
}

/** The canvas and the conversation as text the model can reason about. */
function describeSpecInput({ nodes, edges, chatHistory }: SpecPayload): string {
  const sections = [
    "Canvas components:",
    nodes.map(describeNode).join("\n") || "- none",
    "",
    "Canvas connections:",
    edges.map((edge) => describeEdge(edge, nodes)).join("\n") || "- none",
  ];

  if (chatHistory.length > 0) {
    sections.push(
      "",
      "Conversation about this system, oldest first:",
      chatHistory
        .map((message) => `- ${message.role}: ${message.content}`)
        .join("\n")
    );
  }

  sections.push("", "Write the technical specification for this system.");

  return sections.join("\n");
}

function describeNode(node: SpecNode): string {
  const name = node.data.label || node.id;
  const shape = node.data.shape ? ` (${node.data.shape})` : "";

  return `- ${name}${shape}`;
}

/**
 * Connections are named by label, not by node ID: the model is writing prose
 * about components, so a dangling edge into a deleted node is described as
 * "unknown" rather than leaking a slug into the document.
 */
function describeEdge(edge: SpecEdge, nodes: readonly SpecNode[]): string {
  const label = edge.data.label ? ` — ${edge.data.label}` : "";

  return `- ${nameOf(edge.source)} -> ${nameOf(edge.target)}${label}`;

  function nameOf(id: string): string {
    const node = nodes.find((candidate) => candidate.id === id);

    return node?.data.label || node?.id || "unknown";
  }
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
