import baseConfig from "../vitest.config.ts";
import { defineConfig } from "vitest/config";

const base = baseConfig as unknown as Record<string, unknown>;
const baseTest = (baseConfig as { test?: Record<string, unknown> }).test ?? {};

export default defineConfig({
  ...base,
  test: {
    ...baseTest,
    include: ["extensions/**/*.test.ts"],
  },
});
