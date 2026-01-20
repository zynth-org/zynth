const path = require("path");
const {
  findWorkspaceRoot,
  findAppDirectory,
  ensurePrebuild,
} = require("../utils");

module.exports = {
  command: "prebuild <platform>",
  describe: "Generate native project from templates",
  builder: (yargs) => {
    yargs.positional("platform", {
      describe: "Platform to prebuild for",
      choices: ["ios", "android"],
    });
    yargs.option("production", {
      describe: "Generate production build without dev infrastructure",
      type: "boolean",
      default: false,
    });
    yargs.option("new-runtime", {
      describe: "Use the new runtime from @zynth/core during prebuild",
      type: "boolean",
      default: false,
    });
  },
  handler: (argv) => {
    const root = findWorkspaceRoot(process.cwd());
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());
    const options = { dev: !argv.production, newRuntime: argv.newRuntime };
    ensurePrebuild(root, appDir, argv.platform, options);
  },
};
