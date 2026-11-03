// The two runtimes share one current-turn image contract. History stays text-only;
// a deliberate follow-up re-read supplies NEW current-turn bytes (referenceImages.ts).
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { parsePastedImage } from "./pastedImages.ts";

export const MODEL_IMAGE_MAX_COUNT = 4;
export const MODEL_IMAGE_MAX_DATA_URL_CHARS = 6_500_000;

export function modelImageSources(images: readonly string[] = []): Array<{
  type: "base64";
  media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  data: string;
}> {
  if (images.length > MODEL_IMAGE_MAX_COUNT) throw new Error("이미지는 한 번에 4장까지 분석할 수 있어요.");
  return images.map((url) => {
    const parsed = parsePastedImage(url);
    if (!parsed || url.length > MODEL_IMAGE_MAX_DATA_URL_CHARS || parsed.base64.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.base64)
      || Buffer.from(parsed.base64, "base64").toString("base64") !== parsed.base64) {
      throw new Error("이미지 데이터를 읽지 못했어요. PNG·JPEG·GIF·WebP 이미지를 다시 첨부해 주세요.");
    }
    return { type: "base64", media_type: parsed.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: parsed.base64 };
  });
}

/** Keep text-only turns on their existing path; images need SDK streaming input. */
export function sdkPromptWithImages(text: string, images: readonly string[] = []): string | AsyncIterable<SDKUserMessage> {
  const sources = modelImageSources(images);
  if (!sources.length) return text;
  return (async function* () {
    yield {
      type: "user" as const,
      parent_tool_use_id: null,
      message: {
        role: "user" as const,
        content: [
          ...(text ? [{ type: "text" as const, text }] : []),
          ...sources.map((source) => ({ type: "image" as const, source })),
        ],
      },
    };
  })();
}

export function proxyUserContent(text: string, images: readonly string[] = []): string | Array<
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
> {
  const sources = modelImageSources(images);
  return sources.length ? [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...sources.map((s) => ({ type: "image_url" as const, image_url: { url: `data:${s.media_type};base64,${s.data}` } })),
  ] : text;
}
