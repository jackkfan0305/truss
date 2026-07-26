import { EditorShell } from "@/components/editor/editor-shell";

// Server component by design: 07-wire-editor-home fetches owned and shared
// projects here and passes them into the shell. Access is already gated by
// proxy.ts, so there is no auth check to repeat at this level yet.
export default function EditorPage() {
  return <EditorShell />;
}
