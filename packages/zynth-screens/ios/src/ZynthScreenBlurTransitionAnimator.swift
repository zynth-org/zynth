import UIKit

/// Handles the blur-style push/pop animation that backs the `animation: "sheet-blur"` option.
final class ZynthScreenBlurTransitionAnimator: NSObject, UIViewControllerAnimatedTransitioning {
  private let operation: UINavigationController.Operation
  private let duration: TimeInterval = 0.35

  init(operation: UINavigationController.Operation) {
    self.operation = operation
    super.init()
  }

  func transitionDuration(using transitionContext: UIViewControllerContextTransitioning?) -> TimeInterval {
    return duration
  }

  func animateTransition(using transitionContext: UIViewControllerContextTransitioning) {
    let containerView = transitionContext.containerView
    guard
      let fromViewController = transitionContext.viewController(forKey: .from),
      let toViewController = transitionContext.viewController(forKey: .to)
    else {
      transitionContext.completeTransition(!transitionContext.transitionWasCancelled)
      return
    }

    switch operation {
    case .push:
      performPushTransition(
        context: transitionContext,
        containerView: containerView,
        fromViewController: fromViewController,
        toViewController: toViewController
      )
    case .pop:
      performPopTransition(
        context: transitionContext,
        containerView: containerView,
        fromViewController: fromViewController,
        toViewController: toViewController
      )
    default:
      transitionContext.completeTransition(!transitionContext.transitionWasCancelled)
    }
  }

  private func performPushTransition(
    context: UIViewControllerContextTransitioning,
    containerView: UIView,
    fromViewController: UIViewController,
    toViewController: UIViewController
  ) {
    guard 
      let toView = context.view(forKey: .to) ?? toViewController.view,
      let fromView = context.view(forKey: .from) ?? fromViewController.view
    else {
      context.completeTransition(!context.transitionWasCancelled)
      return
    }

    let targetFrame = resolvedFinalFrame(for: toViewController, context: context, fallback: containerView.bounds)
    var startFrame = targetFrame
    startFrame.origin.x = containerView.bounds.width

    toView.frame = startFrame
    
    // Setup Blur on From View (simulate "leaving into blur")
    let fromBlurEffectView = UIVisualEffectView(effect: nil)
    fromBlurEffectView.frame = fromView.bounds
    fromBlurEffectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    fromBlurEffectView.alpha = 0
    fromView.addSubview(fromBlurEffectView)
    
    // Setup Blur on To View (simulate "arriving from blur")
    // Note: Since toView is coming from offscreen (right), we can just set its clear.
    // But the requirement is "new one comes from the right with a blur".
    // So we need a blur view on toView that starts opaque and fades out.
    let toBlurEffectView = UIVisualEffectView(effect: UIBlurEffect(style: .light))
    toBlurEffectView.frame = toView.bounds
    toBlurEffectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    toBlurEffectView.alpha = 1
    toView.addSubview(toBlurEffectView)

    containerView.addSubview(toView)

    UIView.animate(
      withDuration: duration,
      delay: 0,
      usingSpringWithDamping: 1.0,
      initialSpringVelocity: 1.0,
      options: [.curveEaseOut, .allowUserInteraction]
    ) {
      toView.frame = targetFrame
      
      // Move fromView to left (-30%)
      fromView.frame.origin.x = -containerView.bounds.width * 0.3
      
      // Animate Blurs
      fromBlurEffectView.effect = UIBlurEffect(style: .light)
      fromBlurEffectView.alpha = 1
      
      toBlurEffectView.effect = nil // reducing effect might not animate smoothly, alpha is better
      toBlurEffectView.alpha = 0
      
    } completion: { _ in
      let cancelled = context.transitionWasCancelled
      
      fromBlurEffectView.removeFromSuperview()
      toBlurEffectView.removeFromSuperview()
      
      if cancelled {
        toView.removeFromSuperview()
        fromView.frame.origin.x = 0
      }
      context.completeTransition(!cancelled)
    }
  }

  private func performPopTransition(
    context: UIViewControllerContextTransitioning,
    containerView: UIView,
    fromViewController: UIViewController,
    toViewController: UIViewController
  ) {
    guard
      let fromView = context.view(forKey: .from) ?? fromViewController.view,
      let toView = context.view(forKey: .to) ?? toViewController.view
    else {
      context.completeTransition(!context.transitionWasCancelled)
      return
    }

    let startFrame = resolvedInitialFrame(for: fromViewController, context: context, fallback: fromView.frame)
    var targetFrame = startFrame
    targetFrame.origin.x = containerView.bounds.width

    let toTargetFrame = resolvedFinalFrame(for: toViewController, context: context, fallback: containerView.bounds)
    var toStartFrame = toTargetFrame
    toStartFrame.origin.x = -containerView.bounds.width * 0.3
    toView.frame = toStartFrame
    
    // Setup Blur on From View (simulate "leaving to right with blur")
    let fromBlurEffectView = UIVisualEffectView(effect: nil)
    fromBlurEffectView.frame = fromView.bounds
    fromBlurEffectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    fromBlurEffectView.alpha = 0
    fromView.addSubview(fromBlurEffectView)
    
    // Setup Blur on To View (simulate "arriving from left with blur")
    // It should start blurred and fade out
    let toBlurEffectView = UIVisualEffectView(effect: UIBlurEffect(style: .light))
    toBlurEffectView.frame = toView.bounds
    toBlurEffectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    toBlurEffectView.alpha = 1
    toView.addSubview(toBlurEffectView)

    containerView.insertSubview(toView, belowSubview: fromView)

    UIView.animate(
      withDuration: duration,
      delay: 0,
      options: [.curveEaseInOut, .allowUserInteraction]
    ) {
      fromView.frame = targetFrame
      toView.frame = toTargetFrame
      
      // Animate Blurs
      fromBlurEffectView.effect = UIBlurEffect(style: .light)
      fromBlurEffectView.alpha = 1
      
      toBlurEffectView.effect = nil
      toBlurEffectView.alpha = 0
      
    } completion: { _ in
      let cancelled = context.transitionWasCancelled
      
      fromBlurEffectView.removeFromSuperview()
      toBlurEffectView.removeFromSuperview()
      
      if cancelled {
        fromView.frame = startFrame
        toView.removeFromSuperview()
      }
      context.completeTransition(!cancelled)
    }
  }

  private func resolvedFinalFrame(
    for viewController: UIViewController,
    context: UIViewControllerContextTransitioning,
    fallback: CGRect
  ) -> CGRect {
    let frame = context.finalFrame(for: viewController)
    return frame == .zero ? fallback : frame
  }

  private func resolvedInitialFrame(
    for viewController: UIViewController,
    context: UIViewControllerContextTransitioning,
    fallback: CGRect
  ) -> CGRect {
    let frame = context.initialFrame(for: viewController)
    return frame == .zero ? fallback : frame
  }
}
