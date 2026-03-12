# @zynth/media-library

Save image/video files into system Photos/Gallery from Zynth apps.

## API

```ts
import { MediaLibrary } from "@zynth/media-library";

await MediaLibrary.requestPermissionsAsync({ writeOnly: true });
await MediaLibrary.saveImageAsync({ uri: "file:///.../image.jpg" });
await MediaLibrary.saveVideoAsync({ uri: "file:///.../video.mp4" });
```

## Permissions

Set permissions/messages explicitly in `app.json`:

- iOS: `zynth.ios.infoPlist.NSPhotoLibraryAddUsageDescription`
- Android: scoped `MediaStore` save is used (no broad storage permission is auto-added)

## Security Hardening Checklist

- [x] Reject network URLs (`http://`, `https://`) at JS API boundary.
- [x] Restrict native URI schemes to local sources (`file://`, `content://`).
- [x] Enforce app-sandbox path checks for direct file-path access.
- [x] Ensure source file existence/readability before save.
- [x] Keep permission/config explicit in `app.json` (no silent injection).
- [ ] Add automated native integration tests (permission denied, invalid uri, source missing).
- [ ] Add media-type mismatch tests (image API with video input and vice versa).
