# A browser model with the user's own key

ADR 0001 removed every server-side model. The terminal agent became the only
model, and Truss held no key. That left anyone without a terminal agent unable
to create or discuss a diagram.

We now allow one more model, and only in the browser. The editor's assistant
panel connects the user's own OpenRouter account through OAuth PKCE. The key
OpenRouter returns stays in that browser's localStorage. The browser calls
OpenRouter directly, and the model's tools call the same agent endpoints the
terminal agent uses, with the user's session.

ADR 0001 narrows to this: Truss runs no server-side model and holds no model
key. Its server still never interprets intent. The model that does is the
user's, paid for by the user, running in the user's browser.

## Consequences

The server stays the only place a graph is validated, laid out and written, so
the two agents cannot drift apart on the contract. A key in localStorage can be
read by any script on our origin, so the assistant renders model output as
plain text only, and Disconnect deletes the key. A server-side proxy would
reintroduce the tier ADR 0001 removed and is out of scope.
