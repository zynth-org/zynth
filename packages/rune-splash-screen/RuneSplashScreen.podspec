Pod::Spec.new do |s|
  s.name         = "RuneSplashScreen"
  s.version      = "0.0.1"
  s.summary      = "Native splash screen management for Rune"
  s.homepage     = "https://github.com/x64Bits/rune"
  s.license      = "MIT"
  s.author       = { "Rune Team" => "team@rune.dev" }
  s.platform     = :ios, "13.0"
  s.source       = { :path => "." }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.requires_arc = true
  s.swift_version = "5.0"

  s.dependency "RuneKit"
end
