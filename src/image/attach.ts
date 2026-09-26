/**
 * T29 — turn pending clipboard images into the content blocks a user message
 * carries.
 *
 * dsh owns the bytes from here: `ctx.attachments.saveImage()` validates the
 * decoded raster, normalizes it, and returns a durable content-addressed
 * reference. The user message then carries one `{ type: "image", attachment }`
 * block per image, and dsh decides per route whether that reaches the provider
 * natively or is projected to handle text.
 *
 * A refusal is never fatal: the words still go out, and the user is told which
 * image did not make it. Losing a screenshot must not lose the question about
 * it.
 */
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from "@deepseek-ai/dsh-attachment";
import type { ClipboardImage } from "./clipboard.js";

/** The slice of dsh's attachment store kumo uses; `ctx.get("attachments")`. */
export interface AttachmentStoreLike {
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>;
}

/** One content block of a user message, in dsh's own shape. */
export type UserContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly attachment: ImageAttachmentRef };

export interface BuiltContent {
  /** Message content in order: the text first, then the images. */
  parts: UserContentPart[];
  /** How many images reached the store. */
  attached: number;
  /** One line per image the store refused, already phrased for the user. */
  failures: string[];
  /** True when there was no store at all, so nothing could be attached. */
  noStore: boolean;
}

/** The dim line shown when dsh refused one image; the rest of the message goes. */
export function attachFailureNotice(failures: readonly string[]): string {
  if (failures.length === 0) return "";
  if (failures.length === 1) return `Image not attached: ${failures[0] ?? ""}`;
  return `${String(failures.length)} images not attached: ${failures.join(", ")}`;
}

/** The notice for a build where the attachment service is not there at all. */
export const NO_STORE_NOTICE = "Images are not available in this dsh build";

/**
 * Build the user message content. The chip text stays in the text part: it is
 * the label the user typed and the label the model reads, next to the image
 * itself.
 */
export async function buildUserContent(
  text: string,
  images: readonly ClipboardImage[],
  store: AttachmentStoreLike | undefined,
): Promise<BuiltContent> {
  const parts: UserContentPart[] = [{ type: "text", text }];
  if (images.length === 0) return { parts, attached: 0, failures: [], noStore: false };
  if (store === undefined) return { parts, attached: 0, failures: [], noStore: true };

  const failures: string[] = [];
  let attached = 0;
  for (const image of images) {
    try {
      const attachment = await store.saveImage({
        data: image.data,
        mediaType: image.mediaType satisfies ImageMediaType,
        name: image.name,
      });
      parts.push({ type: "image", attachment });
      attached += 1;
    } catch (error) {
      failures.push(oneLine(error, image.name));
    }
  }
  return { parts, attached, failures, noStore: false };
}

function oneLine(error: unknown, name: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split(/\r?\n/)[0]?.trim() ?? "";
  return first === "" ? name : first;
}
