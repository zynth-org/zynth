import path from "node:path";
import fs from "node:fs/promises";
import { WebSocketServer } from "ws";

const VIRTUAL_MODULE_ID = "virtual:rune-entry";
const RESOLVED_VIRTUAL_MODULE_ID = "\0rune-entry";

export function runeNativePlugin(options = {}) {
  const {
    platform = process.env.RUNE_PLATFORM || "ios",
    entryFile = "src/index.tsx",
    appRoot = process.cwd(),
  } = options;

  const nativeClients = new Set();

  const asJson = (payload) => {
    if (payload == null) {
      return null;
    }
    if (typeof payload === "string") {
      return payload;
    }
    try {
      return JSON.stringify(payload);
    } catch (error) {
      console.warn("[rune-native] Failed to stringify payload for native clients", error);
      return null;
    }
  };

  const notifyNativeClients = (payload) => {
    if (nativeClients.size === 0) {
      return;
    }
    const message = asJson(payload);
    if (!message) {
      return;
    }
    for (const socket of nativeClients) {
      if (socket.readyState === 1) {
        socket.send(message);
      }
    }
  };

  return {
    name: "rune-native",

    config(config, env) {
      return {
        define: {
          __RUNE_PLATFORM__: JSON.stringify(platform),
          __RUNE_DEV_SERVER__: JSON.stringify(env.command === "serve"),
        },
        resolve: {
          alias: {
            "@rune/app-entry": VIRTUAL_MODULE_ID,
          },
        },
      };
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
      return null;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        const normalizedEntry = entryFile.startsWith("./")
          ? entryFile.slice(2)
          : entryFile;
        const entryPath = path.posix.join("/", normalizedEntry.replace(/\\/g, "/"));
        return `import App from "${entryPath}";\nexport default App;`;
      }
      return null;
    },

    configureServer(server) {
      const { ws, middlewares } = server;

      const nativeWSS = new WebSocketServer({ noServer: true });

      nativeWSS.on("connection", (socket, request) => {
        nativeClients.add(socket);
        socket.on("close", () => nativeClients.delete(socket));
        socket.on("message", (message) => {
          if (typeof message !== "string") {
            return;
          }
          if (message === "__rune_ping__" && socket.readyState === 1) {
            socket.send("__rune_pong__");
          }
        });
        const helloPayload = {
          type: "custom",
          event: "rune:connected",
          data: {
            platform,
            appRoot,
            timestamp: Date.now(),
          },
        };
        const hello = asJson(helloPayload);
        if (hello && socket.readyState === 1) {
          socket.send(hello);
        }
      });

      server.httpServer?.on("upgrade", (request, socket, head) => {
        const url = request.url || "/";
        if (!url.startsWith("/rune-native")) {
          return;
        }
        nativeWSS.handleUpgrade(request, socket, head, (client) => {
          nativeWSS.emit("connection", client, request);
        });
      });

      const watchedSend = ws.send.bind(ws);
      ws.send = (payload, clients) => {
        notifyNativeClients(payload);
        return watchedSend(payload, clients);
      };

      ws.on("connection", (socket, request) => {
        const url = request?.url || "/";
        if (!url.startsWith("/rune-native")) {
          return;
        }
        nativeClients.add(socket);
        socket.on("close", () => {
          nativeClients.delete(socket);
        });
        socket.on("message", (message) => {
          if (typeof message !== "string") {
            return;
          }
          if (message === "__rune_ping__" && socket.readyState === 1) {
            socket.send("__rune_pong__");
          }
        });
        const helloPayload = {
          type: "custom",
          event: "rune:connected",
          data: {
            platform,
            appRoot,
            timestamp: Date.now(),
          },
        };
        const hello = asJson(helloPayload);
        if (hello && socket.readyState === 1) {
          socket.send(hello);
        }
      });

      middlewares.use("/rune-native/bundle", async (req, res, next) => {
        try {
          const bundlePath = path.join(appRoot, "dist", "main.js");
          const code = await fs.readFile(bundlePath, "utf8");
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(code);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: "bundle_unavailable",
              message: error?.message || String(error),
            })
          );
        }
      });

      middlewares.use("/rune-native/ready", async (req, res, next) => {
        if (req.method && req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            platform,
            timestamp: Date.now(),
          })
        );
      });

      server.httpServer?.on("close", () => {
        nativeClients.clear();
        nativeWSS.clients.forEach((client) => {
          try {
            client.terminate();
          } catch (error) {
            /* noop */
          }
        });
        nativeClients.clear();
      });
    },
  };
}

export default runeNativePlugin;
