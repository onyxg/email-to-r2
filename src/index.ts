import { parseEmail } from "./parser";
import { buildEmailSlug, storeEmail } from "./storage";
import { publishToQueue } from "./queue";
import type { Env } from "./types";

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    const receivedAt = new Date().toISOString();

    // ── 1. Parse the raw email stream ───────────────────────────────────────
    let parsed;
    try {
      parsed = await parseEmail(message.raw);
    } catch (err) {
      console.error("Failed to parse email:", err);
      message.setReject("ParseError");
      return;
    }

    console.log(
      `Processing email: messageId=${parsed.messageId ?? "null"} ` +
        `subject="${parsed.subject ?? ""}" ` +
        `from=${parsed.from?.address ?? "unknown"} ` +
        `attachments=${parsed.attachments.length}`
    );

    // ── 2. Build a stable slug for R2 path construction ─────────────────────
    const emailSlug = buildEmailSlug(parsed.messageId);

    // ── 3. Upload attachments + metadata JSON to R2 ──────────────────────────
    let storageResult;
    try {
      storageResult = await storeEmail(env, parsed, receivedAt, emailSlug);
    } catch (err) {
      console.error("Failed to store email to R2:", err);
      // Do not reject the email — it was received successfully.
      // The operator should monitor for R2 write failures.
      throw err;
    }

    console.log(`Stored metadata at: ${storageResult.metadataKey}`);

    // ── 4. Publish to Cloudflare Queue ───────────────────────────────────────
    try {
      await publishToQueue(env, storageResult.metadata, storageResult.metadataKey, env.R2_BUCKET_NAME);
    } catch (err) {
      // Queue failure is non-fatal: the email and metadata are already in R2.
      // Log the error so the operator can re-publish manually if needed.
      console.error("Failed to publish to queue (email is safely stored in R2):", err);
    }

    // ── 5. Forward email (optional) ──────────────────────────────────────────
    if (env.FORWARD_DESTINATION) {
      try {
        await message.forward(env.FORWARD_DESTINATION);
        console.log(`Forwarded email to ${env.FORWARD_DESTINATION}`);
      } catch (err) {
        console.error(`Failed to forward email to ${env.FORWARD_DESTINATION}:`, err);
      }
    }
  },
};
