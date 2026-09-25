export type EditorSidebar = "diagrams" | null;

/** Launch imports do not change the ordinary sidebar's closed initial state. */
export function initialEditorSidebar(): EditorSidebar {
  return null;
}
