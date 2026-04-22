import type { ImagePickerAPI } from "./types";
import { WebImagePicker } from "../web/index";

export * from "./types";

export const ImagePicker: ImagePickerAPI = WebImagePicker;
