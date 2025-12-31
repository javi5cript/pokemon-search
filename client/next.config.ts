import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Explicitly use webpack instead of Turbopack (default in Next.js 16+)
  // This is needed because webpack config requires compatibility migration
  experimental: {
    // @ts-ignore - disable turbopack
    turbo: false,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        stream: false,
      };
    }
    return config;
  },
};

export default nextConfig;
