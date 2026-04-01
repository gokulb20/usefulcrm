import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const key = process.env.POSTHOG_KEY || "";

const rootPkg = JSON.parse(readFileSync("package.json", "utf-8"));
const usefulcrmVersion = rootPkg.version || "";

let hermesVersion = "";
try {
  const req = createRequire(import.meta.url);
  const oclPkg = req("hermes/package.json");
  hermesVersion = oclPkg.version || "";
} catch { /* hermes not resolvable at build time */ }

writeFileSync(
  "extensions/posthog-analytics/lib/build-env.js",
  [
    `export const POSTHOG_KEY = ${JSON.stringify(key)};`,
    `export const DENCHCLAW_VERSION = ${JSON.stringify(usefulcrmVersion)};`,
    `export const OPENCLAW_VERSION = ${JSON.stringify(hermesVersion)};`,
    "",
  ].join("\n"),
);
