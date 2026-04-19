import { Platform } from "@zynth/core";
import type { ImagePickerAPI } from "./types";
import { NativeImagePicker } from "./native";
import { WebImagePicker } from "./web";

export * from "./types";

export const ImagePicker: ImagePickerAPI =
  Platform.OS === "web" ? WebImagePicker : NativeImagePicker;
