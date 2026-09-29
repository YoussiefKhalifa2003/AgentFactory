import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["three", "mermaid"],
  devIndicators: false,
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
