const path = require("path");
const {
  findWorkspaceRoot,
  findAppDirectory,
  ensureBootstrap,
} = require("../utils");

module.exports = {
  command: "bootstrap <platform>",
  describe: "Generate native project from templates",
  builder: (yargs) => {
    yargs.positional("platform", {
      describe: "Platform to bootstrap for",
      choices: ["ios", "android"],
    });
    yargs.option("production", {
      describe: "Generate production build without dev infrastructure",
      type: "boolean",
      default: false,
    });
    yargs.option("axon-enabled", {
      describe: "Enable the Axon Android layout engine during bootstrap/native build",
      type: "boolean",
      default: false,
    });
  },
  handler: (argv) => {
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());
    let root = appDir;
    try {
      root = findWorkspaceRoot(process.cwd());
    } catch (_error) {
      // Standalone app: use app root as command root
    }
    const options = {
      dev: !argv.production,
      axonEnabled: argv.platform === "android" ? argv.axonEnabled : false,
    };
    ensureBootstrap(root, appDir, argv.platform, options);
  },
};
