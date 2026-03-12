import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getBillingHistory } from "@/lib/billing/credit";

export async function GET(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(req.url);
	const rawLimit = Number(url.searchParams.get("limit") ?? 50);
	const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
	const history = await getBillingHistory(session.user.id, limit);

	return Response.json({ entries: history });
}
