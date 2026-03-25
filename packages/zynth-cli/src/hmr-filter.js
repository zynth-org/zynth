const readline = require('readline');

/**
 * Creates a filter for Rsbuild HMR server output.
 * It condenses noise and success messages while preserving errors and code frames.
 * @param {object} indicator - Optional progress indicator to stop on success/error.
 * @param {object} options - Optional callbacks for lifecycle events.
 */
function createHMRFilter(indicator, options = {}) {
  let inError = false;
  const onReady =
    options && typeof options.onReady === "function" ? options.onReady : null;

  return (data) => {
    const text = data.toString();
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      if (!line.trim()) continue;

      // Strip ANSI codes for pattern matching
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();

      // 1. Success condensation
      if (clean.includes('ready built in') || (clean.includes('ready') && /[\d.]+ s/.test(clean))) {
        if (indicator) {
          indicator.stop(true);
        }
        const timeMatch = clean.match(/built in ([\d.]+ s)/) || clean.match(/ready ([\d.]+ s)/) || clean.match(/([\d.]+ s)/);
        const timeStr = timeMatch ? timeMatch[1] : 'unknown time';
        process.stdout.write(`\x1b[32m✔\x1b[0m Bundle build complete in ${timeStr}\n`);
        if (onReady) {
          onReady();
        }
        inError = false;
        continue;
      }

      // 2. Explicitly ignore noise
      if (
        clean.startsWith('start build') ||
        clean.startsWith('start building') ||
        clean.startsWith('Rsbuild v') ||
        clean.includes('press h + enter') ||
        clean.includes('Rsbuild dev server spawned')
      ) {
        continue;
      }

      // 3. Error detection
      const isErrorStart = clean.toLowerCase().includes('error ') || clean.startsWith('×');
      const isCodeFrame = /^[╭│·╰]/.test(clean);

      if (isErrorStart || isCodeFrame) {
        if (indicator) {
          indicator.stop(true);
        }
        inError = true;
        process.stdout.write(line + '\n');
        continue;
      }

      // 4. Preserve context if we are in an error state
      if (inError) {
        process.stdout.write(line + '\n');
        continue;
      }
    }
  };
}

module.exports = { createHMRFilter };
