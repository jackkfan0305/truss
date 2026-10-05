import { OpenRouterCallback } from "@/components/editor/openrouter-callback"

interface OpenRouterCallbackPageProps {
  searchParams: Promise<{ code?: string | string[] }>
}

export default async function OpenRouterCallbackPage({
  searchParams,
}: OpenRouterCallbackPageProps) {
  const { code } = await searchParams
  return <OpenRouterCallback code={typeof code === "string" ? code : ""} />
}
