import { TrussLoader } from "@/components/ui/truss-loader";

/** Shown while the server resolves project access and the sidebar lists. */
export default function EditorRoomLoading() {
  return (
    <main className="flex h-dvh items-center justify-center bg-page">
      <TrussLoader label="Opening project" />
    </main>
  );
}
