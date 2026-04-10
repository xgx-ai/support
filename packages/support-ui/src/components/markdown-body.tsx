import { For, Show, type JSX } from "solid-js";

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** Rewrite legacy S3 URLs to backend-proxied paths. */
const S3_SUPPORT_IMAGE_RE = /^https?:\/\/[^/]+\/[^/]+\/(support-images\/.+)$/;

function rewriteImageUrl(url: string, baseURL: string): string {
  const match = S3_SUPPORT_IMAGE_RE.exec(url);
  if (match) return `${baseURL}/api/support-images/${match[1]}`;
  return url;
}

export interface MarkdownBodyProps {
  text: string;
  baseURL: string;
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
    let match: RegExpExecArray | null;
    while ((match = regex.exec(props.text)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          type: "text",
          value: props.text.slice(lastIndex, match.index),
        });
      }
      result.push({
        type: "image",
        value: rewriteImageUrl(match[2]!, props.baseURL),
        alt: match[1],
      });
      lastIndex = regex.lastIndex;
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
