const path = require("path");
const { findAppDirectory, resetIOS, resetAndroid } = require("../utils");

module.exports = {
  command: "reset <platform>",
  describe: "Clean native build artifacts",
  builder: (yargs) => {
    yargs.positional("platform", {
      describe: "Platform to reset",
      choices: ["ios", "android"],
    });
  },
  handler: (argv) => {
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());
    if (argv.platform === "ios") {
      resetIOS(appDir);
    } else {
      resetAndroid(appDir);
    }
  },
};
