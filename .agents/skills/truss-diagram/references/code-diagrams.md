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
| `code-function` | A standalone function. Put the one-line signature in `signature`. |
| `code-method` | A method. Its `parentId` must be a `code-class` boundary. |
| `code-type` | An interface, struct or record. One field per row in `rows`. |
| `code-enum` | An enum or union. One value per row in `rows`. |
| `code-class` | A boundary holding a class's constructor and methods. |
| `code-module` | A boundary holding a file or package. Use it for the groups in an overview. |

## Edges

Edges run from caller to callee. Use `kind: "calls"` for a call (the default) and `kind: "uses"` for a reference to a type. Label an edge only when the call is not obvious, such as `on retry`.

## Source links

Give each block a `source` with `path` and `line`. Add a GitHub `url` only when the commit is pushed. Run:

```bash
git remote get-url origin       # GitHub? Extract owner/repo
git rev-parse HEAD              # the sha to pin
git branch -r --contains HEAD   # any output means the commit is pushed
```

If the remote is on GitHub and the last command prints a branch, set `source.url` to `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<line>`. Otherwise send `path` and `line` only; the canvas then shows a copy button. Turn `git@github.com:owner/repo.git` and `https://github.com/owner/repo.git` into `owner/repo`.

## Limits

- `signature`: one line, at most 120 characters.
- `rows`: at most 12 strings, each at most 60 characters, trimmed, one line.
- `source.path`: repository-relative, at most 200 characters. `source.line`: a positive integer. `source.url`: starts with `https://github.com/`.
- A version 2 graph holds at most 80 nodes and 120 edges.

## Example

Prompt: "what happens when `main()` runs".

```json
{
  "version": 2,
  "nodes": [
    { "id": "main", "kind": "code", "catalogId": "code-entry", "label": "main", "signature": "main()", "source": { "path": "src/main.ts", "line": 1, "url": "https://github.com/o/r/blob/abc/src/main.ts#L1" } },
    { "id": "svc", "kind": "boundary", "catalogId": "code-class", "label": "Service" },
    { "id": "run", "kind": "code", "catalogId": "code-method", "label": "run", "parentId": "svc" },
    { "id": "cfg", "kind": "code", "catalogId": "code-type", "label": "Config", "rows": ["port: number"] }
  ],
  "edges": [
    { "id": "e1", "source": "main", "target": "run", "label": "", "kind": "calls" },
    { "id": "e2", "source": "run", "target": "cfg", "label": "", "kind": "uses" }
  ]
}
```

## Layout

Leave out coordinates. Truss lays the graph out left to right, so the entry point lands first.
