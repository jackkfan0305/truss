"use client"

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react"

import { cn } from "@/lib/utils"

const KEY_STEP = 16

/**
 * Drag handle on a sidebar's inner edge. The width lives in a CSS variable on
 * <html> (defaults in globals.css), so the navbar can follow it, and in
 * localStorage, so it survives a reload.
 */
export function SidebarResizeHandle({
  side,
  cssVar,
  min,
  max,
  label,
}: {
  /** Which edge of the window the sidebar hugs. */
  side: "left" | "right"
  cssVar: string
  min: number
  max: number
  label: string
}) {
  const storageKey = `truss.sidebar-width.${cssVar}`
  const ref = useRef<HTMLDivElement>(null)

  function apply(next: number) {
    const clamped = Math.round(Math.min(max, Math.max(min, next)))
    document.documentElement.style.setProperty(cssVar, `${clamped}px`)
    ref.current?.setAttribute("aria-valuenow", String(clamped))
    try {
      window.localStorage.setItem(storageKey, String(clamped))
    } catch {}
  }

  useEffect(() => {
    let saved: number | null = null
    try {
      saved = Number(window.localStorage.getItem(storageKey)) || null
    } catch {}
    if (saved) apply(saved)
    // Mount only: apply is recreated each render but reads nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const aside = event.currentTarget.parentElement!.getBoundingClientRect()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    // Turns off transitions (globals.css) so the navbar keeps up with the drag.
    document.documentElement.dataset.resizing = ""

    const onMove = (move: globalThis.PointerEvent) =>
      apply(side === "left" ? move.clientX - aside.left : aside.right - move.clientX)
    const onUp = () => {
      delete document.documentElement.dataset.resizing
      handle.removeEventListener("pointermove", onMove)
      handle.removeEventListener("pointerup", onUp)
      handle.removeEventListener("pointercancel", onUp)
    }
    handle.addEventListener("pointermove", onMove)
    handle.addEventListener("pointerup", onUp)
    handle.addEventListener("pointercancel", onUp)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft"
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight"
    if (event.key !== grow && event.key !== shrink) return
    event.preventDefault()
    const current = event.currentTarget.parentElement!.getBoundingClientRect().width
    apply(current + (event.key === grow ? KEY_STEP : -KEY_STEP))
  }

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute inset-y-0 z-10 hidden w-2 cursor-col-resize touch-none outline-none md:block",
        side === "left" ? "right-0" : "left-0"
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 w-0.5 bg-transparent transition-colors group-hover:bg-copy-faint group-focus-visible:bg-copy-faint",
          side === "left" ? "right-0" : "left-0"
        )}
      />
    </div>
  )
}
