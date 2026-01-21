import ZynthKit
import UIKit

@objcMembers
public class ZynthAlertView: UIView {
  
  private var manager: ZynthUIManager?
  private var node: ZynthNode?
  
  private var alertTitle: String?
  private var alertMessage: String?
  private var buttonsConfig: [[String: Any]] = []
  private var alertController: UIAlertController?
  
  public func bind(manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
  }
  
  public func reset() {
    dismiss()
    manager = nil
    node = nil
    alertTitle = nil
    alertMessage = nil
    buttonsConfig = []
  }
  
  public func setAlertTitle(_ title: String) {
    alertTitle = title
  }
  
  public func setAlertMessage(_ message: String) {
    alertMessage = message
  }
  
  public func setButtons(_ buttons: [Any]) {
    buttonsConfig = buttons.compactMap { $0 as? [String: Any] }
  }
  
  public func show() {
    guard alertController == nil else { return }
    
    let alert = UIAlertController(
      title: alertTitle,
      message: alertMessage,
      preferredStyle: .alert
    )
    
    if buttonsConfig.isEmpty {
      // Default OK button
      let action = UIAlertAction(title: "OK", style: .default) { [weak self] _ in
        self?.handleButtonPress(index: 0)
        self?.handleDismiss()
      }
      alert.addAction(action)
    } else {
      for (index, buttonConfig) in buttonsConfig.enumerated() {
        let text = buttonConfig["text"] as? String ?? "Button"
        let styleString = buttonConfig["style"] as? String ?? "default"
        let style = mapButtonStyle(styleString)
        
        let action = UIAlertAction(title: text, style: style) { [weak self] _ in
          self?.handleButtonPress(index: index)
          self?.handleDismiss()
        }
        alert.addAction(action)
      }
    }
    
    alertController = alert
    
    // Find the presenting view controller
    guard let viewController = findViewController() else { return }
    viewController.present(alert, animated: true)
  }
  
  public func dismiss() {
    guard let alert = alertController else { return }
    alert.dismiss(animated: true) { [weak self] in
      self?.handleDismiss()
    }
    alertController = nil
  }
  
  private func mapButtonStyle(_ style: String) -> UIAlertAction.Style {
    switch style {
    case "cancel":
      return .cancel
    case "destructive":
      return .destructive
    default:
      return .default
    }
  }
  
  private func handleButtonPress(index: Int) {
    dispatchEvent("onButtonPress", payload: ["index": index])
  }
  
  private func handleDismiss() {
    alertController = nil
    dispatchEvent("onDismiss", payload: [:])
  }
  
  private func dispatchEvent(_ name: String, payload: [AnyHashable: Any]?) {
    guard let manager = manager, let node = node else { return }
    let selector = NSSelectorFromString("zynth_dispatchEvent:payload:toNode:")
    guard let method = manager.method(for: selector) else { return }
    typealias Imp = @convention(c) (AnyObject, Selector, NSString, NSDictionary?, ZynthNode) -> Void
    let function = unsafeBitCast(method, to: Imp.self)
    function(manager, selector, name as NSString, payload as NSDictionary?, node)
  }
  
  private func findViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let nextResponder = responder?.next {
      if let viewController = nextResponder as? UIViewController {
        return viewController
      }
      responder = nextResponder
    }
    
    // Fallback to key window's root view controller
    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
       let window = windowScene.windows.first(where: { $0.isKeyWindow }) {
      return window.rootViewController?.presentedViewController ?? window.rootViewController
    }
    
    return nil
  }
}
