Pod::Spec.new do |s|
  s.name         = "RuneBottomSheet"
  s.version      = "0.0.1"
  s.summary      = "Rune native bottom sheet helpers"
  s.license      = { :type => "MIT" }
  s.author       = { "Rune" => "dev@runestack.dev" }
  s.homepage     = "https://github.com/rune/rune"
  s.platform     = :ios, "15.0"

  s.source       = { :git => "https://github.com/rune/rune.git", :branch => "main" }
  s.source_files = "ios/src/**/*.{h,m,mm,swift}"

  s.dependency   = "RuneKit"

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => %w[
      $(inherited)
      ${PODS_CONFIGURATION_BUILD_DIR}/RuneKit/RuneKit.framework/Headers
      ${PODS_ROOT}/Headers/Public/RuneKit
      ${PODS_ROOT}/Headers/Private/RuneKit
      ${PODS_TARGET_SRCROOT}/../rune-ios/ios/RuneKit/include
      ${PODS_TARGET_SRCROOT}/../rune-ios/ios/RuneKit/src
      ${PODS_TARGET_SRCROOT}/../rune-ios/ios/RuneKit
    ].join(' ')
  }
end
