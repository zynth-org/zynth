import UIKit

@objcMembers
public final class RuneScreenContainerView: UIView {
  private var detachingScreens: [RuneScreenView] = []

  public override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  private func commonInit() {
    clipsToBounds = false
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    for view in subviews {
      view.frame = bounds
    }
  }

  public override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    guard let screen = subview as? RuneScreenView else { return }
    screen.container = self
    updateScreenVisibility()
  }

  public override func willRemoveSubview(_ subview: UIView) {
    super.willRemoveSubview(subview)
    guard let screen = subview as? RuneScreenView else { return }
    if screen.container === self {
      screen.container = nil
    }
    detachingScreens.removeAll { $0 === screen }
    updateScreenVisibility()
  }

  @objc(beginRemovalForScreen:)
  public func beginRemoval(for screen: RuneScreenView) -> Bool {
    guard let top = stackScreens().last, top === screen else {
      return false
    }
    if !detachingScreens.contains(where: { $0 === screen }) {
      detachingScreens.append(screen)
    }
    updateScreenVisibility()
    screen.startExitAnimationAndCleanup()
    return true
  }

  @objc public func finishRemoval(screen: RuneScreenView) {
    detachingScreens.removeAll { $0 === screen }
    updateScreenVisibility()
    guard screen.superview === self else { return }
    UIView.performWithoutAnimation {
      screen.removeFromSuperview()
    }
  }

  func previousScreen(for screen: RuneScreenView) -> RuneScreenView? {
    let stack = stackScreens()
    if let index = stack.firstIndex(where: { $0 === screen }) {
      if index > 0 {
        return stack[index - 1]
      }
      return nil
    }
    return stack.last
  }

  public func updateScreenVisibility() {
    let stack = stackScreens()
    let topActive = stack.last(where: { $0.isScreenActive })
    var modalBackgroundIndex: Int?
    if let top = topActive,
       top.animationType == .modal,
       let topIndex = stack.firstIndex(where: { $0 === top }) {
      modalBackgroundIndex = topIndex - 1
    }

    for (index, screen) in stack.enumerated() {
      var shouldBeVisible = false
      if screen === topActive {
        shouldBeVisible = true
      }
      if screen.isInTransition {
        shouldBeVisible = true
      }
      if index + 1 < stack.count {
        let screenAbove = stack[index + 1]
        if screenAbove.isInTransition {
          shouldBeVisible = true
        }
      }
      if let modalIndex = modalBackgroundIndex, modalIndex == index {
        shouldBeVisible = true
      }
      if !detachingScreens.isEmpty, screen === topActive {
        shouldBeVisible = true
      }
      screen.isHidden = !shouldBeVisible
      screen.layer.zPosition = CGFloat(index)
    }

    for (offset, screen) in detachingScreens.enumerated() {
      screen.isHidden = false
      screen.layer.zPosition = CGFloat(stack.count + offset + 100)
    }
  }

  private func stackScreens() -> [RuneScreenView] {
    return subviews.compactMap { $0 as? RuneScreenView }
      .filter { screen in
        !detachingScreens.contains(where: { $0 === screen })
      }
  }
}
