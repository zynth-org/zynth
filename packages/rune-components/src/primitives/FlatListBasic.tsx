import { JSX, createMemo, splitProps } from "solid-js";
import type { ComponentType } from "solid-js";
import type { Style } from "@rune/core";
import {
  ScrollView,
  type ScrollViewProps,
  createScrollController,
} from "./ScrollView";
import { View } from "./View";

type RenderItemInfo<T> = {
  item: T;
  index: number;
  key: string;
};

type KeyExtractor<T> = (item: T, index: number) => string;

export type FlatListBasicProps<T> = {
  data: T[];
  renderItem: (info: RenderItemInfo<T>) => JSX.Element;
  keyExtractor?: KeyExtractor<T>;
  style?: Style;
  contentContainerStyle?: Style;
  ListHeaderComponent?: JSX.Element | ComponentType;
  ListFooterComponent?: JSX.Element | ComponentType;
  ListEmptyComponent?: JSX.Element | ComponentType;
  scrollViewProps?: Partial<ScrollViewProps>;
  testID?: string;
};

type ItemEntry<T> = {
  item: T;
  index: number;
  key: string;
};

const renderSupplemental = (
  value: JSX.Element | ComponentType | undefined
): JSX.Element | null => {
  if (!value) return null;
  if (typeof value === "function") {
    const ComponentValue = value as ComponentType;
    return <ComponentValue />;
  }
  return value;
};

export function FlatListBasic<T>(allProps: FlatListBasicProps<T>) {
  const [local] = splitProps(allProps, [
    "data",
    "renderItem",
    "keyExtractor",
    "style",
    "contentContainerStyle",
    "ListHeaderComponent",
    "ListFooterComponent",
    "ListEmptyComponent",
    "scrollViewProps",
    "testID",
  ]);

  const scrollController = createScrollController();

  const keyExtractor = createMemo<KeyExtractor<T>>(
    () =>
      local.keyExtractor ??
      ((_, index) => {
        return String(index);
      })
  );

  const items = createMemo<ItemEntry<T>[]>(() => {
    const entries = (local.data ?? []).map((item, index) => ({
      item,
      index,
      key: keyExtractor()(item, index),
    }));
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.key)) {
        console.warn(
          `[FlatListBasic] Duplicate key detected for index ${entry.index}: "${entry.key}". Keys should be unique.`
        );
      }
      seen.add(entry.key);
    }
    return entries;
  });

  const scrollProps = createMemo<Partial<ScrollViewProps>>(
    () => local.scrollViewProps ?? {}
  );

  return (
    <ScrollView
      {...scrollProps()}
      style={local.style}
      contentContainerStyle={local.contentContainerStyle}
      controller={scrollController}
      testID={local.testID ?? scrollProps().testID}
    >
      {renderSupplemental(local.ListHeaderComponent)}
      {items().length === 0
        ? renderSupplemental(local.ListEmptyComponent)
        : null}
      {items().map((entry) => (
        <View key={entry.key}>
          {local.renderItem({
            item: entry.item,
            index: entry.index,
            key: entry.key,
          })}
        </View>
      ))}
      {renderSupplemental(local.ListFooterComponent)}
    </ScrollView>
  );
}
