"use client";

import { useState, type ReactNode } from "react";
import {
  ClientSideSuspense,
  LiveblocksProvider,
  RoomProvider,
  useErrorListener,
} from "@liveblocks/react/suspense";

import { Canvas } from "@/components/canvas/canvas";

interface CanvasRoomProps {
  /** The project ID — one identifier for the route, the row and the room. */
  roomId: string;
}

/**
 * Joins the Liveblocks room for a project and mounts the canvas inside it
 * (11-base-canvas).
 *
 * The room is authenticated through `/api/liveblocks-auth`, which verifies
 * project membership before issuing a token — so a user who cannot open the
 * project cannot join its room either.
 */
export function CanvasRoom({ roomId }: CanvasRoomProps) {
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id={roomId}
        initialPresence={{ cursor: null, isThinking: false }}
      >
        {/*
          The guard sits *outside* the suspense boundary on purpose: a room that
          fails to connect never resolves, so without it the loading state would
          be permanent rather than an error.
        */}
        <ConnectionGuard>
          <ClientSideSuspense
            fallback={<CanvasStatus>Connecting to the canvas…</CanvasStatus>}
          >
            <Canvas />
          </ClientSideSuspense>
        </ConnectionGuard>
      </RoomProvider>
    </LiveblocksProvider>
  );
}

/**
 * Replaces the canvas with a readable message when the room connection fails.
 *
 * `useErrorListener` is Liveblocks' own channel for this, so no error-boundary
 * dependency is needed. Only connection errors are handled — anything else is
 * left to bubble rather than blanking a working canvas.
 */
function ConnectionGuard({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  useErrorListener((error) => {
    if (error.context.type !== "ROOM_CONNECTION_ERROR") {
      return;
    }

    setMessage(describeConnectionError(error.context.code));
  });

  if (message) {
    return <CanvasStatus>{message}</CanvasStatus>;
  }

  return <>{children}</>;
}

function describeConnectionError(code: number): string {
  switch (code) {
    case -1:
      return "Could not authenticate with the canvas. Try reloading the page.";
    case 4001:
      return "You no longer have access to this canvas.";
    case 4005:
      return "This canvas is at capacity. Try again in a moment.";
    default:
      return "Lost connection to the canvas. Try reloading the page.";
  }
}

function CanvasStatus({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-copy-muted"
    >
      {children}
    </div>
  );
}
