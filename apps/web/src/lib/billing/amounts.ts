import { z } from "zod";
import { Prisma } from "../../generated/prisma/client";
import {
	BILLING_CURRENCY,
	BILLING_METADATA_SCHEMA_VERSION,
	CREDITS_PER_USD,
	MIN_PURCHASE_CENTS,
	MIN_PURCHASE_USD,
} from "./config";

export type DecimalInput = Prisma.Decimal | number | string;

export class BillingAmountError extends Error {}

export interface PurchaseCheckoutMetadata {
	[key: string]: string | number | boolean;
	baseAmountCents: number;
	creditsGranted: number;
	currency: string;
	paymentAmountUsd: number;
	schemaVersion: number;
	userId: string;
}

export interface NormalizedPurchaseAmount {
	baseAmountCents: number;
	baseAmountUsd: Prisma.Decimal;
	creditsGranted: number;
}

const purchaseMetadataSchema = z.object({
	baseAmountCents: z.number().int().positive(),
	creditsGranted: z.number().positive(),
	currency: z.string().trim().toLowerCase(),
	paymentAmountUsd: z.number().positive(),
	schemaVersion: z.number().int().positive(),
	userId: z.string().min(1),
});

function normalizeDecimalInput(value: number | string): string {
	return typeof value === "number" ? value.toString() : value;
}

export function decimal(value: DecimalInput): Prisma.Decimal {
	if (Prisma.Decimal.isDecimal(value)) {
		return value;
	}

	return new Prisma.Decimal(normalizeDecimalInput(value));
}

export function decimalMax(left: DecimalInput, right: DecimalInput): Prisma.Decimal {
	const leftDecimal = decimal(left);
	const rightDecimal = decimal(right);

	return leftDecimal.greaterThanOrEqualTo(rightDecimal) ? leftDecimal : rightDecimal;
}

export function decimalMin(left: DecimalInput, right: DecimalInput): Prisma.Decimal {
	const leftDecimal = decimal(left);
	const rightDecimal = decimal(right);

	return leftDecimal.lessThanOrEqualTo(rightDecimal) ? leftDecimal : rightDecimal;
}

export function decimalToNumber(value: DecimalInput): number {
	return decimal(value).toNumber();
}

export function centsToUsd(cents: number): Prisma.Decimal {
	return new Prisma.Decimal(cents).div(100);
}

export function usdToCredits(amountUsd: DecimalInput): Prisma.Decimal {
	return decimal(amountUsd).mul(CREDITS_PER_USD);
}

export function creditsToUsd(credits: DecimalInput): Prisma.Decimal {
	return decimal(credits).div(CREDITS_PER_USD);
}

export function toNegativeAmount(amount: DecimalInput): Prisma.Decimal {
	return decimal(amount).abs().negated();
}

export function toPositiveAmount(amount: DecimalInput): Prisma.Decimal {
	return decimal(amount).abs();
}

export function buildPurchaseCheckoutMetadata(params: {
	baseAmountCents: number;
	userId: string;
}): PurchaseCheckoutMetadata {
	const paymentAmountUsd = centsToUsd(params.baseAmountCents).toNumber();

	return {
		baseAmountCents: params.baseAmountCents,
		creditsGranted: params.baseAmountCents,
		currency: BILLING_CURRENCY,
		paymentAmountUsd,
		schemaVersion: BILLING_METADATA_SCHEMA_VERSION,
		userId: params.userId,
	};
}

export function parsePurchaseCheckoutMetadata(
	metadata: Record<string, string | number | boolean>,
): PurchaseCheckoutMetadata {
	const parsed = purchaseMetadataSchema.safeParse(metadata);
	if (!parsed.success) {
		throw new BillingAmountError("Polar checkout metadata is invalid");
	}

	if (parsed.data.currency !== BILLING_CURRENCY) {
		throw new BillingAmountError("Polar checkout currency must be USD");
	}

	if (parsed.data.schemaVersion !== BILLING_METADATA_SCHEMA_VERSION) {
		throw new BillingAmountError("Unsupported checkout metadata schema version");
	}

	const expectedUsd = centsToUsd(parsed.data.baseAmountCents).toNumber();
	if (parsed.data.paymentAmountUsd !== expectedUsd) {
		throw new BillingAmountError("Polar checkout amount metadata is inconsistent");
	}

	if (parsed.data.creditsGranted !== parsed.data.baseAmountCents) {
		throw new BillingAmountError("Polar checkout credits metadata is inconsistent");
	}

	return parsed.data;
}

export function normalizePurchaseAmount(input: unknown): NormalizedPurchaseAmount {
	const rawValue =
		typeof input === "number"
			? input.toString()
			: typeof input === "string"
				? input.trim()
				: "";

	const sanitized = rawValue.replace(/[$,\s]/g, "");
	if (!/^\d+(?:\.\d{1,2})?$/.test(sanitized)) {
		throw new BillingAmountError("Enter a valid USD amount with up to 2 decimals");
	}

	const baseAmountUsd = decimal(sanitized);
	if (!baseAmountUsd.isFinite() || baseAmountUsd.lessThanOrEqualTo(0)) {
		throw new BillingAmountError("Purchase amount must be positive");
	}

	const baseAmountCents = baseAmountUsd.mul(100);
	if (!baseAmountCents.isInteger()) {
		throw new BillingAmountError("Purchase amount must resolve to whole cents");
	}

	if (baseAmountCents.lessThan(MIN_PURCHASE_CENTS)) {
		throw new BillingAmountError(`Minimum purchase is $${MIN_PURCHASE_USD.toFixed(2)}`);
	}

	return {
		baseAmountCents: baseAmountCents.toNumber(),
		baseAmountUsd,
		creditsGranted: baseAmountCents.toNumber(),
	};
}
