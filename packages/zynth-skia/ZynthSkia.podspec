Pod::Spec.new do |s|
  s.name         = "ZynthSkia"
  s.version      = "0.0.1"
  s.summary      = "Declarative Skia renderer for Zynth"
  s.homepage     = "https://github.com/x64bits/zynth"
  s.license      = "MIT"
  s.author       = { "x64Bits" => "hello@x64bits.com" }
  s.source       = { :git => "https://github.com/x64bits/zynth.git", :tag => "#{s.version}" }

  s.platform     = :ios, "15.0"
  s.swift_version = "5.0"

  s.source_files = "ios/**/*.{h,m,swift}"
  s.public_header_files = "ios/include/**/*.h"

  s.dependency "ZynthKit"
end
