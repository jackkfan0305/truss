interface AuthPanelProps {
  children: React.ReactNode;
}

const FEATURES = [
  "Real-time collaborative canvas",
  "AI-generated architecture from a prompt",
  "Markdown specs straight from the graph",
] as const;

/**
 * Two-panel auth shell: context on the left, Clerk form on the right.
 * Below `lg` the left panel is dropped entirely and only the form renders.
 *
 * The left column is a three-part editorial stack — wordmark, statement,
 * footnote — rather than a single centred block, so the panel reads as a
 * composed page instead of text floating in a void.
 */
export function AuthPanel({ children }: AuthPanelProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-surface-border bg-surface px-14 py-14 lg:flex">
        <div
          aria-hidden
          className="surface-dot-grid pointer-events-none absolute inset-0 opacity-50"
        />

        <div className="relative motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
          <span className="font-mono text-sm tracking-tight text-copy-primary">
            truss
          </span>
        </div>

        <div className="relative flex flex-col gap-12 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          <h2 className="max-w-[14ch] text-[clamp(2.25rem,3.4vw,3.25rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-copy-primary">
            Describe a system. Watch it take shape.
          </h2>

          <ol className="flex flex-col gap-4">
            {FEATURES.map((feature, index) => (
              <li key={feature} className="flex items-baseline gap-4">
                <span className="font-mono text-xs tabular-nums text-copy-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm text-copy-secondary">{feature}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="relative text-xs text-copy-muted">
        </p>
      </aside>

      {/*
        Clerk's card has a fixed 335px min-width, so `px-6` (48px) overflows a
        375px viewport by 8px. `px-4` keeps it inside without touching Clerk's
        internals. Viewports narrower than ~367px still overflow — that floor is
        Clerk's, not ours.
      */}
      <main className="flex items-center justify-center px-4 py-12 sm:px-6">
        {children}
      </main>
    </div>
  );
}
