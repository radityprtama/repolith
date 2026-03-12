"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Key, Wallet } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { UserSettings } from "@/lib/user-settings-store";

interface BillingTabProps {
	onNavigate: (tab: "general" | "editor" | "ai" | "billing" | "account") => void;
	settings: UserSettings;
}

interface BalanceData {
	available: number;
	availableCredits: number;
	nearestExpiry: string | null;
	totalDebited: number;
	totalDebitedCredits: number;
	totalGranted: number;
	totalGrantedCredits: number;
	welcomed: boolean;
}

interface SpendingLimitData {
	availableCredits: number;
	availableUsd: number;
	monthlyCapUsd: number | null;
	periodStart: string;
	periodUsageUsd: number;
	remainingUsd: number | null;
}

interface BillingHistoryEntry {
	amountCredits: number;
	amountUsd: number;
	createdAt: string;
	description: string;
	entryType: string;
	expiresAt: string | null;
	id: string;
	taskType: string | null;
}

interface BillingHistoryData {
	entries: BillingHistoryEntry[];
}

function formatUsd(amount: number): string {
	return new Intl.NumberFormat("en-US", {
		currency: "USD",
		maximumFractionDigits: 4,
		minimumFractionDigits: amount % 1 === 0 ? 2 : 2,
		style: "currency",
	}).format(amount);
}

function formatCredits(amount: number): string {
	return new Intl.NumberFormat("en-US", {
		maximumFractionDigits: 4,
		minimumFractionDigits: 0,
	}).format(amount);
}

