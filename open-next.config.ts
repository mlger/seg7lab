// open-next.config.ts — SEG7 Lab on Cloudflare Workers.
//
// Intentionally NOT using the template's `r2IncrementalCache` override: that
// requires an `NEXT_INC_CACHE_R2_BUCKET` R2 binding (a bucket that must be
// created and paid attention to). This app has no ISR / revalidation — one
// static page plus dynamic API routes — so the default no-op incremental
// cache is correct and needs zero extra Cloudflare resources.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
