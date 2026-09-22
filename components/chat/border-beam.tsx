"use client"

import type { ReactNode } from "react"
import { BorderBeam } from "border-beam"

import { useReducedMotion } from "@/hooks/use-reduced-motion"

/**
 * The composer's border, lit while a run is in flight.
 *
 * The other half of the sidechat's accent exception. It decorates a state the
 * working indicator and the running task already state in words, so a reader
 * who cannot see it loses nothing.
 *
 * `ocean` rather than the `mono` the design named: `mono` is a set of baked
 * grayscale stops filtered with hue-rotate and saturate, and no amount of
 * either turns grayscale into a colour — the package exposes no colour
 * override. `ocean`'s lead stop is rgba(100, 80, 220) against --accent-ai's
 * rgb(100, 87, 249), so this is the AI accent rather than a second palette.
 * `staticColors` stops the hue cycle, which is what would have made it one.
 *
 * Forced off under reduced motion: the beam travels, and a traveling glow is
 * exactly the kind of motion that preference is asking not to see.
 */
export function ComposerBeam({
  isActive,
  children,
}: {
  isActive: boolean
  children: ReactNode
}) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <BorderBeam
      size="md"
      colorVariant="ocean"
      theme="dark"
      staticColors
      active={isActive && !prefersReducedMotion}
    >
      {children}
    </BorderBeam>
  )
}
