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

  device_lib_dir = "${PODS_TARGET_SRCROOT}/native/vendor/ios/arm64/device/metal-pdf"
  simulator_lib_dir = "${PODS_TARGET_SRCROOT}/native/vendor/ios/$(CURRENT_ARCH)/simulator/metal-pdf"
  user_device_lib_dir = "${PODS_ROOT}/../../../../packages/zynth-skia/native/vendor/ios/arm64/device/metal-pdf"
  user_simulator_lib_dir = "${PODS_ROOT}/../../../../packages/zynth-skia/native/vendor/ios/$(CURRENT_ARCH)/simulator/metal-pdf"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "CLANG_CXX_LIBRARY" => "libc++",
    "LIBRARY_SEARCH_PATHS[sdk=iphoneos*]" => "\"#{device_lib_dir}\" $(inherited)",
    "LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]" => "\"#{simulator_lib_dir}\" $(inherited)",
    "OTHER_LDFLAGS[sdk=iphoneos*]" => "-lskia -lskia-bindings $(inherited)",
    "OTHER_LDFLAGS[sdk=iphonesimulator*]" => "-lskia -lskia-bindings $(inherited)",
  }
  s.user_target_xcconfig = {
    "LIBRARY_SEARCH_PATHS[sdk=iphoneos*]" => "\"#{user_device_lib_dir}\" $(inherited)",
    "LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]" => "\"#{user_simulator_lib_dir}\" $(inherited)",
    "OTHER_LDFLAGS[sdk=iphoneos*]" => "-lskia -lskia-bindings $(inherited)",
    "OTHER_LDFLAGS[sdk=iphonesimulator*]" => "-lskia -lskia-bindings $(inherited)",
  }

  s.dependency "ZynthKit"
end
