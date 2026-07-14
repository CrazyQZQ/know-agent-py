import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";
import type { ConfigEnv, UserConfig, UserConfigExport } from "vite";

import viteConfig, { webuiManualChunk } from "../../vite.config";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { name: string };

async function resolveViteConfig(config: UserConfigExport): Promise<UserConfig> {
  const configEnv: ConfigEnv = {
    command: "serve",
    mode: "test",
    isSsrBuild: false,
    isPreview: false,
  };

  return typeof config === "function" ? await config(configEnv) : await config;
}

describe("Know-Agent Vite runtime configuration", () => {
  it("uses the Know-Agent package identity", () => {
    expect(packageJson.name).toBe("know-agent-web-ui");
  });

  it("proxies the API to the local Know-Agent backend by default", async () => {
    const previousTarget = process.env.VITE_API_BASE_URL;
    const config = await (async () => {
      delete process.env.VITE_API_BASE_URL;

      try {
        return await resolveViteConfig(viteConfig);
      } finally {
        if (previousTarget === undefined) {
          delete process.env.VITE_API_BASE_URL;
        } else {
          process.env.VITE_API_BASE_URL = previousTarget;
        }
      }
    })();

    expect(config.server?.proxy?.["/v1"]).toMatchObject({
      target: "http://localhost:8000",
      changeOrigin: true,
    });
  });

  it("builds into the local dist directory", async () => {
    const config = await resolveViteConfig(viteConfig);

    expect(config.build?.outDir).toBe("dist");
  });
});

describe("webuiManualChunk", () => {
  it("keeps Refractor's selector parser in the syntax highlighting chunk", () => {
    expect(
      webuiManualChunk("/repo/node_modules/hast-util-parse-selector/index.js"),
    ).toBe("syntax-highlight");
  });

  it("keeps markdown-only hast utilities in the markdown chunk", () => {
    expect(
      webuiManualChunk("/repo/node_modules/hast-util-to-jsx-runtime/lib/index.js"),
    ).toBe("markdown-vendor");
  });

  it("leaves language grammars as independently loaded chunks", () => {
    expect(webuiManualChunk("/repo/node_modules/refractor/lang/python.js")).toBeUndefined();
  });
});
