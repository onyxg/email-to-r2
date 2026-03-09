import PostalMime from "postal-mime";
import type { EmailAddress, ParsedAttachment, ParsedEmail } from "./types";

/**
 * Parse a raw email stream into a structured ParsedEmail.
 * Throws on unrecoverable parse failure.
 */
export async function parseEmail(rawStream: ReadableStream): Promise<ParsedEmail> {
  const parsed = await PostalMime.parse(rawStream);

  const messageId = extractHeader(parsed.headers, "message-id") ?? null;
  const date = parsed.date ? new Date(parsed.date).toISOString() : null;

  const attachments: ParsedAttachment[] = (parsed.attachments ?? []).map((att, index) => {
    const filename = sanitizeFilename(att.filename ?? undefined) ?? `attachment-${index}.bin`;
    const mimeType = att.mimeType ?? "application/octet-stream";
    const content =
      att.content instanceof ArrayBuffer
        ? att.content
        : new TextEncoder().encode(att.content as string).buffer as ArrayBuffer;

    return {
      filename,
      mimeType,
      size: content.byteLength,
      contentId: att.contentId ?? null,
      disposition: att.disposition === "inline" ? "inline" : "attachment",
      content,
    };
  });

  const headers: Record<string, string> = {};
  for (const header of parsed.headers ?? []) {
    headers[header.key.toLowerCase()] = header.value;
  }

  return {
    messageId: messageId ? normalizeMessageId(messageId) : null,
    date,
    subject: parsed.subject ?? null,
    from: toEmailAddress(parsed.from),
    replyTo: Array.isArray(parsed.replyTo) ? (parsed.replyTo[0] ? toEmailAddress(parsed.replyTo[0]) : null) : toEmailAddress(parsed.replyTo),
    to: (parsed.to ?? []).map(toEmailAddress).filter((a): a is EmailAddress => a !== null),
    cc: (parsed.cc ?? []).map(toEmailAddress).filter((a): a is EmailAddress => a !== null),
    bcc: (parsed.bcc ?? []).map(toEmailAddress).filter((a): a is EmailAddress => a !== null),
    textBody: parsed.text ?? null,
    htmlBody: parsed.html ?? null,
    attachments,
    headers,
  };
}

function toEmailAddress(addr: { name?: string; address?: string } | null | undefined): EmailAddress | null {
  if (!addr?.address) return null;
  return {
    name: addr.name ?? null,
    address: addr.address,
  };
}

function extractHeader(
  headers: Array<{ key: string; value: string }> | undefined,
  name: string
): string | undefined {
  return headers?.find((h) => h.key.toLowerCase() === name)?.value;
}

/** Strip angle brackets from Message-ID */
function normalizeMessageId(raw: string): string {
  return raw.replace(/^<|>$/g, "").trim();
}

/**
 * Sanitize an attachment filename:
 * - Removes path separators and null bytes
 * - Replaces unsafe characters with underscores
 * - Truncates to 200 characters
 * Returns null if the result is empty.
 */
export function sanitizeFilename(filename: string | undefined): string | null {
  if (!filename) return null;

  // Remove path components
  const base = filename.replace(/.*[/\\]/, "");

  // Replace anything that isn't alphanumeric, dot, hyphen, or underscore
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");

  // Collapse multiple consecutive underscores
  const clean = safe.replace(/_+/g, "_").replace(/^_|_$/g, "");

  if (!clean) return null;

  // Truncate preserving extension
  const maxLength = 200;
  if (clean.length <= maxLength) return clean;

  const ext = clean.lastIndexOf(".");
  if (ext > 0) {
    const extension = clean.slice(ext);
    return clean.slice(0, maxLength - extension.length) + extension;
  }
  return clean.slice(0, maxLength);
}
