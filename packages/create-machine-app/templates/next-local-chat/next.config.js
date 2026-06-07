/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@machine/activation-sdk', '@machine/ui'],
};

module.exports = nextConfig;
