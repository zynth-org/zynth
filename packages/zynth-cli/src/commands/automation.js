const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function runSafe(task) {
  try {
    await task();
  } catch (error) {
    console.error(`[automation] ${formatError(error)}`);
    process.exitCode = 1;
  }
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function connectHub(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timed out connecting to devtools hub: ${url}`));
    }, timeoutMs);
    socket.on("open", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function sendMessage(socket, message) {
  socket.send(JSON.stringify(message));
}

function subscribeTopics(socket, topics, options = {}) {
  const payload = { type: "sub", topics };
  if (options.replay) {
    payload.replay = true;
    if (typeof options.limit === "number" && options.limit > 0) {
      payload.limit = options.limit;
    }
  }
  sendMessage(socket, payload);
}

function publishTopic(socket, topic, data) {
  sendMessage(socket, {
    type: "pub",
    event: {
      topic,
      tag: "automation-cli",
      level: "info",
      data,
    },
  });
}

function collectReadyRuntimes(socket, discoverTimeoutMs) {
  return new Promise((resolve) => {
    const runtimes = new Map();
    const onMessage = (buffer) => {
      let message;
      try {
        message = JSON.parse(buffer.toString());
      } catch {
        return;
      }
      if (message?.type !== "event") return;
      const event = message.event || {};
      if (event.topic !== "automation/ready") return;
      const data = event.data || {};
      const runtimeId = data.runtimeId;
      if (!runtimeId || typeof runtimeId !== "string") return;
      runtimes.set(runtimeId, {
        runtimeId,
        appId: typeof data.appId === "string" ? data.appId : "unknown",
        platform: typeof data.platform === "string" ? data.platform : "unknown",
        capabilities: data.capabilities || {},
      });
    };

    socket.on("message", onMessage);
    publishTopic(socket, "automation/discover", { requestId: randomId("discover") });

    setTimeout(() => {
      socket.off("message", onMessage);
      resolve(Array.from(runtimes.values()));
    }, discoverTimeoutMs);
  });
}

function selectRuntime(runtimes, argv) {
  let candidates = runtimes;
  if (argv.runtime) {
    candidates = candidates.filter((runtime) => runtime.runtimeId === argv.runtime);
  }
  if (argv.appId) {
    candidates = candidates.filter((runtime) => runtime.appId === argv.appId);
  }
  if (argv.platform) {
    candidates = candidates.filter(
      (runtime) => runtime.platform.toLowerCase() === String(argv.platform).toLowerCase()
    );
  }
  return candidates;
}

function readSnapshot(socket, targetRuntime, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const requestId = randomId("read");
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for automation response. Ensure @zynthjs/automation is imported in the app."));
    }, timeoutMs);

    const onMessage = (buffer) => {
      let message;
      try {
        message = JSON.parse(buffer.toString());
      } catch {
        return;
      }
      if (message?.type !== "event") return;
      const event = message.event || {};
      if (event.topic !== "automation/response") return;
      const data = event.data || {};
      if (data.requestId !== requestId) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(data);
    };

    socket.on("message", onMessage);
    publishTopic(socket, "automation/request", {
      requestId,
      action: "read",
      target: {
        runtimeId: targetRuntime.runtimeId,
      },
      options,
    });
  });
}

function compareValues(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffExpected(actualSnapshot, expectedSnapshot, strict) {
  const issues = [];
  const actualSurfaceMap = new Map((actualSnapshot.surfaces || []).map((surface) => [surface.surfaceId, surface]));
  const expectedSurfaceMap = new Map(
    (expectedSnapshot.surfaces || []).map((surface) => [surface.surfaceId, surface])
  );

  if (strict) {
    for (const actualSurface of actualSnapshot.surfaces || []) {
      if (!expectedSurfaceMap.has(actualSurface.surfaceId)) {
        issues.push(`Unexpected surface ${actualSurface.surfaceId}`);
      }
    }
  }

  for (const expectedSurface of expectedSnapshot.surfaces || []) {
    const actualSurface = actualSurfaceMap.get(expectedSurface.surfaceId);
    if (!actualSurface) {
      issues.push(`Missing surface ${expectedSurface.surfaceId}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(expectedSurface, "rootChildren")) {
      if (!compareValues(actualSurface.rootChildren, expectedSurface.rootChildren)) {
        issues.push(`Surface ${expectedSurface.surfaceId} field rootChildren mismatch`);
      }
    }
    const expectedNodeMap = new Map(
      (expectedSurface.nodes || []).map((node) => [String(node.id), node])
    );
    if (strict) {
      for (const actualNodeId of Object.keys(actualSurface.nodes || {})) {
        if (!expectedNodeMap.has(actualNodeId)) {
          issues.push(
            `Unexpected node ${actualNodeId} on surface ${expectedSurface.surfaceId}`
          );
        }
      }
    }
    for (const expectedNode of expectedSurface.nodes || []) {
      const actualNode = actualSurface.nodes?.[String(expectedNode.id)];
      if (!actualNode) {
        issues.push(`Missing node ${expectedNode.id} on surface ${expectedSurface.surfaceId}`);
        continue;
      }
      if (expectedNode.type && actualNode.type !== expectedNode.type) {
        issues.push(
          `Node ${expectedNode.id} type mismatch: expected=${expectedNode.type} actual=${actualNode.type}`
        );
      }
      const fields = [
        "surfaceId",
        "parentId",
        "visibility",
        "alpha",
        "text",
      ];
      for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(expectedNode, field)) {
          if (!compareValues(actualNode[field], expectedNode[field])) {
            issues.push(
              `Node ${expectedNode.id} field ${field} mismatch: expected=${JSON.stringify(
                expectedNode[field]
              )} actual=${JSON.stringify(actualNode[field])}`
            );
          }
        }
      }
      const complexFields = ["childIds", "yogaStyles", "resolvedStyles", "componentState"];
      for (const field of complexFields) {
        if (Object.prototype.hasOwnProperty.call(expectedNode, field)) {
          if (!compareValues(actualNode[field], expectedNode[field])) {
            issues.push(`Node ${expectedNode.id} field ${field} mismatch`);
          }
        }
      }
    }
  }
  return issues;
}

