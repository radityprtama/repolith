import { Inngest } from "inngest";
import { embedText, embedTexts } from "@/lib/mixedbread";
import {
	getExistingContentHash,
	hashContent,
	upsertEmbedding,
	type ContentType,
} from "@/lib/embedding-store";

export const inngest = new Inngest({ id: "better-github" });

interface ContentViewedData {
	userId: string;
	contentType: "pr" | "issue";
	owner: string;
	repo: string;
	number: number;
	title: string;
	body: string;
	comments?: {
		id: number | string;
		body: string;
		author: string;
		createdAt: string;
	}[];
	reviews?: {
		id: number | string;
		body: string;
		author: string;
		state: string;
		createdAt: string;
	}[];
}

export const embedContent = inngest.createFunction(
	{
		id: "embed-content",
		concurrency: [{ limit: 5 }],
		retries: 3,
	},
	{ event: "app/content.viewed" },
	async ({ event, step }) => {
		const data = event.data as ContentViewedData;
		const {
			userId,
			contentType,
			owner,
			repo,
			number: itemNumber,
			title,
			body,
			comments,
			reviews,
		} = data;

		const contentKey = `${owner}/${repo}#${itemNumber}`;

		// Step 1: Embed the main item (title + body)
		await step.run("embed-main-item", async () => {
			const text = `${title}\n\n${body}`;
			const hash = hashContent(text);

			const existingHash = await getExistingContentHash(
				userId,
				contentType,
				contentKey,
			);
			if (existingHash === hash) return { skipped: true };

			const embedding = await embedText(text);
			await upsertEmbedding({
				userId,
				contentType,
				contentKey,
				owner,
				repo,
				itemNumber,
				contentHash: hash,
				embedding,
				title,
				snippet: text.slice(0, 300),
				metadata: {
					author: null,
					createdAt: null,
				},
			});

			return { embedded: true };
		});

		// Step 2: Embed comments in batches of 20
		const allCommentItems: {
			id: string;
			type: ContentType;
			key: string;
			text: string;
			author: string;
			createdAt: string;
			state?: string;
		}[] = [];

		if (comments) {
			for (const c of comments) {
				if (!c.body?.trim()) continue;
				const commentType: ContentType =
					contentType === "pr" ? "pr_comment" : "issue_comment";
				allCommentItems.push({
					id: String(c.id),
					type: commentType,
					key: `${contentKey}/comment/${c.id}`,
					text: c.body,
					author: c.author,
					createdAt: c.createdAt,
				});
			}
		}

		if (reviews) {
			for (const r of reviews) {
				if (!r.body?.trim()) continue;
				allCommentItems.push({
					id: String(r.id),
					type: "review",
					key: `${contentKey}/review/${r.id}`,
					text: r.body,
					author: r.author,
					createdAt: r.createdAt,
					state: r.state,
				});
			}
		}

		// Process in batches of 20
		const batchSize = 20;
		for (let i = 0; i < allCommentItems.length; i += batchSize) {
			const batch = allCommentItems.slice(i, i + batchSize);
			const batchIndex = Math.floor(i / batchSize);

			await step.run(`embed-comments-batch-${batchIndex}`, async () => {
				// Check which items need embedding
				const toEmbed: typeof batch = [];
				for (const item of batch) {
					const hash = hashContent(item.text);
					const existingHash = await getExistingContentHash(
						userId,
						item.type,
						item.key,
					);
					if (existingHash !== hash) {
						toEmbed.push(item);
					}
				}

				if (toEmbed.length === 0) return { skipped: batch.length };

				const embeddings = await embedTexts(
					toEmbed.map((item) => item.text),
				);

				for (let j = 0; j < toEmbed.length; j++) {
					const item = toEmbed[j];
					await upsertEmbedding({
						userId,
						contentType: item.type,
						contentKey: item.key,
						owner,
						repo,
						itemNumber,
						contentHash: hashContent(item.text),
						embedding: embeddings[j],
						title,
						snippet: item.text.slice(0, 300),
						metadata: {
							author: item.author,
							createdAt: item.createdAt,
							...(item.state
								? { state: item.state }
								: {}),
						},
					});
				}

				return {
					embedded: toEmbed.length,
					skipped: batch.length - toEmbed.length,
				};
			});
		}

		return {
			contentKey,
			commentCount: allCommentItems.length,
		};
	},
);
