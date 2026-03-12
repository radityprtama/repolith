import { describe, expect, it } from "vitest";
import {
	buildPurchaseCheckoutMetadata,
	BillingAmountError,
	normalizePurchaseAmount,
	parsePurchaseCheckoutMetadata,
} from "./amounts";
import { calculateCreditBalance, calculateRefundDeltaUsd, calculateRefundTargetUsd } from "./math";

describe("PAYG billing amounts", () => {
	it("normalizes purchase amounts into pre-tax cents and credits", () => {
		const normalized = normalizePurchaseAmount("$5.00");

		expect(normalized.baseAmountCents).toBe(500);
		expect(normalized.baseAmountUsd.toNumber()).toBe(5);
		expect(normalized.creditsGranted).toBe(500);
	});

	it("rejects purchases below the app minimum", () => {
		expect(() => normalizePurchaseAmount("0.50")).toThrow(BillingAmountError);
	});

	it("round-trips purchase checkout metadata", () => {
		const metadata = buildPurchaseCheckoutMetadata({
			baseAmountCents: 500,
			userId: "user_123",
		});

		expect(parsePurchaseCheckoutMetadata(metadata)).toEqual(metadata);
	});
});

describe("PAYG billing ledger math", () => {
	it("preserves expiry-aware FIFO balance calculation", () => {
		const snapshot = calculateCreditBalance(
			[
				{
					amount: 10,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					expiresAt: new Date("2026-01-31T00:00:00.000Z"),
				},
				{
					amount: 5,
					createdAt: new Date("2026-01-10T00:00:00.000Z"),
					expiresAt: null,
				},
				{
					amount: 3,
					createdAt: new Date("2026-01-20T00:00:00.000Z"),
					expiresAt: new Date("2026-03-01T00:00:00.000Z"),
				},
				{
					amount: -8,
					createdAt: new Date("2026-01-15T00:00:00.000Z"),
					expiresAt: null,
				},
				{
					amount: -1,
					createdAt: new Date("2026-02-01T00:00:00.000Z"),
					expiresAt: null,
				},
			],
			new Date("2026-02-15T00:00:00.000Z"),
		);

		expect(snapshot.totalGranted.toNumber()).toBe(18);
		expect(snapshot.totalDebited.toNumber()).toBe(9);
		expect(snapshot.available.toNumber()).toBe(7);
		expect(snapshot.nearestExpiry?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
	});
});

describe("PAYG refund math", () => {
	it("uses the refunded pre-tax base amount only", () => {
		const refundTarget = calculateRefundTargetUsd(5, 550, 50);
		expect(refundTarget.toNumber()).toBe(5);
	});

	it("treats already-accounted refund deficits as idempotent", () => {
		const { refundDeltaUsd, refundTargetUsd } = calculateRefundDeltaUsd({
			paymentAmountUsd: 5,
			refundedAmountCents: 550,
			refundedBaseAmountUsd: 5,
			refundedTaxAmountCents: 50,
			reversedAmountUsd: 2,
			unrecoveredAmountUsd: 3,
		});

		expect(refundTargetUsd.toNumber()).toBe(5);
		expect(refundDeltaUsd.toNumber()).toBe(0);
	});

	it("applies only the new cumulative refund delta", () => {
		const { refundDeltaUsd } = calculateRefundDeltaUsd({
			paymentAmountUsd: 5,
			refundedAmountCents: 400,
			refundedBaseAmountUsd: 2,
			refundedTaxAmountCents: 0,
			reversedAmountUsd: 2,
			unrecoveredAmountUsd: 0,
		});

		expect(refundDeltaUsd.toNumber()).toBe(2);
	});
});
