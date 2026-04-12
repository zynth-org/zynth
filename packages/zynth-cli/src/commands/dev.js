const path = require("path");
const {
  findWorkspaceRoot,
  findAppDirectory,
  devIOS,
  devAndroid,
  devWeb,
} = require("../utils");

module.exports = {
  command: "dev <platform>",
  describe: "Run app in development mode (native or web)",
  builder: (yargs) => {
    yargs.positional("platform", {
      describe: "Platform to run on",
      choices: ["ios", "android", "web"],
    });
    yargs.option("bootstrap", {
      describe: "Regenerate native project before launching",
      type: "boolean",
      default: false,
    });
    yargs.option("devices", {
      describe: "Select a device to launch on from a list (iOS only)",
      type: "boolean",
      default: false,
    });
    yargs.option("local", {
      describe: "Force HMR to use localhost, bypassing network IP detection",
      type: "boolean",
      default: false,
    });
    yargs.option("hmr-network", {
      describe: "Force HMR to use the local network IP",
      type: "boolean",
      default: false,
    });
    yargs.option("devtools", {
      describe: "Start the devtools event hub and connect the runtime",
      type: "boolean",
      default: true,
    });
    yargs.option("devtools-port", {
      describe: "Port for the devtools WebSocket server",
      type: "number",
      default: 7080,
    });
    yargs.option("verbose", {
      describe: "Print raw native build output without filtering",
      type: "boolean",
      default: false,
    });
  },
  handler: async (argv) => {
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());
    let root = appDir;
    try {
      root = findWorkspaceRoot(process.cwd());
    } catch (_error) {
      // Standalone app: use app root as command root
    }
    if (argv.platform === "web") {
      devWeb(appDir);
      return;
    }
    if (argv.platform === "ios") {
      await devIOS(root, appDir, {
        bootstrap: argv.bootstrap,
        devices: argv.devices,
        local: argv.local,
        hmrNetwork: argv.hmrNetwork,
        devtools: argv.devtools,
        devtoolsPort: argv.devtoolsPort,
        verbose: argv.verbose,
      });
    } else {
      await devAndroid(root, appDir, {
        bootstrap: argv.bootstrap,
        local: argv.local,
        hmrNetwork: argv.hmrNetwork,
        devtools: argv.devtools,
        devtoolsPort: argv.devtoolsPort,
        verbose: argv.verbose,
      });
    }
  },
};
