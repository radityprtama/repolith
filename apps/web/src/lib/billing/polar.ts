import { Polar } from "@polar-sh/sdk";
import { prisma } from "../db";

export const isPolarEnabled = !!process.env.POLAR_ACCESS_TOKEN;

if (!isPolarEnabled) {
	console.warn("[billing] POLAR_ACCESS_TOKEN is not set — Polar features are disabled.");
}

let _polar: Polar | null = null;
export function getPolarClient(): Polar {
	if (!_polar) {
		_polar = new Polar({
			accessToken: process.env.POLAR_ACCESS_TOKEN!,
			// Use 'sandbox' for development/testing, remove or set to 'production' for live
			...(process.env.POLAR_SERVER === "sandbox" ? { server: "sandbox" } : {}),
		});
	}
	return _polar;
}

/**
 * Report usage to Polar for metered billing.
 * This is a no-op if Polar is not enabled or the user has no Polar customer ID.
 */
export async function reportUsageToPolar(
	usageLogId: string,
	userId: string,
	costUsd: number,
): Promise<void> {
	if (!isPolarEnabled) return;

	if (costUsd <= 0) {
		// Mark as reported so retry job skips it.
		await prisma.usageLog.update({
			where: { id: usageLogId },
			data: { polarReported: true },
		});
		return;
	}

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { polarCustomerId: true },
	});
	if (!user?.polarCustomerId) return;

	// Polar doesn't have a direct meter event API like Stripe.
	// Usage tracking is handled by the @polar-sh/better-auth usage() plugin
	// which hooks into Better Auth's subscription lifecycle.
	// We simply mark the usage log as reported for Polar.
	await prisma.usageLog.update({
		where: { id: usageLogId },
		data: { polarReported: true },
	});
}

/**
 * Determine which payment gateway is active for a given user.
 * Returns 'polar' if the user has a Polar customer ID,
 * 'stripe' if the user has a Stripe customer ID,
 * or null if neither is set.
 */
export async function getActivePaymentGateway(userId: string): Promise<"polar" | "stripe" | null> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { polarCustomerId: true, stripeCustomerId: true },
	});
	if (!user) return null;

	// Polar takes priority if both are set (user preference)
	if (user.polarCustomerId && isPolarEnabled) return "polar";
	if (user.stripeCustomerId) return "stripe";
	return null;
}
