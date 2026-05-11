import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, loadEnv, type Plugin, type UserConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

function applyWatchDebounceDefaults(config: UserConfig): UserConfig {
  const existingWatch = config.server?.watch ?? {};
  const existingAwaitWriteFinish = existingWatch.awaitWriteFinish;
  const hasAwaitWriteFinishObject =
    !!existingAwaitWriteFinish &&
    typeof existingAwaitWriteFinish === "object" &&
    !Array.isArray(existingAwaitWriteFinish);

  return {
    ...config,
    server: {
      ...config.server,
      watch: {
        ...existingWatch,
        awaitWriteFinish: {
          ...(hasAwaitWriteFinishObject ? existingAwaitWriteFinish : {}),
          stabilityThreshold: 1000,
          pollInterval: 100,
        },
      },
    },
  };
}

function serverFnErrorLogger(): Plugin {
  const hmrSendKey = "__TANSTACK_SERVER_FN_HMR_SEND__";

  return {
    name: "server-fn-error-logger",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      (
        globalThis as typeof globalThis & {
          [key: string]: ((data: unknown) => void) | undefined;
        }
      )[hmrSendKey] = (data) => {
        server.ws.send({
          type: "custom",
          event: "server-fn-error",
          data,
        });
      };
    },
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, "/");
      const isTargetModule =
        normalizedId.includes("/@tanstack/start-server-core/src/server-functions-handler.ts") ||
        normalizedId.includes("/@tanstack/start-server-core/dist/esm/server-functions-handler.js");

      if (!isTargetModule) {
        return null;
      }

      const needle = "const unwrapped = res.result || res.error";

      if (!code.includes(needle)) {
        return null;
      }

      return code.replace(
        needle,
        `${needle}

      if (res?.error) {
        const err = res.error
        const payload = {
          source: 'tanstack',
          type: 'server-fn-error',
          method: request.method,
          url: request.url,
          name: err?.name ?? 'Error',
          message: err?.message ?? String(err),
          stack: typeof err?.stack === 'string' ? err.stack : undefined,
        }
        globalThis.${hmrSendKey}?.(payload)
      }`,
      );
    },
  };
}

function faviconRedirect(): Plugin {
  return {
    name: "favicon-redirect",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/favicon.ico") {
          next();
          return;
        }

        res.statusCode = 302;
        res.setHeader("Location", "/logo-dark.png");
        res.end();
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const envDefine: Record<string, string> = {};
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");

  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const plugins = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    serverFnErrorLogger(),
    faviconRedirect(),
    ...tanstackStart({
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
      server: { entry: "server" },
    }),
    react(),
  ];

  if (command === "build") {
    plugins.push(
      ...cloudflare({
        viteEnvironment: { name: "ssr" },
      }),
    );
  }

  return applyWatchDebounceDefaults({
    define: envDefine,
    plugins,
    resolve: {
      alias: {
        "@": `${process.cwd()}/src`,
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    server: {
      host: "::",
      port: 8080,
    },
  });
});