function formatDate(date: string | Date): string {
	return new Date(date).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

function getPurchasePreview(input: string) {
	const sanitized = input.trim().replace(/[$,\s]/g, "");
	if (!/^\d+(?:\.\d{1,2})?$/.test(sanitized)) {
		return null;
	}

	const baseAmountUsd = Number(sanitized);
	if (!Number.isFinite(baseAmountUsd) || baseAmountUsd <= 0) {
		return null;
	}

	const baseAmountCents = Math.round(baseAmountUsd * 100);
	return {
		baseAmountCents,
		baseAmountUsd: baseAmountCents / 100,
		creditsGranted: baseAmountCents,
	};
}

async function fetchBalance(): Promise<BalanceData> {
	const res = await fetch("/api/billing/balance");
	if (!res.ok) {
		throw new Error("Failed to load balance");
	}

	return res.json();
}

async function fetchSpendingLimit(): Promise<SpendingLimitData> {
	const res = await fetch("/api/billing/spending-limit");
	if (!res.ok) {
		throw new Error("Failed to load spending limit");
	}

	return res.json();
}

async function fetchHistory(): Promise<BillingHistoryData> {
	const res = await fetch("/api/billing/history");
	if (!res.ok) {
		throw new Error("Failed to load billing history");
	}

	return res.json();
}

async function patchSpendingLimit(monthlyCapUsd: number | null) {
	const res = await fetch("/api/billing/spending-limit", {
		body: JSON.stringify({ monthlyCapUsd }),
		headers: { "Content-Type": "application/json" },
		method: "PATCH",
	});
	if (!res.ok) {
		const data = await res.json();
		throw new Error(data.error ?? "Failed to update spending limit");
	}

	return res.json();
}

async function claimWelcomeCredit() {
	const res = await fetch("/api/billing/welcome", { method: "POST" });
	if (!res.ok) {
		throw new Error("Failed to claim welcome credit");
	}

	return res.json();
}

async function createCheckout(amountUsd: string) {
	const res = await fetch("/api/billing/checkout", {
		body: JSON.stringify({ amountUsd }),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});

	const data = await res.json();
	if (!res.ok) {
		throw new Error(data.error ?? "Failed to create checkout");
	}

	return data as { url: string };
}

export function BillingTab({ settings, onNavigate }: BillingTabProps) {
	const queryClient = useQueryClient();
	const [limitDialogOpen, setLimitDialogOpen] = useState(false);
	const [limitEnabled, setLimitEnabled] = useState(false);
	const [limitAmount, setLimitAmount] = useState("10.00");
	const [purchaseAmount, setPurchaseAmount] = useState("10.00");

	const {
		data: balance,
		error: balanceError,
		isLoading: balanceLoading,
	} = useQuery({
		queryKey: ["billing-balance"],
		queryFn: fetchBalance,
		refetchOnMount: "always",
		refetchOnWindowFocus: "always",
		staleTime: 30_000,
	});

	const {
		data: spendingLimit,
		error: spendingLimitError,
		isLoading: spendingLimitLoading,
	} = useQuery({
		queryKey: ["billing-spending-limit"],
		queryFn: fetchSpendingLimit,
		refetchOnMount: "always",
		refetchOnWindowFocus: "always",
		staleTime: 30_000,
	});

	const {
		data: history,
		error: historyError,
		isLoading: historyLoading,
	} = useQuery({
		queryKey: ["billing-history"],
		queryFn: fetchHistory,
		refetchOnMount: "always",
		refetchOnWindowFocus: "always",
		staleTime: 30_000,
	});

	const invalidateBilling = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ["billing-balance"] }),
			queryClient.invalidateQueries({ queryKey: ["billing-history"] }),
			queryClient.invalidateQueries({ queryKey: ["billing-spending-limit"] }),
		]);

	const limitMutation = useMutation({
		mutationFn: patchSpendingLimit,
		onSuccess: async () => {
			await invalidateBilling();
			setLimitDialogOpen(false);
		},
	});

	const welcomeCreditMutation = useMutation({
		mutationFn: claimWelcomeCredit,
		onSuccess: invalidateBilling,
	});

	const checkoutMutation = useMutation({
		mutationFn: createCheckout,
		onSuccess: ({ url }) => {
			window.location.href = url;
		},
	});

	const loading = balanceLoading || historyLoading || spendingLimitLoading;
	const error =
		balanceError ??
		historyError ??
		spendingLimitError ??
		limitMutation.error ??
		welcomeCreditMutation.error ??
		checkoutMutation.error ??
		null;

	const purchasePreview = getPurchasePreview(purchaseAmount);
	const monthlyCapUsd = spendingLimit?.monthlyCapUsd ?? null;
	const periodUsageUsd = spendingLimit?.periodUsageUsd ?? 0;
	const remainingUsd = spendingLimit?.remainingUsd ?? null;
	const usagePct =
		monthlyCapUsd !== null && monthlyCapUsd > 0
			? Math.min(100, Math.round((periodUsageUsd / monthlyCapUsd) * 100))
			: null;
	const hasByok = settings.useOwnApiKey && Boolean(settings.openrouterApiKey);

	function openLimitDialog() {
		if (monthlyCapUsd !== null) {
			setLimitEnabled(true);
			setLimitAmount(monthlyCapUsd.toFixed(2));
		} else {
			setLimitEnabled(false);
			setLimitAmount("10.00");
		}

		setLimitDialogOpen(true);
	}

	function handleSaveLimit() {
		if (!limitEnabled) {
			limitMutation.mutate(null);
			return;
		}

		const parsed = Number(limitAmount);
		if (!Number.isFinite(parsed) || parsed < 0.01) {
			setLimitAmount("0.01");
			limitMutation.mutate(0.01);
			return;
		}

		limitMutation.mutate(parsed);
	}

	function handlePurchase() {
		if (!purchasePreview) {
			return;
		}

		checkoutMutation.mutate(purchasePreview.baseAmountUsd.toFixed(2));
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center px-4 py-12">
				<span className="text-[10px] font-mono text-muted-foreground/50">
					Loading billing...
				</span>
			</div>
		);
	}

	if (error && !balance) {
		return (
			<div className="px-4 py-12 text-center">
				<p className="text-xs font-mono text-destructive">
					{error instanceof Error
						? error.message
						: "Failed to load billing"}
				</p>
			</div>
		);
	}

	return (
		<div className="divide-y divide-border">
			<div className="px-4 py-4">
				<label className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
					<Wallet className="h-3 w-3" />
					Balance
				</label>
				{balance && (
					<div className="mt-3 space-y-3">
						<div>
							<p className="text-xl font-mono tabular-nums">
								{formatCredits(
									balance.availableCredits,
								)}
								<span className="ml-1.5 text-xs text-muted-foreground">
									credits
								</span>
							</p>
							<p className="mt-1 text-[11px] font-mono text-muted-foreground">
								{formatUsd(balance.available)}{" "}
								available
							</p>
						</div>

						<div className="grid gap-3 border-t border-border/50 pt-3 sm:grid-cols-2">
							<div>
								<p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
									Added
								</p>
								<p className="mt-1 text-sm font-mono tabular-nums">
									{formatCredits(
										balance.totalGrantedCredits,
									)}{" "}
									credits
								</p>
							</div>
							<div>
								<p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
									Deducted
								</p>
								<p className="mt-1 text-sm font-mono tabular-nums">
									{formatCredits(
										balance.totalDebitedCredits,
									)}{" "}
									credits
								</p>
							</div>
						</div>

						{balance.nearestExpiry && (
							<p className="rounded border border-border/70 px-3 py-2 text-[11px] font-mono text-muted-foreground">
								Welcome credit expires{" "}
								{formatDate(balance.nearestExpiry)}.
							</p>
						)}

						{!balance.welcomed && (
							<div className="rounded border border-border/70 px-3 py-3">
								<p className="text-xs font-mono">
									Your signup credit has not
									been granted yet.
								</p>
								<button
									type="button"
									onClick={() =>
										welcomeCreditMutation.mutate()
									}
									disabled={
										welcomeCreditMutation.isPending
									}
									className="mt-3 border border-border px-3 py-1.5 text-xs font-mono text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
								>
									{welcomeCreditMutation.isPending
										? "Granting..."
										: "Claim welcome credit"}
								</button>
							</div>
						)}
					</div>
				)}
			</div>

			<div className="px-4 py-4">
				<label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
					Purchase Credits
				</label>
				<p className="mt-1 text-[10px] font-mono text-muted-foreground/60">
					1 credit = $0.01. Taxes are handled by Polar and do not add
					credits.
				</p>
				<div className="mt-3 flex flex-col gap-3 rounded border border-border p-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<label className="text-xs font-mono text-muted-foreground">
							Amount
						</label>
						<div className="flex flex-1 items-center border border-border px-2.5 py-2">
							<span className="mr-2 text-sm font-mono text-muted-foreground">
								$
							</span>
							<input
								type="text"
								inputMode="decimal"
								value={purchaseAmount}
								onChange={(event) =>
									setPurchaseAmount(
										event.target.value,
									)
								}
								className="min-w-0 flex-1 bg-transparent text-sm font-mono outline-none"
								placeholder="10.00"
							/>
						</div>
					</div>

					<div className="rounded border border-border/70 px-3 py-2.5">
						<p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
							Preview
						</p>
						{purchasePreview ? (
							<p className="mt-1 text-sm font-mono tabular-nums">
								{formatUsd(
									purchasePreview.baseAmountUsd,
								)}{" "}
								→{" "}
								{formatCredits(
									purchasePreview.creditsGranted,
								)}{" "}
								credits
							</p>
						) : (
							<p className="mt-1 text-xs font-mono text-destructive">
								Enter a valid USD amount with up to
								2 decimals.
							</p>
						)}
					</div>

					<button
						type="button"
						onClick={handlePurchase}
						disabled={
							!purchasePreview ||
							checkoutMutation.isPending
						}
						className="border border-border px-3 py-2 text-xs font-mono text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
					>
						{checkoutMutation.isPending
							? "Redirecting..."
							: "Continue to checkout"}
					</button>
				</div>
			</div>

			<div className="px-4 py-4">
				<label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
					Usage Safety Limit
				</label>
				<div className="mt-3 space-y-3">
					<div className="flex items-baseline justify-between gap-3">
						<div>
							<p className="text-lg font-mono tabular-nums">
								{formatUsd(periodUsageUsd)}
							</p>
							<p className="mt-1 text-[10px] font-mono text-muted-foreground/60">
								Used since{" "}
								{spendingLimit
									? formatDate(
											spendingLimit.periodStart,
										)
									: "this month"}
							</p>
						</div>
						<div className="text-right">
							<p className="text-xs font-mono text-muted-foreground">
								Limit{" "}
								<span className="text-foreground">
									{monthlyCapUsd !== null
										? formatUsd(
												monthlyCapUsd,
											)
										: "No limit"}
								</span>
							</p>
							{remainingUsd !== null && (
								<p className="mt-1 text-[10px] font-mono text-muted-foreground/60">
									{formatUsd(remainingUsd)}{" "}
									remaining
								</p>
							)}
						</div>
					</div>

					{usagePct !== null && (
						<div className="space-y-2">
							<div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
								<div
									className={cn(
										"h-full rounded-full transition-all",
										usagePct >= 90
											? "bg-destructive"
											: "bg-foreground/80",
									)}
									style={{
										width: `${usagePct}%`,
									}}
								/>
							</div>
							<p className="text-[10px] font-mono text-muted-foreground/60">
								This safety cap stops AI usage for
								the rest of the month after it is
								reached. Remaining prepaid credits
								stay in your balance.
							</p>
						</div>
					)}

					<button
						type="button"
						onClick={openLimitDialog}
						className="text-left text-[10px] font-mono text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
					>
						Adjust monthly limit
					</button>
				</div>

				<Dialog open={limitDialogOpen} onOpenChange={setLimitDialogOpen}>
					<DialogContent className="sm:max-w-sm">
						<DialogHeader>
							<DialogTitle className="text-sm font-mono">
								Monthly Spending Limit
							</DialogTitle>
							<DialogDescription className="text-xs font-mono">
								This caps monthly AI usage value
								even if you still have credits left.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-3 py-2">
							<label className="flex cursor-pointer items-center gap-2.5">
								<span
									className={cn(
										"flex h-3.5 w-3.5 items-center justify-center rounded-full border",
										!limitEnabled
											? "border-foreground"
											: "border-muted-foreground/30",
									)}
								>
									{!limitEnabled && (
										<span className="h-1.5 w-1.5 rounded-full bg-foreground" />
									)}
								</span>
								<input
									type="radio"
									name="spending-limit"
									checked={!limitEnabled}
									onChange={() =>
										setLimitEnabled(
											false,
										)
									}
									className="sr-only"
								/>
								<span className="text-xs font-mono">
									No limit
								</span>
							</label>
							<label className="flex cursor-pointer items-center gap-2.5">
								<span
									className={cn(
										"flex h-3.5 w-3.5 items-center justify-center rounded-full border",
										limitEnabled
											? "border-foreground"
											: "border-muted-foreground/30",
									)}
								>
									{limitEnabled && (
										<span className="h-1.5 w-1.5 rounded-full bg-foreground" />
									)}
								</span>
								<input
									type="radio"
									name="spending-limit"
									checked={limitEnabled}
									onChange={() =>
										setLimitEnabled(
											true,
										)
									}
									className="sr-only"
								/>
								<span className="flex items-center gap-1.5 text-xs font-mono">
									<span className="text-muted-foreground">
										$
									</span>
									<input
										type="text"
										inputMode="decimal"
										value={limitAmount}
										onChange={(
											event,
										) => {
											setLimitAmount(
												event
													.target
													.value,
											);
											setLimitEnabled(
												true,
											);
										}}
										onFocus={() =>
											setLimitEnabled(
												true,
											)
										}
										className="w-16 border border-border bg-transparent px-1.5 py-0.5 text-xs font-mono outline-none focus:border-foreground/30"
									/>
									<span className="text-muted-foreground/60">
										per month
									</span>
								</span>
							</label>
						</div>
						<DialogFooter>
							<button
								type="button"
								onClick={() =>
									setLimitDialogOpen(false)
								}
								className="border border-border px-3 py-1.5 text-xs font-mono text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSaveLimit}
								disabled={limitMutation.isPending}
								className="border border-border px-3 py-1.5 text-xs font-mono text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
							>
								{limitMutation.isPending
									? "Saving..."
									: "Save"}
							</button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			<div className="px-4 py-4">
				<label className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
					<Key className="h-3 w-3" />
					API Key
				</label>
				<p className="mt-1 text-[10px] font-mono text-muted-foreground/60">
					{hasByok
						? "Your OpenRouter API key is active. Requests use your own billing."
						: "No API key configured. AI requests use your Repolith credit balance."}
				</p>
				{!hasByok && (
					<button
						type="button"
						onClick={() => onNavigate("ai")}
						className="mt-2 text-[10px] font-mono text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
					>
						Configure in AI / Model settings
					</button>
				)}
			</div>

			<div className="px-4 py-4">
				<label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
					Transaction History
				</label>
				<p className="mt-1 text-[10px] font-mono text-muted-foreground/60">
					Local ledger entries for purchases, welcome credits, usage,
					refunds, and manual adjustments.
				</p>
				<div className="mt-3 space-y-2">
					{history?.entries.length ? (
						history.entries.map((entry) => (
							<div
								key={entry.id}
								className="flex items-start justify-between gap-3 rounded border border-border/70 px-3 py-2.5"
							>
								<div className="min-w-0">
									<p className="truncate text-xs font-mono">
										{entry.description}
									</p>
									<p className="mt-1 text-[10px] font-mono text-muted-foreground/60">
										{formatDate(
											entry.createdAt,
										)}
										{entry.expiresAt &&
											` • expires ${formatDate(entry.expiresAt)}`}
									</p>
								</div>
								<div className="text-right">
									<p
										className={cn(
											"text-xs font-mono tabular-nums",
											entry.amountUsd >=
												0
												? "text-foreground"
												: "text-destructive",
										)}
									>
										{entry.amountUsd >=
										0
											? "+"
											: ""}
										{formatCredits(
											entry.amountCredits,
										)}{" "}
										cr
									</p>
									<p className="mt-1 text-[10px] font-mono text-muted-foreground/60">
										{entry.amountUsd >=
										0
											? "+"
											: ""}
										{formatUsd(
											entry.amountUsd,
										)}
									</p>
								</div>
							</div>
						))
					) : (
						<div className="rounded border border-dashed border-border px-3 py-6 text-center">
							<p className="text-xs font-mono text-muted-foreground">
								No billing activity yet.
							</p>
						</div>
					)}
				</div>
			</div>

			{error && (
				<div className="px-4 py-4">
					<div className="flex items-start gap-2 rounded border border-destructive/20 bg-destructive/5 px-3 py-2.5">
						<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
						<p className="text-xs font-mono text-destructive">
							{error instanceof Error
								? error.message
								: "Billing action failed"}
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
