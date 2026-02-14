require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
summary = package["description"]
summary = "Declarative Skia renderer for Zynth" if summary.nil? || summary.strip.empty?

Pod::Spec.new do |s|
  s.name         = "ZynthSkia"
  s.version      = package["version"]
  s.summary      = summary
  s.homepage     = "https://github.com/zynth/zynth"
  s.license      = "MIT"
  s.authors      = { "Zynth Team" => "team@zynth.dev" }
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/zynth/zynth.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.9"
  s.frameworks = %w[
    CoreGraphics
    CoreText
    QuartzCore
    Metal
    MetalKit
    ImageIO
  ]
  s.libraries = %w[c++ z]

  # Headers path relative to Pods target root
  headers_dir = "${PODS_TARGET_SRCROOT}/native/vendor/headers/skia"
  user_headers_dir = "${PODS_ROOT}/../../../../packages/zynth-skia/native/vendor/headers/skia"

  s.vendored_frameworks = "native/vendor/ios/xcframeworks/*.xcframework"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "CLANG_CXX_LIBRARY" => "libc++",
    "HEADER_SEARCH_PATHS" => "\"#{headers_dir}\" $(inherited)",
    "GCC_PREPROCESSOR_DEFINITIONS" => "SK_GRAPHITE=1 SK_FONTMGR_CORETEXT_AVAILABLE=1 SK_TYPEFACE_FACTORY_CORETEXT=1 $(inherited)"
  }
  s.user_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => "\"#{user_headers_dir}\" $(inherited)",
    "GCC_PREPROCESSOR_DEFINITIONS" => "SK_GRAPHITE=1 SK_FONTMGR_CORETEXT_AVAILABLE=1 SK_TYPEFACE_FACTORY_CORETEXT=1 $(inherited)"
  }

  s.dependency "ZynthKit"
end
