import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: { "/*": ["./src/assets/default-template.xlsx"] },
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./tests/**/*", "./doc/**/*", "./.env*"] },
  cacheComponents: true,
  partialPrefetching: true,
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
