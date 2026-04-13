// Support UI package
// Shared SolidJS components and helpers for the support/ticketing system.

// --- Lib ---
export {
  parseEndmatter,
  stripPrefix,
  parseCommentAuthor,
  parseIssueBody,
} from "./lib/parse-endmatter";

export { fileToBase64 } from "./lib/file-to-base64";

export {
  useImageUpload,
  type UploadedImage,
  type UploadImageFn,
} from "./lib/use-image-upload";

export {
  getPriority,
  filterNonPriorityLabels,
  PRIORITY_LABEL_NAMES,
  type PriorityLevel,
  type Priority,
} from "./lib/priority";

// --- Components ---
export {
  MarkdownBody,
  type MarkdownBodyProps,
} from "./components/markdown-body";

export {
  CreateIssueDialog,
  type CreateIssueDialogProps,
  type CreateIssueFn,
} from "./components/create-issue-dialog";

export {
  CommentForm,
  type CommentFormProps,
} from "./components/comment-form";

export {
  ImageAttachmentChips,
  type ImageAttachmentChipsProps,
} from "./components/image-attachment-chips";

export {
  ImageAttachButton,
  type ImageAttachButtonProps,
} from "./components/image-attach-button";

export {
  IssueDetailPage,
  type IssueDetailPageProps,
} from "./components/issue-detail-page";

export {
  IssuesListPage,
  type IssuesListPageProps,
} from "./components/issues-list-page";
