Pod::Spec.new do |s|
  s.name         = "RuneKit"
  s.version      = "0.0.1"
  s.summary      = "Rune iOS Host runtime"
  s.license      = { :type => "MIT" }
  s.author       = { "Rune" => "dev@runestack.dev" }
  s.homepage     = "https://github.com/rune/rune"
  s.platform     = :ios, "15.0"

  s.source       = { :git => "https://github.com/rune/rune.git", :tag => s.version.to_s }
  s.source_files = "ios/RuneKit/include/**/*.{h}", "ios/RuneKit/src/**/*.{h,m,mm,cpp,c,swift}"
  s.public_header_files = "ios/RuneKit/include/**/*.h"
  s.header_mappings_dir = "ios/RuneKit/include"

  s.frameworks   = "JavaScriptCore", "UIKit", "Foundation"
  s.dependency   "Yoga"
  s.dependency   "hermes-engine"

  s.library = 'c++'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'OTHER_CFLAGS' => '-DHERMES_ENABLE_DEBUGGER=0',
    'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_TARGET_SRCROOT}/ios/RuneKit ${PODS_TARGET_SRCROOT}/ios/RuneKit/include ${PODS_TARGET_SRCROOT}/ios/RuneKit/src'
  }
  s.user_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/Headers/Public ${PODS_ROOT}/Headers/Public/RuneKit ${PODS_ROOT}/../node_modules/@rune/ios/ios/RuneKit/include ${PODS_ROOT}/../../node_modules/@rune/ios/ios/RuneKit/include ${PODS_ROOT}/../../../node_modules/@rune/ios/ios/RuneKit/include ${PODS_ROOT}/../../../../node_modules/@rune/ios/ios/RuneKit/include',
    'OTHER_LDFLAGS' => '$(inherited) -lc++'
  }
end
