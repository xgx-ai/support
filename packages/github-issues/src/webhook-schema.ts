import { z } from "zod";

export const issueWebhookActionSchema = z.enum([
	"assigned",
	"closed",
	"deleted",
	"demilestoned",
	"edited",
	"labeled",
	"locked",
	"milestoned",
	"opened",
	"pinned",
	"reopened",
	"transferred",
	"unassigned",
	"unlabeled",
	"unlocked",
	"unpinned",
]);

export const issueCommentWebhookActionSchema = z.enum([
	"created",
	"deleted",
	"edited",
]);

const githubUserSchema = z
	.object({
		login: z.string().min(1),
		avatar_url: z.string(),
		name: z.string().nullable().optional(),
	})
	.loose();

const githubLabelSchema = z
	.object({
		id: z.number().int(),
		name: z.string().min(1),
		color: z.string(),
	})
	.loose();

const repositorySchema = z
	.object({
		id: z.number().int(),
		name: z.string().min(1),
		full_name: z.string().min(1),
		owner: githubUserSchema.nullable().optional(),
		html_url: z.string().optional(),
	})
	.loose();

const issueSchema = z
	.object({
		number: z.number().int().positive(),
		title: z.string(),
		body: z.string().nullable(),
		state: z.enum(["open", "closed"]),
		labels: z.array(githubLabelSchema),
		user: githubUserSchema.nullable(),
		assignee: githubUserSchema.nullable().optional(),
		assignees: z.array(githubUserSchema).optional(),
		comments: z.number().int().nonnegative().optional(),
		created_at: z.string().datetime(),
		updated_at: z.string().datetime(),
		closed_at: z.string().datetime().nullable(),
		state_reason: z
			.enum(["completed", "not_planned", "reopened"])
			.nullable()
			.optional(),
		html_url: z.string().optional(),
	})
	.loose();

const changesSchema = z.record(
	z.string(),
	z
		.object({
			from: z.unknown().optional(),
		})
		.loose(),
);

const issuePayloadBase = z
	.object({
		issue: issueSchema,
		repository: repositorySchema.optional(),
		sender: githubUserSchema.nullable().optional(),
		label: githubLabelSchema.optional(),
		assignee: githubUserSchema.nullable().optional(),
		changes: changesSchema.optional(),
	})
	.loose();

export const githubIssueWebhookPayloadSchema = issuePayloadBase.extend({
	action: issueWebhookActionSchema,
});

export const githubIssueCommentWebhookPayloadSchema = issuePayloadBase.extend({
	action: issueCommentWebhookActionSchema,
	comment: z
		.object({
			id: z.number().int(),
			body: z.string(),
			user: githubUserSchema.nullable(),
			created_at: z.string().datetime(),
			updated_at: z.string().datetime(),
			html_url: z.string().optional(),
		})
		.loose(),
});
