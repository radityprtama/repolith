import { auth } from "@/lib/auth";
import { getCreditBalance, hasWelcomeCredit } from "@/lib/billing/credit";
import { headers } from "next/headers";

export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return new Response("Unauthorized", { status: 401 });
	}

	const [balance, welcomed] = await Promise.all([
		getCreditBalance(session.user.id),
		hasWelcomeCredit(session.user.id),
	]);

	return Response.json({
		...balance,
		nearestExpiry: balance.nearestExpiry?.toISOString() ?? null,
		welcomed,
	});
}
