import Link from "next/link"
import { Lock } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"

/**
 * Shown for both a missing project and one this user may not open — the two are
 * indistinguishable on purpose (see getAccessibleProject).
 */
export function AccessDenied() {
  return (
    <main className="flex flex-1 items-center justify-center bg-page px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-surface-border bg-surface">
          <Lock className="h-6 w-6 text-copy-muted" />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-medium tracking-tight text-copy-primary">
            You don&apos;t have access to this project
          </h1>
          <p className="text-sm text-copy-muted">
            It may have been deleted, or the owner hasn&apos;t shared it with
            you.
          </p>
        </div>

        {/* Styled Link, not <Button>: base-ui's Button takes `render`, not
            `asChild`, and a plain anchor keeps this a Server Component. */}
        <Link
          href="/editor"
          className={buttonVariants({ variant: "outline", className: "mt-2" })}
        >
          Back to projects
        </Link>
      </div>
    </main>
  )
}
