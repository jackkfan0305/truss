export type EditorSidebar = "projects" | "ai" | null;

/** Launch imports do not change the ordinary sidebar's closed initial state. */
export function initialEditorSidebar(): EditorSidebar {
  return null;
}
