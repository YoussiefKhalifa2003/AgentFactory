import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["three", "mermaid"],
  devIndicators: false,
};

export default nextConfig;
