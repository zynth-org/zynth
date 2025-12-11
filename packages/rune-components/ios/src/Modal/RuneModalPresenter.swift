import RuneKit
import UIKit

enum RuneModalAnimation: String {
  case fade
  case slide
  case zoom
  case none

  static func from(_ value: String?) -> RuneModalAnimation {
    guard let value else { return .fade }
    return RuneModalAnimation(rawValue: value.lowercased()) ?? .fade
  }
}

struct RuneModalOptions {
  var animation: RuneModalAnimation = .fade
  var transparent: Bool = false
  var overlayColor: UIColor = .black
  var overlayOpacity: CGFloat = 0.45
  var dismissOnOverlayPress: Bool = true
}

final class RuneModalPresenter: NSObject {
  private weak var host: RuneModalView?
  private let contentHost: UIView
  private var options = RuneModalOptions()
  private var contentController: RuneModalContentViewController?
  private var isOpen = false

  init(contentHost: UIView, host: RuneModalView) {
    self.contentHost = contentHost
    self.host = host
    super.init()
  }

  func updateOptions(_ newOptions: RuneModalOptions) {
    options = newOptions
    contentController?.applyOptions(newOptions)
  }

  func setOpenState(_ open: Bool) {
    if open {
      present()
    } else {
      dismiss()
    }
  }

  func present() {
    DispatchQueue.main.async { [weak self] in
      self?.presentInternal()
    }
  }

  func dismiss() {
    DispatchQueue.main.async { [weak self] in
      self?.dismissInternal()
    }
  }

  func reset() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if let controller = self.contentController {
        controller.dismiss(animated: false) { [weak self] in
          self?.completeDismiss()
        }
      } else {
        self.completeDismiss()
      }
    }
  }

  private func presentInternal() {
    guard !isOpen else { return }
    guard let presenter = topViewController() else { return }
    isOpen = true

    let controller = RuneModalContentViewController(
      contentHost: contentHost,
      options: options
    )
    controller.onOverlayTap = { [weak self] in
      self?.handleOverlayTap()
    }

    controller.modalPresentationStyle = .overFullScreen
    controller.presentationController?.delegate = self
    if options.animation != .none {
      controller.transitioningDelegate = self
    }

    presenter.present(controller, animated: options.animation != .none) { [weak self] in
      guard let self else { return }
      self.host?.dispatchEvent("onOpenChange", payload: ["open": true])
    }

    contentController = controller
  }

  private func dismissInternal() {
    guard isOpen, let controller = contentController else { return }
    controller.dismiss(animated: options.animation != .none) { [weak self] in
      self?.completeDismiss()
    }
  }

  private func completeDismiss() {
    guard isOpen else { return }
    isOpen = false
    contentController = nil
    host?.dispatchEvent("onOpenChange", payload: ["open": false])
    host?.dispatchEvent("onDismiss", payload: nil)
  }

  private func handleOverlayTap() {
    guard options.dismissOnOverlayPress else { return }
    host?.dispatchEvent("onRequestClose", payload: nil)
    dismiss()
  }

  private func topViewController() -> UIViewController? {
    if let vc = host?.window?.rootViewController {
      return topController(from: vc)
    }

    if #available(iOS 13.0, *) {
      let scenes = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
      for scene in scenes where scene.activationState == .foregroundActive {
        if let top = topController(
          from: scene.windows.first(where: { $0.isKeyWindow })?.rootViewController)
        {
          return top
        }
      }
    }

    let fallback = topController(
      from: UIApplication.shared.windows.first(where: { $0.isKeyWindow })?.rootViewController)
    return fallback
  }

  private func topController(from controller: UIViewController?) -> UIViewController? {
    let candidate: UIViewController?
    if let nav = controller as? UINavigationController {
      candidate = nav.visibleViewController
    } else if let tab = controller as? UITabBarController {
      candidate = tab.selectedViewController
    } else {
      candidate = controller
    }

    if let presented = candidate?.presentedViewController {
      return topController(from: presented)
    }
    return candidate
  }
}

extension RuneModalPresenter: UIViewControllerTransitioningDelegate {
  func animationController(
    forPresented presented: UIViewController,
    presenting: UIViewController,
    source: UIViewController
  ) -> UIViewControllerAnimatedTransitioning? {
    return RuneModalAnimator(isPresenting: true, animation: options.animation)
  }

