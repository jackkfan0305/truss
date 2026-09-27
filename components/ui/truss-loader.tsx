import { cn } from "@/lib/utils"

interface TrussLoaderProps {
  /** Read by screen readers and shown under the mark. */
  label: string
  /** Optional heading above the label, such as the diagram being opened. */
  title?: string
  className?: string
}

/** Joints of the triangle, with the delay at which each one lights up. */
const JOINTS = [
  { x: 24, y: 9, delay: "-0.3s" },
  { x: 40, y: 37, delay: "0.15s" },
  { x: 8, y: 37, delay: "0.55s" },
] as const

/** Edges drawn in order, each starting where the previous one ended. */
const EDGES = [
  { d: "M24 9 L40 37", delay: "0s" },
  { d: "M40 37 L8 37", delay: "0.4s" },
  { d: "M8 37 L24 9", delay: "0.8s" },
] as const

/**
 * The app's loading state: a truss triangle that draws itself edge by edge,
 * the way the agent builds a diagram. Keyframes live in app/globals.css.
 */
export function TrussLoader({ label, title, className }: TrussLoaderProps) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center gap-4", className)}
    >
      <svg
        viewBox="0 0 48 48"
        aria-hidden
        className="truss-loader size-12 text-copy-secondary"
      >
        {EDGES.map((edge) => (
          <path
            key={edge.d}
            d={edge.d}
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="truss-loader-edge"
            style={{ animationDelay: edge.delay }}
          />
        ))}
        {JOINTS.map((joint) => (
          <rect
            key={`${joint.x}-${joint.y}`}
            x={joint.x - 3.5}
            y={joint.y - 3.5}
            width={7}
            height={7}
            rx={2}
            stroke="currentColor"
            strokeWidth={1.5}
            className="truss-loader-joint"
            style={{ animationDelay: joint.delay }}
          />
        ))}
      </svg>
      <div className="flex flex-col items-center gap-1 text-center">
        {title ? (
          <p className="text-base font-medium tracking-tight text-copy-primary">
            {title}
          </p>
        ) : null}
        <p className="text-sm text-copy-muted">{label}</p>
      </div>
    </div>
  )
}
