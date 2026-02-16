Pod::Spec.new do |s|
  s.name         = "ZynthSensors"
  s.version      = "0.0.1"
  s.summary      = "Motion and environment sensor APIs for Zynth"
  s.homepage     = "https://github.com/x64Bits/zynth"
  s.license      = "MIT"
  s.author       = { "Zynth Team" => "team@zynth.dev" }
  s.source       = { :path => "." }

  s.platform     = :ios, "13.0"
  s.swift_version = "5.0"

  s.source_files = "ios/**/*.{h,m,swift}"
  s.requires_arc = true
  s.frameworks = "CoreMotion"

  s.dependency "ZynthKit"
end
