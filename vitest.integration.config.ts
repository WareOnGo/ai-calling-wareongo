import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Never fall back to the application's configured database or provider credentials.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "";
process.env.DATABASE_SSL = "disable";
process.env.ENABLE_ENRICHMENT = "true";
process.env.BOLNA_API_KEY = "integration-not-a-real-key";
delete process.env.BOLNA_HINDI_AGENT_ID;
process.env.BOLNA_ENGLISH_AGENT_ID = "00000000-0000-0000-0000-000000000002";
process.env.BOLNA_AGENT_ID = "00000000-0000-0000-0000-000000000001";
process.env.PROCESS_SECRET = "integration-worker-secret";
process.env.BOLNA_WEBHOOK_SECRET = "integration-webhook-secret";
export default defineConfig({
  test: { environment: "node", include: ["tests/integration/**/*.test.ts"], fileParallelism: false, testTimeout: 15000 },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
