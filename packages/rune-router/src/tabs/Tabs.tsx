import {
  ParentComponent,
  createContext,
  createUniqueId,
  useContext,
} from "solid-js";
import type { TabsComponentType, TabsProps } from "../core/types";
import { TabScreen } from "./TabScreen";
import { TabBar } from "./TabBar";

interface TabsContextValue {
  id: string;
  lazy?: boolean;
}

const TabsContext = createContext<TabsContextValue>();

export function useTabsId(): string {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error("Tabs components must be rendered inside <Tabs>");
  }
  return ctx.id;
}

export function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error("Tabs components must be rendered inside <Tabs>");
  }
  return ctx;
}

const TabsBase: ParentComponent<TabsProps> = (props) => {
  const tabsId = props.id ?? `tabs-${createUniqueId()}`;
  return (
    <TabsContext.Provider value={{ id: tabsId, lazy: props.lazy }}>
      {props.children}
    </TabsContext.Provider>
  );
};

export const Tabs = Object.assign(TabsBase, {
  Screen: TabScreen,
  TabBar,
}) as TabsComponentType;
