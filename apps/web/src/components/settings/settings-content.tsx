"use client";

import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Settings, Bot, CreditCard, User, Code2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { GeneralTab } from "./tabs/general-tab";
import { AIModelTab } from "./tabs/ai-model-tab";
import { BillingTab } from "./tabs/billing-tab";
import { AccountTab } from "./tabs/account-tab";
import { EditorTab } from "./tabs/editor-tab";
import type { UserSettings } from "@/lib/user-settings-store";
import type { GitHubProfile } from "./settings-dialog";
import { useMutationEvents } from "@/components/shared/mutation-event-provider";

const TABS = [
	{ id: "general", label: "General", icon: Settings },
	{ id: "editor", label: "Editor", icon: Code2 },
	{ id: "ai", label: "AI / Model", icon: Bot },
	{ id: "billing", label: "Billing", icon: CreditCard },
	{ id: "account", label: "Account", icon: User },
] as const;

export type TabId = (typeof TABS)[number]["id"];

interface SettingsContentProps {
	initialSettings: UserSettings;
	initialTab?: TabId;
	user: { name: string; email: string; image: string | null };
	githubProfile: GitHubProfile;
	onThemeTransition?: () => void;
}

export function SettingsContent({
	initialSettings,
	initialTab,
	user,
	githubProfile,
	onThemeTransition,
}: SettingsContentProps) {
	const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "general");
	const [settings, setSettings] = useState(initialSettings);
	const { emit } = useMutationEvents();
	const queryClient = useQueryClient();
	const updateSeqRef = useRef(0);
	const activeTabConfig = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
	const ActiveTabIcon = activeTabConfig.icon;

	function handleTabChange(nextTab: TabId) {
		setActiveTab(nextTab);
	}

	async function handleUpdate(updates: Partial<UserSettings>) {
		const prev = settings;
		// Don't optimistically expose raw API keys — server returns masked
		const safeUpdates = { ...updates };
		if (
			"openrouterApiKey" in safeUpdates &&
			typeof safeUpdates.openrouterApiKey === "string"
		) {
			delete safeUpdates.openrouterApiKey;
		}
		if ("githubPat" in safeUpdates && typeof safeUpdates.githubPat === "string") {
			delete safeUpdates.githubPat;
		}
		if (Object.keys(safeUpdates).length > 0) {
			setSettings((s) => ({ ...s, ...safeUpdates }));
			queryClient.setQueryData<UserSettings>(["user-settings"], (current) =>
				current ? { ...current, ...safeUpdates } : current,
			);
			emit({ type: "settings:updated" });
		}

		const seq = ++updateSeqRef.current;
		try {
			const res = await fetch("/api/user-settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(updates),
			});

			if (seq !== updateSeqRef.current) return;

			if (res.ok) {
				const updated = (await res.json()) as UserSettings;
				setSettings(updated);
				queryClient.setQueryData(["user-settings"], updated);
				await queryClient.invalidateQueries({
					queryKey: ["user-settings"],
				});
				emit({ type: "settings:updated" });
			} else {
				const refetch = await fetch("/api/user-settings");
				if (refetch.ok) {
					const restored = (await refetch.json()) as UserSettings;
					setSettings(restored);
					queryClient.setQueryData(["user-settings"], restored);
				} else {
					setSettings(prev);
					queryClient.setQueryData(["user-settings"], prev);
				}
			}
		} catch {
			if (seq !== updateSeqRef.current) return;
			setSettings(prev);
			queryClient.setQueryData(["user-settings"], prev);
		}
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			{/* Header */}
			<div className="shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
				<h1 className="text-xl font-medium tracking-tight">Settings</h1>
				<p className="mt-1 font-mono text-[11px] text-muted-foreground">
					Manage your preferences, AI model configuration, and
					account.
				</p>
			</div>

			{/* Mobile section selector */}
			<div className="shrink-0 px-4 pb-3 sm:hidden">
				<label
					htmlFor="settings-tab-select"
					className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
				>
					Section
				</label>
				<div className="relative mt-2">
					<ActiveTabIcon className="pointer-events-none absolute top-1/2 left-3 size-3 -translate-y-1/2 text-muted-foreground" />
					<select
						id="settings-tab-select"
						value={activeTab}
						onChange={(event) =>
							handleTabChange(event.target.value as TabId)
						}
						className="h-10 w-full appearance-none border border-border bg-background py-2.5 pr-9 pl-8 text-[11px] font-mono uppercase tracking-wider text-foreground outline-none transition-colors focus:border-foreground/20 focus:ring-[3px] focus:ring-ring/50"
					>
						{TABS.map((tab) => (
							<option key={tab.id} value={tab.id}>
								{tab.label}
							</option>
						))}
					</select>
					<ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3 -translate-y-1/2 text-muted-foreground" />
				</div>
			</div>

			{/* Tab bar */}
			<div
				role="tablist"
				aria-label="Settings sections"
				className="mx-4 mb-0 hidden shrink-0 items-center overflow-x-auto border border-border no-scrollbar sm:mx-6 sm:flex"
			>
				{TABS.map(({ id, label, icon: Icon }) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={activeTab === id}
						onClick={() => handleTabChange(id)}
						className={cn(
							"flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[11px] font-mono uppercase tracking-wider transition-colors cursor-pointer sm:px-4",
							activeTab === id
								? "bg-muted/50 text-foreground dark:bg-white/[0.04]"
								: "text-muted-foreground hover:text-foreground/60",
						)}
					>
						<Icon className="h-3 w-3" />
						{label}
					</button>
				))}
			</div>

			{/* Content — only this area scrolls */}
			<div className="mx-4 mb-4 flex-1 min-h-0 min-w-0 overflow-y-auto border border-border sm:mx-6 sm:mb-6 sm:border-t-0">
				{activeTab === "general" && (
					<GeneralTab
						settings={settings}
						onUpdate={handleUpdate}
						onThemeTransition={onThemeTransition}
					/>
				)}
				{activeTab === "editor" && <EditorTab />}
				{activeTab === "ai" && (
					<AIModelTab settings={settings} onUpdate={handleUpdate} />
				)}
				{activeTab === "billing" && (
					<BillingTab
						settings={settings}
						onNavigate={handleTabChange}
					/>
				)}
				{activeTab === "account" && (
					<AccountTab
						user={user}
						settings={settings}
						onUpdate={handleUpdate}
						githubProfile={githubProfile}
					/>
				)}
			</div>
		</div>
	);
}
