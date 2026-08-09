"use client"

import { useState } from "react"
import { CircleAlert, Download, FileText, Loader2 } from "lucide-react"

import { MARKDOWN_STYLES } from "@/lib/markdown"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  specDownloadHref,
  useProjectSpecs,
  useSpecContent,
} from "@/hooks/use-project-specs"
import { renderChatMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import type { ProjectSpecSummary } from "@/types/project"

/**
 * The Specs tab's list, preview and download (29-spec-ui-integration).
 *
 * Wiring, not new plumbing: the list comes from the project-scoped specs route
 * and both the preview and the download read the one download route, so the
 * private Blob store is never addressed from the browser.
 */
export function SpecPanel({ projectId }: { projectId: string }) {
  const { specs, isLoading, error } = useProjectSpecs(projectId)

  // Only the ID is held. The Markdown lives in the preview hook, which drops it
  // when the dialog closes rather than accumulating documents in the panel.
  const [openSpecId, setOpenSpecId] = useState<string | null>(null)
  const openSpec = specs.find((spec) => spec.id === openSpecId) ?? null

  return (
    <>
      {/* Sized by the tab panel's grid row for the same reason the preview is. */}
      <ScrollArea className="-mx-1 min-h-0">
        {isLoading ? (
          <p className="flex items-center gap-2 px-1 text-xs text-copy-muted">
            <Loader2
              aria-hidden
              className="size-3.5 motion-safe:animate-spin"
            />
            Loading specs…
          </p>
        ) : error ? (
          <p
            role="alert"
            className="flex items-center gap-2 px-1 text-xs text-copy-primary"
          >
            <CircleAlert aria-hidden className="size-3.5" />
            {error}
          </p>
        ) : specs.length === 0 ? (
          <p className="px-1 text-xs leading-relaxed text-copy-muted">
            No specs yet. Generate one and it will appear here, ready to preview
            or download.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 px-1">
            {specs.map((spec) => (
              <SpecRow
                key={spec.id}
                spec={spec}
                projectId={projectId}
                onOpen={() => setOpenSpecId(spec.id)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>

      <SpecPreviewDialog
        projectId={projectId}
        spec={openSpec}
        onClose={() => setOpenSpecId(null)}
      />
    </>
  )
}

/**
 * A row is two controls, not one: the body opens the preview and the trailing
 * link downloads. Nesting an anchor inside the button would be invalid markup
 * and unreachable by keyboard, so they are siblings sharing one hover surface.
 */
function SpecRow({
  spec,
  projectId,
  onOpen,
}: {
  spec: ProjectSpecSummary
  projectId: string
  onOpen: () => void
}) {
  return (
    <li className="flex items-center gap-1 rounded-xl border border-surface-border bg-page pr-1 transition-colors hover:bg-elevated has-focus-visible:border-copy-primary">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left outline-none"
      >
        <FileText aria-hidden className="size-4 shrink-0 text-copy-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-copy-primary">
            {spec.fileName}
          </span>
          <SpecTimestamp
            createdAt={spec.createdAt}
            className="text-copy-muted"
          />
        </span>
      </button>
      <DownloadAction spec={spec} projectId={projectId} />
    </li>
  )
}

function SpecPreviewDialog({
  projectId,
  spec,
  onClose,
}: {
  projectId: string
  spec: ProjectSpecSummary | null
  onClose: () => void
}) {
  return (
    /*
     * Escape, the backdrop, focus trapping and restore all come from the Base UI
     * dialog primitive; the header's close button is the visible affordance.
     */
    <Dialog
      open={spec !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      {/* The body mounts with the open spec and unmounts with it, which is what
          discards the document — nothing here holds Markdown between opens. */}
      {spec ? <SpecPreviewBody projectId={projectId} spec={spec} /> : null}
    </Dialog>
  )
}

function SpecPreviewBody({
  projectId,
  spec,
}: {
  projectId: string
  spec: ProjectSpecSummary
}) {
  const { markdown, isLoading, error } = useSpecContent(projectId, spec.id)

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
          <SpecTimestamp createdAt={spec.createdAt} prefix="Generated " />
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="-mr-2 min-h-0 pr-2">
        {isLoading ? (
          <p className="flex items-center gap-2 text-xs text-copy-muted">
            <Loader2
              aria-hidden
              className="size-3.5 motion-safe:animate-spin"
            />
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
              "[&_h1]:mt-0 [&_h1]:mb-2 [&_h1]:text-base [&_h2]:mt-5 [&_h2]:text-sm [&_h3]:mt-4",
            )}
            dangerouslySetInnerHTML={{ __html: renderChatMarkdown(markdown) }}
          />
        ) : null}
      </ScrollArea>

      <div className="flex justify-end border-t border-surface-border pt-3">
        <DownloadAction spec={spec} projectId={projectId} withLabel />
      </div>
    </DialogContent>
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
  spec: ProjectSpecSummary
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
          href={specDownloadHref(projectId, spec.id)}
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
 * Client-rendered from a list the browser fetched, so the locale string cannot
 * mismatch a server render.
 */
function SpecTimestamp({
  createdAt,
  prefix = "",
  className,
}: {
  createdAt: string
  prefix?: string
  className?: string
}) {
  const date = new Date(createdAt)

  return (
    <time dateTime={createdAt} className={cn("block text-xs", className)}>
      {prefix}
      {date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}
    </time>
  )
}
