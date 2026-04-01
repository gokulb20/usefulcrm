import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

const rootPkg = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "..", "..", "package.json"), "utf-8"),
) as { version?: string };

let hermesVersion = "";
try {
  const req = createRequire(import.meta.url);
  const oclPkg = req("hermes/package.json") as { version?: string };
  hermesVersion = oclPkg.version ?? "";
} catch { /* hermes not resolvable at build time */ }

const usefulVersion = rootPkg.version ?? "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_DENCHCLAW_VERSION: usefulVersion,
    NEXT_PUBLIC_OPENCLAW_VERSION: hermesVersion,
  },

  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon\\.ico).*)",
        headers: [{ key: "X-Usefulclaw-Version", value: usefulVersion }],
      },
    ];
  },

  // Produce a self-contained standalone build so npm global installs
  // can run the web app with `node server.js` — no npm install or
  // next build required at runtime.
  output: "standalone",

  // Required for pnpm monorepos: trace dependencies from the workspace
  // root so the standalone build bundles its own node_modules correctly
  // instead of resolving through pnpm's virtual store symlinks.
  outputFileTracingRoot: path.join(import.meta.dirname, "..", ".."),

  // Externalize packages with native addons so webpack doesn't break them
  serverExternalPackages: ["ws", "bufferutil", "utf-8-validate", "node-pty"],

  // Transpile ESM-only packages so webpack can bundle them
  transpilePackages: ["react-markdown", "remark-gfm"],

  webpack: (config, { dev, isServer }) => {
    if (!isServer) {
      // html-to-docx references Node-only modules that should not be resolved in browser bundles.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        encoding: false,
      };
    }
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/.next/**",
          path.join(homedir(), ".hermes", "**"),
          path.join(homedir(), ".hermes-*", "**"),
        ],
        poll: 1500,
      };
    }
    return config;
  },
};

export default nextConfig;
