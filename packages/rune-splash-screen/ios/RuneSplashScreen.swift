import UIKit
import RuneKit

@objc(RuneSplashScreen)
public class RuneSplashScreen: NSObject {
    private static var splashView: UIView?
    private static var fadeDuration: TimeInterval = 0.25
    private static var preventAutoHide = false
    private static var bridgeInstalled = false
    
    /// Configures and shows the splash screen, then automatically hides it when the first frame is rendered.
    @objc public static func setup(with runtime: RuneRuntime, 
                                  window: UIWindow, 
                                  imageName: String, 
                                  backgroundColor: String, 
                                  resizeMode: String) {
        
        print("[RuneSplashScreen] setup: mode='\(resizeMode)', image='\(imageName)', bg='\(backgroundColor)'")
        
        installBridgeIfNeeded(runtime: runtime)

        let bg = colorFromHex(backgroundColor) ?? .white
        
        // Proactively set background colors to avoid flashes
        window.backgroundColor = bg
        runtime.rootView.backgroundColor = bg
        
        show(in: window, imageName: imageName, backgroundColor: backgroundColor, resizeMode: resizeMode)
        
        runtime.addSurfaceFirstFrameListener(runtime.rootSurfaceId) {
            DispatchQueue.main.async {
                if preventAutoHide {
                    print("[RuneSplashScreen] Auto-hide prevented; waiting for JS hide()")
                    return
                }
                hide()
            }
        }
    }

    @objc public static func show(in window: UIWindow, 
                                 imageName: String, 
                                 backgroundColor: String, 
                                 resizeMode: String) {
        guard splashView == nil else { return }
        
        // Use main screen bounds for absolute coverage
        let splash = UIView(frame: UIScreen.main.bounds)
        let bg = colorFromHex(backgroundColor) ?? .white
        splash.backgroundColor = bg
        splash.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        
        if !imageName.isEmpty {
            if let image = UIImage(named: imageName) {
                let imageView = UIImageView(image: image)
                let mode = contentMode(from: resizeMode)
                imageView.contentMode = mode
                imageView.clipsToBounds = true
                
                // Use constraints to ensure it REALLY fills the splash container
                imageView.translatesAutoresizingMaskIntoConstraints = false
                splash.addSubview(imageView)
                
                NSLayoutConstraint.activate([
                    imageView.topAnchor.constraint(equalTo: splash.topAnchor),
                    imageView.bottomAnchor.constraint(equalTo: splash.bottomAnchor),
                    imageView.leadingAnchor.constraint(equalTo: splash.leadingAnchor),
                    imageView.trailingAnchor.constraint(equalTo: splash.trailingAnchor)
                ])
                print("[RuneSplashScreen] Image view added with contentMode: \(mode.rawValue) (2=AspectFill)")
            } else {
                print("[RuneSplashScreen] ⚠️ Image '\(imageName)' not found in bundle")
            }
        }
        
        self.splashView = splash
        window.addSubview(splash)
        window.bringSubviewToFront(splash)
        
        // Update window background
        window.backgroundColor = bg
    }
    
    @objc public static func hide() {
        guard let splash = splashView else { return }
        print("[RuneSplashScreen] Hiding splash screen")
        splashView = nil
        
        UIView.animate(withDuration: fadeDuration, animations: {
            splash.alpha = 0
        }) { _ in
            splash.removeFromSuperview()
        }
    }

    @objc public static func preventAutoHideJS() -> [String: Any] {
        preventAutoHide = true
        print("[RuneSplashScreen] preventAutoHide() from JS")
        return ["success": true]
    }

    @objc public static func hideJS() -> [String: Any] {
        print("[RuneSplashScreen] hide() from JS")
        preventAutoHide = false
        hide()
        return ["success": true]
    }

    private static func installBridgeIfNeeded(runtime: RuneRuntime) {
        guard !bridgeInstalled else { return }
        runtime.installModules([RuneSplashScreenBridge()])
        bridgeInstalled = true
        print("[RuneSplashScreen] JS bridge installed")
    }
    
    private static func colorFromHex(_ hex: String) -> UIColor? {
        var clean = hex.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if clean.hasPrefix("#") {
            clean.remove(at: clean.startIndex)
        }
        
        if clean.count == 3 || clean.count == 4 {
            clean = clean.map { "\($0)\($0)" }.joined()
        }
        
        if clean.count == 6 {
            clean += "ff"
        }
        
        guard clean.count == 8 else { return nil }
        
        var value: UInt64 = 0
        Scanner(string: clean).scanHexInt64(&value)
        
        let r = CGFloat((value >> 24) & 0xff) / 255.0
        let g = CGFloat((value >> 16) & 0xff) / 255.0
        let b = CGFloat((value >> 8) & 0xff) / 255.0
        let a = CGFloat(value & 0xff) / 255.0
        
        return UIColor(red: r, green: g, blue: b, alpha: a)
    }
    
    private static func contentMode(from mode: String) -> UIView.ContentMode {
        let cleanMode = mode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch cleanMode {
        case "cover": return .scaleAspectFill
        case "stretch": return .scaleToFill
        case "contain": return .scaleAspectFit
        default: 
            print("[RuneSplashScreen] Unknown or default resizeMode '\(mode)', using contain")
            return .scaleAspectFit
        }
    }
}
