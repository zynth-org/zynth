import {
  type ParentComponent,
  type Component,
  type Element as SolidElement,
} from "solid-js";
import type { Style } from "@zynthjs/core";

export interface MenuProps {
  style?: Style;
  children?: SolidElement;
  onOpen?: () => void;
  onClose?: () => void;
  testID?: string;
}

export interface MenuTriggerProps {
  style?: Style;
  children?: SolidElement;
  testID?: string;
  openOn?: "press" | "longPress";
}

export interface MenuItemProps {
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  style?: Style;
  testID?: string;
  icon?: SolidElement;
}

const MenuRoot: ParentComponent<MenuProps> = (props) => {
  const local = props;

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
  const local = props;

  return (
    <menu-trigger-view
      style={local.style}
      testID={local.testID}
      openOn={local.openOn}
    >
      {local.children}
    </menu-trigger-view>
  );
};

const MenuItem: Component<MenuItemProps> = (props) => {
  const local = props;

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
