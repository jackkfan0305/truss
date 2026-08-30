"use client"

import { useState } from "react"
import { Check, CircleAlert, Link2, Trash2 } from "lucide-react"

import { EditorDialog } from "@/components/editor/editor-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { useStoryboardMembers } from "@/hooks/use-storyboard-members"
import { cn } from "@/lib/utils"
import type { DiagramAccess } from "@/types/diagram"
import type { StoryboardMember } from "@/types/storyboard"

const INVITE_FORM_ID = "invite-collaborator-form"

interface ShareDialogProps {
  diagram: DiagramAccess
  /**
   * The storyboard this diagram sits on. Collaborators are invited to a
   * storyboard, never to a diagram directly (see CONTEXT.md), so the caller
   * only renders this dialog once there is a parent to invite them to.
   */
  storyboardId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShareDialog({
  diagram,
  storyboardId,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const {
    members,
    isLoading,
    email,
    setEmail,
    isPending,
    error,
    invite,
    remove,
  } = useStoryboardMembers(storyboardId, open)

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void invite()
  }

  return (
    <EditorDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Share diagram"
      description={
        diagram.ownsStoryboard
          ? `Everyone invited to the storyboard that "${diagram.name}" sits on can open it.`
          : `You have access to "${diagram.name}" as a collaborator.`
      }
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <div className="grid gap-4">
        <CopyLinkRow diagramId={diagram.id} />

        {diagram.ownsStoryboard ? (
          <form
            id={INVITE_FORM_ID}
            onSubmit={handleSubmit}
            className="grid gap-2"
          >
            <label
              htmlFor="invite-email"
              className="text-xs font-medium text-copy-secondary"
            >
              Invite by email
            </label>
            <div className="flex gap-2">
              <Input
                id="invite-email"
                type="email"
                className="flex-1 text-copy-primary"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@example.com"
                autoComplete="off"
              />
              <Button
                type="submit"
                form={INVITE_FORM_ID}
                disabled={isPending || email.trim().length === 0}
              >
                {isPending ? "Inviting…" : "Invite"}
              </Button>
            </div>
          </form>
        ) : null}

        <div className="grid gap-2">
          <h3 className="text-xs font-medium text-copy-secondary">
            People with access
          </h3>

          <MemberList
            members={members}
            isLoading={isLoading}
            isPending={isPending}
            canRemove={diagram.ownsStoryboard}
            onRemove={remove}
          />
        </div>

        {error ? (
          <p role="alert" className="text-xs text-state-error">
            {error}
          </p>
        ) : null}
      </div>
    </EditorDialog>
  )
}

/** Read-only URL plus a copy button that confirms for two seconds. */
function CopyLinkRow({ diagramId }: { diagramId: string }) {
  const { status, copy } = useCopyToClipboard()

  /*
   * Read once at first render rather than in an effect, which would cost an
   * extra render pass. Safe because the dialog's Portal only mounts when it
   * opens — always client-side — and the `window` guard keeps it correct even
   * if that ever changes.
   */
  const [link] = useState(() =>
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/editor/${diagramId}`,
  )

  return (
    <div className="grid gap-2">
      <label
        htmlFor="share-diagram-link"
        className="text-xs font-medium text-copy-secondary"
      >
        Diagram link
      </label>
      <div className="flex gap-2">
        <Input
          id="share-diagram-link"
          className="flex-1 font-mono text-xs text-copy-primary"
          value={link}
          readOnly
          onFocus={(event) => event.target.select()}
        />
        <Button variant="outline" onClick={() => void copy(link)}>
          {status === "copied" ? (
            <>
              <Check className="h-4 w-4 text-state-success" />
              Copied!
            </>
          ) : status === "error" ? (
            <>
              <CircleAlert className="h-4 w-4" />
              Press Ctrl+C
            </>
          ) : (
            <>
              <Link2 className="h-4 w-4" />
              Copy
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function MemberList({
  members,
  isLoading,
  isPending,
  canRemove,
  onRemove,
}: {
  members: StoryboardMember[]
  isLoading: boolean
  isPending: boolean
  canRemove: boolean
  onRemove: (memberId: string) => Promise<void>
}) {
  if (isLoading) {
    return <p className="py-3 text-sm text-copy-muted">Loading…</p>
  }

  // The owner is always in a successful response, so an empty list means the
  // load failed — the error line below the list says so. Don't claim nobody
  // has access.
  if (members.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-surface-border px-3 py-4 text-center text-sm text-copy-muted">
        No one to show
      </p>
    )
  }

  return (
    <ul
      aria-label="People with access"
      className="max-h-56 overflow-y-auto rounded-2xl border border-surface-border"
    >
      {members.map((member) => {
        // Clerk may know nothing about this person yet — an invite can precede
        // sign-up — so the row falls back through name → email → placeholder.
        const primary = member.name ?? member.email ?? "Unknown user"
        const secondary = member.name ? member.email : null

        return (
          <li
            key={member.id}
            className="flex items-center gap-3 border-b border-surface-border-subtle px-3 py-2 last:border-b-0"
          >
            <Avatar member={member} />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-copy-primary">{primary}</p>
              {secondary ? (
                <p className="truncate text-xs text-copy-muted">{secondary}</p>
              ) : null}
            </div>

            <RoleBadge role={member.role} />

            {/* The owner cannot be removed — the server rejects it too, since
                they have no collaborator row to delete. */}
            {canRemove && member.role !== "owner" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={isPending}
                onClick={() => void onRemove(member.id)}
                aria-label={`Remove ${primary}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-copy-muted" />
              </Button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function RoleBadge({ role }: { role: StoryboardMember["role"] }) {
  const isOwner = role === "owner"

  return (
    <span
      className={cn(
        "shrink-0 rounded-xl px-2 py-0.5 text-[0.6875rem] font-medium capitalize",
        isOwner
          ? "bg-accent-dim text-brand"
          : "bg-subtle text-copy-secondary"
      )}
    >
      {role}
    </span>
  )
}

function Avatar({ member }: { member: StoryboardMember }) {
  if (member.imageUrl) {
    return (
      // Plain <img>: Clerk serves already-sized avatars from its own CDN, so
      // routing a 32px image through the Next optimizer buys nothing and would
      // need a remotePatterns entry.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.imageUrl}
        alt=""
        width={32}
        height={32}
        loading="lazy"
        className="h-8 w-8 shrink-0 rounded-full border border-surface-border object-cover"
      />
    )
  }

  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-surface-border bg-subtle text-xs font-medium text-copy-muted"
    >
      {(member.name ?? member.email ?? "?").charAt(0).toUpperCase()}
    </span>
  )
}
