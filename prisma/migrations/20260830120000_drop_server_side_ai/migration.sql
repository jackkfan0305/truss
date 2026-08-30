-- Truss runs no model of its own (docs/adr/0001-no-server-side-ai.md). The three
-- tables that only ever served the removed server-side AI tier go with it.
-- Nothing else references them: ProjectSpec owns the only foreign key among the
-- three and it points at Project, so each table takes its own constraints down.
--
-- On any deployment with existing ProjectSpec rows, run
-- `npx tsx scripts/cleanup-spec-blobs.ts` first: it deletes the private
-- specs/{projectId}/{specId}.md blobs those rows point at. This migration only
-- drops the pointers; it does not touch Vercel Blob.

DROP TABLE "ProjectSpec";

DROP TABLE "TaskRun";

DROP TABLE "AiRequestRateLimit";
