import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

export interface MarkdownBodyProps {
	text: string;
	class?: string;
}

/**
 * Renders plain text with markdown images (`![alt](url)`) as inline `<img>` tags.
 * All other text is rendered as `whitespace-pre-wrap` spans.
 */
export function MarkdownBody(props: MarkdownBodyProps): JSX.Element {
	const parts = () => {
		const result: { type: "text" | "image"; value: string; alt?: string }[] =
			[];
		let lastIndex = 0;
		const regex = new RegExp(MD_IMAGE_RE);
		let match: RegExpExecArray | null = regex.exec(props.text);
		while (match !== null) {
			if (match.index > lastIndex) {
				result.push({
					type: "text",
					value: props.text.slice(lastIndex, match.index),
				});
			}
			result.push({
				type: "image",
				value: match[2] ?? "",
				alt: match[1],
			});
			lastIndex = regex.lastIndex;
			match = regex.exec(props.text);
		}
		if (lastIndex < props.text.length) {
			result.push({ type: "text", value: props.text.slice(lastIndex) });
		}
		return result;
	};

	return (
		<div class={props.class}>
			<For each={parts()}>
				{(part) => (
					<Show
						when={part.type === "image" ? part : null}
						fallback={<span class="whitespace-pre-wrap">{part.value}</span>}
					>
						{(img) => (
							<a href={img().value} target="_blank" rel="noopener noreferrer">
								<img
									src={img().value}
									alt={img().alt ?? ""}
									class="my-2 max-w-full rounded-md border max-h-96"
									loading="lazy"
								/>
							</a>
						)}
					</Show>
				)}
			</For>
		</div>
	);
}
