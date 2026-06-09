/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The /prototype folder is the design reference, not part of the build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
