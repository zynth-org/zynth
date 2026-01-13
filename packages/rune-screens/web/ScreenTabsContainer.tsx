/** @jsxImportSource solid-js */
import { createMemo, type JSX, type ParentComponent } from "solid-js";
import { registerComponent } from "@rune/core";

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
      <span data-rune-slot style="display: contents" />
    </div>
  );
};

registerComponent("rune-screen-tabs-container", ScreenTabsContainer);
