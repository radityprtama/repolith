-- Drop obsolete usage-reporting indexes before removing their columns.
DROP INDEX IF EXISTS "usage_logs_stripeReported_createdAt_idx";
DROP INDEX IF EXISTS "usage_logs_polarReported_createdAt_idx";

-- Add new ledger linkage columns first so historical usage can be backfilled.
ALTER TABLE "credit_ledger"
	ADD COLUMN "metadataJson" TEXT,
	ADD COLUMN "purchaseGrantId" TEXT,
	ADD COLUMN "usageLogId" TEXT;

-- Historical usage must become full consumed value, not overflow-only value.
UPDATE "usage_logs"
SET "costUsd" = "costUsd" + "creditUsed";

-- Backfill one negative ledger row for every historical credit deduction.
INSERT INTO "credit_ledger" (
	"id",
	"userId",
	"amount",
	"type",
	"description",
	"metadataJson",
	"usageLogId",
	"createdAt"
)
SELECT
	'usage-migration-' || "id",
	"userId",
	-("creditUsed"),
	'usage_deduction',
	'AI usage',
	json_build_object(
		'migratedFromCreditUsed',
		true,
		'usageLogId',
		"id"
	)::text,
	"id",
	"createdAt"
FROM "usage_logs"
WHERE "creditUsed" > 0;

CREATE TABLE "purchase_grant" (
	"id" TEXT NOT NULL,
	"userId" TEXT NOT NULL,
	"polarOrderId" TEXT NOT NULL,
	"polarEventId" TEXT NOT NULL,
	"polarCheckoutId" TEXT,
	"paymentAmountUsd" DECIMAL(10,6) NOT NULL,
	"creditsGranted" DECIMAL(10,6) NOT NULL,
	"currency" TEXT NOT NULL,
	"status" TEXT NOT NULL,
	"metadataJson" TEXT,
	"refundedAt" TIMESTAMP(3),
	"refundedBaseAmountUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
	"reversedAmountUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
	"unrecoveredAmountUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
	"lastRefundEventId" TEXT,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMP(3) NOT NULL,

	CONSTRAINT "purchase_grant_pkey" PRIMARY KEY ("id")
);

-- Remove old subscription and gateway-customer bookkeeping.
DROP TABLE "subscription";

ALTER TABLE "user"
	DROP COLUMN "stripeCustomerId",
	DROP COLUMN "polarCustomerId";

ALTER TABLE "usage_logs"
	DROP COLUMN "creditUsed",
	DROP COLUMN "stripeReported",
	DROP COLUMN "polarReported";

CREATE UNIQUE INDEX "credit_ledger_usageLogId_key" ON "credit_ledger"("usageLogId");
CREATE INDEX "credit_ledger_purchaseGrantId_idx" ON "credit_ledger"("purchaseGrantId");
CREATE UNIQUE INDEX "purchase_grant_polarOrderId_key" ON "purchase_grant"("polarOrderId");
CREATE INDEX "purchase_grant_userId_createdAt_idx" ON "purchase_grant"("userId", "createdAt");
CREATE INDEX "purchase_grant_status_createdAt_idx" ON "purchase_grant"("status", "createdAt");

ALTER TABLE "credit_ledger"
	ADD CONSTRAINT "credit_ledger_purchaseGrantId_fkey"
	FOREIGN KEY ("purchaseGrantId") REFERENCES "purchase_grant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credit_ledger"
	ADD CONSTRAINT "credit_ledger_usageLogId_fkey"
	FOREIGN KEY ("usageLogId") REFERENCES "usage_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_grant"
	ADD CONSTRAINT "purchase_grant_userId_fkey"
	FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
