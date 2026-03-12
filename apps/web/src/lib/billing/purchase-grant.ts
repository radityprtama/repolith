import { Prisma } from "../../generated/prisma/client";
import { decimal, decimalMin, parsePurchaseCheckoutMetadata, toNegativeAmount } from "./amounts";
import { getCreditBalanceSnapshot } from "./credit";
import { BILLING_CURRENCY, CREDIT_ENTRY_TYPE, PURCHASE_GRANT_STATUS } from "./config";
import { calculateRefundDeltaUsd } from "./math";
import { withSerializableTx } from "./transaction";

interface PolarOrderLike {
	checkoutId: string | null;
	currency: string;
	id: string;
	metadata: Record<string, string | number | boolean>;
	refundedAmount: number;
	refundedTaxAmount: number;
}

function serializePurchaseGrantMetadata(order: PolarOrderLike, eventId: string): string {
	return JSON.stringify({
		checkoutId: order.checkoutId,
		currency: order.currency,
		polarEventId: eventId,
		sourceMetadata: order.metadata,
	});
}

function buildRefundStatus(params: {
	paymentAmountUsd: Prisma.Decimal;
	refundTargetUsd: Prisma.Decimal;
	unrecoveredAmountUsd: Prisma.Decimal;
}) {
	if (params.unrecoveredAmountUsd.greaterThan(0)) {
		return PURCHASE_GRANT_STATUS.REFUND_DEFICIT;
	}

	if (params.refundTargetUsd.greaterThanOrEqualTo(params.paymentAmountUsd)) {
		return PURCHASE_GRANT_STATUS.REFUNDED;
	}

	return PURCHASE_GRANT_STATUS.PARTIALLY_REFUNDED;
}

export async function grantCreditsForPaidOrder(params: {
	eventId: string;
	order: PolarOrderLike;
	processedAt?: Date;
}) {
	const metadata = parsePurchaseCheckoutMetadata(params.order.metadata);
	const normalizedCurrency = params.order.currency.toLowerCase();

	if (normalizedCurrency !== BILLING_CURRENCY || metadata.currency !== BILLING_CURRENCY) {
		throw new Error("Only USD Polar credit purchases are supported");
	}

	return withSerializableTx(async (tx) => {
		const user = await tx.user.findUnique({
			where: { id: metadata.userId },
			select: { id: true },
		});
		if (!user) {
			throw new Error(
				`User ${metadata.userId} not found for Polar purchase grant`,
			);
		}

		const existingGrant = await tx.purchaseGrant.findUnique({
			where: { polarOrderId: params.order.id },
			include: {
				creditEntries: {
					select: { id: true },
					take: 1,
					where: { entryType: CREDIT_ENTRY_TYPE.PURCHASE_GRANT },
				},
			},
		});

		if (existingGrant?.creditEntries.length) {
			return {
				creditsGranted: metadata.creditsGranted,
				noOp: true,
				purchaseGrantId: existingGrant.id,
			};
		}

		if (existingGrant && existingGrant.userId !== metadata.userId) {
			throw new Error(
				`Polar order ${params.order.id} is linked to a different user`,
			);
		}

		const purchaseGrant = existingGrant
			? await tx.purchaseGrant.update({
					where: { id: existingGrant.id },
					data: {
						creditsGranted: decimal(metadata.creditsGranted),
						currency: metadata.currency,
						metadataJson: serializePurchaseGrantMetadata(
							params.order,
							params.eventId,
						),
						paymentAmountUsd: decimal(
							metadata.paymentAmountUsd,
						),
						polarCheckoutId: params.order.checkoutId,
						polarEventId: params.eventId,
						status: PURCHASE_GRANT_STATUS.PENDING,
					},
				})
			: await tx.purchaseGrant.create({
					data: {
						creditsGranted: decimal(metadata.creditsGranted),
						currency: metadata.currency,
						metadataJson: serializePurchaseGrantMetadata(
							params.order,
							params.eventId,
						),
						paymentAmountUsd: decimal(
							metadata.paymentAmountUsd,
						),
						polarCheckoutId: params.order.checkoutId,
						polarEventId: params.eventId,
						polarOrderId: params.order.id,
						status: PURCHASE_GRANT_STATUS.PENDING,
						userId: metadata.userId,
					},
				});

		await tx.creditLedger.create({
			data: {
				amount: decimal(metadata.paymentAmountUsd),
				description: `Purchased ${metadata.creditsGranted} credits`,
				entryType: CREDIT_ENTRY_TYPE.PURCHASE_GRANT,
				metadataJson: JSON.stringify({
					baseAmountCents: metadata.baseAmountCents,
					creditsGranted: metadata.creditsGranted,
					polarCheckoutId: params.order.checkoutId,
					polarEventId: params.eventId,
					polarOrderId: params.order.id,
				}),
				purchaseGrantId: purchaseGrant.id,
				userId: metadata.userId,
			},
		});

		await tx.purchaseGrant.update({
			where: { id: purchaseGrant.id },
			data: {
				metadataJson: serializePurchaseGrantMetadata(
					params.order,
					params.eventId,
				),
				polarCheckoutId: params.order.checkoutId,
				polarEventId: params.eventId,
				status: PURCHASE_GRANT_STATUS.GRANTED,
			},
		});

		return {
			creditsGranted: metadata.creditsGranted,
			noOp: false,
			purchaseGrantId: purchaseGrant.id,
		};
	});
}

