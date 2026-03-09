// ─────────────────────────────────────────────────────────────────────────────
// Worker environment bindings (matches wrangler.toml)
// ─────────────────────────────────────────────────────────────────────────────

export interface Env {
  EMAIL_BUCKET: R2Bucket;
  EMAIL_QUEUE: Queue<QueueMessage>;

  // [vars]
  R2_PATH_PREFIX: string;
  R2_BUCKET_NAME: string;
  MAX_ATTACHMENT_SIZE_MB: string;
  STORE_TEXT_BODY: string;
  STORE_HTML_BODY: string;
  /** Optional. When set, forward every incoming email to this address. */
  FORWARD_DESTINATION: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal parsed email shape (output of src/parser.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailAddress {
  name: string | null;
  address: string;
}

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  disposition: "attachment" | "inline";
  content: ArrayBuffer;
}

export interface ParsedEmail {
  messageId: string | null;
  date: string | null;
  subject: string | null;
  from: EmailAddress | null;
  replyTo: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  textBody: string | null;
  htmlBody: string | null;
  attachments: ParsedAttachment[];
  headers: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// R2 metadata JSON schema (stored at {prefix}/metadata.json)
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredAttachmentRef {
  r2Key: string;
  filename: string;
  mimeType: string;
  size: number;
  disposition: "attachment" | "inline";
  contentId: string | null;
  oversized: false;
  uploadFailed: false;
}

export interface OversizedAttachmentRef {
  filename: string;
  mimeType: string;
  size: number;
  disposition: "attachment" | "inline";
  contentId: string | null;
  oversized: true;
  uploadFailed: false;
}

export interface FailedAttachmentRef {
  filename: string;
  mimeType: string;
  size: number;
  disposition: "attachment" | "inline";
  contentId: string | null;
  oversized: false;
  uploadFailed: true;
  error: string;
}

export type AttachmentRef = StoredAttachmentRef | OversizedAttachmentRef | FailedAttachmentRef;

export interface EmailMetadata {
  schemaVersion: "1";
  receivedAt: string;
  messageId: string | null;
  date: string | null;
  subject: string | null;
  from: EmailAddress | null;
  replyTo: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  textBody: string | null;
  htmlBody: string | null;
  attachments: AttachmentRef[];
  headers: Record<string, string>;
  r2Prefix: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Queue message schema
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueAttachment {
  /** Original filename from the email */
  name: string;
  /** MIME type e.g. "application/pdf" */
  mimeType: string;
  /** Size in bytes */
  size: number;
  /** Full R2 URI (r2://{bucket}/{key}). Null when oversized or upload failed. */
  r2Uri: string | null;
  /** Whether the attachment exceeded MAX_ATTACHMENT_SIZE_MB */
  oversized: boolean;
  /** Whether the R2 upload failed */
  uploadFailed: boolean;
}

export interface QueueMessage {
  schemaVersion: "1";
  metadataKey: string;
  receivedAt: string;
  messageId: string | null;
  subject: string | null;
  from: EmailAddress | null;
  to: EmailAddress[];
  attachments: QueueAttachment[];
  r2Prefix: string;
}
