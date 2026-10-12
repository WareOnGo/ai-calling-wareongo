/** @type {import('next').NextConfig} */
const nextConfig = {
  // The local live preview can coexist with production builds for browser tests.
  distDir: process.env.BOLNA_PREVIEW_DIST_DIR || ".next",
  // Keep `pg` as a real Node dependency in serverless functions.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
