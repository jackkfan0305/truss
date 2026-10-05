import type { SVGProps } from "react"

/**
 * OpenRouter's glyph, taken from the wordmark at
 * https://openrouter.ai/brand/v2/openrouter-dark.svg and cropped to the mark.
 * Decorative: always pair it with a visible "OpenRouter" label.
 */
export function OpenRouterLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="19 17 369 259" fill="currentColor" aria-hidden focusable="false" {...props}>
      <path d="M303.95,17.2c42.8,0,77.49,34.69,77.49,77.49s-34.69,77.49-77.49,77.49l76.86,76.86c9.76,9.76,2.85,26.46-10.96,26.46h-220.88c-71.33,0-129.15-57.82-129.15-129.15S77.64,17.2,148.97,17.2h154.98ZM148.97,68.86c-42.8,0-77.49,34.69-77.49,77.49s34.69,77.49,77.49,77.49,77.49-34.69,77.49-77.49-34.69-77.49-77.49-77.49Z" />
    </svg>
  )
}
