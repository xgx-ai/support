// Support UI package
// Shared SolidJS components and helpers for the support/ticketing system.

export {
	type AgentActivityAction,
	type AgentActivityDetail,
	type AgentActivityItem,
	type AgentActivityLink,
	AgentActivityPanel,
	type AgentActivityPanelProps,
	type AgentActivityStage,
	type AgentActivityStatus,
	type AgentActivityVisibility,
	type AgentRiskLevel,
	type AgentWorkflowSummary,
} from "./components/agent-activity-panel";
export {
	CommentForm,
	type CommentFormProps,
} from "./components/comment-form";
export {
	type CreatedIssue,
	CreateIssueDialog,
	type CreateIssueDialogProps,
	type CreateIssueFn,
} from "./components/create-issue-dialog";
export {
	ImageAttachButton,
	type ImageAttachButtonProps,
} from "./components/image-attach-button";
export {
	ImageAttachmentChips,
	type ImageAttachmentChipsProps,
} from "./components/image-attachment-chips";
export {
	IssueDetailPage,
	type IssueDetailPageProps,
} from "./components/issue-detail-page";
export {
	IssuesListPage,
	type IssuesListPageProps,
} from "./components/issues-list-page";
// --- Components ---
export {
	MarkdownBody,
	type MarkdownBodyProps,
} from "./components/markdown-body";
export {
	PriorityPicker,
	type PriorityPickerProps,
} from "./components/priority-picker";
// --- Lib ---
export {
	getAssignedAt,
	getAssigneeDisplayName,
	getAssigneeInitials,
	getIssueAssignees,
	getWorkStartedAt,
	type IssueAssignee,
	type IssueWithAssignees,
} from "./lib/assignee";
export { fileToBase64 } from "./lib/file-to-base64";
export {
	parseCommentAuthor,
	parseEndmatter,
	parseIssueBody,
	stripPrefix,
} from "./lib/parse-endmatter";
export {
	filterNonPriorityLabels,
	getPriority,
	PRIORITY_LABEL_NAMES,
	type Priority,
	type PriorityLabel,
	type PriorityLevel,
} from "./lib/priority";
export {
	type UploadedImage,
	type UploadImageFn,
	useImageUpload,
} from "./lib/use-image-upload";
