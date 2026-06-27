/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep `pg` as a real Node dependency in serverless functions.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
