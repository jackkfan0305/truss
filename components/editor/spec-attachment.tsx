"use client"

import { useState } from "react"
import { Check, CircleAlert, Copy, Download, FileText, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { useHydrated } from "@/hooks/use-hydrated"
import { specDownloadHref, useSpecContent } from "@/hooks/use-project-specs"
import { MARKDOWN_STYLES, renderChatMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import type { SpecAttachmentRef } from "@/lib/spec-attachments"

/**
 * A generated spec, attached to the turn that wrote it (36-spec-attachment).
 *
 * There is no Specs tab any more. A spec is the *result* of a conversation, so
 * it lives in the conversation — the transcript is already the shared, durable,
 * multiplayer record of what the agent did, and a second list beside it was a
 * separate place to remember to look.
 *
 * No new persistence: the Markdown is already in Vercel Blob, the pointer is
 * already a `ProjectSpec` row, and both the preview and the download read the
 * one authorized download route, so the private Blob store is never addressed
 * from the browser.
 */

interface SpecAttachmentListProps {
  attachments: readonly SpecAttachmentRef[]
  projectId: string
  /** The turn's own timestamp — a document is dated by the turn that made it. */
  sentAt: number
}

/**
 * Rendered *outside* the collapsed work-log disclosure, beneath the assistant's
 * closing message: a document is the outcome of the turn, not a step within it,
 * and a reader should not have to expand a work log to find one.
 */
export function SpecAttachmentList({
  attachments,
  projectId,
  sentAt,
}: SpecAttachmentListProps) {
  // Only the ID is held. The Markdown lives in the preview hook, which drops it
  // when the dialog closes rather than accumulating documents in the transcript.
  const [openSpecId, setOpenSpecId] = useState<string | null>(null)
  const openSpec = attachments.find((spec) => spec.specId === openSpecId) ?? null

  if (attachments.length === 0) return null

  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {attachments.map((spec) => (
          <li
            key={spec.specId}
            /*
             * A row is two controls, not one: the body opens the preview and the
             * trailing link downloads. Nesting an anchor inside the button would
             * be invalid markup and unreachable by keyboard, so they are
             * siblings sharing one hover surface.
             */
            className="flex items-center gap-1 rounded-xl border border-surface-border bg-page pr-1 transition-colors hover:bg-elevated has-focus-visible:border-copy-primary"
          >
            <button
              type="button"
              onClick={() => setOpenSpecId(spec.specId)}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left outline-none"
            >
              <FileText aria-hidden className="size-4 shrink-0 text-copy-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-copy-primary">
                  {spec.fileName}
                </span>
                <SpecTimestamp sentAt={sentAt} className="text-copy-muted" />
              </span>
            </button>
            <DownloadAction spec={spec} projectId={projectId} />
          </li>
        ))}
      </ul>

      {/*
       * Escape, the backdrop, focus trapping and restore all come from the Base
       * UI dialog primitive; the header's close button is the visible
       * affordance.
       */}
      <Dialog
        open={openSpec !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpenSpecId(null)
        }}
      >
        {/* The body mounts with the open spec and unmounts with it, which is
            what discards the document — nothing here holds Markdown between
            opens. */}
        {openSpec ? (
          <SpecPreviewBody
            projectId={projectId}
            spec={openSpec}
            sentAt={sentAt}
          />
        ) : null}
      </Dialog>
    </>
  )
}

