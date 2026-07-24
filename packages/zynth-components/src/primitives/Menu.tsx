import {
  
  createSignal,
  onCleanup,
  type ParentComponent,
  type Component,
  type Element as SolidElement,
} from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";

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
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  const refProp = (node: HostNode | null) => {
    if (node) {
      if (local.style != null) setProperty(node, "style", local.style);
      if (local.testID != null) setProperty(node, "testID", local.testID);
      if (local.onOpen) setProperty(node, "onOpen", local.onOpen);
      if (local.onClose) setProperty(node, "onClose", local.onClose);
    }
    setHostNode(node);
  };

  effect(
    () => ({
      node: hostNode(),
      style: local.style,
      testID: local.testID,
    }),
    ({ node, style, testID }) => {
      if (!node) return;
      if (style != null) setProperty(node, "style", style);
      if (testID != null) setProperty(node, "testID", testID);
    }
  , { scope: true });

  onCleanup(() => {
    setHostNode(null);
  });

  return (
    <menu-view ref={refProp}>
      {local.children}
    </menu-view>
  );
};

const MenuTrigger: ParentComponent<MenuTriggerProps> = (props) => {
  const local = props;
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  const refProp = (node: HostNode | null) => {
    if (node) {
      if (local.style != null) setProperty(node, "style", local.style);
      if (local.testID != null) setProperty(node, "testID", local.testID);
      if (local.openOn != null) setProperty(node, "openOn", local.openOn);
    }
    setHostNode(node);
  };

  effect(
    () => ({
      node: hostNode(),
      style: local.style,
      testID: local.testID,
      openOn: local.openOn,
    }),
    ({ node, style, testID, openOn }) => {
      if (!node) return;
      if (style != null) setProperty(node, "style", style);
      if (testID != null) setProperty(node, "testID", testID);
      if (openOn != null) setProperty(node, "openOn", openOn);
    }
  , { scope: true });

  onCleanup(() => {
    setHostNode(null);
  });

  return (
    <menu-trigger-view ref={refProp}>
      {local.children}
    </menu-trigger-view>
  );
};

const MenuItem: Component<MenuItemProps> = (props) => {
  const local = props;
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  const refProp = (node: HostNode | null) => {
    if (node) {
      setProperty(node, "label", local.label);
      if (local.destructive != null) setProperty(node, "destructive", local.destructive);
      if (local.disabled != null) setProperty(node, "disabled", local.disabled);
      setProperty(node, "slot", "items");
      setProperty(node, "style", {
        display: "none",
        position: "absolute",
        width: 0,
        height: 0,
        opacity: 0,
        ...local.style,
      });
      if (local.testID != null) setProperty(node, "testID", local.testID);
      if (local.onPress) setProperty(node, "onPress", local.onPress);
      setProperty(node, "pointerEvents", "none");
    }
    setHostNode(node);
  };

  effect(
    () => ({
      node: hostNode(),
      label: local.label,
      destructive: local.destructive,
      disabled: local.disabled,
      testID: local.testID,
    }),
    ({ node, label, destructive, disabled, testID }) => {
      if (!node) return;
      setProperty(node, "label", label);
      if (destructive != null) setProperty(node, "destructive", destructive);
      if (disabled != null) setProperty(node, "disabled", disabled);
      if (testID != null) setProperty(node, "testID", testID);
    }
  , { scope: true });

  onCleanup(() => {
    setHostNode(null);
  });

  return (
    <menu-item-view ref={refProp}>
      {local.icon}
    </menu-item-view>
  );
};

export const Menu = Object.assign(MenuRoot, {
  Trigger: MenuTrigger,
  Item: MenuItem,
});
