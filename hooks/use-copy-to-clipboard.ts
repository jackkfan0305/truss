"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** How long the confirmation stays up before the button reverts. */
export const COPIED_FEEDBACK_MS = 2000

export type CopyStatus = "idle" | "copied" | "error"

export interface CopyToClipboard {
  status: CopyStatus
  /** Writes `text` and shows the outcome for `COPIED_FEEDBACK_MS`. */
  copy: (text: string) => Promise<void>
}

/**
 * Copy-to-clipboard with self-clearing feedback.
 *
 * A hook rather than a pattern to re-type, because the part that gets forgotten
 * is not the `writeText` — it is the timeout. A copy button whose component
 * unmounts before the two seconds elapse (the spec preview closes on Escape,
 * routinely) leaves a timer holding a setter for a component that is gone.
 * Clearing it on unmount and before each re-arm lives here once.
 *
 * A failed write is a state, never a throw. `navigator.clipboard` rejects on an
 * insecure origin and when the permission is denied, and a button that silently
 * does nothing reads as a broken button — the caller renders `"error"` so the
 * reader knows to select the text themselves.
 */
export function useCopyToClipboard(): CopyToClipboard {
  const [status, setStatus] = useState<CopyStatus>("idle")
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const copy = useCallback(async (text: string) => {
    let next: CopyStatus = "copied"

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      next = "error"
    }

    setStatus(next)

    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setStatus("idle"), COPIED_FEEDBACK_MS)
  }, [])

  return { status, copy }
}
