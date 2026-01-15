require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ZynthIcons"
  s.version      = package["version"]
  s.summary      = "Icons for Zynth"
  s.homepage     = "https://github.com/zynth/zynth"
  s.license      = "MIT"
  s.authors      = { "Zynth Team" => "team@zynth.dev" }
  s.source       = { :git => "https://github.com/zynth/zynth.git", :tag => "#{s.version}" }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.resource_bundles = {
    'ZynthIcons' => ['ios/Fonts/*.{ttf,otf}']
  }
  s.platform     = :ios, "13.0"
end
