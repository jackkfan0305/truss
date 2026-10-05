"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { TrussLoader } from "@/components/ui/truss-loader"
import {
  completeConnect,
  OPENROUTER_KEY_CHANGE_EVENT,
  OpenRouterConnectError,
} from "@/lib/openrouter-auth"

export function OpenRouterCallback({ code }: { code: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  // Strict Mode runs effects twice. The verifier is single-use, so a second
  // exchange would replace a successful connect with an "expired" error.
  const hasStarted = useRef(false)

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true

    completeConnect(code).then(
      (returnTo) => {
        window.dispatchEvent(new Event(OPENROUTER_KEY_CHANGE_EVENT))
        router.replace(returnTo)
      },
      (caught: unknown) => {
        setError(
          caught instanceof OpenRouterConnectError
            ? caught.message
            : "OpenRouter refused the connection. Try Connect again."
        )
      }
    )
  }, [code, router])

  return (
    <main className="flex flex-1 items-center justify-center bg-page px-6">
      {error ? (
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-copy-primary">{error}</p>
          <Link href="/editor" className="text-sm text-copy-secondary underline">
            Back to the editor
          </Link>
        </div>
      ) : (
        <TrussLoader label="Connecting OpenRouter" />
      )}
    </main>
  )
}
