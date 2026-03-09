import type {
  AttachmentRef,
  EmailMetadata,
  Env,
  ParsedAttachment,
  ParsedEmail,
} from "./types";

export interface StorageResult {
  metadata: EmailMetadata;
  metadataKey: string;
}

/**
 * Upload all attachments and the metadata JSON to R2.
 * Returns the full metadata object and its R2 key.
 */
export async function storeEmail(
  env: Env,
  parsed: ParsedEmail,
  receivedAt: string,
  emailSlug: string
): Promise<StorageResult> {
  const prefix = buildPrefix(env.R2_PATH_PREFIX, receivedAt, emailSlug);
  const maxBytes = parseMaxBytes(env.MAX_ATTACHMENT_SIZE_MB);

  // Upload attachments in parallel; tolerate individual failures
  const attachmentResults = await Promise.allSettled(
    parsed.attachments.map((att, index) =>
      uploadAttachment(env.EMAIL_BUCKET, att, prefix, index, maxBytes)
    )
  );

  const attachmentRefs: AttachmentRef[] = attachmentResults.map((result, index) => {
    if (result.status === "fulfilled") return result.value;

    // Upload threw — record failure without crashing the pipeline
    const att = parsed.attachments[index];
    console.error(`Attachment upload failed for "${att.filename}":`, result.reason);
    return {
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      disposition: att.disposition,
      contentId: att.contentId,
      oversized: false,
      uploadFailed: true,
      error: String(result.reason),
    } satisfies AttachmentRef;
  });

  const metadata: EmailMetadata = {
    schemaVersion: "1",
    receivedAt,
    messageId: parsed.messageId,
    date: parsed.date,
    subject: parsed.subject,
    from: parsed.from,
    replyTo: parsed.replyTo,
    to: parsed.to,
    cc: parsed.cc,
    bcc: parsed.bcc,
    textBody: env.STORE_TEXT_BODY === "false" ? null : parsed.textBody,
    htmlBody: env.STORE_HTML_BODY === "false" ? null : parsed.htmlBody,
    attachments: attachmentRefs,
    headers: parsed.headers,
    r2Prefix: prefix,
  };

  const metadataKey = `${prefix}/metadata.json`;
  await env.EMAIL_BUCKET.put(metadataKey, JSON.stringify(metadata, null, 2), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      messageId: parsed.messageId ?? "",
      subject: parsed.subject ?? "",
      from: parsed.from?.address ?? "",
    },
  });

  return { metadata, metadataKey };
}

async function uploadAttachment(
  bucket: R2Bucket,
  att: ParsedAttachment,
  prefix: string,
  index: number,
  maxBytes: number
): Promise<AttachmentRef> {
  if (maxBytes > 0 && att.size > maxBytes) {
    return {
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      disposition: att.disposition,
      contentId: att.contentId,
      oversized: true,
      uploadFailed: false,
    };
  }

  const paddedIndex = String(index).padStart(2, "0");
  const r2Key = `${prefix}/attachments/${paddedIndex}-${att.filename}`;

  await bucket.put(r2Key, att.content, {
    httpMetadata: {
      contentType: att.mimeType,
      contentDisposition: `attachment; filename="${att.filename}"`,
    },
    customMetadata: {
      originalFilename: att.filename,
    },
  });

  return {
    r2Key,
    filename: att.filename,
    mimeType: att.mimeType,
    size: att.size,
    disposition: att.disposition,
    contentId: att.contentId,
    oversized: false,
    uploadFailed: false,
  };
}

/**
 * Build the folder prefix for a given email:
 * {R2_PATH_PREFIX}/{YYYY}/{MM}/{DD}/{emailSlug}
 */
function buildPrefix(pathPrefix: string, receivedAt: string, emailSlug: string): string {
  const d = new Date(receivedAt);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${pathPrefix}/${year}/${month}/${day}/${emailSlug}`;
}

/**
 * Build a filesystem-safe slug from a Message-ID.
 * Falls back to a UUID-based slug when the ID is null or blank.
 */
export function buildEmailSlug(messageId: string | null): string {
  if (!messageId) return `no-id-${crypto.randomUUID()}`;

  const safe = messageId
    .replace(/[^a-zA-Z0-9._-]/g, "-") // replace unsafe chars
    .replace(/-+/g, "-")               // collapse runs of hyphens
    .replace(/^-|-$/g, "")             // trim leading/trailing hyphens
    .slice(0, 96);                     // cap length

  return safe || `no-id-${crypto.randomUUID()}`;
}

function parseMaxBytes(raw: string): number {
  const mb = parseFloat(raw);
  if (!isFinite(mb) || mb < 0) return 25 * 1024 * 1024;
  if (mb === 0) return 0; // 0 means no limit
  return mb * 1024 * 1024;
}
