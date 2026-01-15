Pod::Spec.new do |s|
  s.name         = "ZynthAsyncStorage"
  s.version      = "0.0.1"
  s.summary      = "High-performance AsyncStorage for Zynth"
  s.homepage     = "https://github.com/x64Bits/zynth"
  s.license      = "MIT"
  s.author       = { "Zynth Team" => "team@zynth.dev" }
  s.platform     = :ios, "13.0"
  s.source       = { :path => "." }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.requires_arc = true
  s.swift_version = "5.0"

  s.dependency "ZynthKit"
end
