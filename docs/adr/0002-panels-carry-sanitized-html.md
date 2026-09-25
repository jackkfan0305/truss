# Panel content is sanitized HTML, not Markdown

`lib/markdown.ts` runs markdown-it with `html: false` and says so in a comment:
the flag is the sanitizer, and embedded HTML would mean growing a real one. A
prose panel needs layout Markdown cannot express (columns, callouts, badges),
so we are taking that cost deliberately: markdown-it with `html: true`, plus a
vetted sanitizer and an allowlist owned in that same module.

## Considered Options

Markdown only, expressing structure through additional panel types instead. It
costs nothing and stays safe by configuration rather than by an allowlist
somebody has to maintain. Rejected because every layout need becomes app code,
and the agent authoring these panels writes HTML as readily as Markdown.

MDX was rejected outright. It executes JSX, so agent-authored content would run
arbitrary code in collaborators' browsers.

## Consequences

`lib/markdown.ts` becomes a real trust boundary rather than a configuration
flag. `img` sources are restricted to our own Blob origin and `data:` so a panel
cannot phone out, and `class` is restricted to a fixed allowlist rather than
arbitrary strings. A new panel type that widens the allowlist widens it for
every panel that already exists.
