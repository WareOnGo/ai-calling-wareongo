import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const db=process.env.TEST_DATABASE_URL;
if(!db || !["127.0.0.1","localhost","[::1]"].includes(new URL(db).hostname)) throw Error("Set TEST_DATABASE_URL to a disposable local database");
const port=Number(process.env.BROWSER_PORT||3137), baseURL=`http://localhost:${port}`;
export const SESSION_SECRET="contact-ownership-browser-test-not-production";
export default defineConfig({
  testDir:".",testMatch:"contact-ownership.spec.ts",workers:1,fullyParallel:false,retries:0,
  timeout:45000,expect:{timeout:10000},outputDir:"../../test-results",reporter:"list",
  use:{baseURL,viewport:{width:1600,height:1000},trace:"retain-on-failure",screenshot:"only-on-failure",
    launchOptions:process.env.BROWSER_CHROMIUM_PATH?{executablePath:process.env.BROWSER_CHROMIUM_PATH}:{}},
  webServer:{command:`node node_modules/next/dist/bin/next start --port ${port}`,cwd:resolve(__dirname,"../.."),url:baseURL,reuseExistingServer:false,timeout:60000,
    env:{...process.env,NODE_ENV:"production",DATABASE_URL:db,DIRECT_URL:db,DATABASE_SSL:"disable",SESSION_SECRET,
      OPENAI_API_KEY:"sk-local-test",BOLNA_API_KEY:"local-test",ENABLE_ENRICHMENT:"false",PROCESS_SECRET:"local-test",BOLNA_WEBHOOK_SECRET:"local-test",
      BOLNA_AGENT_ID:"00000000-0000-0000-0000-000000000001",BOLNA_ENGLISH_AGENT_ID:"00000000-0000-0000-0000-000000000002",BOLNA_HINDI_AGENT_ID:"",
      GOOGLE_CLIENT_ID:"local-test",GOOGLE_CLIENT_SECRET:"local-test"}},
});
