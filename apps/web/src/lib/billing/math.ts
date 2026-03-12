import { Prisma } from "../../generated/prisma/client";
import { centsToUsd, decimal, decimalMax, type DecimalInput } from "./amounts";

export interface LedgerBalanceRow {
	amount: Prisma.Decimal | number | string;
	createdAt: Date;
	expiresAt: Date | null;
}

export interface BalanceLot {
	createdAt: Date;
	expiresAt: Date | null;
	remaining: Prisma.Decimal;
}

export interface CreditBalanceSnapshot {
	available: Prisma.Decimal;
	nearestExpiry: Date | null;
	remainingLots: BalanceLot[];
	totalDebited: Prisma.Decimal;
	totalGranted: Prisma.Decimal;
}

function expireLots(lots: BalanceLot[], cutoff: Date): BalanceLot[] {
	return lots.filter((lot) => !lot.expiresAt || lot.expiresAt > cutoff);
}

function consumeLots(lots: BalanceLot[], debitAmount: Prisma.Decimal): BalanceLot[] {
	let remainingDebit = debitAmount;
	const nextLots: BalanceLot[] = [];

	for (const lot of lots) {
		if (remainingDebit.lessThanOrEqualTo(0)) {
			nextLots.push(lot);
			continue;
		}

		if (lot.remaining.lessThanOrEqualTo(remainingDebit)) {
			remainingDebit = remainingDebit.minus(lot.remaining);
			continue;
		}

		nextLots.push({
			...lot,
			remaining: lot.remaining.minus(remainingDebit),
		});
		remainingDebit = decimal(0);
	}

	return nextLots;
}

export function calculateCreditBalance(
	rows: LedgerBalanceRow[],
	now = new Date(),
): CreditBalanceSnapshot {
	let lots: BalanceLot[] = [];
	let totalGranted = decimal(0);
	let totalDebited = decimal(0);

	for (const row of rows) {
		lots = expireLots(lots, row.createdAt);

		const amount = decimal(row.amount);
		if (amount.greaterThan(0)) {
			totalGranted = totalGranted.plus(amount);
			lots.push({
				createdAt: row.createdAt,
				expiresAt: row.expiresAt,
				remaining: amount,
			});
			continue;
		}

		if (amount.lessThan(0)) {
			totalDebited = totalDebited.plus(amount.abs());
			lots = consumeLots(lots, amount.abs());
		}
	}

	lots = expireLots(lots, now);

	const available = lots.reduce((sum, lot) => sum.plus(lot.remaining), decimal(0));
	const nearestExpiry = lots.reduce<Date | null>((current, lot) => {
		if (!lot.expiresAt) {
			return current;
		}

		if (!current || lot.expiresAt < current) {
			return lot.expiresAt;
		}

		return current;
	}, null);

	return {
		available,
		nearestExpiry,
		remainingLots: lots,
		totalDebited,
		totalGranted,
	};
}

export function calculateRefundTargetUsd(
	paymentAmountUsd: DecimalInput,
	refundedAmountCents: number,
	refundedTaxAmountCents: number,
) {
	const originalBaseAmountCents = decimal(paymentAmountUsd)
		.mul(100)
		.toDecimalPlaces(0)
		.toNumber();
	const refundedBaseAmountCents = Math.min(
		originalBaseAmountCents,
		Math.max(0, refundedAmountCents - refundedTaxAmountCents),
	);

	return centsToUsd(refundedBaseAmountCents);
}

export function calculateRefundDeltaUsd(params: {
	paymentAmountUsd: DecimalInput;
	refundedAmountCents: number;
	refundedBaseAmountUsd: DecimalInput;
	refundedTaxAmountCents: number;
	reversedAmountUsd: DecimalInput;
	unrecoveredAmountUsd: DecimalInput;
}) {
	const refundTargetUsd = calculateRefundTargetUsd(
		params.paymentAmountUsd,
		params.refundedAmountCents,
		params.refundedTaxAmountCents,
	);
	const accountedRefundUsd = decimalMax(
		params.refundedBaseAmountUsd,
		decimal(params.reversedAmountUsd).plus(params.unrecoveredAmountUsd),
	);

	return {
		refundDeltaUsd: refundTargetUsd.minus(accountedRefundUsd),
		refundTargetUsd,
	};
}
