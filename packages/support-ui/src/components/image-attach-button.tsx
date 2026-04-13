import { Button, Flex, Text } from "@xgx/ui";
import { Image, Loader2 } from "@xgx/ui/icons";
import { Show } from "solid-js";

export interface ImageAttachButtonProps {
	uploading: boolean;
	onFiles: (files: FileList) => void;
}

/**
 * Hidden file input + "Attach image" button + clipboard hint.
 * Accepts multiple image files.
 */
export function ImageAttachButton(props: ImageAttachButtonProps) {
	let fileInputRef!: HTMLInputElement;

	return (
		<Flex align="center" gap="2">
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				multiple
				class="hidden"
				onChange={(e) => {
					const files = e.currentTarget.files;
					if (files) props.onFiles(files);
					e.currentTarget.value = "";
				}}
			/>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => fileInputRef.click()}
				disabled={props.uploading}
			>
				<Show when={props.uploading} fallback={<Image class="size-3.5" />}>
					<Loader2 class="size-3.5 animate-spin" />
				</Show>
				{props.uploading ? "Uploading..." : "Attach image"}
			</Button>
			<Text as="span" size="xs" class="text-muted-foreground">
				or paste from clipboard
			</Text>
		</Flex>
	);
}
