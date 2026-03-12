import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../db";
import { decimalToNumber, toPositiveAmount, usdToCredits } from "./amounts";
import {
	BILLING_HISTORY_LIMIT,
	CREDIT_ENTRY_TYPE,
	WELCOME_CREDIT_EXPIRY_DAYS,
	WELCOME_CREDIT_USD,
} from "./config";
import { calculateCreditBalance, type CreditBalanceSnapshot } from "./math";
import { withSerializableTx } from "./transaction";

export interface CreditBalance {
	available: number;
	availableCredits: number;
	nearestExpiry: Date | null;
	totalDebited: number;
	totalDebitedCredits: number;
	totalGranted: number;
	totalGrantedCredits: number;
}

export interface BillingHistoryEntry {
	amountCredits: number;
	amountUsd: number;
	createdAt: string;
	description: string;
	entryType: string;
	expiresAt: string | null;
	id: string;
	metadata: Record<string, unknown> | null;
	purchaseGrant: {
		creditsGranted: number;
		currency: string;
		paymentAmountUsd: number;
		polarOrderId: string;
		refundedAt: string | null;
		status: string;
	} | null;
	taskType: string | null;
}

function parseMetadataJson(metadataJson: string | null): Record<string, unknown> | null {
	if (!metadataJson) return null;

	try {
		const parsed = JSON.parse(metadataJson) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function getFallbackDescription(entryType: string, taskType: string | null): string {
	switch (entryType) {
		case CREDIT_ENTRY_TYPE.PURCHASE_GRANT:
			return "Credit purchase";
		case CREDIT_ENTRY_TYPE.REFUND_REVERSAL:
			return "Refund reversal";
		case CREDIT_ENTRY_TYPE.USAGE_DEDUCTION:
			return taskType ? `AI usage: ${taskType}` : "AI usage";
		case CREDIT_ENTRY_TYPE.WELCOME_CREDIT:
			return "Welcome credit";
		case CREDIT_ENTRY_TYPE.MANUAL_ADJUSTMENT:
			return "Manual adjustment";
		default:
			return "Ledger entry";
	}
}

export async function grantSignupCredits(userId: string): Promise<void> {
	if (WELCOME_CREDIT_USD <= 0) return;

	await withSerializableTx(async (tx) => {
		const existing = await tx.creditLedger.findFirst({
			where: {
				entryType: CREDIT_ENTRY_TYPE.WELCOME_CREDIT,
				userId,
			},
			select: { id: true },
		});
		if (existing) return;

		const expiresAt = new Date(
			Date.now() + WELCOME_CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
		);
		await tx.creditLedger.create({
			data: {
				amount: toPositiveAmount(WELCOME_CREDIT_USD),
				description: "Welcome credit on signup",
				entryType: CREDIT_ENTRY_TYPE.WELCOME_CREDIT,
				expiresAt,
				metadataJson: JSON.stringify({ source: "signup" }),
				userId,
			},
		});
	});
}

export async function getCreditBalanceSnapshot(
	userId: string,
	tx?: Prisma.TransactionClient,
): Promise<CreditBalanceSnapshot> {
	const db = tx ?? prisma;
	const ledgerRows = await db.creditLedger.findMany({
		where: { userId },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		select: {
			amount: true,
			createdAt: true,
			expiresAt: true,
		},
	});

	return calculateCreditBalance(ledgerRows);
}

export async function getCreditBalance(
	userId: string,
	tx?: Prisma.TransactionClient,
): Promise<CreditBalance> {
	const snapshot = await getCreditBalanceSnapshot(userId, tx);

	return {
		available: decimalToNumber(snapshot.available),
		availableCredits: decimalToNumber(usdToCredits(snapshot.available)),
		nearestExpiry: snapshot.nearestExpiry,
		totalDebited: decimalToNumber(snapshot.totalDebited),
		totalDebitedCredits: decimalToNumber(usdToCredits(snapshot.totalDebited)),
		totalGranted: decimalToNumber(snapshot.totalGranted),
		totalGrantedCredits: decimalToNumber(usdToCredits(snapshot.totalGranted)),
	};
}

export async function hasWelcomeCredit(userId: string): Promise<boolean> {
	const count = await prisma.creditLedger.count({
		where: {
			entryType: CREDIT_ENTRY_TYPE.WELCOME_CREDIT,
			userId,
		},
	});
	return count > 0;
}

export async function getBillingHistory(
	userId: string,
	limit = BILLING_HISTORY_LIMIT,
): Promise<BillingHistoryEntry[]> {
	const rows = await prisma.creditLedger.findMany({
		where: { userId },
		include: {
			purchaseGrant: {
				select: {
					creditsGranted: true,
					currency: true,
					paymentAmountUsd: true,
					polarOrderId: true,
					refundedAt: true,
					status: true,
				},
			},
			usageLog: {
				select: {
					taskType: true,
				},
			},
		},
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: Math.max(1, Math.min(limit, 100)),
	});

	return rows.map((row) => ({
		amountCredits: decimalToNumber(usdToCredits(row.amount)),
		amountUsd: decimalToNumber(row.amount),
		createdAt: row.createdAt.toISOString(),
		description:
			row.description ??
			getFallbackDescription(row.entryType, row.usageLog?.taskType ?? null),
		entryType: row.entryType,
		expiresAt: row.expiresAt?.toISOString() ?? null,
		id: row.id,
		metadata: parseMetadataJson(row.metadataJson),
		purchaseGrant: row.purchaseGrant
			? {
					creditsGranted: decimalToNumber(
						row.purchaseGrant.creditsGranted,
					),
					currency: row.purchaseGrant.currency,
					paymentAmountUsd: decimalToNumber(
						row.purchaseGrant.paymentAmountUsd,
					),
					polarOrderId: row.purchaseGrant.polarOrderId,
					refundedAt:
						row.purchaseGrant.refundedAt?.toISOString() ?? null,
					status: row.purchaseGrant.status,
				}
			: null,
		taskType: row.usageLog?.taskType ?? null,
	}));
}
