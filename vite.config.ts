import vinext from "vinext";
import { defineConfig } from "vite";
import { existsSync } from "node:fs";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";
import { appBuildId } from "./scripts/app-build-id.mjs";

export default defineConfig(async ({ command }) => {
  configureToolEnvironment(process.cwd());
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    define: { __NEONWORTH_APP_VERSION__: JSON.stringify(appBuildId(process.cwd())) },
    server: {
      host: "127.0.0.1",
      port: 5173,
      ...(process.env.CODEX_SANDBOX === "seatbelt"
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        configPath: existsSync("wrangler.jsonc") ? "wrangler.jsonc" : "wrangler.example.jsonc",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        remoteBindings: false,
        config: (config) => ({
          // Authenticate assets as well as pages, route handlers and MCP.
          assets: { ...config.assets, binding: "ASSETS", run_worker_first: true },
          // This local convenience never survives a production build.
          vars: { ...config.vars, LOCAL_DEV: command === "serve" ? "true" : "false" },
        }),
      }),
    ],
  };
});
