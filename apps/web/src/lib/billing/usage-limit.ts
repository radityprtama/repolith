import { prisma } from "../db";
import { isBillingExemptUser } from "./billing-exemption";
import { getCreditBalance } from "./credit";
import {
	getCurrentBillingPeriodStart,
	getCurrentPeriodUsage,
	getSpendingLimit,
} from "./spending-limit";

export async function checkUsageLimit(
	userId: string,
	isCustomApiKey = false,
): Promise<{
	allowed: boolean;
	current: number;
	limit: number;
	creditExhausted?: boolean;
	spendingLimitReached?: boolean;
}> {
	// 1. Custom API key — no cost to the app, always allowed
	if (isCustomApiKey) {
		return { allowed: true, current: 0, limit: 0 };
	}

	// 2. Admin users are exempt from app-billed usage limits.
	if (await isBillingExemptUser(userId)) {
		return { allowed: true, current: 0, limit: 0 };
	}

	// 3. User must exist and stay within current-month usage cap.
	const userExists = await prisma.user.findUnique({
		where: { id: userId },
		select: { id: true },
	});
	if (!userExists) {
		return { allowed: false, current: 0, limit: 0 };
	}

	const monthStart = getCurrentBillingPeriodStart();
	const [monthlyCapUsd, balance] = await Promise.all([
		getSpendingLimit(userId),
		getCreditBalance(userId),
	]);

	if (monthlyCapUsd !== null) {
		const monthUsage = await getCurrentPeriodUsage(userId, monthStart);
		if (monthUsage >= monthlyCapUsd) {
			return {
				allowed: false,
				current: monthUsage,
				limit: monthlyCapUsd,
				spendingLimitReached: true,
			};
		}
	}

	if (balance.available <= 0) {
		return {
			allowed: false,
			creditExhausted: true,
			current: 0,
			limit: monthlyCapUsd ?? 0,
		};
	}

	return { allowed: true, current: 0, limit: monthlyCapUsd ?? 0 };
}
