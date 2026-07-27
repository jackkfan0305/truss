/**
 * Liveblocks types for the whole app (10-liveblocks-setup).
 *
 * Declared globally rather than exported, which is how Liveblocks picks them
 * up: every hook in `@liveblocks/react` and every token issued by
 * `app/api/liveblocks-auth` reads this one `Liveblocks` interface.
 *
 * https://liveblocks.io/docs/api-reference/liveblocks-react#Typing-your-data
 */
declare global {
  interface Liveblocks {
    /** Per-user ephemeral state, discarded the moment the user disconnects. */
    Presence: {
      /** Canvas coordinates, not screen coordinates. `null` while off-canvas. */
      cursor: { x: number; y: number } | null;
      /** True while an AI generation this user started is in flight. */
      isThinking: boolean;
    };

    /**
     * Set server-side in `app/api/liveblocks-auth`, and so trustworthy on the
     * client: a user cannot rename or recolour themselves.
     */
    UserMeta: {
      id: string;
      info: {
        name: string;
        avatar: string;
        /** Cursor colour, derived from the user ID by `getCursorColor`. */
        color: string;
      };
    };

    // Storage, RoomEvent, ThreadMetadata and RoomInfo are deliberately absent:
    // every key here is optional and falls back to the permissive Liveblocks
    // default, and declaring them empty would be a lie the compiler enforces.
    // Storage arrives with the React Flow node/edge schema.
  }
}

export {};
