export interface FontAssetDescriptor {
  type: "font";
  name: string;
  ext: string;
  hash: string;
  relativePath?: string;
  devPath?: string;
}

export interface ImageAssetDescriptor {
  type: "asset";
  name: string;
  ext: string;
  hash: string;
  scale?: number;
  relativePath?: string;
  devPath?: string;
}

declare module "*.ttf" {
  const content: FontAssetDescriptor;
  export default content;
}

declare module "*.otf" {
  const content: FontAssetDescriptor;
  export default content;
}

declare module "*.woff" {
  const content: FontAssetDescriptor;
  export default content;
}

declare module "*.woff2" {
  const content: FontAssetDescriptor;
  export default content;
}

declare module "*.png" {
  const content: ImageAssetDescriptor;
  export default content;
}

declare module "*.jpg" {
  const content: ImageAssetDescriptor;
  export default content;
}

declare module "*.jpeg" {
  const content: ImageAssetDescriptor;
  export default content;
}

declare module "*.gif" {
  const content: ImageAssetDescriptor;
  export default content;
}

declare module "*.svg" {
  const content: ImageAssetDescriptor;
  export default content;
}

declare module "*.webp" {
  const content: ImageAssetDescriptor;
  export default content;
}

declare module "*.heic" {
  const content: ImageAssetDescriptor;
  export default content;
}

declare module "*.heif" {
  const content: ImageAssetDescriptor;
  export default content;
}

declare module "*.ico" {
  const content: ImageAssetDescriptor;
  export default content;
}

declare module "*.bmp" {
  const content: ImageAssetDescriptor;
  export default content;
}
