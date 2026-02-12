import Foundation
import ZynthKit
import UIKit
import CoreText

public class ZynthFontModule: ZynthModule {
    public var name: String { "Font" }
    
    public init() {}
    
    public func call(method: String, args: Any?) throws -> Any? {
        switch method {
        case "loadAsync":
            return try loadAsync(args: args)
        default:
            throw ZynthModuleError.moduleNotFound("Method \(method) not found in Font module")
        }
    }

    private func findFontInBundleRecursively(
        bundle: Bundle,
        fileName: String
    ) -> URL? {
        guard let resourcePath = bundle.resourcePath else { return nil }
        let rootURL = URL(fileURLWithPath: resourcePath, isDirectory: true)
        guard let enumerator = FileManager.default.enumerator(
            at: rootURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return nil
        }
        while let next = enumerator.nextObject() as? URL {
            if next.lastPathComponent.caseInsensitiveCompare(fileName) == .orderedSame {
                return next
            }
        }
        return nil
    }
    
    private func loadAsync(args: Any?) throws -> Any? {
        guard let params = args as? [String: Any],
              let fontFamily = params["fontFamily"] as? String,
              let resourceName = params["resourceName"] as? String else {
            throw ZynthModuleError.moduleNotFound("Invalid arguments for loadAsync. Expected fontFamily and resourceName.")
        }

        print("[ZynthFontModule] Attempting to load font: \(fontFamily) (resource: \(resourceName))")
        let normalizedResource = resourceName.replacingOccurrences(of: "\\", with: "/")
        let resourceFileName = (normalizedResource as NSString).lastPathComponent
        let mainBundle = Bundle.main

        // 1. Try to find the font in the main bundle
        var fontURL = mainBundle.url(forResource: normalizedResource, withExtension: nil)
        if fontURL == nil && resourceFileName != normalizedResource {
            fontURL = mainBundle.url(forResource: resourceFileName, withExtension: nil)
        }
        if fontURL == nil {
            fontURL = mainBundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "fonts")
                ?? mainBundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "Fonts")
                ?? mainBundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "assets/fonts")
                ?? mainBundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "src/assets/fonts")
        }
        if let url = fontURL {
             print("[ZynthFontModule] Found in Main Bundle: \(url.path)")
        }
        
        // 2. If not found, look for it in specific bundles (like ZynthIcons.bundle or ZynthComponents.bundle)
        if fontURL == nil {
            let bundleNames = ["ZynthIcons", "ZynthComponents"]
            for bundleName in bundleNames {
                print("[ZynthFontModule] Searching for \(bundleName).bundle...")
                if let bundleURL = Bundle.main.url(forResource: bundleName, withExtension: "bundle") {
                     print("[ZynthFontModule] Found \(bundleName).bundle at: \(bundleURL.path)")
                     if let bundle = Bundle(url: bundleURL) {
                        fontURL = bundle.url(forResource: normalizedResource, withExtension: nil)
                        if fontURL == nil {
                            fontURL = bundle.url(forResource: resourceFileName, withExtension: nil)
                        }
                        if let url = fontURL {
                             print("[ZynthFontModule] Found file in \(bundleName).bundle root: \(url.path)")
                             break
                        } else {
                             fontURL = bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "Fonts")
                                 ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "fonts")
                             if let url = fontURL {
                                 print("[ZynthFontModule] Found file in \(bundleName).bundle/Fonts: \(url.path)")
                                 break
                             } else {
                                 // Try assets/fonts too since that's where we just pointed the podspec
                                 fontURL = bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "assets/fonts")
                                     ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "src/assets/fonts")
                                 if let url = fontURL {
                                     print("[ZynthFontModule] Found file in \(bundleName).bundle/assets/fonts: \(url.path)")
                                     break
                                 } else {
                                     print("[ZynthFontModule] File not found in \(bundleName).bundle")
                                 }
                             }
                        }
                     }
                }
            }
        }
        
        // 3. If still not found, search all loaded bundles
        if fontURL == nil {
            print("[ZynthFontModule] Searching all \(Bundle.allBundles.count) loaded bundles...")
            for bundle in Bundle.allBundles {
                if let url = bundle.url(forResource: normalizedResource, withExtension: nil)
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil)
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "fonts")
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "Fonts")
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "assets/fonts")
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "src/assets/fonts") {
                    fontURL = url
                    print("[ZynthFontModule] Found in bundle '\(bundle.bundlePath)': \(url.path)")
                    break
                }
            }
        }

        // 4. If still not found, recursively scan bundle resource folders by filename.
        if fontURL == nil {
            print("[ZynthFontModule] Recursive bundle search for '\(resourceFileName)'...")
            let bundles = [Bundle.main] + Bundle.allBundles
            for bundle in bundles {
                if let found = findFontInBundleRecursively(bundle: bundle, fileName: resourceFileName) {
                    fontURL = found
                    print("[ZynthFontModule] Found via recursive scan in '\(bundle.bundlePath)': \(found.path)")
                    break
                }
            }
        }

        // 5. If resourceName is a file path, try direct filesystem path.
        if fontURL == nil {
            let directPaths = [normalizedResource, resourceFileName].filter { !$0.isEmpty }
            for candidate in directPaths {
                let url = URL(fileURLWithPath: candidate)
                if FileManager.default.fileExists(atPath: url.path) {
                    fontURL = url
                    print("[ZynthFontModule] Found via direct file path: \(url.path)")
                    break
                }
            }
        }
        
        guard let targetURL = fontURL else {
             print("[ZynthFontModule] CRITICAL: Could not find '\(resourceName)' anywhere.")
             throw ZynthModuleError.moduleNotFound("Font resource '\(resourceName)' not found in any bundle.")
        }
        
        // 6. Register the font
        var error: Unmanaged<CFError>?
        let success = CTFontManagerRegisterFontsForURL(targetURL as CFURL, .process, &error)
        
        if !success {
             if let error = error?.takeRetainedValue() {
                 let nsError = error as! NSError
                 // If error is "already registered", we consider it a success
                 if nsError.domain == kCTFontManagerErrorDomain as String && nsError.code == CTFontManagerError.alreadyRegistered.rawValue {
                     print("[ZynthFontModule] Font '\(fontFamily)' already registered.")
                     return true
                 }
                 print("[ZynthFontModule] Failed to register font '\(fontFamily)': \(nsError)")
                 throw ZynthModuleError.moduleNotFound("Failed to register font: \(nsError.localizedDescription)")
             }
             return false
        }
        
        print("[ZynthFontModule] Successfully registered font '\(fontFamily)' from \(targetURL.lastPathComponent)")
        
        // Verify availability
        let testFont = UIFont(name: fontFamily, size: 12)
        if let f = testFont {
            print("[ZynthFontModule] Verification: UIFont(name: \"\(fontFamily)\") created successfully: \(f.fontName)")
        } else {
            print("[ZynthFontModule] Verification: FAILED to create UIFont(name: \"\(fontFamily)\"). It might have a different PostScript name.")
            for name in UIFont.familyNames {
                if name.contains("Zynth") || name.contains("Icon") {
                    print("[ZynthFontModule] Available similar family: \(name)")
                    for fontName in UIFont.fontNames(forFamilyName: name) {
                        print("[ZynthFontModule]   - \(fontName)")
                    }
                }
            }
        }

        return true
    }
}
