import { defineConfig, mergeConfig } from "vitest/config"

import viteConfig from "./vite.config.ts"

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // jsdom: Fabric's text classes measure glyphs through a real DOM
      // document; the canvas 2D context is stubbed in vitest.setup.ts (jsdom
      // ships no canvas). Object geometry and unit math stay DOM-free.
      environment: "jsdom",
      setupFiles: ["./vitest.setup.ts"],
    },
  }),
)
