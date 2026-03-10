import {
  splitProps,
  createSignal,
  type ParentComponent,
  type Component,
  type JSX,
} from "solid-js";
import type { HostNode, StyleProp } from "@zynth/core";
import { createStyleBinding } from "../hooks/styleBinding";

export interface MenuProps {
  style?: StyleProp;
  children?: JSX.Element;
  onOpen?: () => void;
  onClose?: () => void;
  testID?: string;
  ref?: (node: HostNode | null) => void;
}

export interface MenuTriggerProps {
  style?: StyleProp;
  children?: JSX.Element;
  testID?: string;
  ref?: (node: HostNode | null) => void;
}

export interface MenuItemProps {
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  style?: StyleProp;
  testID?: string;
  icon?: JSX.Element;
  ref?: (node: HostNode | null) => void;
}

const MenuRoot: ParentComponent<MenuProps> = (props) => {
  const [local] = splitProps(props, [
    "style",
    "children",
    "testID",
    "onOpen",
    "onClose",
    "ref",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  createStyleBinding(hostNode, () => local.style);

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    local.ref?.(node);
  };

  return (
    <menu-view
      style={undefined}
      testID={local.testID}
      onOpen={local.onOpen}
      onClose={local.onClose}
      ref={refProp}
    >
      {local.children}
    </menu-view>
  );
};

const MenuTrigger: ParentComponent<MenuTriggerProps> = (props) => {
  const [local] = splitProps(props, ["style", "children", "testID", "ref"]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  createStyleBinding(hostNode, () => local.style);

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    local.ref?.(node);
  };

  return (
    <menu-trigger-view style={undefined} testID={local.testID} ref={refProp}>
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
    "ref",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const internalStyle = () => [
    {
      display: "none",
      position: "absolute",
      width: 0,
      height: 0,
      opacity: 0,
    },
    local.style,
  ] as StyleProp;

  createStyleBinding(hostNode, internalStyle);

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    local.ref?.(node);
  };

  return (
    <menu-item-view
      label={local.label}
      destructive={local.destructive}
      disabled={local.disabled}
      slot="items"
      style={undefined}
      testID={local.testID}
      onPress={local.onPress}
      pointerEvents="none"
      ref={refProp}
    >
      {local.icon}
    </menu-item-view>
  );
};

export const Menu = Object.assign(MenuRoot, {
  Trigger: MenuTrigger,
  Item: MenuItem,
});
