Pod::Spec.new do |s|
  s.name         = "ZynthScreens"
  s.version      = "0.0.1"
  s.summary      = "Native screen primitives for Zynth router"
  s.license      = { :type => "MIT" }
  s.author       = { "Zynth" => "dev@zynthstack.dev" }
  s.homepage     = "https://github.com/zynth-org/zynth"
  s.platform     = :ios, "15.0"

  s.source       = { :git => "https://github.com/zynth-org/zynth.git", :branch => "main" }
  s.source_files = "ios/src/**/*.{h,m,mm,swift}"
  s.swift_version = "5.9"

  s.dependency "ZynthKit"

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => %w[
      $(inherited)
      ${PODS_CONFIGURATION_BUILD_DIR}/ZynthKit/ZynthKit.framework/Headers
      ${PODS_ROOT}/Headers/Public/ZynthKit
      ${PODS_ROOT}/Headers/Private/ZynthKit
    ].join(' ')
  }
end
