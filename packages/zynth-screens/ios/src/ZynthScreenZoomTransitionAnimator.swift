import UIKit

/// Fallback zoom animation for iOS versions that don't support the native zoom transition.
final class ZynthScreenZoomTransitionAnimator: NSObject, UIViewControllerAnimatedTransitioning {
  private let operation: UINavigationController.Operation
  private let duration: TimeInterval = 0.32
  private let startScale: CGFloat = 0.85
  private let cornerRadius: CGFloat = 18

  init(operation: UINavigationController.Operation) {
    self.operation = operation
    super.init()
  }

  func transitionDuration(using transitionContext: UIViewControllerContextTransitioning?) -> TimeInterval {
    return duration
  }

  func animateTransition(using transitionContext: UIViewControllerContextTransitioning) {
    guard
      let fromView = transitionContext.view(forKey: .from),
      let toView = transitionContext.view(forKey: .to)
    else {
      transitionContext.completeTransition(false)
      return
    }

    let container = transitionContext.containerView
    let isPush = operation == .push

    if isPush {
      toView.frame = container.bounds
      toView.transform = CGAffineTransform(scaleX: startScale, y: startScale)
      toView.alpha = 0
      toView.layer.cornerRadius = cornerRadius
      toView.layer.masksToBounds = true
      if #available(iOS 13.0, *) {
        toView.layer.cornerCurve = .continuous
      }
      container.addSubview(toView)
    } else {
      toView.frame = container.bounds
      container.insertSubview(toView, belowSubview: fromView)
      toView.transform = .identity
      toView.alpha = 1
    }

    UIView.animate(
      withDuration: duration,
      delay: 0,
      options: [.curveEaseInOut, .allowUserInteraction]
    ) {
      if isPush {
        toView.layer.cornerRadius = 0
        toView.transform = .identity
        toView.alpha = 1
      } else {
        fromView.layer.cornerRadius = self.cornerRadius
        fromView.transform = CGAffineTransform(scaleX: self.startScale, y: self.startScale)
        fromView.alpha = 0
      }
    } completion: { _ in
      let cancelled = transitionContext.transitionWasCancelled
      if cancelled && isPush {
        toView.removeFromSuperview()
      }
      toView.layer.masksToBounds = false
      fromView.layer.cornerRadius = 0
      fromView.transform = .identity
      transitionContext.completeTransition(!cancelled)
    }
  }
}
