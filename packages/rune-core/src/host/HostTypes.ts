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

export type Style = {
  width?: number | `${number}%` | "auto";
  height?: number | `${number}%` | "auto";
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  flexGrow?: number;
  flexShrink?: number;
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
  justifyContent?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around";
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
  alignSelf?:
    | "auto"
    | "flex-start"
    | "center"
    | "flex-end"
      | "stretch"
      | "baseline";
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  fontSize?: number;
  color?: string;
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
  tintColor?: string;
};

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
  | ImageDataSource
  | ImageAssetDescriptor;

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
}
