import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Sandbox provider SDKs pull in native/node-only modules (ssh2's crypto
  // addon via dockerode) that Turbopack cannot bundle; load them from
  // node_modules at runtime instead.
  serverExternalPackages: ["dockerode", "ssh2", "@daytonaio/sdk"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "vercel.com",
      },
      {
        protocol: "https",
        hostname: "*.vercel.com",
      },
    ],
  },
  /*
   * Sandbox provider SDKs must load from node_modules at runtime rather than
   * being bundled:
   *  - dockerode pulls in ssh2's native crypto addon, which Turbopack cannot
   *    place in an ESM chunk
   *  - @daytonaio/sdk is deliberately not installed (the provider is a stub),
   *    so a bundler that follows its lazy import fails to resolve it
   */
  serverExternalPackages: ["@daytonaio/sdk", "dockerode", "ssh2"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default withWorkflow(withBotId(nextConfig));
