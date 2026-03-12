export const BILLING_ERROR = {
	MESSAGE_LIMIT_REACHED: "MESSAGE_LIMIT_REACHED",
	CREDIT_EXHAUSTED: "CREDIT_EXHAUSTED",
	SPENDING_LIMIT_REACHED: "SPENDING_LIMIT_REACHED",
} as const;

export type BillingErrorCode = (typeof BILLING_ERROR)[keyof typeof BILLING_ERROR];

export function getBillingErrorCode(result: {
	creditExhausted?: boolean;
	spendingLimitReached?: boolean;
}): BillingErrorCode {
	if (result.creditExhausted) return BILLING_ERROR.CREDIT_EXHAUSTED;
	if (result.spendingLimitReached) return BILLING_ERROR.SPENDING_LIMIT_REACHED;
	return BILLING_ERROR.MESSAGE_LIMIT_REACHED;
}

export const BILLING_CURRENCY = "usd";
export const CREDITS_PER_USD = 100;

export const CREDIT_ENTRY_TYPE = {
	MANUAL_ADJUSTMENT: "manual_adjustment",
	PURCHASE_GRANT: "purchase_grant",
	REFUND_REVERSAL: "refund_reversal",
	USAGE_DEDUCTION: "usage_deduction",
	WELCOME_CREDIT: "welcome_credit",
} as const;

export type CreditEntryType = (typeof CREDIT_ENTRY_TYPE)[keyof typeof CREDIT_ENTRY_TYPE];

export const PURCHASE_GRANT_STATUS = {
	FAILED: "failed",
	GRANTED: "granted",
	PENDING: "pending",
	PARTIALLY_REFUNDED: "partially_refunded",
	REFUNDED: "refunded",
	REFUND_DEFICIT: "refund_deficit",
} as const;

export type PurchaseGrantStatus =
	(typeof PURCHASE_GRANT_STATUS)[keyof typeof PURCHASE_GRANT_STATUS];

export const BILLING_METADATA_SCHEMA_VERSION = 1;
export const BILLING_HISTORY_LIMIT = 50;

export const MIN_CAP_USD = 0.01;
export const MIN_PURCHASE_USD = 1;
export const MIN_PURCHASE_CENTS = MIN_PURCHASE_USD * CREDITS_PER_USD;

export const WELCOME_CREDIT_USD = 10;
export const WELCOME_CREDIT_EXPIRY_DAYS = 30;

export const FIXED_COSTS = {
	sandbox: 0,
} as const;
