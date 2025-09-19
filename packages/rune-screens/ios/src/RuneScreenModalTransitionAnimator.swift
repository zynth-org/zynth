import UIKit

/// Handles the sheet-style push/pop animation that backs the `presentation: "modal"` option.
final class RuneScreenModalTransitionAnimator: NSObject, UIViewControllerAnimatedTransitioning {
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
    toViewController: UIViewController
  ) {
    guard let toView = context.view(forKey: .to) ?? toViewController.view else {
      context.completeTransition(!context.transitionWasCancelled)
      return
    }

    let targetFrame = resolvedFinalFrame(for: toViewController, context: context, fallback: containerView.bounds)
    var startFrame = targetFrame
    startFrame.origin.y = containerView.bounds.height

    toView.frame = startFrame
    containerView.addSubview(toView)

    UIView.animate(
      withDuration: duration,
      delay: 0,
      usingSpringWithDamping: 0.92,
      initialSpringVelocity: 0.85,
      options: [.curveEaseOut, .allowUserInteraction]
    ) {
      toView.frame = targetFrame
    } completion: { _ in
      let cancelled = context.transitionWasCancelled
      if cancelled {
        toView.removeFromSuperview()
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
    targetFrame.origin.y = containerView.bounds.height

    let toTargetFrame = resolvedFinalFrame(for: toViewController, context: context, fallback: containerView.bounds)
    toView.frame = toTargetFrame
    containerView.insertSubview(toView, belowSubview: fromView)

    UIView.animate(
      withDuration: duration,
      delay: 0,
      options: [.curveEaseInOut, .allowUserInteraction]
    ) {
      fromView.frame = targetFrame
    } completion: { _ in
      let cancelled = context.transitionWasCancelled
      if cancelled {
        fromView.frame = startFrame
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