export async function applyRefundToPurchaseGrant(params: {
	eventId: string;
	order: PolarOrderLike;
	processedAt?: Date;
}) {
	return withSerializableTx(async (tx) => {
		const purchaseGrant = await tx.purchaseGrant.findUnique({
			where: { polarOrderId: params.order.id },
		});
		if (!purchaseGrant) {
			throw new Error(
				`Purchase grant not found for Polar order ${params.order.id}`,
			);
		}

		const paymentAmountUsd = decimal(purchaseGrant.paymentAmountUsd);
		const { refundDeltaUsd, refundTargetUsd } = calculateRefundDeltaUsd({
			paymentAmountUsd,
			refundedAmountCents: params.order.refundedAmount,
			refundedBaseAmountUsd: purchaseGrant.refundedBaseAmountUsd,
			refundedTaxAmountCents: params.order.refundedTaxAmount,
			reversedAmountUsd: purchaseGrant.reversedAmountUsd,
			unrecoveredAmountUsd: purchaseGrant.unrecoveredAmountUsd,
		});

		if (refundDeltaUsd.lessThanOrEqualTo(0)) {
			return {
				noOp: true,
				purchaseGrantId: purchaseGrant.id,
				recoverableUsd: 0,
				unrecoveredUsd: 0,
			};
		}

		const balance = await getCreditBalanceSnapshot(purchaseGrant.userId, tx);
		const recoverableUsd = decimalMin(balance.available, refundDeltaUsd);
		const unrecoveredUsd = refundDeltaUsd.minus(recoverableUsd);

		if (recoverableUsd.greaterThan(0)) {
			await tx.creditLedger.create({
				data: {
					amount: toNegativeAmount(recoverableUsd),
					description: "Refund reversal",
					entryType: CREDIT_ENTRY_TYPE.REFUND_REVERSAL,
					metadataJson: JSON.stringify({
						polarEventId: params.eventId,
						polarOrderId: params.order.id,
						recoverableUsd: recoverableUsd.toString(),
						refundTargetUsd: refundTargetUsd.toString(),
						unrecoveredUsd: unrecoveredUsd.toString(),
					}),
					purchaseGrantId: purchaseGrant.id,
					userId: purchaseGrant.userId,
				},
			});
		}

		const nextReversedAmountUsd = decimal(purchaseGrant.reversedAmountUsd).plus(
			recoverableUsd,
		);
		const nextUnrecoveredAmountUsd = decimal(purchaseGrant.unrecoveredAmountUsd).plus(
			unrecoveredUsd,
		);

		await tx.purchaseGrant.update({
			where: { id: purchaseGrant.id },
			data: {
				lastRefundEventId: params.eventId,
				polarCheckoutId:
					params.order.checkoutId ?? purchaseGrant.polarCheckoutId,
				refundedAt: params.processedAt ?? new Date(),
				refundedBaseAmountUsd: refundTargetUsd,
				reversedAmountUsd: nextReversedAmountUsd,
				status: buildRefundStatus({
					paymentAmountUsd,
					refundTargetUsd,
					unrecoveredAmountUsd: nextUnrecoveredAmountUsd,
				}),
				unrecoveredAmountUsd: nextUnrecoveredAmountUsd,
			},
		});

		return {
			noOp: false,
			purchaseGrantId: purchaseGrant.id,
			recoverableUsd: recoverableUsd.toNumber(),
			unrecoveredUsd: unrecoveredUsd.toNumber(),
		};
	});
}
