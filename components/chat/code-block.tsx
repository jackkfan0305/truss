"use client"

import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { cn } from "@/lib/utils"

export interface CodeBlockProps {
  code: string
  /** The fence's info string, or undefined for a bare fence. */
  language?: string
  showLineNumbers?: boolean
  className?: string
}

/**
 * A fenced block with its own scroll and a copy control.
 *
 * Its own horizontal scroll rather than the panel's: a long line of code in a
 * 26rem sidebar would otherwise widen the whole transcript, and every message
 * beside it would scroll sideways with it.
 *
 * The copy control reuses `useCopyToClipboard` — the timeout that clears the
 * confirmation is the part that gets forgotten, and it lives in that hook
 * once.
 */
export function CodeBlock({
  code,
  language,
  showLineNumbers = false,
  className,
}: CodeBlockProps) {
  const { status, copy } = useCopyToClipboard()
  // A fence's content carries its trailing newline; that newline is not a line.
  const lines = code.replace(/\n$/, "").split("\n")

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-xl border border-surface-border bg-elevated",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-surface-border px-3 py-1.5">
        {/* A failed copy replaces the language rather than being an icon swap
            nobody sees: a control that silently does nothing reads as broken. */}
        {status === "error" ? (
          <span className="truncate text-xs text-copy-primary">
            Clipboard access failed
          </span>
        ) : (
          <span className="truncate font-mono text-xs text-copy-muted">
            {language || "text"}
          </span>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void copy(code)}
          aria-label={
            status === "copied"
              ? "Copied"
              : status === "error"
                ? "Retry copying code"
                : "Copy code"
          }
          className="shrink-0 text-copy-muted hover:bg-subtle hover:text-copy-primary focus-visible:border-copy-primary focus-visible:ring-copy-primary/20"
        >
          {status === "copied" ? (
            <Check aria-hidden className="size-3" />
          ) : (
            <Copy aria-hidden className="size-3" />
          )}
        </Button>
      </div>

      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className="font-mono text-copy-primary">
          {showLineNumbers
            ? lines.map((line, index) => (
                <span key={index} className="grid grid-cols-[2ch_1fr] gap-3">
                  <span aria-hidden className="text-right text-copy-faint">
                    {index + 1}
                  </span>
                  <span>{line}</span>
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  )
}
