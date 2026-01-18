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
    
    private func loadAsync(args: Any?) throws -> Any? {
        guard let params = args as? [String: Any],
              let fontFamily = params["fontFamily"] as? String,
              let resourceName = params["resourceName"] as? String else {
            throw ZynthModuleError.moduleNotFound("Invalid arguments for loadAsync. Expected fontFamily and resourceName.")
        }

        print("[ZynthFontModule] Attempting to load font: \(fontFamily) (resource: \(resourceName))")

        // 1. Try to find the font in the main bundle
        var fontURL = Bundle.main.url(forResource: resourceName, withExtension: nil)
        if let url = fontURL {
             print("[ZynthFontModule] Found in Main Bundle: \(url.path)")
        }
        
        // 2. If not found, look for it in specific bundles (like ZynthIcons.bundle)
        if fontURL == nil {
            if resourceName.contains("ZynthIcons") {
                print("[ZynthFontModule] Searching for ZynthIcons.bundle...")
                if let bundleURL = Bundle.main.url(forResource: "ZynthIcons", withExtension: "bundle") {
                     print("[ZynthFontModule] Found ZynthIcons.bundle at: \(bundleURL.path)")
                     if let bundle = Bundle(url: bundleURL) {
                        fontURL = bundle.url(forResource: resourceName, withExtension: nil)
                        if let url = fontURL {
                             print("[ZynthFontModule] Found file in ZynthIcons.bundle root: \(url.path)")
                        } else {
                             fontURL = bundle.url(forResource: resourceName, withExtension: nil, subdirectory: "Fonts")
                             if let url = fontURL {
                                 print("[ZynthFontModule] Found file in ZynthIcons.bundle/Fonts: \(url.path)")
                             } else {
                                 print("[ZynthFontModule] File not found in ZynthIcons.bundle")
                             }
                        }
                     }
                } else {
                    print("[ZynthFontModule] ZynthIcons.bundle not found in Main Bundle.")
                }
            }
        }
        
        // 3. If still not found, search all loaded bundles
        if fontURL == nil {
            print("[ZynthFontModule] Searching all \(Bundle.allBundles.count) loaded bundles...")
            for bundle in Bundle.allBundles {
                if let url = bundle.url(forResource: resourceName, withExtension: nil) {
                    fontURL = url
                    print("[ZynthFontModule] Found in bundle '\(bundle.bundlePath)': \(url.path)")
                    break
                }
            }
        }
        
        guard let targetURL = fontURL else {
             print("[ZynthFontModule] CRITICAL: Could not find '\(resourceName)' anywhere.")
             throw ZynthModuleError.moduleNotFound("Font resource '\(resourceName)' not found in any bundle.")
        }
        
        // 4. Register the font
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
