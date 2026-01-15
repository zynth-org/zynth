import UIKit
import ZynthKit

@objc(ZynthSplashScreen)
public class ZynthSplashScreen: NSObject {
    private static var splashWindow: UIWindow?
    private static var mainWindow: UIWindow?
    private static var rootView: UIView?
    private static var previousWindowBackground: UIColor?
    private static var previousRootBackground: UIColor?
    private static var fadeDuration: TimeInterval = 0.25
    private static var hasBeenHidden = false
    private static var pollTimer: Timer?
    
    // Thread-safe access to preventAutoHide
    private static let lockQueue = DispatchQueue(label: "com.zynth.splashscreen.lock", attributes: .concurrent)
    private static var _preventAutoHide = false
    private static var preventAutoHide: Bool {
        get {
            return lockQueue.sync { _preventAutoHide }
        }
        set {
            lockQueue.async(flags: .barrier) { _preventAutoHide = newValue }
        }
    }
    
    /// Configures and shows the splash screen, then automatically hides it when the first frame is rendered.
    @objc public static func setup(with runtime: ZynthRuntime, 
                                  window: UIWindow, 
                                  imageName: String, 
                                  backgroundColor: String, 
                                  resizeMode: String) {
        
        // Always install bridge to ensure the runtime has access to the module
        runtime.installModules([ZynthSplashScreenBridge()])

        let bg = colorFromHex(backgroundColor) ?? .white
        
        // Proactively set background colors on the main window/root to avoid flashes behind the splash
        mainWindow = window
        rootView = runtime.rootView
        previousWindowBackground = window.backgroundColor
        previousRootBackground = runtime.rootView.backgroundColor
        window.backgroundColor = bg
        runtime.rootView.backgroundColor = bg
        
        // We no longer rely on the passed window for hierarchy, but we use the shared setup flow.
        // Using a dedicated window avoids issues with rootViewController replacements on the main window.
        DispatchQueue.main.async {
            show(imageName: imageName, backgroundColor: backgroundColor, resizeMode: resizeMode)
        }
        
        // Primary hide mechanism: Native "First Frame" event
        runtime.addSurfaceFirstFrameListener(runtime.rootSurfaceId) {
            DispatchQueue.main.async {
                if preventAutoHide {
                    return
                }
                hide()
            }
        }
        
        // Fallback mechanism: Poll for readiness
        // This handles cases where the First Frame event might be missed or behavior is inconsistent.
        DispatchQueue.main.async {
            pollTimer?.invalidate()
            pollTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
                // If the user requested to wait, don't auto-hide via polling
                if preventAutoHide {
                    return
                }
                
                // Check if the root view is attached to a window and has content (subviews)
                if let rootWindow = runtime.rootView.window,
                   !runtime.rootView.subviews.isEmpty {
                    hide()
                    timer.invalidate()
                    pollTimer = nil
                }
            }
        }
    }

    @objc public static func show(in window: UIWindow, 
                                 imageName: String, 
                                 backgroundColor: String, 
                                 resizeMode: String) {
        // Compatibility shim if called directly
        show(imageName: imageName, backgroundColor: backgroundColor, resizeMode: resizeMode)
    }

    private static func show(imageName: String, 
                             backgroundColor: String, 
                             resizeMode: String) {
        // Prevent showing if we've already hidden (race condition protection)
        if hasBeenHidden {
            return
        }
        
        guard splashWindow == nil else { return }
        
        // Create a dedicated window for the splash screen
        // We use the main screen bounds
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = .clear
        
        // Place it above the status bar and alerts to ensure visibility
        window.windowLevel = .statusBar + 1
        
        let bg = colorFromHex(backgroundColor) ?? .white
        let splashVC = UIViewController()
        splashVC.view.backgroundColor = bg
        
        if !imageName.isEmpty {
            if let image = UIImage(named: imageName) {
                let imageView = UIImageView(image: image)
                let mode = contentMode(from: resizeMode)
                imageView.contentMode = mode
                imageView.clipsToBounds = true
                imageView.translatesAutoresizingMaskIntoConstraints = false
                
                splashVC.view.addSubview(imageView)
                
                NSLayoutConstraint.activate([
                    imageView.topAnchor.constraint(equalTo: splashVC.view.topAnchor),
                    imageView.bottomAnchor.constraint(equalTo: splashVC.view.bottomAnchor),
                    imageView.leadingAnchor.constraint(equalTo: splashVC.view.leadingAnchor),
                    imageView.trailingAnchor.constraint(equalTo: splashVC.view.trailingAnchor)
                ])
            } else {
                print("[ZynthSplashScreen] ⚠️ Image '\(imageName)' not found in bundle")
            }
        }
        
        window.rootViewController = splashVC
        window.isHidden = false
        
        self.splashWindow = window
    }
    
    @objc public static func hide() {
        // Ensure timer is cleaned up
        pollTimer?.invalidate()
        pollTimer = nil
        
        hasBeenHidden = true
        restoreAppBackgrounds()
        guard let window = splashWindow else { return }
        
        UIView.animate(withDuration: fadeDuration, animations: {
            window.alpha = 0
        }) { _ in
            window.isHidden = true
            window.rootViewController = nil
            self.splashWindow = nil
        }
    }

    @objc public static func preventAutoHideJS() -> [String: Any] {
        preventAutoHide = true
        return ["success": true]
    }

    private static func restoreAppBackgrounds() {
        if let window = mainWindow {
            window.backgroundColor = previousWindowBackground
        }
        if let rootView = rootView {
            rootView.backgroundColor = previousRootBackground
        }
        mainWindow = nil
        rootView = nil
        previousWindowBackground = nil
        previousRootBackground = nil
    }

    @objc public static func hideJS() -> [String: Any] {
        preventAutoHide = false
        DispatchQueue.main.async {
            hide()
        }
        return ["success": true]
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
            return .scaleAspectFit
        }
    }
}
