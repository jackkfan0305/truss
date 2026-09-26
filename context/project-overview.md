# Truss

## Overview

Truss is a system design workspace. A terminal agent maps a system onto a canvas through the `truss-diagram` skill.

Truss runs no model of its own — see `docs/adr/0001-no-server-side-ai.md`.

## Goals

1. Let authenticated users create and manage architecture diagrams.
2. Let users import prebuilt starter system designs into the canvas.
3. Let a calling agent create, read, edit, and delete diagrams over MCP.

## Core User Flow

1. User opens the storyboard builder, signed in or signed out.
2. A signed-out user works in a temporary storyboard in memory only.
3. User signs in when they want to save the temporary storyboard. The current
   storyboard is preserved through sign-in and saved to their account.
4. User creates or selects a diagram.
5. User enters the diagram workspace.
6. User optionally imports a starter system design template into the canvas.
7. User asks their terminal agent to draw or extend the system design.
8. The agent writes nodes and edges into the canvas.

## Features

### Authentication and Diagrams

- User sign-in and route protection.
- Diagram creation and ownership.
- Diagram list and workspace navigation.
- A signed-out user can build a temporary storyboard with the full feature set.
  Signing in preserves the temporary storyboard and saves it as a new
  storyboard owned by the user. Sign-in opens in a page modal so the temporary
  storyboard remains available in memory. If saving fails, the temporary
  storyboard remains available for retry. Each browser tab has its own
  temporary storyboard.

### Canvas

- React Flow canvas with node and edge editing.
- Canvas snapshots persisted as versioned Vercel Blob snapshots.
- Agent cursor and avatar driven by replay of agent writes.

### Starter System Designs

- A curated library of prebuilt system design templates.
- Users can import a starter template into the canvas at any point during editing.
- Templates are static canvas snapshots loaded directly into the active room.
- Covers common patterns: monolith, microservices, event-driven, serverless, and more.

### Agent Diagram Operations

- The `truss-diagram` skill creates, reads, edits, and deletes diagrams over MCP.
- Output is structured as canvas nodes and edges written into the shared room.
- Writes are paced, so a mounted editor watches the agent's cursor place each item.

## Scope

### In Scope

- Authentication and route protection
- Diagram creation and ownership
- Starter system design template library and import
- Canvas with nodes and edges, versioned and persisted
- Agent-driven diagram create, read, edit, and delete over MCP
- Persistent storage for diagram metadata and canvas snapshots

### Out Of Scope

- Billing and subscription systems
- Any server-side model call — see `docs/adr/0001-no-server-side-ai.md`
- Production object storage migration
- Mobile-native applications

## Success Criteria

1. A signed-in user can create and open a diagram.
2. A user can import a prebuilt starter design into the canvas.
3. A calling agent can create, read, edit, and delete a diagram.
4. Diagram metadata and canvas snapshots are stored in the correct layers.
