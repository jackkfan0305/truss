# Truss runs no model of its own

Truss began with an in-app AI sidebar: a chat box, a Gemini key, and Trigger.dev
tasks that generated designs and specs in the background. The `truss-diagram`
skill later proved the opposite arrangement works better, with the calling agent
producing the graph and Truss only validating and rendering it. We are removing
the server-side half entirely. The terminal agent is the only model in the
system, and Truss holds no model key, runs no background jobs, and never
interprets a user's intent.

## Consequences

Trigger.dev goes with it, along with the `TaskRun` and `AiRequestRateLimit`
models, the `ai` and `@ai-sdk/google` dependencies, spec generation, and the
`isThinking` presence field. Any future feature wanting server-side generation
is reintroducing a whole tier, not adding a route.

The upside is that intent is interpreted exactly once, by the agent already
holding the conversation. The previous arrangement had two models forming two
views of the same request and no way to reconcile them.
