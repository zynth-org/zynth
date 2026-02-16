import Foundation
import ZynthKit
import UIKit
import CoreText

public class ZynthFontModule: ZynthModule {
    public var name: String { "Font" }
    
    public var exportedMethods: [String] {
        return ["loadAsync"]
    }
    
    public init() {}
    
    public func call(method: String, args: ZynthArgs) throws -> Any? {
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
    
    private func loadAsync(args: ZynthArgs) throws -> Any? {
        let resourceName = try args.string("resourceName")
        let fontFamily = try args.string("fontFamily")
        
        print("[ZynthFontModule] Loading font '\(fontFamily)' from resource '\(resourceName)'")

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
        
        // 2. If not found, look for it in specific bundles (like ZynthIcons.bundle or ZynthComponents.bundle)
        if fontURL == nil {
            let bundleNames = ["ZynthIcons", "ZynthComponents"]
            for bundleName in bundleNames {
                if let bundleURL = Bundle.main.url(forResource: bundleName, withExtension: "bundle") {
                     if let bundle = Bundle(url: bundleURL) {
                        fontURL = bundle.url(forResource: normalizedResource, withExtension: nil)
                        if fontURL == nil {
                            fontURL = bundle.url(forResource: resourceFileName, withExtension: nil)
                        }
                        if fontURL != nil {
                             break
                        } else {
                             fontURL = bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "Fonts")
                                 ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "fonts")
                             if fontURL != nil {
                                 break
                             } else {
                                 fontURL = bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "assets/fonts")
                                     ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "src/assets/fonts")
                                 if fontURL != nil {
                                     break
                                 }
                             }
                        }
                     }
                }
            }
        }
        
        // 3. If still not found, search all loaded bundles
        if fontURL == nil {
            for bundle in Bundle.allBundles {
                if let url = bundle.url(forResource: normalizedResource, withExtension: nil)
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil)
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "fonts")
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "Fonts")
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "assets/fonts")
                    ?? bundle.url(forResource: resourceFileName, withExtension: nil, subdirectory: "src/assets/fonts") {
                    fontURL = url
                    break
                }
            }
        }

        // 4. If still not found, recursively scan bundle resource folders by filename.
        if fontURL == nil {
            let bundles = [Bundle.main] + Bundle.allBundles
            for bundle in bundles {
                if let found = findFontInBundleRecursively(bundle: bundle, fileName: resourceFileName) {
                    fontURL = found
                    break
                }
            }
        }

        // 5. If resourceName is a URL, download it
        if fontURL == nil && (resourceName.hasPrefix("http://") || resourceName.hasPrefix("https://")) {
            if let remoteURL = URL(string: resourceName) {
                let semaphore = DispatchSemaphore(value: 0)
                var downloadedURL: URL?
                
                let task = URLSession.shared.downloadTask(with: remoteURL) { (localURL, response, error) in
                    if let localURL = localURL {
                        // Move to a more permanent location in Caches
                        let fileManager = FileManager.default
                        let cachesDirectory = fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                        let destinationURL = cachesDirectory.appendingPathComponent(remoteURL.lastPathComponent)
                        
                        try? fileManager.removeItem(at: destinationURL)
                        do {
                            try fileManager.moveItem(at: localURL, to: destinationURL)
                            downloadedURL = destinationURL
                        } catch {
                            // ignore error move
                        }
                    } else if let error = error {
                        print("[ZynthFontModule] Download failed: \(error)")
                    }
                    semaphore.signal()
                }
                task.resume()
                _ = semaphore.wait(timeout: .now() + 30.0) // 30s timeout
                fontURL = downloadedURL
            }
        }

        // 6. If resourceName is a file path, try direct filesystem path.
        if fontURL == nil {
            let directPaths = [normalizedResource, resourceFileName].filter { !$0.isEmpty }
            for candidate in directPaths {
                let url = URL(fileURLWithPath: candidate)
                if FileManager.default.fileExists(atPath: url.path) {
                    fontURL = url
                    break
                }
            }
        }
        
        guard let targetURL = fontURL else {
             throw ZynthModuleError.moduleNotFound("Font resource '\(resourceName)' not found in any bundle and failed to download if it was a URL.")
        }
        
        // 7. Register the font
        var error: Unmanaged<CFError>?
        var success = false
        
        // Use main thread for registration to avoid potential hangs during initialization
        if Thread.isMainThread {
            success = CTFontManagerRegisterFontsForURL(targetURL as CFURL, .process, &error)
        } else {
            DispatchQueue.main.sync {
                success = CTFontManagerRegisterFontsForURL(targetURL as CFURL, .process, &error)
            }
        }
        
        if !success {
             if let error = error?.takeRetainedValue() {
                 let nsError = error as! NSError
                 // If error is "already registered", we consider it a success
                 if nsError.domain == kCTFontManagerErrorDomain as String && nsError.code == CTFontManagerError.alreadyRegistered.rawValue {
                     return [
                        "success": true,
                        "path": targetURL.path
                     ]
                 }
                 throw ZynthModuleError.moduleNotFound("Failed to register font: \(nsError.localizedDescription)")
             }
             return [
                "success": false
             ]
        }
        
        return [
            "success": true,
            "path": targetURL.path
        ]
    }
}
