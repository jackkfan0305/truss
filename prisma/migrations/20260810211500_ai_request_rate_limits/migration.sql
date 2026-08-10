-- CreateTable
CREATE TABLE "AiRequestRateLimit" (
    "userId" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRequestRateLimit_pkey" PRIMARY KEY ("userId")
);
