/**
 * Shared HTTP handler for serving support images from an S3-compatible bucket.
 *
 * Each consuming app registers this at `/api/support-images/*` in its own
 * HTTP router and passes in the bucket name + CORS headers.
 */

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export interface SupportImageRequestOptions {
  /** S3-compatible bucket name. */
  bucket: string;
  /** Pre-built CORS headers to include in every response. */
  corsHeaders: Record<string, string>;
}

/**
 * Handles a `GET /api/support-images/*` request by streaming the image from
 * an S3-compatible bucket via `Bun.s3`.
 *
 * Returns a `Response` with the image body, correct `Content-Type`, and
 * aggressive caching headers (images are keyed by UUID so are immutable).
 */
export async function handleSupportImageRequest(
  req: Request,
  options: SupportImageRequestOptions,
): Promise<Response> {
  const { bucket, corsHeaders: headers } = options;
  try {
    const url = new URL(req.url);
    const key = url.pathname.replace("/api/support-images/", "");
    if (!key || !key.startsWith("support-images/")) {
      return new Response("Not found", { status: 404, headers });
    }

    const s3File = Bun.s3.file(key, { bucket });
    const exists = await s3File.exists();
    if (!exists) {
      return new Response("Not found", { status: 404, headers });
    }

    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

    return new Response(s3File.stream(), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("support image failed", error);
    return new Response("Internal error", { status: 500, headers });
  }
}
