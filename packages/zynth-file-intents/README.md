# @zynth/file-intents

System file integration for Zynth apps.

- Open files with the system app chooser
- Share one or many files with the system share sheet
- Export files to system-managed destinations

## API

```ts
import { FileIntents } from "@zynth/file-intents";

await FileIntents.openAsync({ uri, mimeType });
await FileIntents.shareAsync({ files: [{ uri, mimeType }], text: "Hello" });
const result = await FileIntents.exportAsync({
  uri,
  mimeType,
  suggestedName: "report.pdf",
  target: "files",
});
```

## Notes

- This package does not add runtime permissions automatically.
- Configure platform permissions/messages explicitly in `app.json` when your app workflow needs them.
- On iOS, `target: "downloads"` is treated as `target: "files"` because exports go through the system Files picker.

## Security Hardening Checklist

- [x] Reject network URLs (`http://`, `https://`) at JS API boundary.
- [x] Restrict native URI schemes to local sources (`file://`, `content://`).
- [x] Enforce app-sandbox path checks for direct file-path access.
- [x] Validate MIME format before native handoff.
- [x] Limit oversized multi-share batches (`shareAsync` max 32 files).
- [x] Return explicit and user-safe errors for missing handlers/files.
- [ ] Add automated native integration tests (malformed URI, path escape, handler unavailable).
- [ ] Add release-mode log redaction tests for path leakage.
