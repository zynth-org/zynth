const path = require("path");
const {
  findWorkspaceRoot,
  findAppDirectory,
  devIOS,
  devAndroid,
} = require("../utils");

module.exports = {
  command: "dev <platform>",
  describe: "Bundle JS and run native project",
  builder: (yargs) => {
    yargs.positional("platform", {
      describe: "Platform to run on",
      choices: ["ios", "android"],
    });
    yargs.option("prebuild", {
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
  },
  handler: async (argv) => {
    const root = findWorkspaceRoot(process.cwd());
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());
    if (argv.platform === "ios") {
      await devIOS(root, appDir, {
        prebuild: argv.prebuild,
        devices: argv.devices,
        local: argv.local,
        hmrNetwork: argv.hmrNetwork,
      });
    } else {
      await devAndroid(root, appDir, {
        local: argv.local,
        hmrNetwork: argv.hmrNetwork,
      });
    }
  },
};
