import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL||'';
process.env.DATABASE_SSL='disable';
export default defineConfig({test:{environment:'node',include:['tests/performance/**/*.test.ts'],fileParallelism:false,testTimeout:300000,hookTimeout:300000},resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}}});
