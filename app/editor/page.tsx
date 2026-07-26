import { EditorShell } from "@/components/editor/editor-shell";
import {
  MOCK_OWNED_PROJECTS,
  MOCK_SHARED_PROJECTS,
} from "@/lib/mock-projects";

// Server component by design: 07-wire-editor-home swaps the mock lists below
// for the real owned/shared queries here. Access is already gated by proxy.ts,
// so there is no auth check to repeat at this level yet.
export default function EditorPage() {
  return (
    <EditorShell
      ownedProjects={MOCK_OWNED_PROJECTS}
      sharedProjects={MOCK_SHARED_PROJECTS}
    />
  );
}
