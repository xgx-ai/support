import { Flex, Text } from "@xgx/ui";
import { Image, X } from "@xgx/ui/icons";
import { For, Show } from "solid-js";
import type { UploadedImage } from "../lib/use-image-upload";

export interface ImageAttachmentChipsProps {
	images: UploadedImage[];
	onRemove: (url: string) => void;
}

/** Renders a row of attachment chips for uploaded images with remove buttons. */
export function ImageAttachmentChips(props: ImageAttachmentChipsProps) {
	return (
		<Show when={props.images.length > 0}>
			<Flex gap="2" class="flex-wrap">
				<For each={props.images}>
					{(img) => (
						<Flex
							align="center"
							gap="1.5"
							class="rounded-md border px-2 py-1 text-xs"
						>
							<Image class="size-3 text-muted-foreground" />
							<Text as="span" size="xs" class="max-w-32 truncate">
								{img.fileName}
							</Text>
							<button
								type="button"
								class="text-muted-foreground hover:text-foreground"
								onClick={() => props.onRemove(img.url)}
							>
								<X class="size-3" />
							</button>
						</Flex>
					)}
				</For>
			</Flex>
		</Show>
	);
}
