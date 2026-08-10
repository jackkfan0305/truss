import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const AI_REQUEST_LIMIT = 10;
export const AI_REQUEST_WINDOW_MS = 60_000;

/**
 * Consumes one per-user AI request slot in a single PostgreSQL statement.
 *
 * The conditional upsert is the lock: parallel requests for one user update the
 * same row, and once its count reaches the cap the `WHERE` clause returns no
 * row. An in-memory counter would split across serverless instances, while a
 * read-then-write pair could let a burst race past the limit.
 */
export async function consumeAiRequestSlot(
  userId: string,
  now = new Date(),
  client: Pick<typeof prisma, "$queryRaw"> = prisma,
): Promise<boolean> {
  const expiredBefore = new Date(now.getTime() - AI_REQUEST_WINDOW_MS);
  const rows = await client.$queryRaw<Array<{ requestCount: number }>>(
    Prisma.sql`
      INSERT INTO "AiRequestRateLimit" (
        "userId",
        "windowStartedAt",
        "requestCount",
        "updatedAt"
      )
      VALUES (${userId}, ${now}, 1, ${now})
      ON CONFLICT ("userId") DO UPDATE
      SET
        "windowStartedAt" = CASE
          WHEN "AiRequestRateLimit"."windowStartedAt" <= ${expiredBefore}
          THEN ${now}
          ELSE "AiRequestRateLimit"."windowStartedAt"
        END,
        "requestCount" = CASE
          WHEN "AiRequestRateLimit"."windowStartedAt" <= ${expiredBefore}
          THEN 1
          ELSE "AiRequestRateLimit"."requestCount" + 1
        END,
        "updatedAt" = ${now}
      WHERE
        "AiRequestRateLimit"."windowStartedAt" <= ${expiredBefore}
        OR "AiRequestRateLimit"."requestCount" < ${AI_REQUEST_LIMIT}
      RETURNING "requestCount"
    `,
  );

  return rows.length === 1;
}
