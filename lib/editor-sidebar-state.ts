export type EditorSidebar = "projects" | "ai" | null;

/** A launch opens the AI surface; ordinary editor visits retain the closed chrome. */
export function initialEditorSidebar(launchId?: string): EditorSidebar {
  return launchId ? "ai" : null;
}
