import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { BillingAmountError, normalizePurchaseAmount } from "@/lib/billing/amounts";
import { createCreditCheckout, isPolarEnabled } from "@/lib/billing/polar";

function getRequestIp(headersList: Headers): string | null {
	const forwardedFor = headersList.get("x-forwarded-for");
	if (forwardedFor) {
		return forwardedFor.split(",")[0]?.trim() ?? null;
	}

	return headersList.get("x-real-ip");
}

function buildBillingReturnUrl(req: Request, headersList: Headers, includeCheckoutId: boolean) {
	const requestUrl = new URL(req.url);
	const referer = headersList.get("referer");
	let targetUrl = new URL("/dashboard", requestUrl.origin);

	if (referer) {
		try {
			const refererUrl = new URL(referer);
			if (refererUrl.origin === requestUrl.origin) {
				targetUrl = refererUrl;
			}
		} catch {
			targetUrl = new URL("/dashboard", requestUrl.origin);
		}
	}

	targetUrl.searchParams.set("settings", "billing");
	if (includeCheckoutId) {
		targetUrl.searchParams.set("checkout_id", "{CHECKOUT_ID}");
	} else {
		targetUrl.searchParams.delete("checkout_id");
	}

	return targetUrl.toString();
}

export async function POST(req: Request) {
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (!isPolarEnabled) {
		return Response.json({ error: "Polar billing is not configured" }, { status: 503 });
	}

	let body: { amountUsd?: unknown };
	try {
		body = (await req.json()) as { amountUsd?: unknown };
	} catch {
		return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
	}

	try {
		const normalizedAmount = normalizePurchaseAmount(body.amountUsd);
		const checkout = await createCreditCheckout({
			baseAmountCents: normalizedAmount.baseAmountCents,
			customerEmail: session.user.email,
			customerIpAddress: getRequestIp(headersList),
			customerName: session.user.name,
			returnUrl: buildBillingReturnUrl(req, headersList, false),
			successUrl: buildBillingReturnUrl(req, headersList, true),
			userId: session.user.id,
		});

		return Response.json({
			baseAmountCents: normalizedAmount.baseAmountCents,
			baseAmountUsd: normalizedAmount.baseAmountUsd.toNumber(),
			checkoutId: checkout.id,
			creditsGranted: normalizedAmount.creditsGranted,
			url: checkout.url,
		});
	} catch (error) {
		if (error instanceof BillingAmountError) {
			return Response.json({ error: error.message }, { status: 400 });
		}

		console.error("[billing] createCreditCheckout failed:", error);
		return Response.json({ error: "Failed to create checkout" }, { status: 500 });
	}
}
