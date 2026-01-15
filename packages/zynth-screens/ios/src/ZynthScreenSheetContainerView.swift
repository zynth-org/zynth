import UIKit

@objcMembers
public final class ZynthScreenSheetContainerView: UIView, ZynthScreenContainer {
  private var orderedScreens: [ZynthScreenView] = []
  private var controllerMap: [ObjectIdentifier: ZynthScreenViewController] = [:]
  private var activeController: ZynthScreenViewController?
  private var pendingUpdate = false
  private let transitionWillBeginName = Notification.Name("ZynthScreenTransitionWillBegin")
  private let transitionDidEndName = Notification.Name("ZynthScreenTransitionDidEnd")
  
  private weak var parentViewController: UIViewController?

  public override init(frame: CGRect) {
    super.init(frame: frame)
    clipsToBounds = false
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    clipsToBounds = false
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      parentViewController = findParentViewController()
      scheduleUpdate()
    } else {
      parentViewController = nil
    }
  }

  public func insertScreen(_ screen: ZynthScreenView, at index: Int) {
    let clampedIndex = max(0, min(index, orderedScreens.count))
    orderedScreens.removeAll { $0 === screen }
    orderedScreens.insert(screen, at: clampedIndex)
    screen.container = self
    scheduleUpdate()
  }

  public func removeScreen(_ screen: ZynthScreenView) {
    orderedScreens.removeAll { $0 === screen }
    
    if let controller = controllerMap[ObjectIdentifier(screen)] {
       if controller !== activeController {
          controllerMap.removeValue(forKey: ObjectIdentifier(screen))
       }
    }
    
    scheduleUpdate()
  }

  func screenDidAttach(_ screen: ZynthScreenView) {
    if !orderedScreens.contains(where: { $0 === screen }) {
      orderedScreens.append(screen)
    }
    scheduleUpdate()
  }
    
  func screenDidChangeActiveState(_ screen: ZynthScreenView) {
    scheduleUpdate()
  }
  
  func screenHeaderOptionsDidChange(_ screen: ZynthScreenView) {}
  func screenAnimationDidChange(_ screen: ZynthScreenView) {}
  func refreshInteractiveGestureState() {}

  private func controller(for screen: ZynthScreenView) -> ZynthScreenViewController {
    let identifier = ObjectIdentifier(screen)
    if let existing = controllerMap[identifier] {
      return existing
    }
    let controller = ZynthScreenViewController(screenView: screen)
    controllerMap[identifier] = controller
    return controller
  }

  private func scheduleUpdate() {
    guard !pendingUpdate else { return }
    pendingUpdate = true
    DispatchQueue.main.async { [weak self] in
      self?.pendingUpdate = false
      self?.updateLayout()
    }
  }

  private func updateLayout() {
    guard let parentVC = parentViewController else { return }
    
    let activeScreens = orderedScreens.filter { $0.isScreenActive }
    
    guard let nextScreen = activeScreens.last else {
        if let current = activeController {
             transition(from: current, to: nil, operation: .pop, animationType: current.screenView.animationType)
        }
        return
    }
    
    let nextController = controller(for: nextScreen)
    
    if activeController === nextController {
        return
    }
    
    var operation: UINavigationController.Operation = .push
    var animationType: ZynthScreenAnimation = .push
    
    if let current = activeController {
        let currentIndex = orderedScreens.firstIndex { $0 === current.screenView } ?? -1
        let nextIndex = orderedScreens.firstIndex { $0 === nextScreen } ?? -1
        
        if currentIndex == -1 {
            operation = .pop
            animationType = current.screenView.animationType
        } else if nextIndex < currentIndex {
            operation = .pop
            animationType = current.screenView.animationType
        } else if nextIndex > currentIndex {
            operation = .push
            animationType = nextScreen.animationType
        } else {
            operation = .push
            animationType = .fade
        }
    } else {
        operation = .none
        animationType = .none
    }
    
    transition(from: activeController, to: nextController, operation: operation, animationType: animationType)
  }

  private func transition(from fromVC: ZynthScreenViewController?, to toVC: ZynthScreenViewController?, operation: UINavigationController.Operation, animationType: ZynthScreenAnimation) {
    guard let parentVC = parentViewController else { return }
    
    if let toVC = toVC {
        parentVC.addChild(toVC)
        toVC.view.frame = bounds
        toVC.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        toVC.view.transform = .identity
    }
    
    if operation == .none || animationType == .none {
        fromVC?.willMove(toParent: nil)
        fromVC?.view.removeFromSuperview()
        fromVC?.removeFromParent()
        
        if let toVC = toVC {
            addSubview(toVC.view)
            toVC.didMove(toParent: parentVC)
        }
        activeController = toVC
        
        if let from = fromVC, !orderedScreens.contains(where: { $0 === from.screenView }) {
             controllerMap.removeValue(forKey: ObjectIdentifier(from.screenView))
        }
        return
    }
    
    performAnimation(from: fromVC, to: toVC, operation: operation, animationType: animationType) { [weak self] in
        fromVC?.willMove(toParent: nil)
        fromVC?.view.removeFromSuperview()
        fromVC?.removeFromParent()
        fromVC?.view.transform = .identity // Reset transform
        fromVC?.view.alpha = 1.0 // Reset alpha
        
        toVC?.didMove(toParent: parentVC)
        self?.activeController = toVC
        
        if let from = fromVC, let self = self {
             if !self.orderedScreens.contains(where: { $0 === from.screenView }) {
                 self.controllerMap.removeValue(forKey: ObjectIdentifier(from.screenView))
             }
        }
    }
  }

  private func performAnimation(from: ZynthScreenViewController?, to: ZynthScreenViewController?, operation: UINavigationController.Operation, animationType: ZynthScreenAnimation, completion: @escaping () -> Void) {
     if operation == .pop {
         NotificationCenter.default.post(name: transitionWillBeginName, object: nil)
     }

     guard let toView = to?.view else {
         if let fromView = from?.view {
             UIView.animate(withDuration: 0.35, animations: {
                 fromView.alpha = 0
             }) { [weak self] _ in
                 if operation == .pop, let self {
                     NotificationCenter.default.post(name: self.transitionDidEndName, object: nil)
                 }
                 completion()
             }
         } else {
             if operation == .pop {
                 NotificationCenter.default.post(name: self.transitionDidEndName, object: nil)
             }
             completion()
         }
         return
     }
     
     guard let fromView = from?.view else {
         addSubview(toView)
         // Initial state for 'toView' when no 'fromView'
         toView.alpha = 1.0
         completion()
         return
     }
     
     let duration: TimeInterval = 0.35
     let containerWidth = bounds.width
     
     if operation == .pop {
         insertSubview(toView, belowSubview: fromView)
     } else {
         addSubview(toView)
     }
     
     // --- BLUR EFFECTS SETUP ---
     let blurEffect = UIBlurEffect(style: .light)
     
     func addBlur(to view: UIView, startAlpha: CGFloat) -> UIVisualEffectView {
         let blur = UIVisualEffectView(effect: blurEffect)
         blur.frame = view.bounds
         blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
         blur.alpha = startAlpha
         view.addSubview(blur)
         return blur
     }
     
     var fromBlur: UIVisualEffectView?
     var toBlur: UIVisualEffectView?
     
     if operation == .pop {
        // POP: "From" (Details) Leaving Right. "To" (Home) Entering from Left.
        
        // Initial States
        fromView.transform = .identity
        fromView.alpha = 1.0
        
        toView.transform = CGAffineTransform(translationX: -containerWidth * 0.3, y: 0)
        toView.alpha = 0.5 // Start with partial opacity
        
        // Blur Logic:
        // From (Leaving): 0 -> 1
        // To (Entering): 1 -> 0
        
        fromBlur = addBlur(to: fromView, startAlpha: 0)
        toBlur = addBlur(to: toView, startAlpha: 1)
        
        UIView.animate(withDuration: duration, delay: 0, options: .curveEaseInOut) {
            fromView.transform = CGAffineTransform(translationX: containerWidth, y: 0)
            fromView.alpha = 0.0 // Fade out leaving screen
            
            toView.transform = .identity
            toView.alpha = 1.0 // Fade in entering screen
            
            fromBlur?.alpha = 1
            toBlur?.alpha = 0
        } completion: { [weak self] _ in
            fromBlur?.removeFromSuperview()
            toBlur?.removeFromSuperview()
            if operation == .pop, let self {
                NotificationCenter.default.post(name: self.transitionDidEndName, object: nil)
            }
            completion()
        }
        
     } else {
        // PUSH: "From" (Home) Leaving Left. "To" (Details) Entering from Right.
        
        // Initial States
        fromView.transform = .identity
        fromView.alpha = 1.0
        
        toView.transform = CGAffineTransform(translationX: containerWidth, y: 0)
        toView.alpha = 0.5 // Start with partial opacity
        
        // Blur Logic:
        // From (Leaving): 0 -> 1
        // To (Entering): 1 -> 0
        
        fromBlur = addBlur(to: fromView, startAlpha: 0)
        toBlur = addBlur(to: toView, startAlpha: 1)
        
        UIView.animate(withDuration: duration, delay: 0, options: .curveEaseOut) {
            fromView.transform = CGAffineTransform(translationX: -containerWidth * 0.3, y: 0)
            fromView.alpha = 0.0 // Fade out leaving screen
            
            toView.transform = .identity
            toView.alpha = 1.0 // Fade in entering screen
            
            fromBlur?.alpha = 1
            toBlur?.alpha = 0
        } completion: { [weak self] _ in
            fromBlur?.removeFromSuperview()
            toBlur?.removeFromSuperview()
            if operation == .pop, let self {
                NotificationCenter.default.post(name: self.transitionDidEndName, object: nil)
            }
            completion()
        }
     }
  }

  private func findParentViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let vc = next as? UIViewController {
        return vc
      }
      responder = next
    }
    return nil
  }
}
