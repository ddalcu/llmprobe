-- CreateTable
CREATE TABLE "Run" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Run_createdAt_idx" ON "Run"("createdAt");