  func animationController(
    forDismissed dismissed: UIViewController
  ) -> UIViewControllerAnimatedTransitioning? {
    return RuneModalAnimator(isPresenting: false, animation: options.animation)
  }
}

extension RuneModalPresenter: UIAdaptivePresentationControllerDelegate {
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    completeDismiss()
  }
}

private final class RuneModalAnimator: NSObject, UIViewControllerAnimatedTransitioning {
  private let isPresenting: Bool
  private let animation: RuneModalAnimation

  init(isPresenting: Bool, animation: RuneModalAnimation) {
    self.isPresenting = isPresenting
    self.animation = animation
    super.init()
  }

  func transitionDuration(
    using transitionContext: UIViewControllerContextTransitioning?
  ) -> TimeInterval {
    switch animation {
    case .fade:
      return 0.22
    case .slide:
      return 0.32
    case .zoom:
      return 0.26
    case .none:
      return 0
    }
  }

  func animateTransition(using transitionContext: UIViewControllerContextTransitioning) {
    let containerView = transitionContext.containerView

    let key: UITransitionContextViewKey = isPresenting ? .to : .from
    guard let animatingView = transitionContext.view(forKey: key) else {
      transitionContext.completeTransition(false)
      return
    }

    let modalController = (isPresenting
      ? transitionContext.viewController(forKey: .to)
      : transitionContext.viewController(forKey: .from)) as? RuneModalContentViewController

    let overlayView = modalController?.overlayView
    let contentView = modalController?.contentHost ?? animatingView
    let overlayAlpha = modalController?.resolvedOverlayOpacity ?? 0
    let usesViewFade = animation == .fade

    if isPresenting {
      guard let toViewController = transitionContext.viewController(forKey: .to) else {
        transitionContext.completeTransition(false)
        return
      }
      animatingView.frame = transitionContext.finalFrame(for: toViewController)
      containerView.addSubview(animatingView)
    }

    let duration = transitionDuration(using: transitionContext)
    let initialTransform: CGAffineTransform
    let finalTransform = CGAffineTransform.identity

    switch animation {
    case .slide:
      initialTransform = CGAffineTransform(
        translationX: 0,
        y: containerView.bounds.height
      )
    case .zoom:
      initialTransform = CGAffineTransform(scaleX: 0.92, y: 0.92)
    case .fade, .none:
      initialTransform = .identity
    }

    if isPresenting {
      if usesViewFade {
        animatingView.alpha = 0
        overlayView?.alpha = overlayAlpha
        contentView.alpha = 1
        contentView.transform = finalTransform
      } else {
        overlayView?.alpha = 0
        if animation == .zoom {
          contentView.alpha = 0
        }
        contentView.transform = initialTransform
      }
    }

    let animations = {
      if self.isPresenting {
        if usesViewFade {
          animatingView.alpha = 1
        } else {
          overlayView?.alpha = overlayAlpha
          contentView.alpha = 1
          contentView.transform = finalTransform
        }
      } else {
        if usesViewFade {
          animatingView.alpha = 0
        } else {
          overlayView?.alpha = 0
          switch self.animation {
          case .fade:
            contentView.alpha = 0
            contentView.transform = finalTransform
          case .slide:
            contentView.alpha = 1
            contentView.transform = initialTransform
          case .zoom:
            contentView.alpha = 0
            contentView.transform = initialTransform
          case .none:
            contentView.alpha = 1
            contentView.transform = finalTransform
          }
        }
      }
    }

    let completion: (Bool) -> Void = { finished in
      transitionContext.completeTransition(!transitionContext.transitionWasCancelled)
      if !self.isPresenting && finished {
        contentView.alpha = 1
        contentView.transform = finalTransform
        animatingView.alpha = 1
      }
    }

    if duration == 0 {
      animations()
      completion(true)
      return
    }

    let curve: UIView.AnimationOptions = isPresenting ? .curveEaseOut : .curveEaseIn
    UIView.animate(
      withDuration: duration,
      delay: 0,
      options: [curve, .beginFromCurrentState],
      animations: animations,
      completion: completion
    )
  }
}
