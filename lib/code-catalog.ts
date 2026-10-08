/**
 * Code diagram blocks and boundaries. Same role as `AWS_CATALOG`: the dock, the
 * graph schema and the agent catalog read all use this one list.
 */

export type CodeIconName = "entry" | "function" | "method" | "type" | "enum" | "class" | "module";

export interface CodeCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly kind: "block" | "boundary";
  readonly icon: CodeIconName;
  readonly defaultSize: { readonly width: number; readonly height: number };
}

const blockSize = { width: 220, height: 72 };
const rowsSize = { width: 220, height: 150 };
const boundarySize = { width: 380, height: 240 };

export const CODE_CATALOG: readonly CodeCatalogEntry[] = [
  { id: "code-entry", name: "Entry point", description: "Where a call path starts: a route handler, CLI command, job or event listener.", aliases: ["entry", "main", "handler", "route", "endpoint"], kind: "block", icon: "entry", defaultSize: blockSize },
  { id: "code-function", name: "Function", description: "A standalone function, with an optional signature line.", aliases: ["function", "fn", "def", "procedure"], kind: "block", icon: "function", defaultSize: blockSize },
  { id: "code-method", name: "Method", description: "A function that belongs to a class. Must sit inside a class.", aliases: ["method", "member", "constructor"], kind: "block", icon: "method", defaultSize: blockSize },
  { id: "code-type", name: "Type", description: "A data shape such as an interface, struct or record, with field rows.", aliases: ["type", "interface", "struct", "record", "model", "schema"], kind: "block", icon: "type", defaultSize: rowsSize },
  { id: "code-enum", name: "Enum", description: "A fixed set of values, one per row.", aliases: ["enum", "union", "constants"], kind: "block", icon: "enum", defaultSize: rowsSize },
  { id: "code-class", name: "Class", description: "Holds a class's constructor and methods.", aliases: ["class", "object", "service"], kind: "boundary", icon: "class", defaultSize: boundarySize },
  { id: "code-module", name: "Module", description: "Holds the contents of a file or package.", aliases: ["module", "file", "package", "namespace"], kind: "boundary", icon: "module", defaultSize: boundarySize },
];

export function getCodeCatalogEntry(id: string): CodeCatalogEntry | undefined {
  return CODE_CATALOG.find((entry) => entry.id === id);
}

export function searchCodeCatalog(query: string): readonly CodeCatalogEntry[] {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return CODE_CATALOG;
  return CODE_CATALOG.filter((entry) =>
    [entry.name, ...entry.aliases].some((value) => value.toLowerCase().includes(term)),
  );
}

export const GITHUB_SOURCE_PREFIX = "https://github.com/";

/** The only links a code block may render. The trailing slash rules out `github.com.evil.com`. */
export function isGithubSourceUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(GITHUB_SOURCE_PREFIX) && !/\s/.test(value);
}
