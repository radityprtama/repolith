import { BillingAmountError } from "@/lib/billing/amounts";
import { applyRefundToPurchaseGrant, grantCreditsForPaidOrder } from "@/lib/billing/purchase-grant";
import { verifyPolarWebhook, WebhookVerificationError } from "@/lib/billing/polar";

export async function POST(req: Request) {
	const rawBody = await req.text();

	try {
		const { event, eventId } = verifyPolarWebhook(rawBody, req.headers);

		switch (event.type) {
			case "order.paid":
				await grantCreditsForPaidOrder({
					eventId,
					order: {
						checkoutId: event.data.checkoutId,
						currency: event.data.currency,
						id: event.data.id,
						metadata: event.data.metadata,
						refundedAmount: event.data.refundedAmount,
						refundedTaxAmount: event.data.refundedTaxAmount,
					},
					processedAt: event.timestamp,
				});
				return Response.json({ ok: true });

			case "order.refunded":
				await applyRefundToPurchaseGrant({
					eventId,
					order: {
						checkoutId: event.data.checkoutId,
						currency: event.data.currency,
						id: event.data.id,
						metadata: event.data.metadata,
						refundedAmount: event.data.refundedAmount,
						refundedTaxAmount: event.data.refundedTaxAmount,
					},
					processedAt: event.timestamp,
				});
				return Response.json({ ok: true });

			default:
				return Response.json({ ignored: true, ok: true });
		}
	} catch (error) {
		if (error instanceof WebhookVerificationError) {
			return Response.json({ error: error.message }, { status: 400 });
		}

		if (error instanceof BillingAmountError) {
			return Response.json({ error: error.message }, { status: 422 });
		}

		console.error("[billing] polar webhook failed:", error);
		return Response.json({ error: "Webhook processing failed" }, { status: 500 });
	}
}
