# email-to-r2

A Cloudflare Email Worker that receives incoming emails, parses them, stores attachments to R2, and publishes a summary message to a Cloudflare Queue for downstream processing.

## What it does

1. **Receives** emails via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
2. **Parses** the email (headers, text/HTML body, attachments) using [postal-mime](https://github.com/postalsys/postal-mime)
3. **Stores** each attachment as a separate object in R2
4. **Writes** a `metadata.json` file to R2 containing the full parsed email structure
5. **Publishes** a lean message to a Cloudflare Queue so downstream workers can react

## R2 structure

```
{R2_PATH_PREFIX}/
  {YYYY}/
    {MM}/
      {DD}/
        {email-slug}/
          metadata.json
          attachments/
            00-invoice.pdf
            01-photo.jpg
```

## Queue message

The queue message includes attachment metadata so consumers can act on files without fetching `metadata.json` from R2 first.

```jsonc
{
  "schemaVersion": "1",
  "metadataKey": "emails/2024/11/15/abc123.../metadata.json",
  "receivedAt": "2024-11-15T14:23:01.000Z",
  "messageId": "<abc123@mail.example.com>",
  "subject": "Q3 Invoice",
  "from": { "name": "Alice Smith", "address": "alice@example.com" },
  "to": [{ "name": null, "address": "inbox@myapp.com" }],
  "attachments": [
    {
      "name": "invoice.pdf",
      "mimeType": "application/pdf",
      "size": 204800,
      "r2Uri": "r2://my-email-bucket/emails/2024/11/15/.../attachments/00-invoice.pdf",
      "oversized": false,
      "uploadFailed": false
    },
    {
      "name": "bigvideo.mp4",
      "mimeType": "video/mp4",
      "size": 52428800,
      "r2Uri": null,        // null when oversized or upload failed
      "oversized": true,
      "uploadFailed": false
    }
  ],
  "r2Prefix": "emails/2024/11/15/abc123..."
}
```

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers, R2, Queues, and Email Routing enabled
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed (`npm install -g wrangler`)
- Node.js 18+

## Setup

### 1. Clone and install

```bash
git clone https://github.com/onyxg/email-to-r2.git
cd email-to-r2
npm install
```

### 2. Create Cloudflare resources

```bash
# Create an R2 bucket
wrangler r2 bucket create my-email-bucket

# Create a Cloudflare Queue
wrangler queues create email-notifications
```

### 3. Configure

```bash
cp wrangler.example.toml wrangler.toml
```

Edit `wrangler.toml` and replace the placeholder values:

| Placeholder | Replace with |
|---|---|
| `YOUR_BUCKET_NAME` | Your R2 bucket name (appears in both `[[r2_buckets]]` and `[vars]`) |
| `YOUR_QUEUE_NAME` | Your queue name |

### 4. Configure Email Routing

In the [Cloudflare dashboard](https://dash.cloudflare.com):

1. Go to **Email** → **Email Routing** for your domain
2. Add a **Custom address** or **Catch-all** rule
3. Set the action to **Send to a Worker** and select `email-to-r2`

### 5. Deploy

```bash
npm run deploy
```

## Configuration variables

All variables are set in `wrangler.toml` under `[vars]`. No secrets are required.

| Variable | Default | Description |
|---|---|---|
| `R2_BUCKET_NAME` | — | **Required.** Must match `bucket_name` in `[[r2_buckets]]`. Used to construct `r2://` URIs in queue messages. |
| `R2_PATH_PREFIX` | `emails` | Root folder inside the R2 bucket. |
| `MAX_ATTACHMENT_SIZE_MB` | `25` | Max attachment size in MB. Oversized attachments are recorded in metadata but not uploaded. Set to `0` to disable the limit. |
| `STORE_TEXT_BODY` | `true` | Include the plain-text body in `metadata.json`. Set to `false` to reduce storage on high-volume pipelines. |
| `STORE_HTML_BODY` | `true` | Include the HTML body in `metadata.json`. |
| `FORWARD_DESTINATION` | _(unset)_ | When set, forward every incoming email to this address after processing. Omit or leave blank to disable. |

## Metadata JSON schema

```jsonc
{
  "schemaVersion": "1",
  "receivedAt": "2024-11-15T14:23:01.000Z",   // UTC timestamp set by the Worker
  "messageId": "<abc123@mail.example.com>",
  "date": "2024-11-15T14:22:55.000Z",          // From the email Date header
  "subject": "Q3 Invoice",
  "from": { "name": "Alice Smith", "address": "alice@example.com" },
  "replyTo": null,
  "to": [{ "name": null, "address": "inbox@myapp.com" }],
  "cc": [],
  "bcc": [],
  "textBody": "Please find the invoice attached.",
  "htmlBody": "<p>Please find the invoice attached.</p>",
  "attachments": [
    {
      // Successfully stored attachment
      "r2Key": "emails/2024/11/15/.../attachments/00-invoice.pdf",
      "filename": "invoice.pdf",
      "mimeType": "application/pdf",
      "size": 204800,
      "disposition": "attachment",
      "contentId": null,
      "oversized": false,
      "uploadFailed": false
    },
    {
      // Attachment that exceeded MAX_ATTACHMENT_SIZE_MB
      "filename": "bigvideo.mp4",
      "mimeType": "video/mp4",
      "size": 52428800,
      "disposition": "attachment",
      "contentId": null,
      "oversized": true,
      "uploadFailed": false
    }
  ],
  "headers": { "x-mailer": "Outlook 16.0" },
  "r2Prefix": "emails/2024/11/15/abc123..."
}
```

## Consuming the queue

Create a separate Cloudflare Worker as a queue consumer:

```toml
# consumer-worker/wrangler.toml
[[queues.consumers]]
queue = "email-notifications"
binding = "EMAIL_QUEUE"
```

```typescript
export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { metadataKey, attachments } = msg.body;

      // Act on attachments directly from the queue message
      for (const att of attachments) {
        if (att.r2Uri) {
          console.log(`Attachment: ${att.name} (${att.mimeType}, ${att.size} bytes) → ${att.r2Uri}`);
        }
      }

      // Fetch full metadata from R2 if needed
      const obj = await env.EMAIL_BUCKET.get(metadataKey);
      const metadata = await obj?.json();
      // ... process email
      msg.ack();
    }
  },
};
```

## Environments

Deploy to staging with:

```bash
npm run deploy:staging
```

Configure the staging bucket and queue in `wrangler.toml` under `[env.staging]`.

## Error handling

| Scenario | Behaviour |
|---|---|
| Email parse failure | Email is rejected (`message.setReject`), nothing written to R2 |
| Attachment upload fails | Recorded in metadata with `uploadFailed: true`; other attachments and metadata still saved |
| Attachment too large | Recorded in metadata with `oversized: true`; skipped |
| R2 metadata write fails | Worker throws, email is **not** rejected (already received) |
| Queue publish fails | Logged as an error; email and metadata remain safely in R2 |
| Forward fails | Logged as an error; does not affect R2 storage or queue publish |

## Local development

`wrangler dev` does not support the `email` event handler — test by deploying to a staging environment and sending test emails.

## License

MIT
