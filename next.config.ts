import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is deliberately left off: every admin/worker page reads the
  // login cookie, and plain dynamic rendering keeps the code simple.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
