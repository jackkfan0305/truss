# Truss

## Overview

Truss is a real-time collaborative system design workspace. A terminal agent maps a system onto a shared canvas through the `truss-diagram` skill, and collaborators refine the architecture in place.

Truss runs no model of its own — see `docs/adr/0001-no-server-side-ai.md`.

## Goals

1. Let authenticated users create and manage architecture diagrams.
2. Provide a collaborative real-time canvas for system design.
3. Let users import prebuilt starter system designs into the canvas.
4. Let a calling agent create, read, edit, and delete diagrams over MCP.
5. Let collaborators refine the resulting architecture.

## Core User Flow

1. User signs in.
2. User creates or selects a diagram.
3. User enters the diagram workspace.
4. User optionally imports a starter system design template into the canvas.
5. User asks their terminal agent to draw or extend the system design.
6. The agent writes nodes and edges into the shared canvas.
7. Collaborators edit and refine the design.

## Features

### Authentication and Diagrams

- User sign-in and route protection.
- Diagram creation, ownership, and collaborator access.
- Diagram list and workspace navigation.

### Collaborative Canvas

- Shared real-time canvas using Liveblocks and React Flow.
- Live cursors, presence indicators, and node/edge editing.
- Canvas snapshots persisted to Vercel Blob.

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
- Collaborator access by diagram
- Starter system design template library and import
- Real-time shared canvas with nodes, edges, and presence
- Agent-driven diagram create, read, edit, and delete over MCP
- Persistent storage for diagram metadata and canvas snapshots

### Out Of Scope

- Billing and subscription systems
- Enterprise permission tiers beyond owner and collaborator
- Any server-side model call — see `docs/adr/0001-no-server-side-ai.md`
- Production object storage migration
- Mobile-native applications

## Success Criteria

1. A signed-in user can create and open a diagram.
2. Multiple users can collaborate in the same canvas simultaneously.
3. A user can import a prebuilt starter design into the canvas.
4. A calling agent can create, read, edit, and delete a diagram in the shared room.
5. Diagram metadata and canvas snapshots are stored in the correct layers.
