"use client"

import { EditorDialog } from "@/components/editor/editor-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DiagramActions } from "@/hooks/use-diagram-actions"

/*
 * Form ids let the footer buttons submit the form that lives in the dialog
 * body — native HTML, so Enter in the input submits without a key handler.
 */
const CREATE_FORM_ID = "create-diagram-form"
const RENAME_FORM_ID = "rename-diagram-form"

interface DiagramDialogsProps {
  actions: DiagramActions
}

export function DiagramDialogs({ actions }: DiagramDialogsProps) {
  const { dialog, name, setName, roomId, isPending, error, closeDialog, submit } =
    actions

  // Only "create" has no target; the other two always carry a diagram.
  const targetName = dialog && dialog.kind !== "create" ? dialog.diagram.name : ""

  const handleOpenChange = (open: boolean) => {
    if (!open) closeDialog()
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }

  return (
    <>
      <EditorDialog
        open={dialog?.kind === "create"}
        onOpenChange={handleOpenChange}
        title="New diagram"
        description="Name your workspace. You can rename it at any time."
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={CREATE_FORM_ID}
              disabled={isPending || roomId.length === 0}
            >
              {isPending ? "Creating…" : "Create diagram"}
            </Button>
          </>
        }
      >
        <form id={CREATE_FORM_ID} onSubmit={handleSubmit} className="grid gap-2">
          <label
            htmlFor="create-diagram-name"
            className="text-xs font-medium text-copy-secondary"
          >
            Diagram name
          </label>
          {/* The value the user typed is primary content, not supporting text. */}
          <Input
            id="create-diagram-name"
            className="text-copy-primary"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Checkout Service"
            autoComplete="off"
          />
          {/* The room ID is the diagram ID — this is the real URL, not a guess. */}
          <p className="truncate font-mono text-xs text-copy-muted">
            /editor/{roomId || "your-diagram"}
          </p>
          <DialogError message={error} />
        </form>
      </EditorDialog>

      <EditorDialog
        open={dialog?.kind === "rename"}
        onOpenChange={handleOpenChange}
        title="Rename diagram"
        description={`Currently named "${targetName}".`}
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={RENAME_FORM_ID}
              disabled={isPending || name.trim().length === 0}
            >
              {isPending ? "Saving…" : "Save name"}
            </Button>
          </>
        }
      >
        <form id={RENAME_FORM_ID} onSubmit={handleSubmit} className="grid gap-2">
          <label
            htmlFor="rename-diagram-name"
            className="text-xs font-medium text-copy-secondary"
          >
            Diagram name
          </label>
          <Input
            id="rename-diagram-name"
            className="text-copy-primary"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
          <DialogError message={error} />
        </form>
      </EditorDialog>

      <EditorDialog
        open={dialog?.kind === "delete"}
        onOpenChange={handleOpenChange}
        title="Delete diagram"
        description={`"${targetName}" and everything on its canvas will be permanently deleted. This cannot be undone.`}
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submit()}
              disabled={isPending}
            >
              {isPending ? "Deleting…" : "Delete diagram"}
            </Button>
          </>
        }
      >
        <DialogError message={error} />
      </EditorDialog>
    </>
  )
}

/** Renders nothing until a mutation fails, so the dialog keeps its layout. */
function DialogError({ message }: { message: string | null }) {
  if (!message) return null

  return (
    <p role="alert" className="text-xs text-state-error">
      {message}
    </p>
  )
}
