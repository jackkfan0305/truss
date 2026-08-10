import "dotenv/config";

import assert from "node:assert/strict";

import {
  AI_REQUEST_LIMIT,
  AI_REQUEST_WINDOW_MS,
  consumeAiRequestSlot,
} from "../lib/ai-request-rate-limit";
import { prisma } from "../lib/prisma";

async function main() {
  const userId = `user-rate-limit-${Date.now()}`;
  const now = new Date("2026-08-10T20:00:00.000Z");

  try {
    const burst = await Promise.all(
      Array.from({ length: AI_REQUEST_LIMIT + 5 }, () =>
        consumeAiRequestSlot(userId, now),
      ),
    );

    assert.equal(
      burst.filter(Boolean).length,
      AI_REQUEST_LIMIT,
      "parallel requests cannot race beyond the durable cap",
    );

    assert.equal(
      await consumeAiRequestSlot(
        userId,
        new Date(now.getTime() + AI_REQUEST_WINDOW_MS + 1),
      ),
      true,
      "the next rolling window starts with a fresh slot",
    );
  } finally {
    await prisma.aiRequestRateLimit.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  }

  console.log("✅ AI request rate limit is atomic under a concurrent burst");
}

void main();
