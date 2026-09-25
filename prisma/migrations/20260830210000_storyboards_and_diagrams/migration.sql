-- `Project` becomes `Storyboard`, and `Diagram` splits out as its own model
-- with a nullable parent storyboard (issue #27).
--
-- The old rows are dropped rather than migrated. The live deployment holds
-- test data only, and a rename constrained to preserve Liveblocks room IDs and
-- Blob paths would shape the schema around data nobody needs.
--
-- `ProjectStatus` goes with it: a diagram's deletion state is now two nullable
-- timestamps, which say *when* as well as *whether*.

DROP TABLE "ProjectCollaborator";

DROP TABLE "Project";

DROP TYPE "ProjectStatus";

-- CreateTable
CREATE TABLE "Storyboard" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Storyboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryboardCollaborator" (
    "id" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryboardCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagram" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canvasJsonPath" TEXT,
    "storyboardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletingAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Diagram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Storyboard_ownerId_idx" ON "Storyboard"("ownerId");

-- CreateIndex
CREATE INDEX "Storyboard_createdAt_idx" ON "Storyboard"("createdAt");

-- CreateIndex
CREATE INDEX "StoryboardCollaborator_email_idx" ON "StoryboardCollaborator"("email");

-- CreateIndex
CREATE INDEX "StoryboardCollaborator_storyboardId_createdAt_idx" ON "StoryboardCollaborator"("storyboardId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoryboardCollaborator_storyboardId_email_key" ON "StoryboardCollaborator"("storyboardId", "email");

-- CreateIndex
CREATE INDEX "Diagram_ownerId_idx" ON "Diagram"("ownerId");

-- CreateIndex
CREATE INDEX "Diagram_createdAt_idx" ON "Diagram"("createdAt");

-- CreateIndex
CREATE INDEX "Diagram_storyboardId_idx" ON "Diagram"("storyboardId");

-- AddForeignKey
ALTER TABLE "StoryboardCollaborator" ADD CONSTRAINT "StoryboardCollaborator_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "Storyboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagram" ADD CONSTRAINT "Diagram_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "Storyboard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
