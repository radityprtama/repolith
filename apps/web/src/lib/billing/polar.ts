import { Polar } from "@polar-sh/sdk";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { buildPurchaseCheckoutMetadata } from "./amounts";
import { BILLING_CURRENCY } from "./config";

function getRequiredEnv(name: "POLAR_ACCESS_TOKEN" | "POLAR_PRODUCT_ID" | "POLAR_WEBHOOK_SECRET") {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required for Polar billing`);
	}

	return value;
}

function shouldUseSandboxServer(): boolean {
	if (process.env.VERCEL_ENV) {
		return process.env.VERCEL_ENV !== "production";
	}

	return process.env.NODE_ENV !== "production";
}

export const isPolarEnabled = Boolean(
	process.env.POLAR_ACCESS_TOKEN && process.env.POLAR_PRODUCT_ID,
);

let polarClient: Polar | null = null;

export function getPolarClient(): Polar {
	if (!polarClient) {
		polarClient = new Polar({
			accessToken: getRequiredEnv("POLAR_ACCESS_TOKEN"),
			...(shouldUseSandboxServer() ? { server: "sandbox" } : {}),
		});
	}

	return polarClient;
}

export function getPolarProductId(): string {
	return getRequiredEnv("POLAR_PRODUCT_ID");
}

export function getPolarWebhookSecret(): string {
	return getRequiredEnv("POLAR_WEBHOOK_SECRET");
}

export async function createCreditCheckout(params: {
	baseAmountCents: number;
	customerEmail: string;
	customerIpAddress?: string | null;
	customerName?: string | null;
	returnUrl?: string | null;
	successUrl: string;
	userId: string;
}) {
	const productId = getPolarProductId();
	const metadata = buildPurchaseCheckoutMetadata({
		baseAmountCents: params.baseAmountCents,
		userId: params.userId,
	});

	return getPolarClient().checkouts.create({
		allowDiscountCodes: false,
		currency: BILLING_CURRENCY,
		customerEmail: params.customerEmail,
		customerIpAddress: params.customerIpAddress ?? undefined,
		customerName: params.customerName ?? undefined,
		externalCustomerId: params.userId,
		metadata,
		products: [productId],
		prices: {
			[productId]: [
				{
					amountType: "fixed",
					priceAmount: params.baseAmountCents,
					priceCurrency: BILLING_CURRENCY,
				},
			],
		},
		returnUrl: params.returnUrl ?? undefined,
		successUrl: params.successUrl,
	});
}

export function verifyPolarWebhook(body: string, headers: Headers) {
	const webhookHeaders = {
		"webhook-id": headers.get("webhook-id") ?? "",
		"webhook-signature": headers.get("webhook-signature") ?? "",
		"webhook-timestamp": headers.get("webhook-timestamp") ?? "",
	};
	const event = validateEvent(body, webhookHeaders, getPolarWebhookSecret());
	const eventId = webhookHeaders["webhook-id"];

	if (!eventId) {
		throw new Error("Polar webhook is missing webhook-id");
	}

	return { event, eventId };
}

export { WebhookVerificationError };
