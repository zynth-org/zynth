import {
  splitProps,
  type ParentComponent,
  type Component,
  type JSX,
} from "solid-js";
import type { Style } from "@zynth/core";

export interface MenuProps {
  style?: Style;
  children?: JSX.Element;
  onOpen?: () => void;
  onClose?: () => void;
  testID?: string;
}

export interface MenuTriggerProps {
  style?: Style;
  children?: JSX.Element;
  testID?: string;
}

export interface MenuItemProps {
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  style?: Style;
  testID?: string;
  icon?: JSX.Element;
}

const MenuRoot: ParentComponent<MenuProps> = (props) => {
  const [local] = splitProps(props, [
    "style",
    "children",
    "testID",
    "onOpen",
    "onClose",
  ]);

  return (
    <menu-view
      style={local.style}
      testID={local.testID}
      onOpen={local.onOpen}
      onClose={local.onClose}
    >
      {local.children}
    </menu-view>
  );
};

const MenuTrigger: ParentComponent<MenuTriggerProps> = (props) => {
  const [local] = splitProps(props, ["style", "children", "testID"]);

  return (
    <menu-trigger-view style={local.style} testID={local.testID}>
      {local.children}
    </menu-trigger-view>
  );
};

const MenuItem: Component<MenuItemProps> = (props) => {
  const [local] = splitProps(props, [
    "label",
    "onPress",
    "destructive",
    "disabled",
    "style",
    "testID",
    "icon",
  ]);

  return (
    <menu-item-view
      label={local.label}
      destructive={local.destructive}
      disabled={local.disabled}
      slot="items"
      style={{
        display: "none",
        position: "absolute",
        width: 0,
        height: 0,
        opacity: 0,
        ...local.style,
      }}
      testID={local.testID}
      onPress={local.onPress}
      pointerEvents="none"
    >
      {local.icon}
    </menu-item-view>
  );
};

export const Menu = Object.assign(MenuRoot, {
  Trigger: MenuTrigger,
  Item: MenuItem,
});
