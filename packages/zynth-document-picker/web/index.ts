import type {
  DocumentPickerAsset,
  DocumentPickerOptions,
  DocumentPickerResult,
} from "../src/types";

export const DocumentPicker = {
  async getDocumentAsync(
    options?: DocumentPickerOptions
  ): Promise<DocumentPickerResult> {
    if (typeof document === "undefined") {
      return { cancelled: true, assets: [] };
    }

    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.style.display = "none";

      if (options?.multiple) {
        input.multiple = true;
      }

      if (options?.type) {
        if (Array.isArray(options.type)) {
          input.accept = options.type.join(",");
        } else {
          input.accept = options.type;
        }
      }

      const handleChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const files = target.files;
        if (files && files.length > 0) {
          const assets: DocumentPickerAsset[] = Array.from(files).map((file) => ({
            uri: URL.createObjectURL(file),
            name: file.name,
            mimeType: file.type || null,
            size: file.size,
          }));
          resolve({ cancelled: false, assets });
        } else {
          resolve({ cancelled: true, assets: [] });
        }
        cleanup();
      };

      const handleCancel = () => {
        resolve({ cancelled: true, assets: [] });
        cleanup();
      };

      const cleanup = () => {
        input.removeEventListener("change", handleChange);
        input.removeEventListener("cancel", handleCancel);
        document.body.removeChild(input);
      };

      input.addEventListener("change", handleChange);
      input.addEventListener("cancel", handleCancel);

      document.body.appendChild(input);
      input.click();
    });
  },

  isAvailable(): boolean {
    return typeof document !== "undefined";
  },
};
