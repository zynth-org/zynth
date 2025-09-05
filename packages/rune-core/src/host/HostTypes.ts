export type NodeType =
  | "root"
  | "view"
  | "button"
  | "pressable"
  | "text"
  | "image"
  | "marker"
  | "text-input"
  | "secure-text-input";

export interface HostNode {
  id: number; // for marker: generate a synthetic negative or a distinct counter
  type: NodeType; // "marker" has no native nor yoga counterparts
}

export type HostBatchKind = "template" | "hydrate" | "update" | (string & {});

export interface HostBatchMeta {
  kind: HostBatchKind;
  scope?: HostBatchKind;
  target?: number;
  templateId?: string;
  itemKey?: string | number;
  itemIndex?: number;
  descriptor?: Record<string, any> | null;
  extras?: Record<string, any> | null;
}

export type Style = {
  width?: number | `${number}%` | "auto";
  height?: number | `${number}%` | "auto";
  minWidth?: number | `${number}%`;
  maxWidth?: number | `${number}%`;
  minHeight?: number | `${number}%`;
  maxHeight?: number | `${number}%`;
  flexGrow?: number;
  flexShrink?: number;
  background?: string | string[];
  backgroundImage?: string | string[];
  backgroundColor?: string;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  padding?: number;
  paddingHorizontal?: number;
  paddingVertical?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: number;
  marginHorizontal?: number;
  marginVertical?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  flex?: number;
  flexDirection?: "row" | "column";
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  flexBasis?: number | string | "auto";
  justifyContent?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around";
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
  alignContent?:
    | "flex-start"
    | "flex-end"
    | "center"
    | "stretch"
    | "space-between"
    | "space-around";
  alignSelf?:
    | "auto"
    | "flex-start"
    | "center"
    | "flex-end"
    | "stretch"
    | "baseline";
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  display?: "flex" | "none";
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  borderTopColor?: string;
  borderRightColor?: string;
  borderBottomColor?: string;
  borderLeftColor?: string;
  borderTopWidth?: number;
  borderRightWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderStyle?: "solid" | "dotted" | "dashed";
  opacity?: number;
  boxShadow?: string | string[];
  shadowColor?: string;
  shadowOffset?: { width?: number; height?: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;
  zIndex?: number;
  aspectRatio?: number;
  overflow?: "visible" | "hidden" | "scroll";
  fontSize?: number;
  color?: string;
  placeholderColor?: string;
  fontWeight?:
    | "normal"
    | "bold"
    | "100"
    | "200"
    | "300"
    | "400"
    | "500"
    | "600"
    | "700"
    | "800"
    | "900";
  fontFamily?: string;
  fontStyle?: "normal" | "italic";
  textAlign?: "left" | "center" | "right" | "justify";
  lineHeight?: number;
  lineSpacing?: number;
  paragraphSpacing?: number;
  letterSpacing?: number;
  textDecorationLine?:
    | "none"
    | "underline"
    | "line-through"
    | "underline line-through";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  minimumFontScale?: number;
  baselineShift?: number;
  hyphenation?: "none" | "standard" | "high";
  tintColor?: string;
  transform?: string | Record<string, number | string>[];
  transformOrigin?: string | (string | number)[];
};

/**
 * StyleProp allows styles to be passed as either:
 * - A single Style object: `{ color: "red" }`
 * - An array of Style objects: `[{ color: "red" }, props.customStyle]`
 *
 * Array styles are merged left-to-right, with later values overriding earlier ones.
 * Useful for conditional and responsive styling while maintaining SolidJS reactivity.
 */
export type StyleProp = Style | (Style | undefined | null)[];

export type ImageResizeMode = "cover" | "contain" | "stretch" | "center";

export type ImageUriSource = {
  uri: string;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  cache?: "default" | "reload" | "force-cache" | "only-if-cached";
};

export type ImageAssetSource = {
  asset: string;
  bundle?: string;
  scale?: number;
};

export type ImageSystemSource = {
  system: string;
};

export type ImageAssetDescriptor = {
  type: "asset";
  name: string;
  ext: string;
  hash: string;
  scale?: number;
  relativePath?: string;
  devPath?: string;
};

export type ImageDataSource = {
  data: string;
  mimeType?: string;
};

export type ImageSource =
  | string
  | ImageUriSource
  | ImageAssetSource
  | ImageSystemSource
  | ImageDataSource
  | ImageAssetDescriptor;

export type RecyclingConfig = {
  poolSize: number;
  itemType: NodeType;
  resetProps?: string[];
};

export type RecyclingContext = {
  id: string;
  config: RecyclingConfig;
  pool: Map<NodeType, number[]>; // type -> array of available nodeIds
  activeBindings: Map<number, { itemKey: string; itemIndex: number }>; // nodeId -> item info
};

export interface Host {
  createRootContainer(container: unknown): HostNode;
  createNode(
    type: Exclude<NodeType, "root">,
    props?: Record<string, any>
  ): HostNode;
  createText(value: string): HostNode;
  setProperty(node: HostNode, name: string, value: any): void;
  setText(node: HostNode, value: string): void;
  insertNode(parent: HostNode, node: HostNode, anchor?: HostNode | null): void;
  removeNode(parent: HostNode, node: HostNode): void;
  getParentNode(node: HostNode): HostNode | null;
  getFirstChild(node: HostNode): HostNode | null;
  getNextSibling(node: HostNode): HostNode | null;
  getText(node: HostNode): string;
  flush?(): void;
  beginBatch?(meta: HostBatchMeta): void;
  endBatch?(meta?: HostBatchMeta): void;

  // Recycling APIs
  enableRecycling?(containerId: number, config: RecyclingConfig): string; // returns contextId
  disableRecycling?(contextId: string): void;
  reclaimNode?(contextId: string, node: HostNode): void; // return node to pool
  acquireNode?(
    contextId: string,
    type: NodeType,
    itemKey: string,
    itemIndex: number
  ): HostNode | null; // get node from pool or create new
  updateNodeBinding?(
    node: HostNode,
    itemKey: string,
    itemIndex: number,
    props: Record<string, any>
  ): void; // update existing node with new data
}
