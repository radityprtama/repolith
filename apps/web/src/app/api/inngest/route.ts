import { serve } from "inngest/next";
import { embedContent, inngest } from "@/lib/inngest";

export const { GET, POST, PUT } = serve({
	client: inngest,
	functions: [embedContent],
});
