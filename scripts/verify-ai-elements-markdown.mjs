import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { build } from "esbuild"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const temporaryDirectory = mkdtempSync(join(process.cwd(), ".ai-elements-parity-"))

try {
  const output = join(temporaryDirectory, "message.mjs")
  await build({
    entryPoints: ["components/ai-elements/message.tsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    tsconfig: "tsconfig.json",
    outfile: output,
  })
  const { MessageResponse } = await import(pathToFileURL(output).href)
  const render = (value, isAnimating = false) =>
    renderToStaticMarkup(
      React.createElement(MessageResponse, { isAnimating }, value)
    )

  const raw = render('<script>alert(1)</script>\n<img src=x onerror="alert(1)">')
  assert.doesNotMatch(raw, /<script|<img\b|onerror=/i)

  for (const scheme of ["javascript:alert(1)", "data:text/html,evil"]) {
    const html = render(`[click](${scheme})`)
    assert.doesNotMatch(html, /href="(?:javascript:|data:)/i)
    assert.match(html, /click/)
  }

  const link = render("[docs](https://example.test/a)")
  assert.match(link, /data-streamdown="link"/)
  assert.doesNotMatch(link, /href="https:\/\/example\.test\/a"/)

  const table = render("| a | b |\n| --- | --- |\n| 1 | 2 |")
  assert.match(table, /<table/)
  const code = render("```ts\nconst a = 1\n```")
  assert.match(code, /const a = 1/)
  const openFence = render("Visible words\n```ts\nconst pending = true", true)
  assert.match(openFence, /Visible words/)
  const partial = render("Visible words and **unfinished", true)
  assert.match(partial, /Visible words/)
  const malformed = render("[visible](javascript:")
  assert.match(malformed, /visible/)
  const longAnswer = render(`${"A long answer with words. ".repeat(80)}\n\n**End**`)
  assert.match(longAnswer, /End/)

  console.log("AI Elements Markdown boundary confirmed: safe links render as buttons")
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
