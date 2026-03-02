-- AlterTable
ALTER TABLE "usage_logs" ADD COLUMN     "polarReported" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "polarCustomerId" TEXT;

-- CreateIndex
CREATE INDEX "usage_logs_polarReported_createdAt_idx" ON "usage_logs"("polarReported", "createdAt");
