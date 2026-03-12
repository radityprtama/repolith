import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../db";

const TX_MAX_RETRIES = 3;

export const SERIALIZABLE_TX_OPTIONS = {
	isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
	maxWait: 5000,
	timeout: 10000,
} as const;

export async function withSerializableTx<T>(
	fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await prisma.$transaction(fn, SERIALIZABLE_TX_OPTIONS);
		} catch (error) {
			const isWriteConflict =
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2034";

			if (isWriteConflict && attempt < TX_MAX_RETRIES) {
				continue;
			}

			throw error;
		}
	}
}
