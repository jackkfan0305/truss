// ponytail: module-level, since "start editing" is one-shot UI state that is never saved.
const pendingEdits = new Set<string>();

/** The next mount of this note opens straight into its editor. */
export function markNoteForEditing(id: string) {
  pendingEdits.add(id);
}

/** True once, if the note was marked; the mark is cleared. */
export function consumeNoteEdit(id: string) {
  return pendingEdits.delete(id);
}
