"use server";

import { revalidatePath } from "next/cache";
import { getOctokit } from "@/lib/github";
import { getErrorMessage } from "@/lib/utils";

export async function followUser(username: string) {
	const octokit = await getOctokit();
	if (!octokit) return { error: "Not authenticated" };

	try {
		await octokit.users.follow({ username });
		revalidatePath(`/users/${username}`);
		return { success: true };
	} catch (e: unknown) {
		return { error: getErrorMessage(e) || "Failed to follow user" };
	}
}

export async function unfollowUser(username: string) {
	const octokit = await getOctokit();
	if (!octokit) return { error: "Not authenticated" };

	try {
		await octokit.users.unfollow({ username });
		revalidatePath(`/users/${username}`);
		return { success: true };
	} catch (e: unknown) {
		return { error: getErrorMessage(e) || "Failed to unfollow user" };
	}
}
