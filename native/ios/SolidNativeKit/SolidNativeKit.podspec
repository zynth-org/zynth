Pod::Spec.new do |s|
  s.name         = "SolidNativeKit"
  s.version      = "0.0.1"
  s.summary      = "Solid Native iOS Host (UIKit + Yoga, Obj-C)"
  s.license      = { :type => "MIT" }
  s.author       = { "SolidNative" => "dev@example.com" }
  s.homepage     = "https://example.com/solid-native-kit"
  s.platform     = :ios, "12.0"
  # For local development pods installed via :path, CocoaPods still
  # validates the presence of a proper `source`. This value won't be used
  # when :path is provided but silences validation errors.
  s.source       = { :git => "https://example.com/solid-native-kit.git", :tag => s.version.to_s }
  s.source_files = "include/**/*.{h}", "src/**/*.{m,mm}"
  s.public_header_files = "include/**/*.h"
  s.header_mappings_dir = "include"
  s.frameworks   = "JavaScriptCore", "UIKit", "Foundation"
  s.dependency   "Yoga"

  # Configure C++ support for Yoga integration
  s.library = 'c++'

  # Ensure module is defined and headers are visible to user targets
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++14',
    'CLANG_CXX_LIBRARY' => 'libc++'
  }
  s.user_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/Headers/Public ${PODS_ROOT}/Headers/Public/SolidNativeKit',
    'OTHER_LDFLAGS' => '$(inherited) -lc++'
  }
end
