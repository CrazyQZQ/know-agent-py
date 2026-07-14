import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";
import type { ConfigEnv, UserConfig, UserConfigExport } from "vite";

import viteConfig, { resolveApiTarget, webuiManualChunk } from "../../vite.config";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as {
  name: string;
  engines?: { node?: string };
};
const indexHtml = readFileSync(require.resolve("../../index.html"), "utf8");

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

  it("requires a Node release supported by ESLint 10", () => {
    expect(packageJson.engines?.node).toBe("^20.19.0 || ^22.13.0 || >=24");
  });

  it("uses the local Know-Agent backend when no API target is configured", () => {
    expect(resolveApiTarget({})).toBe("http://localhost:8000");
  });

  it("uses an explicitly configured API target", () => {
    expect(resolveApiTarget({ VITE_API_BASE_URL: "http://api.example" })).toBe(
      "http://api.example",
    );
  });

  it("configures the /v1 proxy with origin rewriting", async () => {
    const config = await resolveViteConfig(viteConfig);

    expect(config.server?.proxy?.["/v1"]).toMatchObject({
      changeOrigin: true,
    });
  });

  it("builds into the local dist directory", async () => {
    const config = await resolveViteConfig(viteConfig);

    expect(config.build?.outDir).toBe("dist");
  });
});

describe("Know-Agent boot shell", () => {
  it("disables the boot animation when reduced motion is requested", () => {
    expect(indexHtml).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.boot-dot\s*\{[\s\S]*?animation:\s*none;/,
    );
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
