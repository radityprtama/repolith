import { prisma } from "../db";
import { getCreditBalance } from "./credit";
import { getActiveSubscription, getCurrentPeriodUsage, getSpendingLimit } from "./spending-limit";
import { getStripeClient, isStripeEnabled } from "./stripe";
import { isPolarEnabled } from "./polar";

/**
 * Determine the active payment gateway for a user.
 * Polar takes priority if both are configured and the user has a Polar customer ID.
 */
async function getPaymentGateway(
	userId: string,
): Promise<{ gateway: "polar" | "stripe" | null; customerId: string | null }> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { stripeCustomerId: true, polarCustomerId: true },
	});
	if (!user) return { gateway: null, customerId: null };

	// Polar takes priority if enabled and the user has a Polar customer
	if (isPolarEnabled && user.polarCustomerId) {
		return { gateway: "polar", customerId: user.polarCustomerId };
	}
	if (isStripeEnabled && user.stripeCustomerId) {
		return { gateway: "stripe", customerId: user.stripeCustomerId };
	}
	return { gateway: null, customerId: null };
}

// Lazy migration for users created before the Stripe plugin was installed.
// Creates a Stripe customer on first AI usage.
async function ensureStripeCustomer(userId: string): Promise<string | null> {
	if (!isStripeEnabled) return null;

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { email: true, name: true },
	});
	if (!user?.email) return null;

	try {
		const customer = await getStripeClient().customers.create({
			email: user.email,
			name: user.name ?? undefined,
			metadata: { userId, customerType: "user" },
		});
		await prisma.user.update({
			where: { id: userId },
			data: { stripeCustomerId: customer.id },
		});
		return customer.id;
	} catch (e) {
		console.error("[billing] ensureStripeCustomer failed:", e);
		return null;
	}
}

/**
 * Ensure the user has a payment gateway customer ID.
 * Tries Polar first (if enabled), falls back to Stripe.
 * Returns the gateway type and customer ID, or null if neither could be created.
 */
async function ensurePaymentCustomer(
	userId: string,
): Promise<{ gateway: "polar" | "stripe" | null; customerId: string | null }> {
	// First check if user already has a customer ID for either gateway
	const existing = await getPaymentGateway(userId);
	if (existing.customerId) return existing;

	// For Polar, customer creation is handled automatically by the plugin
	// via createCustomerOnSignUp, so we only do lazy migration for Stripe
	if (isStripeEnabled) {
		const stripeId = await ensureStripeCustomer(userId);
		if (stripeId) return { gateway: "stripe", customerId: stripeId };
	}

	return { gateway: null, customerId: null };
}

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

	// 2. Ensure user has a payment gateway customer
	const { gateway, customerId } = await ensurePaymentCustomer(userId);
	if (!customerId) {
		// Check if user even exists
		const userExists = await prisma.user.findUnique({
			where: { id: userId },
			select: { id: true },
		});
		if (!userExists) {
			return { allowed: false, current: 0, limit: 0 };
		}

		// No payment gateway customer — fall through to credit-only check
		const balance = await getCreditBalance(userId);
		if (balance.available <= 0) {
			return {
				allowed: false,
				current: 0,
				limit: 0,
				creditExhausted: true,
			};
		}
		return { allowed: true, current: 0, limit: 0 };
	}

	// 3. Active subscription — spending limit check
	const subscription = await getActiveSubscription(userId);
	if (subscription?.periodStart) {
		const [periodUsage, monthlyCapUsd] = await Promise.all([
			getCurrentPeriodUsage(userId, subscription.periodStart),
			getSpendingLimit(userId),
		]);
		if (monthlyCapUsd !== null && periodUsage >= monthlyCapUsd) {
			return {
				allowed: false,
				current: 0,
				limit: 0,
				spendingLimitReached: true,
			};
		}
		return { allowed: true, current: 0, limit: 0 };
	}

	// 4. Payment customer exists, no subscription — spending limit + credit balance check
	const [monthlyCapUsd, balance] = await Promise.all([
		getSpendingLimit(userId),
		getCreditBalance(userId),
	]);

	if (monthlyCapUsd !== null) {
		const monthStart = new Date();
		monthStart.setUTCDate(1);
		monthStart.setUTCHours(0, 0, 0, 0);
		const monthUsage = await getCurrentPeriodUsage(userId, monthStart);
		if (monthUsage >= monthlyCapUsd) {
			return {
				allowed: false,
				current: 0,
				limit: 0,
				spendingLimitReached: true,
			};
		}
	}

	if (balance.available <= 0) {
		return { allowed: false, current: 0, limit: 0, creditExhausted: true };
	}

	return { allowed: true, current: 0, limit: 0 };
}
