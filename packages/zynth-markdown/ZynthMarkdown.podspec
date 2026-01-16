Pod::Spec.new do |s|
  s.name         = "ZynthMarkdown"
  s.version      = "0.0.1"
  s.summary      = "Native markdown parser for Zynth apps"
  s.homepage     = "https://github.com/x64Bits/zynth"
  s.license      = "MIT"
  s.author       = { "Zynth Team" => "team@zynth.dev" }
  s.source       = { :path => "." }

  s.platform     = :ios, "13.0"
  s.swift_version = "5.0"

  s.source_files = "ios/**/*.{h,m,mm,swift}",
                   "native/zynth_markdown.{h,cpp}",
                   "native/cmark-gfm/src/*.{c,h}",
                   "native/cmark-gfm/extensions/*.{c,h}"
  s.exclude_files = "native/cmark-gfm/src/main.c"
  s.public_header_files = "ios/include/**/*.h"
  s.requires_arc = true
  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => "\"${PODS_TARGET_SRCROOT}/native\" \"${PODS_TARGET_SRCROOT}/native/cmark-gfm-stubs\" \"${PODS_TARGET_SRCROOT}/native/cmark-gfm/src\" \"${PODS_TARGET_SRCROOT}/native/cmark-gfm/extensions\""
  }

  s.dependency "ZynthKit"
end