function SpecPreviewBody({
  projectId,
  spec,
  sentAt,
}: {
  projectId: string
  spec: SpecAttachmentRef
  sentAt: number
}) {
  const { markdown, isLoading, error } = useSpecContent(projectId, spec.specId)

  return (
    /*
     * Grid rows, not a flex column. The ScrollArea primitive sizes its viewport
     * with `h-full`, and a percentage height resolves to `auto` inside a flex
     * item — the document then rendered at full height straight out of the
     * modal. A `minmax(0,1fr)` track is definite, so the viewport gets a real
     * height to scroll inside.
     */
    <DialogContent className="grid max-h-[min(42rem,calc(100dvh-4rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-3xl border border-surface-border bg-surface p-5 sm:max-w-2xl">
      <DialogHeader className="pr-8">
        <DialogTitle className="text-copy-primary">{spec.fileName}</DialogTitle>
        <DialogDescription className="text-copy-muted">
          <SpecTimestamp sentAt={sentAt} prefix="Generated " />
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="-mr-2 min-h-0 pr-2">
        {isLoading ? (
          <p className="flex items-center gap-2 text-xs text-copy-muted">
            <Loader2 aria-hidden className="size-3.5 motion-safe:animate-spin" />
            Loading spec…
          </p>
        ) : error ? (
          <p
            role="alert"
            className="flex items-center gap-2 text-xs text-copy-primary"
          >
            <CircleAlert aria-hidden className="size-3.5" />
            {error}
          </p>
        ) : markdown ? (
          /*
           * Safe for exactly one reason: `lib/markdown.ts` runs markdown-it
           * with `html: false`, so raw HTML in a document is escaped into
           * visible text rather than parsed. That file is the sanitizer, and
           * this content is model-authored — read it before changing this.
           */
          <div
            className={cn(
              "wrap-anywhere text-sm leading-relaxed text-copy-primary",
              MARKDOWN_STYLES,
              // A document, unlike a chat message, has hierarchy worth seeing.
              "[&_h1]:mt-0 [&_h1]:mb-2 [&_h1]:text-base [&_h2]:mt-5 [&_h2]:text-sm [&_h3]:mt-4"
            )}
            dangerouslySetInnerHTML={{ __html: renderChatMarkdown(markdown) }}
          />
        ) : null}
      </ScrollArea>

      <div className="flex justify-end gap-1 border-t border-surface-border pt-3">
        {/* Only once there is a document to copy — a button that would put an
            error message or an empty string on the clipboard is worse than no
            button. */}
        {markdown ? <CopyAction markdown={markdown} /> : null}
        <DownloadAction spec={spec} projectId={projectId} withLabel />
      </div>
    </DialogContent>
  )
}

/**
 * Copies the spec's Markdown source, not the rendered HTML.
 *
 * The document is Markdown everywhere else it exists — in Blob, in the
 * download, in the model's output — so pasting it into an editor or an issue
 * should reproduce it, not a flattened copy of what the dialog happens to look
 * like.
 */
function CopyAction({ markdown }: { markdown: string }) {
  const { status, copy } = useCopyToClipboard()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void copy(markdown)}
      className="shrink-0 text-copy-muted hover:bg-subtle hover:text-copy-primary focus-visible:border-copy-primary focus-visible:ring-copy-primary/20"
    >
      {status === "copied" ? (
        <Check aria-hidden className="size-3.5 text-state-success" />
      ) : status === "error" ? (
        <CircleAlert aria-hidden className="size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
      {/* The label carries the outcome, so a screen reader hears the change
          rather than only seeing a swapped icon. */}
      {status === "copied"
        ? "Copied!"
        : status === "error"
          ? "Press Ctrl+C"
          : "Copy"}
    </Button>
  )
}

/**
 * A plain link to the download route. `download` names the saved file, and the
 * route sets `Content-Disposition` anyway — the browser does the saving, so
 * nothing here reads the body or juggles an object URL.
 */
function DownloadAction({
  spec,
  projectId,
  withLabel = false,
}: {
  spec: SpecAttachmentRef
  projectId: string
  withLabel?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size={withLabel ? "sm" : "icon-sm"}
      // Base UI assumes a native <button> and warns otherwise: this one renders
      // an anchor, because a download is a link, not a button that fetches.
      nativeButton={false}
      className="shrink-0 text-copy-muted hover:bg-subtle hover:text-copy-primary focus-visible:border-copy-primary focus-visible:ring-copy-primary/20"
      render={
        <a
          href={specDownloadHref(projectId, spec.specId)}
          download={spec.fileName}
          aria-label={withLabel ? undefined : `Download ${spec.fileName}`}
        />
      }
    >
      <Download aria-hidden className="size-3.5" />
      {withLabel ? "Download" : null}
    </Button>
  )
}

/**
 * A spec's timestamp, in the reader's own locale and timezone.
 *
 * Formatted after mount rather than during render. In practice this only ever
 * renders client-side — the transcript comes from a Liveblocks subscription —
 * but "there is no server render to mismatch" is a fact about the *caller*, and
 * a component is not the place to depend on one. Formatting in an effect makes
 * it true here regardless of who renders it.
 *
 * The ISO date shows until then: unambiguous, identical on both sides, and the
 * same width class as the real thing so nothing jumps when it lands.
 */
function SpecTimestamp({
  sentAt,
  prefix = "",
  className,
}: {
  sentAt: number
  prefix?: string
  className?: string
}) {
  const isHydrated = useHydrated()
  const iso = new Date(sentAt).toISOString()

  return (
    <time dateTime={iso} className={cn("block text-xs", className)}>
      {prefix}
      {isHydrated ? formatSpecTimestamp(sentAt) : iso.slice(0, 10)}
    </time>
  )
}

/**
 * Called only once `useHydrated` reports the browser is rendering, so
 * `undefined` here resolves to the *reader's* locale and timezone rather than
 * whatever the server happens to run in.
 */
function formatSpecTimestamp(sentAt: number): string {
  return new Date(sentAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}
