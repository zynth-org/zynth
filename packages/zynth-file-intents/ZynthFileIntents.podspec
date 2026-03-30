require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ZynthFileIntents"
  s.version      = package["version"]
  s.summary      = "System open/share/export intents for Zynth"
  s.homepage     = "https://github.com/zynth/zynth"
  s.license      = "MIT"
  s.authors      = { "Zynth Team" => "team@zynthai.com" }
  s.source       = { :git => "https://github.com/zynth/zynth.git", :tag => "#{s.version}" }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.platform     = :ios, "13.0"
  s.dependency "ZynthKit"
end
