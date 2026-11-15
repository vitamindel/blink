import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lets a production build run next to the dev server (which owns .next)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
};

export default nextConfig;
