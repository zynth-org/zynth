/** @jsxImportSource solid-js */
import { createMemo, type JSX, type ParentComponent } from "solid-js";
import { registerComponent } from "@zynth/core";

export const ScreenTabsContainer: ParentComponent<any> = (props) => {
  const style = createMemo<JSX.CSSProperties>(() => ({
    display: "flex",
    "flex-direction": "column",
    flex: 1,
    position: "relative",
    overflow: "hidden",
    ...props.style,
  }));

  return (
    <div style={style()}>
      <span data-zynth-slot style="display: contents" />
    </div>
  );
};

registerComponent("zynth-screen-tabs-container", ScreenTabsContainer);
