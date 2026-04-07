// YAML endmatter embedded in an HTML comment.
// Hidden on GitHub but parseable on the frontend.
//
// Format:
//   <!--meta
//   author: Louis
//   -->

export function buildEndmatter(meta: Record<string, string>): string {
  const yaml = Object.entries(meta)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  return `\n\n<!--meta\n${yaml}\n-->`;
}

export function parseEndmatter(body: string): {
  body: string;
  meta: Record<string, string>;
} {
  const match = body.match(/^([\s\S]*?)\n?\n?<!--meta\n([\s\S]*?)\n-->$/);
  if (!match) return { body, meta: {} };

  const meta: Record<string, string> = {};
  for (const line of match[2]!.split("\n")) {
    const idx = line.indexOf(": ");
    if (idx > 0) {
      meta[line.slice(0, idx)] = line.slice(idx + 2);
    }
  }

  return { body: match[1]!, meta };
}
