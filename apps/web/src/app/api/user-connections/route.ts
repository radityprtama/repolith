import { NextRequest, NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";

type ConnectionType = "followers" | "following";

export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const username = searchParams.get("username");
	const type = searchParams.get("type");
	const page = Math.max(Number(searchParams.get("page")) || 1, 1);
	const perPage = Math.min(Math.max(Number(searchParams.get("per_page")) || 30, 1), 100);

	if (!username) {
		return NextResponse.json({ error: "Missing username parameter" }, { status: 400 });
	}

	if (type !== "followers" && type !== "following") {
		return NextResponse.json({ error: "Invalid connection type" }, { status: 400 });
	}

	const octokit = await getOctokit();
	if (!octokit) {
		return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
	}

	try {
		const response =
			type === "followers"
				? await octokit.users.listFollowersForUser({
						username,
						page,
						per_page: perPage,
					})
				: await octokit.users.listFollowingForUser({
						username,
						page,
						per_page: perPage,
					});

		const items = response.data.map((entry) => ({
			login: entry.login,
			id: entry.id,
			avatar_url: entry.avatar_url,
			html_url: entry.html_url,
			type: entry.type,
		}));

		return NextResponse.json(
			{
				items,
				page,
				hasMore: items.length === perPage,
				type: type as ConnectionType,
			},
			{
				headers: {
					"Cache-Control": "private, no-store",
				},
			},
		);
	} catch {
		return NextResponse.json({ error: `Failed to fetch ${type}` }, { status: 500 });
	}
}
