require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
summary = package["description"]
summary = "Rune hypervisor container for embedding guest apps" if summary.nil? || summary.strip.empty?

Pod::Spec.new do |s|
  s.name         = "RuneHypervisor"
  s.version      = package["version"]
  s.summary      = summary
  s.homepage     = "https://github.com/rune/rune"
  s.license      = "MIT"
  s.authors      = { "Rune Team" => "team@rune.dev" }
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/rune/rune.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  
  s.dependency "RuneKit"
end
