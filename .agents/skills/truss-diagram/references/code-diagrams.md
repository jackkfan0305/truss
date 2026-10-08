# Code diagrams

Use this when the user asks to explain or diagram code in the current repository. Create the diagram with `truss_create_diagram` and a version 2 graph.

## Pick a zoom level

| Prompt | Level | Blocks |
| --- | --- | --- |
| Names a repository, a feature area, or something spread over many files, such as "how does auth work" | Overview | Module boundaries holding file or function blocks. Edges are the main calls or imports between them. |
| Names a function, endpoint, class, or one file, such as "what happens when `checkout()` runs" | Detail | The entry point, the functions it calls, classes as boundaries holding their methods, and the types those touch, with field rows. |

When the prompt fits neither row, draw the overview and tell the user they can ask for detail on any part. An overview has 6 to 15 blocks. A detail view shows the full call path within the 80-node limit.

## Read the code

Use your own tools. Truss never receives source code. Send only names, one-line signatures, field rows and locations.

- Trace depth-first from the entry point.
- Stop at library and framework code. Draw it as a leaf block or leave it out. Never expand it.
- Skip trivial helpers unless the user asks for them.

## Blocks

Call `truss_get_catalog` for the ids. Entries tagged `family: "code"` are:

| Id | Use for |
| --- | --- |
| `code-entry` | Where a call path starts: a route handler, CLI command, job or listener. |
| `code-function` | A standalone function. Put the one-line signature, with its return type, in `signature`. |
| `code-method` | A method. Its `parentId` must be a `code-class` boundary. |
| `code-type` | An interface, struct or record. One field per row in `rows`. |
| `code-enum` | An enum or union. One value per row in `rows`. |
| `code-class` | A boundary holding a class's constructor and methods. |
| `code-module` | A boundary holding a file or package. Use it for the groups in an overview. |

Every `code-entry`, `code-function` and `code-method` must have a `summary` and `pseudocode`; the tools refuse a graph without them. The `summary` is one plain sentence on what it does, such as `Checks the caller owns the diagram`. Describe the purpose, not the parameters.

The `pseudocode` is 3 to 16 lines of plain-language steps, indented two spaces per level. The canvas shows it when the block is hovered. Name the decisions and calls that matter and skip the bookkeeping. When a step calls a block this one has an edge to, write `calls` and the callee's label exactly as it appears on its block, with its arguments. If the call returns something the function uses, add `, gets <name>` with a short name for the result, and use that name in later steps. The canvas colors callee names so the reader can match each step to an edge:

```json
["calls authorizeDiagram(request, id)", "calls parseEditRequest(body), gets edit", "for each node in edit:", "  calls collidesWithOpaque(live, node), gets overlaps", "  reject the edit if overlaps", "save under the diagram lock"]
```

## Types and enums

Draw a `code-type` or `code-enum` only when a function's `signature` or `pseudocode` names it, even once. When one does, you must draw it. Each function that names it gets a `uses` edge to it, and the tools refuse a graph that breaks either rule. Leave out types the code only touches in passing.

Follow field types down to built-ins. When a drawn type has a field whose type is another of the codebase's types, such as `side: EdgeSide`, draw that type too with a `uses` edge from the first type, and keep going until every field is a primitive (`string`, `number`) or a standard type (`Array`, `Map`, `Promise`). Library types are leaves: draw them without rows.

Keep types apart from functions. Put every type and enum in a `code-module` boundary labelled `Types`, or one per area when there are many, such as `Diagram types`. These boundaries hold only types and enums; functions stay in their file boundaries.

## Edges

Edges run from caller to callee. Use `kind: "calls"` for a call (the default) and `kind: "uses"` for a reference to a type. Label an edge only when the call is not obvious, such as `on retry`. Keep labels to two or three words and leave out step numbers; most calls need no label.

## Source links

Give each block a `source` with `path` and `line`. Add a GitHub `url` only when the commit is pushed. Run:

```bash
git remote get-url origin       # GitHub? Extract owner/repo
git rev-parse HEAD              # the sha to pin
git branch -r --contains HEAD   # any output means the commit is pushed
```

If the remote is on GitHub and the last command prints a branch, set `source.url` to `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<line>`. Otherwise send `path` and `line` only; the canvas then shows a copy button. Turn `git@github.com:owner/repo.git` and `https://github.com/owner/repo.git` into `owner/repo`.

## Limits

- `signature`: one line, at most 120 characters. End it with the return type in the source language's own syntax, such as `parseEditRequest(value): EditRequest` or `def load(path) -> Config`. Leave the return type off only when the function returns nothing.
- `summary`: one line, at most 100 characters.
- `pseudocode`: at most 16 lines of at most 80 characters, no trailing spaces. Leading spaces are kept.
- `rows`: at most 12 strings, each at most 60 characters, trimmed, one line.
- `source.path`: repository-relative, at most 200 characters. `source.line`: a positive integer. `source.url`: starts with `https://github.com/`.
- A version 2 graph holds at most 80 nodes and 120 edges.

## Example

Prompt: "what happens when `main()` runs".

```json
{
  "version": 2,
  "nodes": [
    { "id": "main", "kind": "code", "catalogId": "code-entry", "label": "main", "signature": "main(): Promise<void>", "summary": "Loads config and starts the service.", "pseudocode": ["load config", "calls run()"], "source": { "path": "src/main.ts", "line": 1, "url": "https://github.com/o/r/blob/abc/src/main.ts#L1" } },
    { "id": "svc", "kind": "boundary", "catalogId": "code-class", "label": "Service" },
    { "id": "run", "kind": "code", "catalogId": "code-method", "label": "run", "summary": "Serves requests until stopped.", "signature": "run(): void", "pseudocode": ["read the port from Config", "loop until stopped:", "  handle the next request"], "parentId": "svc" },
    { "id": "cfg", "kind": "code", "catalogId": "code-type", "label": "Config", "rows": ["port: number"], "parentId": "types" },
    { "id": "types", "kind": "boundary", "catalogId": "code-module", "label": "Types" }
  ],
  "edges": [
    { "id": "e1", "source": "main", "target": "run", "label": "", "kind": "calls" },
    { "id": "e2", "source": "run", "target": "cfg", "label": "", "kind": "uses" }
  ]
}
```

## Layout

Leave out coordinates. Truss lays the graph out left to right, so the entry point lands first.
