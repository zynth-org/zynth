/** @jsxImportSource solid-js */
import { registerComponent } from "@rune/core";

export const StatusBar = () => {
  return <div style="display: none" aria-hidden="true" />;
};

registerComponent("rune-status-bar", StatusBar);
