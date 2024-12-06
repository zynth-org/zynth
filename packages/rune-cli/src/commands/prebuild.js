const path = require("path");
const { findWorkspaceRoot, findAppDirectory, ensurePrebuild } = require("../utils");

module.exports = {
  command: "prebuild <platform>",
  describe: "Generate native project from templates",
  builder: (yargs) => {
    yargs.positional("platform", {
      describe: "Platform to prebuild for",
      choices: ["ios", "android"],
    });
  },
  handler: (argv) => {
    const root = findWorkspaceRoot(process.cwd());
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());
    ensurePrebuild(root, appDir, argv.platform);
  },
};
