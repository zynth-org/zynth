import Foundation
import RuneKit
import UIKit
import CoreText

public class RuneFontModule: RuneModule {
    public var name: String { "Font" }
    
    public init() {}
    
    public func call(method: String, args: Any?) throws -> Any? {
        switch method {
        case "loadAsync":
            return try loadAsync(args: args)
        default:
            throw RuneModuleError.moduleNotFound("Method \(method) not found in Font module")
        }
    }
    
    private func loadAsync(args: Any?) throws -> Any? {
        guard let params = args as? [String: Any],
              let fontFamily = params["fontFamily"] as? String,
              let resourceName = params["resourceName"] as? String else {
            throw RuneModuleError.moduleNotFound("Invalid arguments for loadAsync. Expected fontFamily and resourceName.")
        }

        print("[RuneFontModule] Attempting to load font: \(fontFamily) (resource: \(resourceName))")

        // 1. Try to find the font in the main bundle
        var fontURL = Bundle.main.url(forResource: resourceName, withExtension: nil)
        if let url = fontURL {
             print("[RuneFontModule] Found in Main Bundle: \(url.path)")
        }
        
        // 2. If not found, look for it in specific bundles (like RuneIcons.bundle)
        if fontURL == nil {
            if resourceName.contains("RuneIcons") {
                print("[RuneFontModule] Searching for RuneIcons.bundle...")
                if let bundleURL = Bundle.main.url(forResource: "RuneIcons", withExtension: "bundle") {
                     print("[RuneFontModule] Found RuneIcons.bundle at: \(bundleURL.path)")
                     if let bundle = Bundle(url: bundleURL) {
                        fontURL = bundle.url(forResource: resourceName, withExtension: nil)
                        if let url = fontURL {
                             print("[RuneFontModule] Found file in RuneIcons.bundle root: \(url.path)")
                        } else {
                             fontURL = bundle.url(forResource: resourceName, withExtension: nil, subdirectory: "Fonts")
                             if let url = fontURL {
                                 print("[RuneFontModule] Found file in RuneIcons.bundle/Fonts: \(url.path)")
                             } else {
                                 print("[RuneFontModule] File not found in RuneIcons.bundle")
                             }
                        }
                     }
                } else {
                    print("[RuneFontModule] RuneIcons.bundle not found in Main Bundle.")
                }
            }
        }
        
        // 3. If still not found, search all loaded bundles
        if fontURL == nil {
            print("[RuneFontModule] Searching all \(Bundle.allBundles.count) loaded bundles...")
            for bundle in Bundle.allBundles {
                if let url = bundle.url(forResource: resourceName, withExtension: nil) {
                    fontURL = url
                    print("[RuneFontModule] Found in bundle '\(bundle.bundlePath)': \(url.path)")
                    break
                }
            }
        }
        
        guard let targetURL = fontURL else {
             print("[RuneFontModule] CRITICAL: Could not find '\(resourceName)' anywhere.")
             throw RuneModuleError.moduleNotFound("Font resource '\(resourceName)' not found in any bundle.")
        }
        
        // 4. Register the font
        var error: Unmanaged<CFError>?
        let success = CTFontManagerRegisterFontsForURL(targetURL as CFURL, .process, &error)
        
        if !success {
             if let error = error?.takeRetainedValue() {
                 let nsError = error as! NSError
                 // If error is "already registered", we consider it a success
                 if nsError.domain == kCTFontManagerErrorDomain as String && nsError.code == CTFontManagerError.alreadyRegistered.rawValue {
                     print("[RuneFontModule] Font '\(fontFamily)' already registered.")
                     return true
                 }
                 print("[RuneFontModule] Failed to register font '\(fontFamily)': \(nsError)")
                 throw RuneModuleError.moduleNotFound("Failed to register font: \(nsError.localizedDescription)")
             }
             return false
        }
        
        print("[RuneFontModule] Successfully registered font '\(fontFamily)' from \(targetURL.lastPathComponent)")
        
        // Verify availability
        let testFont = UIFont(name: fontFamily, size: 12)
        if let f = testFont {
            print("[RuneFontModule] Verification: UIFont(name: \"\(fontFamily)\") created successfully: \(f.fontName)")
        } else {
            print("[RuneFontModule] Verification: FAILED to create UIFont(name: \"\(fontFamily)\"). It might have a different PostScript name.")
            for name in UIFont.familyNames {
                if name.contains("Rune") || name.contains("Icon") {
                    print("[RuneFontModule] Available similar family: \(name)")
                    for fontName in UIFont.fontNames(forFamilyName: name) {
                        print("[RuneFontModule]   - \(fontName)")
                    }
                }
            }
        }
        
        return true
    }
}
