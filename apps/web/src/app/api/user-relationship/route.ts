import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getOctokit } from "@/lib/github";

function getStatus(error: unknown): number | undefined {
	return typeof error === "object" && error !== null && "status" in error
		? Number((error as { status?: unknown }).status)
		: undefined;
}

export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const username = searchParams.get("username");

	if (!username) {
		return NextResponse.json({ error: "Missing username parameter" }, { status: 400 });
	}

	const octokit = await getOctokit();
	if (!octokit) {
		return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
	}

	try {
		const sessionUser = await getAuthenticatedUser();
		const viewerLogin =
			typeof sessionUser?.login === "string" && sessionUser.login.length > 0
				? sessionUser.login
				: (await octokit.users.getAuthenticated()).data.login;
		const isOwnProfile = viewerLogin.toLowerCase() === username.toLowerCase();

		if (isOwnProfile) {
			return NextResponse.json(
				{ viewerLogin, isOwnProfile, isFollowing: false },
				{ headers: { "Cache-Control": "private, no-store" } },
			);
		}

		try {
			await octokit.users.checkPersonIsFollowedByAuthenticated({ username });
			return NextResponse.json(
				{ viewerLogin, isOwnProfile: false, isFollowing: true },
				{ headers: { "Cache-Control": "private, no-store" } },
			);
		} catch (error) {
			if (getStatus(error) === 404) {
				return NextResponse.json(
					{ viewerLogin, isOwnProfile: false, isFollowing: false },
					{ headers: { "Cache-Control": "private, no-store" } },
				);
			}
			if (getStatus(error) === 403) {
				return NextResponse.json(
					{ error: "Following requires GitHub follow permissions." },
					{ status: 403 },
				);
			}
			throw error;
		}
	} catch {
		return NextResponse.json(
			{ error: "Failed to fetch follow state" },
			{ status: 500 },
		);
	}
}
