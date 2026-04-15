/**
 * Max incoming message/payload size (5 MB).
 *
 * This is an application-level guard, not a Cloudflare platform limit.
 * Workers allow 100 MB+ request bodies and DO WebSockets allow 32 MiB messages,
 * but we cap at 5 MB to keep memory usage reasonable (Workers have a 128 MB limit
 * and we buffer the full body with `arrayBuffer()`).
 */
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Max asset upload size (25 MB).
 *
 * Generous for images and PDFs in documents. Workers allow 100 MB+ but we
 * buffer the full body, so this keeps memory usage reasonable.
 */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
