import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getActivePaymentGateway } from "@/lib/billing/polar";
import { isStripeEnabled } from "@/lib/billing/stripe";
import { isPolarEnabled } from "@/lib/billing/polar";

type BillingGateway = "stripe" | "polar";

function getPreferredGatewayFromEnv(): BillingGateway | null {
	const raw = (process.env.PAYMENT_GATEWAY ?? process.env.NEXT_PUBLIC_PAYMENT_GATEWAY ?? "")
		.toLowerCase()
		.trim();

	if (raw === "stripe" || raw === "polar") return raw;
	return null;
}

function resolvePreferredEnabledGateway(): BillingGateway | null {
	const envPreferred = getPreferredGatewayFromEnv();

	if (envPreferred === "polar" && isPolarEnabled) return "polar";
	if (envPreferred === "stripe" && isStripeEnabled) return "stripe";

	if (isPolarEnabled) return "polar";
	if (isStripeEnabled) return "stripe";
	return null;
}

export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const linkedGateway = await getActivePaymentGateway(session.user.id);
	const preferredGateway = resolvePreferredEnabledGateway();
	const activeGateway = linkedGateway ?? preferredGateway;

	return Response.json({
		activeGateway,
		linkedGateway,
		preferredGateway,
		available: {
			stripe: isStripeEnabled,
			polar: isPolarEnabled,
		},
	});
}
