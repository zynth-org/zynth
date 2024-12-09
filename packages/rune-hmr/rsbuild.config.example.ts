import { createRuneRsbuildConfig } from "@rune/hmr";
import path from "node:path";

// Example Rsbuild configuration for a Rune app
export default createRuneRsbuildConfig({
  appRoot: __dirname,
  outDir: "./dist",
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
  aliases: {
    // Add custom aliases if needed
    "@/components": path.resolve(__dirname, "src/components"),
  },
});
