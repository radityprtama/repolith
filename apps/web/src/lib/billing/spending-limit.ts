import { prisma } from "../db";
import { MIN_CAP_USD } from "./config";

export interface SpendingLimitInfo {
	monthlyCapUsd: number | null;
	periodStart: Date;
	periodUsageUsd: number;
	remainingUsd: number | null;
}

export function getCurrentBillingPeriodStart(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function getSpendingLimit(userId: string): Promise<number | null> {
	const config = await prisma.spendingLimit.findUnique({ where: { userId } });
	return config ? Number(config.monthlyCapUsd) : null;
}

export async function updateSpendingLimit(
	userId: string,
	monthlyCapUsd: number | null,
): Promise<number | null> {
	if (monthlyCapUsd === null) {
		await prisma.spendingLimit.deleteMany({ where: { userId } });
		return null;
	}

	if (!Number.isFinite(monthlyCapUsd)) {
		throw new Error("Spending limit must be a finite USD amount");
	}

	const normalizedCapUsd = Math.round(monthlyCapUsd * 100) / 100;
	if (normalizedCapUsd < MIN_CAP_USD) {
		throw new Error(`Spending limit must be at least $${MIN_CAP_USD.toFixed(2)}`);
	}

	const config = await prisma.spendingLimit.upsert({
		where: { userId },
		create: {
			monthlyCapUsd: normalizedCapUsd,
			userId,
		},
		update: { monthlyCapUsd: normalizedCapUsd },
	});

	return Number(config.monthlyCapUsd);
}

export async function getCurrentPeriodUsage(userId: string, periodStart: Date): Promise<number> {
	const result = await prisma.usageLog.aggregate({
		where: {
			createdAt: { gte: periodStart },
			userId,
		},
		_sum: { costUsd: true },
	});

	return Number(result._sum.costUsd ?? 0);
}

export async function getSpendingLimitInfo(
	userId: string,
	now = new Date(),
): Promise<SpendingLimitInfo> {
	const periodStart = getCurrentBillingPeriodStart(now);
	const [monthlyCapUsd, periodUsageUsd] = await Promise.all([
		getSpendingLimit(userId),
		getCurrentPeriodUsage(userId, periodStart),
	]);

	return {
		monthlyCapUsd,
		periodStart,
		periodUsageUsd,
		remainingUsd:
			monthlyCapUsd !== null ? Math.max(0, monthlyCapUsd - periodUsageUsd) : null,
	};
}
