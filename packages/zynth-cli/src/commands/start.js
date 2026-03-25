const path = require("path");
const { spawn } = require("child_process");
const { createDevtoolsHub } = require("../devtools/hub");
const { createHMRFilter } = require("../hmr-filter");
const { findAppDirectory, printZynthDevStatus } = require("../utils");

module.exports = {
  command: "start",
  describe: "Start rsbuild dev server and Zynth devtools hub",
  builder: (yargs) => {
    yargs.option("port", {
      type: "number",
      default: 7070,
      describe: "Port for rsbuild dev server",
    });
    yargs.option("host", {
      type: "string",
      default: "0.0.0.0",
      describe: "Host for rsbuild dev server",
    });
    yargs.option("devtools", {
      type: "boolean",
      default: true,
      describe: "Start the Zynth devtools hub",
    });
    yargs.option("devtools-port", {
      type: "number",
      default: 7080,
      describe: "Port for Zynth devtools hub",
    });
    yargs.option("devtools-host", {
      type: "string",
      default: "0.0.0.0",
      describe: "Host for Zynth devtools hub",
    });
  },
  handler: async (argv) => {
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());

    const rsbuildPort = Number(process.env.ZYNTH_HMR_PORT || argv.port || 7070);
    const rsbuildHost = process.env.ZYNTH_HMR_BIND || argv.host || "0.0.0.0";
    const devtoolsPort = Number(
      process.env.ZYNTH_DEVTOOLS_PORT || argv.devtoolsPort || 7080
    );
    const devtoolsHost = argv.devtoolsHost || "0.0.0.0";

    let shuttingDown = false;
    let rsbuildProcess = null;
    let devtoolsServer = null;
    let hasShownStartedBanner = false;

    const waitForClose = () =>
      new Promise((resolve) => {
        if (!rsbuildProcess) {
          resolve();
          return;
        }
        rsbuildProcess.once("close", () => resolve());
      });

    const shutdown = async (exitCode = 0) => {
      if (shuttingDown) return;
      shuttingDown = true;

      if (devtoolsServer?.close) {
        try {
          await devtoolsServer.close();
        } catch (_error) {
          // ignore close errors during shutdown
        }
      }

      if (rsbuildProcess && !rsbuildProcess.killed) {
        rsbuildProcess.kill("SIGTERM");
        await waitForClose();
      }

      process.exit(exitCode);
    };

    process.on("SIGINT", () => {
      shutdown(0);
    });
    process.on("SIGTERM", () => {
      shutdown(0);
    });

    if (argv.devtools !== false) {
      const hub = createDevtoolsHub({
        host: devtoolsHost,
        port: devtoolsPort,
        print: true,
        json: false,
        replayLimit: 200,
        filters: {
          topics: [],
          levels: [],
          tags: [],
          hideAutomation: true,
        },
      });
      devtoolsServer = await hub.start();
      console.log(
        `◆ Zynth devtools hub listening at ws://${devtoolsServer.host}:${devtoolsServer.port}`
      );
    }

    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    rsbuildProcess = spawn(
      command,
      ["rsbuild", "dev", "--port", String(rsbuildPort), "--host", rsbuildHost],
      {
        cwd: appDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
          BROWSERSLIST_IGNORE_OLD_DATA: "true",
          FORCE_COLOR: "1",
        },
      }
    );

    const hmrFilter = createHMRFilter(null, {
      onReady: () => {
        if (hasShownStartedBanner) return;
        hasShownStartedBanner = true;
        printZynthDevStatus({
          appDir,
          serverPort: rsbuildPort,
          devtoolsEnabled: argv.devtools !== false,
        });
      },
    });

    rsbuildProcess.stdout.on("data", hmrFilter);
    rsbuildProcess.stderr.on("data", hmrFilter);

    rsbuildProcess.on("error", (error) => {
      console.error(`✖ Failed to start rsbuild dev server: ${error.message}`);
      shutdown(1);
    });

    rsbuildProcess.on("close", (code) => {
      if (shuttingDown) return;
      const exitCode = typeof code === "number" ? code : 1;
      shutdown(exitCode);
    });

    await new Promise(() => {});
  },
};
