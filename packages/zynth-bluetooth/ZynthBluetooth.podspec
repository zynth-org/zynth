require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
summary = package["description"]
summary = "Secure Bluetooth Classic + BLE primitives for Zynth" if summary.nil? || summary.strip.empty?

Pod::Spec.new do |s|
  s.name         = "ZynthBluetooth"
  s.version      = package["version"]
  s.summary      = summary
  s.homepage     = "https://github.com/zynth/zynth"
  s.license      = "MIT"
  s.authors      = { "Zynth Team" => "team@zynthai.com" }
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/zynth/zynth.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.9"

  s.dependency "ZynthKit"
end
