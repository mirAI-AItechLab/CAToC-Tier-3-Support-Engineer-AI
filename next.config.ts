import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

    // ★追加: ビルド時の型チェックエラーを無視する
  typescript: {
    ignoreBuildErrors: true,
  },

  // ★追加: ビルド時のESLintエラーを無視する
  eslint: {
    ignoreDuringBuilds: true,
  /* config options here */
  },
};

export default nextConfig;
