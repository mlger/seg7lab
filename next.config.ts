import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    // The repo is tsc-clean (`bunx tsc --noEmit` exits 0); a type error must
    // FAIL the build instead of being silently shipped.
    ignoreBuildErrors: false,
  },
  // Double-invokes effects in dev to surface impure renders/side effects.
  reactStrictMode: true,
};

export default nextConfig;
