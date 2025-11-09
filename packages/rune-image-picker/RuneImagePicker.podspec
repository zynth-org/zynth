require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "RuneImagePicker"
  s.version      = package["version"]
  s.summary      = "Image Picker for Rune"
  s.homepage     = "https://github.com/rune/rune"
  s.license      = "MIT"
  s.authors      = { "Rune Team" => "team@rune.dev" }
  s.source       = { :git => "https://github.com/rune/rune.git", :tag => "#{s.version}" }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.platform     = :ios, "13.0"
  s.dependency "RuneKit"
end
