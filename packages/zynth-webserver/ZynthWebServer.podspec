Pod::Spec.new do |s|
  s.name         = "ZynthWebServer"
  s.version      = "0.0.1"
  s.summary      = "Embedded web server for Zynth apps"
  s.homepage     = "https://github.com/x64Bits/zynth"
  s.license      = "MIT"
  s.author       = { "Zynth Team" => "team@zynthai.com" }
  s.source       = { :path => "." }

  s.platform     = :ios, "13.0"
  s.swift_version = "5.0"

  s.source_files = "ios/**/*.{h,m,mm,swift}", "native/**/*.{h,c}"
  s.public_header_files = "ios/include/**/*.h"
  s.requires_arc = true
  tls_enabled = ENV["ZYNTH_WEBSERVER_TLS"] == "1"
  if tls_enabled
    s.compiler_flags = "-DUSE_MBEDTLS -UDEBUG"
    s.pod_target_xcconfig = {
      "HEADER_SEARCH_PATHS" => "\"${PODS_TARGET_SRCROOT}/native\" \"${PODS_TARGET_SRCROOT}/native/mbedtls/include\"",
      "OTHER_CFLAGS" => "$(inherited) -Wno-ambiguous-macro -Wno-documentation-deprecated-sync -Wno-shorten-64-to-32"
    }
  else
    s.exclude_files = "native/mbedtls/**/*"
    s.compiler_flags = "-DNO_SSL -UDEBUG"
    s.pod_target_xcconfig = {
      "HEADER_SEARCH_PATHS" => "\"${PODS_TARGET_SRCROOT}/native\"",
      "OTHER_CFLAGS" => "$(inherited) -Wno-ambiguous-macro"
    }
  end

  s.dependency "ZynthKit"
end
