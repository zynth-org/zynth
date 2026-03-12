const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const prompts = require("prompts");
const { findAppDirectory, readJSON } = require("../utils");

const PRESETS = {
  "media-library": {
    description: "Save images/videos to system Photos/Gallery",
    iosInfoPlist: {
      NSPhotoLibraryAddUsageDescription:
        "This app saves received media to your photo library when you request it.",
    },
    androidPermissions: [],
  },
  "file-intents": {
    description: "Open/share/export files using system handlers",
    iosInfoPlist: {},
    androidPermissions: [],
  },
};

function ensureZynthConfig(appJson) {
  if (!appJson.zynth || typeof appJson.zynth !== "object") {
    appJson.zynth = {};
  }
  return appJson.zynth;
}

function ensureArrayUnique(targetArray, values) {
  const seen = new Set(targetArray);
  for (const value of values) {
    if (!seen.has(value)) {
      targetArray.push(value);
      seen.add(value);
    }
  }
}

function applyPreset(appJson, presetName, iosInfoOverrides = {}) {
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}`);
  }

  const zynth = ensureZynthConfig(appJson);
  zynth.ios = zynth.ios || {};
  zynth.ios.infoPlist = zynth.ios.infoPlist || {};

  for (const [key, fallbackValue] of Object.entries(preset.iosInfoPlist || {})) {
    if (Object.prototype.hasOwnProperty.call(iosInfoOverrides, key)) {
      zynth.ios.infoPlist[key] = iosInfoOverrides[key];
      continue;
    }
    if (zynth.ios.infoPlist[key] == null) {
      zynth.ios.infoPlist[key] = fallbackValue;
    }
  }

  zynth.android = zynth.android || {};
  zynth.android.permissions = Array.isArray(zynth.android.permissions)
    ? zynth.android.permissions
    : [];
  ensureArrayUnique(zynth.android.permissions, preset.androidPermissions || []);
}

function collectIosPromptKeys(presetNames) {
  const entries = [];
  for (const presetName of presetNames) {
    const preset = PRESETS[presetName];
    for (const [key, defaultValue] of Object.entries(preset.iosInfoPlist || {})) {
      entries.push({ presetName, key, defaultValue });
    }
  }
  return entries;
}

async function runWizard({ appJson, appJsonPath }) {
  const presetNames = Object.keys(PRESETS);

  const presetPick = await prompts(
    {
      type: "multiselect",
      name: "selectedPresets",
      message: "Select permission presets to apply",
      instructions: false,
      min: 1,
      choices: presetNames.map((name) => ({
        title: name,
        description: PRESETS[name].description,
        value: name,
      })),
    },
    {
      onCancel: () => {
        throw new Error("Permission wizard cancelled");
      },
    }
  );

  const selectedPresets = Array.isArray(presetPick.selectedPresets)
    ? presetPick.selectedPresets
    : [];

  if (selectedPresets.length === 0) {
    throw new Error("No permission presets selected");
  }

  const iosKeys = collectIosPromptKeys(selectedPresets);
  const iosOverrides = {};

  for (const entry of iosKeys) {
    const currentValue =
      appJson?.zynth?.ios?.infoPlist?.[entry.key] ?? entry.defaultValue;

    const response = await prompts(
      {
        type: "text",
        name: "value",
        message: `iOS ${entry.key} (${entry.presetName})`,
        initial: currentValue,
      },
      {
        onCancel: () => {
          throw new Error("Permission wizard cancelled");
        },
      }
    );

    const finalValue =
      typeof response.value === "string" && response.value.trim().length > 0
        ? response.value.trim()
        : entry.defaultValue;
    iosOverrides[entry.key] = finalValue;
  }

  for (const presetName of selectedPresets) {
    applyPreset(appJson, presetName, iosOverrides);
  }

  fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

  console.log(chalk.green(`✔ Applied presets: ${selectedPresets.join(", ")}`));
  console.log(chalk.gray(`  Updated ${path.relative(process.cwd(), appJsonPath)}`));
}

function printPresetList() {
  const lines = Object.entries(PRESETS).map(([name, preset]) => {
    const iosKeys = Object.keys(preset.iosInfoPlist || {});
    const androidPerms = preset.androidPermissions || [];
    return [
      `- ${chalk.cyan(name)}: ${preset.description}`,
      `  iOS infoPlist keys: ${iosKeys.length > 0 ? iosKeys.join(", ") : "none"}`,
      `  Android permissions: ${androidPerms.length > 0 ? androidPerms.join(", ") : "none"}`,
    ].join("\n");
  });

  console.log(lines.join("\n"));
}

module.exports = {
  command: "permissions [action] [preset]",
  describe: "Apply or edit app.json permission presets for Zynth packages",
  builder: (yargs) => {
    yargs.positional("action", {
      describe: "Operation",
      choices: ["add", "wizard", "list"],
      default: "wizard",
    });
    yargs.positional("preset", {
      describe: "Permission preset name",
      choices: Object.keys(PRESETS),
    });
  },
  handler: async (argv) => {
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());

    const appJsonPath = path.join(appDir, "app.json");
    if (!fs.existsSync(appJsonPath)) {
      throw new Error(`app.json not found at ${appJsonPath}`);
    }

    if (argv.action === "list") {
      printPresetList();
      return;
    }

    const appJson = readJSON(appJsonPath);

    if (argv.action === "wizard") {
      await runWizard({ appJson, appJsonPath });
      return;
    }

    if (argv.action === "add") {
      if (!argv.preset) {
        throw new Error("Missing preset. Usage: zynth permissions add <preset>");
      }
      applyPreset(appJson, argv.preset);
      fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
      console.log(
        chalk.green(
          `✔ Applied '${argv.preset}' permission preset to ${path.relative(process.cwd(), appJsonPath)}`
        )
      );
      return;
    }

    throw new Error(`Unsupported action: ${argv.action}`);
  },
};
