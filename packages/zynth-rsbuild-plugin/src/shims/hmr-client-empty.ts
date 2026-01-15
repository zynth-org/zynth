// Rsbuild injects its Web HMR runtime by default. Hermes cannot evaluate it, so we provide a stub.
export const registerOverlay = () => {};
export default undefined;