function buildReadOptions(argv) {
  const options = {};
  if (argv.surface !== undefined) options.surfaceId = Number(argv.surface);
  if (argv.rootNode !== undefined) options.rootNodeId = Number(argv.rootNode);
  if (argv.maxDepth !== undefined) options.maxDepth = Number(argv.maxDepth);
  if (argv.styles) options.includeYogaStyles = true;
  if (argv.resolvedStyles) options.includeResolvedStyles = true;
  if (argv.componentState) options.includeComponentState = true;
  if (argv.text) options.includeText = true;
  if (argv.globalFrame === false) options.includeGlobalFrame = false;
  return options;
}

module.exports = {
  command: "automation <command>",
  describe: "Automation utilities (screen read + diff) via devtools hub",
  builder: (yargs) =>
    yargs
      .command(
        "list",
        "List available automation runtimes connected to the devtools hub",
        (cmd) =>
          cmd
            .option("hub", {
              type: "string",
              default: "ws://127.0.0.1:7080",
              describe: "Devtools hub WebSocket URL",
            })
            .option("connect-timeout", {
              type: "number",
              default: 3000,
              describe: "Connection timeout in ms",
            })
            .option("discover-timeout", {
              type: "number",
              default: 600,
              describe: "Discovery window in ms",
            })
            .option("json", {
              type: "boolean",
              default: false,
              describe: "Print JSON output",
            }),
        async (argv) =>
          runSafe(async () => {
            const socket = await connectHub(argv.hub, argv.connectTimeout);
            try {
              subscribeTopics(socket, ["automation/ready"], { replay: true, limit: 200 });
              const runtimes = await collectReadyRuntimes(socket, argv.discoverTimeout);
              if (argv.json) {
                process.stdout.write(`${JSON.stringify({ runtimes }, null, 2)}\n`);
                return;
              }
              if (runtimes.length === 0) {
                console.log("No automation runtimes found.");
                console.log("Ensure @zynthjs/automation is installed and imported by the target app.");
                return;
              }
              console.log(`Found ${runtimes.length} automation runtime(s):`);
              for (const runtime of runtimes) {
                console.log(
                  `- runtime=${runtime.runtimeId} app=${runtime.appId} platform=${runtime.platform}`
                );
              }
            } finally {
              socket.close();
            }
          })
      )
      .command(
        "read",
        "Read native screen snapshot from a target runtime",
        (cmd) =>
          cmd
            .option("hub", {
              type: "string",
              default: "ws://127.0.0.1:7080",
              describe: "Devtools hub WebSocket URL",
            })
            .option("connect-timeout", {
              type: "number",
              default: 3000,
              describe: "Connection timeout in ms",
            })
            .option("discover-timeout", {
              type: "number",
              default: 600,
              describe: "Discovery window in ms",
            })
            .option("timeout", {
              type: "number",
              default: 5000,
              describe: "Read response timeout in ms",
            })
            .option("runtime", {
              type: "string",
              describe: "Target runtime id",
            })
            .option("app-id", {
              type: "string",
              describe: "Target app id",
            })
            .option("platform", {
              type: "string",
              choices: ["ios", "android"],
              describe: "Target platform",
            })
            .option("surface", {
              type: "number",
              describe: "Filter by surface id",
            })
            .option("root-node", {
              type: "number",
              describe: "Filter to subtree rooted at node id",
            })
            .option("max-depth", {
              type: "number",
              describe: "Maximum traversal depth",
            })
            .option("styles", {
              type: "boolean",
              default: false,
              describe: "Include Yoga style cache",
            })
            .option("resolved-styles", {
              type: "boolean",
              default: false,
              describe: "Include resolved native style state",
            })
            .option("component-state", {
              type: "boolean",
              default: false,
              describe: "Include component-level inspector state",
            })
            .option("text", {
              type: "boolean",
              default: false,
              describe: "Include text payloads",
            })
            .option("global-frame", {
              type: "boolean",
              default: true,
              describe: "Include global frame values",
            })
            .option("json", {
              type: "boolean",
              default: false,
              describe: "Print raw JSON snapshot",
            })
            .option("expect", {
              type: "string",
              describe: "Path to expected snapshot subset JSON for diff/assert",
            })
            .option("strict", {
              type: "boolean",
              default: false,
              describe: "Strict diff mode (fail on unexpected surfaces/nodes)",
            }),
        async (argv) =>
          runSafe(async () => {
            const socket = await connectHub(argv.hub, argv.connectTimeout);
            try {
              subscribeTopics(socket, ["automation/ready"], { replay: true, limit: 200 });
              subscribeTopics(socket, ["automation/response"]);
              const runtimes = await collectReadyRuntimes(socket, argv.discoverTimeout);
              if (runtimes.length === 0) {
                throw new Error(
                  "No automation runtimes discovered. Ensure @zynthjs/automation is installed and imported in the app."
                );
              }
              const candidates = selectRuntime(runtimes, argv);
              if (candidates.length === 0) {
                throw new Error(
                  "No runtime matches filters. Use --runtime or combine --app-id with --platform."
                );
              }
              if (candidates.length > 1) {
                const summary = candidates
                  .map((runtime) => `${runtime.runtimeId} (${runtime.appId}/${runtime.platform})`)
                  .join(", ");
                throw new Error(
                  `Multiple matching runtimes. Provide --runtime (recommended). Candidates: ${summary}`
                );
              }
              const targetRuntime = candidates[0];
              const options = buildReadOptions(argv);
              const response = await readSnapshot(socket, targetRuntime, options, argv.timeout);
              if (!response.ok) {
                throw new Error(
                  `Target runtime responded with error: ${response.error || "unknown_error"}`
                );
              }
              const snapshot = response.snapshot;
              if (argv.expect) {
                const expectPath = path.resolve(process.cwd(), argv.expect);
                const expected = JSON.parse(fs.readFileSync(expectPath, "utf8"));
                const issues = diffExpected(snapshot, expected, argv.strict);
                if (issues.length > 0) {
                  console.error(`Snapshot diff failed (${issues.length} issue(s))`);
                  for (const issue of issues.slice(0, 20)) {
                    console.error(`- ${issue}`);
                  }
                  process.exitCode = 1;
                } else {
                  console.log("Snapshot diff passed.");
                }
              }
              if (argv.json || !argv.expect) {
                process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
              }
            } finally {
              socket.close();
            }
          })
      )
      .demandCommand(1),
  handler: () => {},
};
