import type { EmailMetadata, Env, QueueAttachment, QueueMessage } from "./types";

/**
 * Publish a message to the Cloudflare Queue.
 * Includes attachment metadata so consumers can access files directly
 * without fetching the full metadata.json from R2.
 */
export async function publishToQueue(
  env: Env,
  metadata: EmailMetadata,
  metadataKey: string,
  bucketName: string
): Promise<void> {
  const attachments: QueueAttachment[] = metadata.attachments.map((a) => ({
    name: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    r2Uri: "r2Key" in a && a.r2Key ? `r2://${bucketName}/${a.r2Key}` : null,
    oversized: a.oversized,
    uploadFailed: "uploadFailed" in a ? a.uploadFailed : false,
  }));

  const message: QueueMessage = {
    schemaVersion: "1",
    metadataKey,
    receivedAt: metadata.receivedAt,
    messageId: metadata.messageId,
    subject: metadata.subject,
    from: metadata.from,
    to: metadata.to,
    attachments,
    r2Prefix: metadata.r2Prefix,
  };

  await env.EMAIL_QUEUE.send(message, { contentType: "json" });
}
