-- Truss runs no model of its own (docs/adr/0001-no-server-side-ai.md). The three
-- tables that only ever served the removed server-side AI tier go with it.
-- Nothing else references them: ProjectSpec owns the only foreign key among the
-- three and it points at Project, so each table takes its own constraints down.

DROP TABLE "ProjectSpec";

DROP TABLE "TaskRun";

DROP TABLE "AiRequestRateLimit";
