import solid from "rollup-preset-solid";
export default solid({
  input: "src/index.ts",
  targets: ["esm", "cjs"],
  external: ["solid-js", "@rune/apis"],
});
