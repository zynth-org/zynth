/** @jsxImportSource solid-js */
import { registerComponent } from "@zynth/core";

export const StatusBar = () => {
  return <div style="display: none" aria-hidden="true" />;
};

registerComponent("zynth-status-bar", StatusBar);
