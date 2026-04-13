import { useMutation } from "@tanstack/solid-query";
import type { DialogContentProps } from "@xgx/ui";
import {
	Button,
	DialogFooter,
	Stack,
	Text,
	TextField,
	TextFieldInput,
	TextFieldLabel,
	TextFieldTextArea,
} from "@xgx/ui";
import { createSignal, Show } from "solid-js";
import type { UploadImageFn } from "../lib/use-image-upload";
import { useImageUpload } from "../lib/use-image-upload";
import { ImageAttachButton } from "./image-attach-button";
import { ImageAttachmentChips } from "./image-attachment-chips";
import { PriorityPicker } from "./priority-picker";

export type CreateIssueFn = (input: {
	title: string;
	body: string;
	priority?: string;
}) => Promise<{ data: unknown; error: string | null }>;

export interface CreateIssueDialogProps extends DialogContentProps<boolean> {
	uploadImage: UploadImageFn;
	createIssue: CreateIssueFn;
	/**
	 * Optional hook to transform the title/body before the create mutation fires.
	 * Use this for app-specific additions (e.g. appending a PostHog session replay URL).
	 */
	onBeforeCreate?: (params: { title: string; body: string }) => {
		title: string;
		body: string;
	};
}

export function CreateIssueDialog(props: CreateIssueDialogProps) {
	const [title, setTitle] = createSignal("");
	const [body, setBody] = createSignal("");
	const [priority, setPriority] = createSignal<string | undefined>(undefined);

	const {
		images,
		uploading,
		uploadFile,
		handlePaste,
		removeImage,
		buildBodyWithImages,
	} = useImageUpload(props.uploadImage);

	const createMutation = useMutation(() => ({
		mutationFn: async (params: {
			title: string;
			body: string;
			priority?: string;
		}) => {
			const transformed = props.onBeforeCreate
				? { ...params, ...props.onBeforeCreate(params) }
				: params;
			const result = await props.createIssue(transformed);
			if (result.error) throw new Error(result.error);
			return result;
		},
		onSuccess: () => {
			props.resolve(true);
		},
	}));

	const handleSubmit = (e: SubmitEvent) => {
		e.preventDefault();
		const fullBody = buildBodyWithImages(body().trim());
		createMutation.mutate({
			title: title(),
			body: fullBody,
			priority: priority(),
		});
	};

	return (
		<form onSubmit={handleSubmit}>
			<Stack gap="4">
				<TextField
					value={title()}
					onChange={(value: string) => setTitle(value)}
				>
					<TextFieldLabel>Title</TextFieldLabel>
					<TextFieldInput placeholder="Brief summary of the issue" />
				</TextField>

				<TextField value={body()} onChange={(value: string) => setBody(value)}>
					<TextFieldLabel>Description</TextFieldLabel>
					<TextFieldTextArea
						placeholder="Describe the issue in detail..."
						autoResize
						onPaste={handlePaste}
					/>
				</TextField>

				<PriorityPicker
					value={priority()}
					onChange={setPriority}
					label="Priority"
				/>

				{/* Image attachments */}
				<ImageAttachmentChips images={images()} onRemove={removeImage} />

				<ImageAttachButton
					uploading={uploading()}
					onFiles={(files) => {
						for (const file of files) uploadFile(file);
					}}
				/>

				<Show when={createMutation.error}>
					<Text as="p" size="sm" variant="destructive">
						{createMutation.error instanceof Error
							? createMutation.error.message
							: "Failed to create issue."}
					</Text>
				</Show>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={props.reject}
						disabled={createMutation.isPending}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						disabled={
							!title().trim() ||
							!body().trim() ||
							createMutation.isPending ||
							uploading()
						}
					>
						{createMutation.isPending ? "Creating..." : "Create Issue"}
					</Button>
				</DialogFooter>
			</Stack>
		</form>
	);
}
