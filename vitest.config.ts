import { defineConfig, mergeConfig } from "vitest/config"

import viteConfig from "./vite.config.ts"

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Unit seams (units, shape geometry) are pure math — no DOM needed;
      // Fabric's isomorphic build constructs objects fine in Node.
      environment: "node",
    },
  }),
)
