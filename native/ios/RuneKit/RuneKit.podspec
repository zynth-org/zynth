Pod::Spec.new do |s|
  s.name         = "RuneKit"
  s.version      = "0.0.1"
  s.summary      = "Rune iOS Host (UIKit + Yoga, Obj-C)"
  s.license      = { :type => "MIT" }
  s.author       = { "Rune" => "dev@example.com" }
  s.homepage     = "https://example.com/rune-kit"
  s.platform     = :ios, "15.0"

  s.source       = { :git => "https://example.com/rune-kit.git", :tag => s.version.to_s }
  s.source_files = "include/**/*.{h}", "src/**/*.{h,m,mm,cpp,c,swift}"
  s.public_header_files = "include/**/*.h", "src/runtime/HermesRuntimeHost.h"
  s.header_mappings_dir = "include"

  s.frameworks   = "JavaScriptCore", "UIKit", "Foundation"
  s.dependency   "Yoga"
  s.dependency   "hermes-engine"

  s.library = 'c++'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'OTHER_CFLAGS' => '-DHERMES_ENABLE_DEBUGGER=0',
    'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_TARGET_SRCROOT}/include'
  }
  s.user_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/Headers/Public ${PODS_ROOT}/Headers/Public/RuneKit ${PODS_TARGET_SRCROOT}/include',
    'OTHER_LDFLAGS' => '$(inherited) -lc++'
  }
end
