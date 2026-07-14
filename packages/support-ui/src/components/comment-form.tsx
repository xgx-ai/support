import {
	Button,
	Flex,
	Stack,
	TextField,
	TextFieldTextArea,
	toast,
} from "@xgx/ui";
import { CircleCheck, Send } from "@xgx/ui/icons";
import { createSignal } from "solid-js";
import type { UploadImageFn } from "../lib/use-image-upload";
import { useImageUpload } from "../lib/use-image-upload";
import { ImageAttachButton } from "./image-attach-button";
import { ImageAttachmentChips } from "./image-attachment-chips";

export interface CommentFormProps {
	onClose?: (body: string) => Promise<boolean>;
	onSubmit: (body: string) => Promise<{ error: string | null }>;
	uploadImage: UploadImageFn;
}

/**
 * Comment form with image upload support (file picker + clipboard paste).
 * Used on the issue detail page.
 */
export function CommentForm(props: CommentFormProps) {
	const [commentBody, setCommentBody] = createSignal("");
	const [closing, setClosing] = createSignal(false);
	const [submitting, setSubmitting] = createSignal(false);

	const {
		images,
		uploading,
		uploadFile,
		handlePaste,
		removeImage,
		reset,
		buildBodyWithImages,
	} = useImageUpload(props.uploadImage);

	const handleSubmit = async () => {
		const body = buildBodyWithImages(commentBody().trim());
		if (!body) return;

		setSubmitting(true);
		try {
			const result = await props.onSubmit(body);
			if (result.error) {
				toast.error(result.error);
			} else {
				setCommentBody("");
				reset();
			}
		} catch {
			toast.error("Failed to add comment");
		} finally {
			setSubmitting(false);
		}
	};

	const handleClose = async () => {
		const body = buildBodyWithImages(commentBody().trim());
		if (!body || !props.onClose) return;

		setClosing(true);
		try {
			if (await props.onClose(body)) {
				setCommentBody("");
				reset();
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to close ticket",
			);
		} finally {
			setClosing(false);
		}
	};

	const isPending = () => submitting() || closing() || uploading();
	const isEmpty = () => !commentBody().trim() && images().length === 0;

	return (
		<Stack class="gap-3 pt-2">
			<TextField
				value={commentBody()}
				onChange={(value: string) => setCommentBody(value)}
			>
				<TextFieldTextArea
					placeholder="Write a comment..."
					class="min-h-24"
					onPaste={handlePaste}
				/>
			</TextField>

			{/* Image attachments */}
			<ImageAttachmentChips images={images()} onRemove={removeImage} />

			<Flex justify="between" align="center">
				<ImageAttachButton
					uploading={uploading()}
					onFiles={(files) => {
						for (const file of files) uploadFile(file);
					}}
				/>
				<Flex gap="2" align="center">
					<Button
						variant="outline"
						size="sm"
						class="text-destructive hover:text-destructive"
						onClick={() => void handleClose()}
						disabled={isEmpty() || isPending() || !props.onClose}
					>
						<CircleCheck class="size-3.5" />
						{closing() ? "Closing..." : "Close ticket"}
					</Button>
					<Button
						size="sm"
						onClick={handleSubmit}
						disabled={isEmpty() || isPending()}
					>
						<Send class="size-3.5" />
						{submitting() ? "Sending..." : "Send"}
					</Button>
				</Flex>
			</Flex>
		</Stack>
	);
}
