export type EditorSidebar = "diagrams" | "assistant" | null;

/** Launch imports do not change the ordinary sidebar's closed initial state. */
export function initialEditorSidebar(): EditorSidebar {
  return null;
}
