"use client"

import {
  createElement,
  Fragment,
  memo,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react"

import { CodeBlock } from "@/components/chat/code-block"
import { useSmoothText } from "@/hooks/use-smooth-text"
import {
  MARKDOWN_LINK_ATTRS,
  parseMarkdown,
  type MarkdownToken,
} from "@/lib/markdown-tokens"
import { completeStreamingMarkdown } from "@/lib/streaming-markdown"
import { cn } from "@/lib/utils"

/**
 * Streaming markdown rendered as React elements.
 *
 * The parsing settings, the link filter and the link attributes all come from
 * `lib/markdown-tokens.ts`, which is the sanitizer — read that file before
 * changing anything here. What this component adds is that the token stream
 * becomes *elements* rather than an HTML string, which is what removes
 * direct HTML injection from the chat path instead of adding a fourth use
 * of it.
 *
 * Heading *scale* is deliberately absent from the class map below. A heading
 * gets weight and rhythm here and takes its size from the container's class
 * name, so the spec preview can pass a document scale while the transcript
 * passes nothing — losing that override would flatten a spec's hierarchy to
 * the `text-sm` every chat heading uses.
 */

export type ResponseTag =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "ul"
  | "ol"
  | "li"
  | "blockquote"
  | "strong"
  | "em"
  | "s"
  | "a"
  | "table"
  | "thead"
  | "tbody"
  | "tr"
  | "th"
  | "td"
  | "hr"

export type ResponseComponents = Partial<
  Record<ResponseTag, ComponentType<{ children?: ReactNode }>>
>

export interface ResponseProps {
  /** The markdown source. Text, not elements. */
  children: string
  /** Whether more deltas are still arriving into this text. */
  isStreaming?: boolean
  parseIncompleteMarkdown?: boolean
  components?: ResponseComponents
  showLineNumbers?: boolean
  className?: string
}

const RESPONSE_CLASSES: Partial<Record<ResponseTag | "code", string>> = {
  p: "my-0 mt-2 first:mt-0",
  h1: "mt-3 mb-1 font-medium text-copy-primary first:mt-0",
  h2: "mt-3 mb-1 font-medium text-copy-primary first:mt-0",
  h3: "mt-3 mb-1 font-medium text-copy-primary first:mt-0",
  h4: "mt-3 mb-1 font-medium text-copy-primary first:mt-0",
  h5: "mt-3 mb-1 font-medium text-copy-primary first:mt-0",
  h6: "mt-3 mb-1 font-medium text-copy-primary first:mt-0",
  ul: "my-2 list-disc pl-4",
  ol: "my-2 list-decimal pl-4",
  li: "my-0.5 marker:text-copy-faint",
  blockquote: "my-2 border-l border-surface-border pl-3 text-copy-muted",
  strong: "font-medium text-copy-primary",
  em: "italic",
  s: "line-through",
  a: "underline underline-offset-2 decoration-copy-faint hover:decoration-copy-primary",
  // Fixed layout: a markdown table carries no widths, and deriving them from
  // the longest cell makes columns jump as rows stream in.
  table: "w-full table-fixed border-collapse",
  th: "border border-surface-border px-2 py-1 text-left font-medium",
  td: "border border-surface-border px-2 py-1 wrap-anywhere",
  hr: "my-3 border-surface-border",
  code: "rounded bg-elevated px-1 py-0.5 font-mono text-xs",
}

interface RenderOptions {
  components: ResponseComponents
  showLineNumbers: boolean
}

function ResponseBody({
  children,
  isStreaming = false,
  parseIncompleteMarkdown = true,
  components = {},
  showLineNumbers = false,
  className,
}: ResponseProps) {
  // `settled` is the negation of `isStreaming`: a finished answer has no more
  // deltas coming, so trickling would hide its last words behind an animation
  // with nothing left to animate toward.
  const revealed = useSmoothText(children, !isStreaming)
  // Repair applies while deltas are still arriving *and* while the reveal is
  // mid-string, because a revealed prefix has a half-typed tail of its own.
  const shouldRepair =
    parseIncompleteMarkdown && (isStreaming || revealed !== children)
  const source = shouldRepair ? completeStreamingMarkdown(revealed) : revealed

  const nodes = useMemo(() => {
    const tokens = parseMarkdown(source)

    return renderRange(tokens, 0, tokens.length, { components, showLineNumbers })
  }, [source, components, showLineNumbers])

  return <div className={cn("wrap-anywhere", className)}>{nodes}</div>
}

/**
 * Memoised on the text, the streaming flag and the class name, so a long
 * answer does not re-parse when a sibling in the transcript moves.
 *
 * `components` is intentionally outside the comparison: it is an object
 * literal at every call site here, so comparing it by identity would defeat
 * the memo entirely. Callers that need it must keep it stable themselves.
 */
export const Response = memo(
  ResponseBody,
  (previous, next) =>
    previous.children === next.children &&
    previous.isStreaming === next.isStreaming &&
    previous.parseIncompleteMarkdown === next.parseIncompleteMarkdown &&
    previous.showLineNumbers === next.showLineNumbers &&
    previous.className === next.className
)

Response.displayName = "Response"

/**
 * markdown-it emits a flat stream with `nesting` of +1, 0 and -1. This walks
 * it back into a tree by finding each opening token's matching close.
 */
function renderRange(
  tokens: readonly MarkdownToken[],
  from: number,
  to: number,
  options: RenderOptions
): ReactNode[] {
  const nodes: ReactNode[] = []
  let index = from
  let key = 0

  while (index < to) {
    const token = tokens[index]

    if (token.nesting === 1) {
      const close = findClose(tokens, index, to)

      nodes.push(
        renderOpen(
          token,
          renderRange(tokens, index + 1, close, options),
          String(key),
          options
        )
      )
      index = close + 1
    } else {
      const node = renderLeaf(token, String(key), options)

      if (node !== null) nodes.push(node)
      index += 1
    }

    key += 1
  }

  return nodes
}

function findClose(
  tokens: readonly MarkdownToken[],
  openIndex: number,
  to: number
): number {
  let depth = 0

  for (let index = openIndex; index < to; index += 1) {
    depth += tokens[index].nesting

    if (depth === 0) return index
  }

  // An unbalanced stream ends the element at the range's end rather than
  // throwing: the tail repair handles the common causes, and a parse this
  // component cannot walk must still render the words it has.
  return to
}

function renderOpen(
  token: MarkdownToken,
  children: ReactNode[],
  key: string,
  options: RenderOptions
): ReactNode {
  const tag = token.tag as ResponseTag
  const className = RESPONSE_CLASSES[tag]

  if (tag === "a") {
    const href = token.attrGet("href")

    // `validateLink` already refused the dangerous schemes, so a link_open
    // without an href is a malformed stream rather than an attack — its label
    // still renders.
    if (typeof href !== "string") return <span key={key}>{children}</span>

    return (
      <a key={key} href={href} {...MARKDOWN_LINK_ATTRS} className={className}>
        {children}
      </a>
    )
  }

  if (tag === "table") {
    // The wrapper scrolls, not the panel: a wide table in a 26rem sidebar
    // would otherwise drag every message beside it sideways.
    return (
      <div key={key} className="my-2 overflow-x-auto">
        <table className={className}>{children}</table>
      </div>
    )
  }

  const Override = options.components[tag]

  if (Override) return <Override key={key}>{children}</Override>

  return createElement(tag, { key, className }, children)
}

function renderLeaf(
  token: MarkdownToken,
  key: string,
  options: RenderOptions
): ReactNode {
  switch (token.type) {
    case "inline": {
      const children = token.children ?? []

      return (
        <Fragment key={key}>
          {renderRange(children, 0, children.length, options)}
        </Fragment>
      )
    }
    case "text":
    // `html: false` means markdown-it never emits these two. The branch exists
    // so that if that ever changed, the content would land in a React text
    // node as visible characters rather than as markup.
    case "html_block":
    case "html_inline":
      return token.content
    case "code_inline":
      return (
        <code key={key} className={RESPONSE_CLASSES.code}>
          {token.content}
        </code>
      )
    case "fence":
    case "code_block":
      return (
        <CodeBlock
          key={key}
          code={token.content}
          language={token.info.trim().split(/\s+/)[0] || undefined}
          showLineNumbers={options.showLineNumbers}
        />
      )
    // `breaks: true`, so a single newline is where the line visibly broke.
    case "softbreak":
    case "hardbreak":
      return <br key={key} />
    case "hr":
      return <hr key={key} className={RESPONSE_CLASSES.hr} />
    case "image":
      // No remote images in a chat panel. The alt text is what the message
      // meant, and rendering it keeps the words without fetching anything.
      return token.content || token.attrGet("alt") || null
    default:
      return null
  }
}
