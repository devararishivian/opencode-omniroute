/**
 * Which served rows are chat models OpenCode can actually select.
 *
 * OmniRoute's `/v1/models` is a catalog of everything the gateway can route:
 * chat models, but also image, video, audio, embedding and rerank models. The
 * picker is a chat picker, so publishing the rest is noise — a long list where
 * `flux`, `whisper` and `text-embedding-3-small` crowd out the models a user
 * wants, and where a zero price makes every one of them read as "Free".
 *
 * This mirrors what the Pi sync extension does (`isPiChatModel`): a row is a
 * chat model unless it declares a non-chat `type`, or declares output
 * modalities that contain no text.
 */
import type { OmniRouteRawModelEntry } from "./shared/models-map.js";

/** Row kinds the gateway serves that a chat picker cannot use. */
const NON_CHAT_TYPES = new Set(["image", "embedding", "rerank", "audio", "video", "pdf"]);

/**
 * Token patterns in model IDs that unambiguously identify non-chat models
 * (image generation, embeddings, reranking) when the gateway omits `type` and
 * `output_modalities`.
 */
const NON_CHAT_ID_PATTERN = /(?:^|[-_/])(?:image|embed|embedding|rerank)(?:[-_/0-9]|$)/i;

/** Whether a raw row is a chat model. */
export function isChatModel(entry: OmniRouteRawModelEntry): boolean {
  const type = typeof entry.type === "string" ? entry.type.trim().toLowerCase() : "";
  if (NON_CHAT_TYPES.has(type)) return false;
  const output = entry.output_modalities;
  if (Array.isArray(output) && output.length > 0) {
    if (!output.some((modality) => String(modality).trim().toLowerCase() === "text")) {
      return false;
    }
  }
  // Gateway fallback: rows with missing type/modalities that name image or embed models
  const id = typeof entry.id === "string" ? entry.id : "";
  if (NON_CHAT_ID_PATTERN.test(id)) return false;
  return true;
}
