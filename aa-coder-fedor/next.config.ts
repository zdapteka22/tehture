import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["monaco-editor", "playwright", "playwright-core", "minisearch"],
  // Cursor Preview proxies from 127.0.0.1; Next.js 16 blocks that origin by default.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  devIndicators: false,
  typescript: { ignoreBuildErrors: true },
  webpack: (config, { isServer, webpack }) => {
    // webpack 5 treats `node:dns` as a URL and throws UnhandledSchemeError.
    // Rewrite node:* to the bare builtin name before that check.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^node:/,
        (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, "");
        },
      ),
    );

    if (isServer) {
      config.externalsPresets = { ...(config.externalsPresets || {}), node: true };
      // Keep Node createRequire at runtime. Webpack's static rewrite turns
      // createRequire(path.join(...)) into undefined and crashes page collection.
      config.module = config.module || {};
      const parser = (config.module.parser || {}) as {
        javascript?: Record<string, unknown>;
      };
      config.module.parser = {
        ...parser,
        javascript: {
          ...(parser.javascript || {}),
          createRequire: false,
        },
      };
      return config;
    }

    // Never emit `require("process")` / `require("dns")` into the browser bundle.
    // That is what froze the UI on "Loading…".
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      process: false,
      dns: false,
      fs: false,
      net: false,
      tls: false,
      child_process: false,
      async_hooks: false,
      os: false,
      path: false,
      crypto: false,
      http: false,
      https: false,
      stream: false,
      module: false,
      url: false,
      buffer: false,
      zlib: false,
      util: false,
      events: false,
      worker_threads: false,
      inspector: false,
    };
    return config;
  },
};

export default nextConfig;
