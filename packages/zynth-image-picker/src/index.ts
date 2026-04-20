import type { ImagePickerAPI } from "./types";
import { NativeImagePicker } from "./native";

export * from "./types";

export const ImagePicker: ImagePickerAPI = NativeImagePicker;
