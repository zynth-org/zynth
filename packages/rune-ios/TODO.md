# TODO

- [ ] Support module-style imports (`@import RuneKit;`) in the iOS template.
      - Ensure all public headers exported by RuneKit live under `ios/RuneKit/include` and avoid pulling private headers.
      - Let CocoaPods generate the umbrella header; verify `RuneKit-umbrella.h` re-exports everything app code needs.
      - Once the module compiles with `@import RuneKit;`, update `packages/rune-templates/ios/AppDelegate.m` and re-run `yarn reset:ios && yarn prebuild:ios && yarn ios:dev` to confirm the flow stays warning-free.
