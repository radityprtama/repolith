import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { auth } from "./auth";
import { dashClient, sentinelClient } from "@better-auth/infra/client";
import { stripeClient } from "@better-auth/stripe/client";
import { polarClient } from "@polar-sh/better-auth/client";

export const authClient = createAuthClient({
	plugins: [
		inferAdditionalFields<typeof auth>(),
		dashClient(),
		sentinelClient(),
		stripeClient({ subscription: true }),
		polarClient(),
	],
});

export const { signIn, signOut, useSession } = authClient;
