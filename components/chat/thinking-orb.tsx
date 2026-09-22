"use client"

import { ThinkingOrb as ThinkingOrbCanvas, type OrbState } from "thinking-orbs"

import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { cn } from "@/lib/utils"

export interface ThinkingOrbProps {
  state: OrbState
  /** The package ships exactly two tuned presets; they are separate designs. */
  size: 64 | 20
  /** What the orb is saying, for a reader who cannot see it. */
  label: string
  className?: string
}

/**
 * The thinking orb, bound to this app's accent and motion preference.
 *
 * `ui-context.md` keeps the sidechat monochrome with one exception, and this
 * is half of it: the canvas itself renders the package's own light ink, and
 * the `--accent-ai` bloom sits *behind* it. The orb annotates a state that the
 * running task already states in words, so nothing here is the only carrier of
 * meaning.
 *
 * `paused` rather than unmounting under reduced motion: the orb is still the
 * shape that says "working", and freezing it keeps that without the movement.
 */
export function ThinkingOrb({ state, size, label, className }: ThinkingOrbProps) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full blur-md"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent-ai) 40%, transparent) 0%, transparent 70%)",
        }}
      />
      <ThinkingOrbCanvas
        state={state}
        size={size}
        // The app is dark only, so the palette is pinned rather than detected.
        theme="dark"
        paused={prefersReducedMotion}
        role="img"
        aria-label={label}
        className="relative"
      />
    </span>
  )
}
