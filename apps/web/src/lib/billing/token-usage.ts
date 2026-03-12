import type { LanguageModelUsage } from "ai";
import { Prisma } from "../../generated/prisma/client";
import {
	calculateCostUsd,
	hasModelPricing,
	type CostDetails,
	type UsageDetails,
} from "./ai-models";
import { decimal, toNegativeAmount } from "./amounts";
import { isBillingExemptUser } from "./billing-exemption";
import { getCreditBalanceSnapshot } from "./credit";
import { CREDIT_ENTRY_TYPE, FIXED_COSTS } from "./config";
import { withSerializableTx } from "./transaction";

class InsufficientCreditBalanceError extends Error {
	constructor() {
		super("Insufficient credit balance to record usage");
	}
}

function buildUsageDetails(usage: LanguageModelUsage): UsageDetails {
	const input = usage.inputTokens ?? 0;
	const output = usage.outputTokens ?? 0;
	const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? undefined;
	const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? undefined;
	const reasoning = usage.outputTokenDetails?.reasoningTokens ?? undefined;
	const total = usage.totalTokens ?? input + output;

	const details: UsageDetails = { input, output, total };
	if (cacheRead) details.cacheRead = cacheRead;
	if (cacheWrite) details.cacheWrite = cacheWrite;
	if (reasoning) details.reasoning = reasoning;

	return details;
}

function toJsonOrNull(obj: UsageDetails | CostDetails): string | null {
	const { total: _, ...rest } = obj;
	const hasValues = Object.values(rest).some((value) => value !== undefined && value > 0);
	return hasValues ? JSON.stringify(obj) : null;
}

async function ensureSufficientBalance(
	tx: Prisma.TransactionClient,
	userId: string,
	fullCostUsd: Prisma.Decimal,
): Promise<void> {
	const balance = await getCreditBalanceSnapshot(userId, tx);
	if (balance.available.lessThan(fullCostUsd)) {
		throw new InsufficientCreditBalanceError();
	}
}

export async function logTokenUsage(params: {
	conversationId?: string | undefined;
	isCustomApiKey: boolean;
	modelId: string;
	provider: string;
	taskType: string;
	usage: LanguageModelUsage;
	userId: string;
}): Promise<void> {
	const usageDetails = buildUsageDetails(params.usage);
	const isBillingExempt = await isBillingExemptUser(params.userId);
	const costDetails =
		params.isCustomApiKey || !hasModelPricing(params.modelId)
			? null
			: calculateCostUsd(params.modelId, usageDetails);
	const fullCostUsd = decimal(costDetails?.total ?? 0);

	await withSerializableTx(async (tx) => {
		const shouldBill =
			!params.isCustomApiKey && !isBillingExempt && fullCostUsd.greaterThan(0);

		if (shouldBill) {
			await ensureSufficientBalance(tx, params.userId, fullCostUsd);
		}

		const aiCallLog = await tx.aiCallLog.create({
			data: {
				conversationId: params.conversationId,
				costJson: costDetails ? toJsonOrNull(costDetails) : null,
				inputTokens: usageDetails.input,
				modelId: params.modelId,
				outputTokens: usageDetails.output,
				provider: params.provider,
				taskType: params.taskType,
				totalTokens: usageDetails.total,
				usageJson: toJsonOrNull(usageDetails),
				userId: params.userId,
				usingOwnKey: params.isCustomApiKey,
			},
		});

		const usageLog = await tx.usageLog.create({
			data: {
				aiCallLogId: aiCallLog.id,
				costUsd: shouldBill ? fullCostUsd : decimal(0),
				taskType: params.taskType,
				userId: params.userId,
			},
		});

		if (!shouldBill) {
			return;
		}

		await tx.creditLedger.create({
			data: {
				amount: toNegativeAmount(fullCostUsd),
				description: `AI usage: ${params.taskType}`,
				entryType: CREDIT_ENTRY_TYPE.USAGE_DEDUCTION,
				metadataJson: JSON.stringify({
					modelId: params.modelId,
					provider: params.provider,
					taskType: params.taskType,
				}),
				usageLogId: usageLog.id,
				userId: params.userId,
			},
		});
	});
}

export async function logFixedCostUsage(params: {
	costUsd?: number | undefined;
	taskType: string;
	userId: string;
}): Promise<void> {
	const fullCostUsd = decimal(
		params.costUsd ?? FIXED_COSTS[params.taskType as keyof typeof FIXED_COSTS] ?? 0,
	);
	const isBillingExempt = await isBillingExemptUser(params.userId);

	await withSerializableTx(async (tx) => {
		const shouldBill = !isBillingExempt && fullCostUsd.greaterThan(0);

		if (shouldBill) {
			await ensureSufficientBalance(tx, params.userId, fullCostUsd);
		}

		const usageLog = await tx.usageLog.create({
			data: {
				costUsd: shouldBill ? fullCostUsd : decimal(0),
				taskType: params.taskType,
				userId: params.userId,
			},
		});

		if (!shouldBill) {
			return;
		}

		await tx.creditLedger.create({
			data: {
				amount: toNegativeAmount(fullCostUsd),
				description: `AI usage: ${params.taskType}`,
				entryType: CREDIT_ENTRY_TYPE.USAGE_DEDUCTION,
				metadataJson: JSON.stringify({ taskType: params.taskType }),
				usageLogId: usageLog.id,
				userId: params.userId,
			},
		});
	});
}
