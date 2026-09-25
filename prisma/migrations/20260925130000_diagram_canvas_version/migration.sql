-- Canvas writes become compare-and-swap on a per-diagram counter (ADR 0005).
ALTER TABLE "Diagram"
  ADD COLUMN "canvasVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "canvasWrittenByAgent" BOOLEAN NOT NULL DEFAULT false;
