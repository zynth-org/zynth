Pod::Spec.new do |s|
  s.name         = "ZynthKit"
  s.version      = "0.0.1"
  s.summary      = "Zynth Core iOS runtime (new)"
  s.license      = { :type => "MIT" }
  s.author       = { "Zynth" => "dev@zynthstack.dev" }
  s.homepage     = "https://github.com/zynth/zynth"
  s.platform     = :ios, "15.0"

  s.source       = { :git => "https://github.com/zynth/zynth.git", :tag => s.version.to_s }
  s.source_files = "ios/ZynthKit/include/**/*.{h}", "ios/ZynthKit/src/**/*.{h,m,mm,cpp,c,swift}"
  s.public_header_files = "ios/ZynthKit/include/**/*.h"

  s.frameworks   = "UIKit", "Foundation"
  s.dependency   "Yoga"
  s.dependency   "hermes-engine"

  s.library = 'c++'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'OTHER_CFLAGS' => '-DHERMES_ENABLE_DEBUGGER=0',
    'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/hermes-engine/destroot/include ${PODS_ROOT}/hermes-engine/destroot/include/jsi ${PODS_ROOT}/hermes-engine/API ${PODS_ROOT}/hermes-engine/API/jsi ${PODS_ROOT}/hermes-engine/public'
  }
  s.user_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/Headers/Public ${PODS_ROOT}/Headers/Public/ZynthKit ${PODS_ROOT}/hermes-engine/destroot/include',
    'OTHER_LDFLAGS' => '$(inherited) -lc++'
  }
end
