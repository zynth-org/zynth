const fs = require("fs");
const path = require("path");
const prompts = require("prompts");
const chalk = require("chalk");
const { readJSON } = require("../utils");

function resolveAppTemplateDir() {
  return path.join(__dirname, "..", "templates", "app");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function updateHtmlTitle(htmlPath, title) {
  if (!fs.existsSync(htmlPath)) {
    return;
  }
  const source = fs.readFileSync(htmlPath, "utf8");
  const escapedTitle = escapeHtml(title);
  const next = source.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapedTitle}</title>`);
  fs.writeFileSync(htmlPath, next, "utf8");
}

async function createNewApp(argv) {
  const {
    directory,
    path: customPath,
    yes,
    displayName: cliDisplayName,
    slug: cliSlug,
  } = argv;

  const baseDir = customPath ? path.resolve(customPath) : process.cwd();

  if (directory && fs.existsSync(path.join(baseDir, directory))) {
    console.error(
      chalk.red(`Directory '${directory}' already exists in '${baseDir}'.`)
    );
    process.exit(1);
  }

  let appDirectory = directory;
  if (!appDirectory) {
    if (yes) {
      console.error(
        chalk.red("Directory is required in non-interactive mode. Pass it as `zynth new <directory> --yes`.")
      );
      process.exit(1);
    }
    const response = await prompts({
      type: "text",
      name: "directory",
      message: "Enter the directory name for your new app:",
      validate: (value) =>
        fs.existsSync(path.join(baseDir, value))
          ? "Directory already exists"
          : true,
    });
    appDirectory = response.directory;
  }

  if (!appDirectory) {
    console.error(chalk.red("App directory is required."));
    process.exit(1);
  }

  const appPath = path.join(baseDir, appDirectory);
  const appName = path.basename(appPath);
  const appTemplateDir = resolveAppTemplateDir();

  const defaultDisplayName = appName;
  const defaultSlug = appName.toLowerCase().replace(/\s+/g, "-");
  let displayName = cliDisplayName;
  let slug = cliSlug;

  if (yes) {
    displayName = displayName || defaultDisplayName;
    slug = slug || defaultSlug;
  } else {
    const questions = [];
    if (!displayName) {
      questions.push({
        type: "text",
        name: "displayName",
        message: "Enter the display name for your app:",
        initial: defaultDisplayName,
      });
    }
    if (!slug) {
      questions.push({
        type: "text",
        name: "slug",
        message: "Enter the slug for your app:",
        initial: defaultSlug,
      });
    }

    if (questions.length > 0) {
      const answers = await prompts(questions);
      displayName = displayName || answers.displayName;
      slug = slug || answers.slug;
    }
  }

  if (!displayName || !slug) {
    console.error(chalk.red("App name and slug are required."));
    process.exit(1);
  }

  console.log(chalk.cyan(`Creating a new Zynth app in ${appPath}`));

  fs.mkdirSync(appPath, { recursive: true });

  // Copy app templates
  fs.cpSync(appTemplateDir, appPath, { recursive: true });

  // Note: src/index.tsx and src/App.tsx are now copied from the template


  // Update app.json
  const appJsonPath = path.join(appPath, "app.json");
  const appJson = readJSON(appJsonPath);
  appJson.name = displayName;
  appJson.slug = slug;
  if (!appJson.zynth || typeof appJson.zynth !== "object") {
    appJson.zynth = {};
  }
  appJson.zynth.name = displayName;
  appJson.zynth.slug = slug;
  fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));

  // Update package.json
  const packageJsonPath = path.join(appPath, "package.json");
  const packageJson = readJSON(packageJsonPath);
  packageJson.name = slug;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  updateHtmlTitle(path.join(appPath, "public", "index.html"), displayName);

      console.log(`\n\x1b[32m✔\x1b[0m App created successfully!`);

  
  console.log(
    chalk.cyan(`To get started, run:

  cd ${appDirectory}
  yarn zynth dev ios
  yarn zynth dev web`)
  );
}

module.exports = {
  command: "new [directory]",
  describe: "Create a new Zynth app",
  builder: (yargs) => {
    yargs
      .positional("directory", {
        describe: "The directory to create the app in",
        type: "string",
      })
      .option("path", {
        alias: "p",
        type: "string",
        description: "The path to create the app in",
      })
      .option("display-name", {
        type: "string",
        description: "Display name for app.json (non-interactive friendly)",
      })
      .option("slug", {
        type: "string",
        description: "Slug for app.json and package.json (non-interactive friendly)",
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        description: "Run non-interactively using defaults for missing values",
      });
  },
  handler: (argv) => {
    createNewApp(argv).catch((err) => {
      console.error(chalk.red(err.stack));
      process.exit(1);
    });
  },
};
