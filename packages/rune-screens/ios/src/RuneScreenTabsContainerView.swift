import UIKit

@objcMembers
public final class RuneScreenTabsContainerView: UIView {
  @objc public private(set) var selectedIndex: Int = 0
  @objc public private(set) var tabAnimation: RuneScreenAnimation = .none

  public override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  private func commonInit() {
    clipsToBounds = true
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    for view in subviews {
      view.frame = bounds
    }
  }

  public override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    subview.frame = bounds
    subview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    updateTabVisibility()
  }

  public override func willRemoveSubview(_ subview: UIView) {
    super.willRemoveSubview(subview)
    DispatchQueue.main.async { [weak self] in
      self?.clampSelectedIndex()
      self?.updateTabVisibility()
    }
  }

  public func setSelectedIndexValue(_ value: NSNumber?) {
    let proposed = value?.intValue ?? 0
    selectedIndex = max(0, proposed)
    updateTabVisibility()
  }

  public func setTabAnimationType(_ value: NSString?) {
    tabAnimation = RuneScreenAnimation(string: value as String?)
  }

  private func clampSelectedIndex() {
    if subviews.isEmpty {
      selectedIndex = 0
      return
    }
    selectedIndex = max(0, min(selectedIndex, subviews.count - 1))
  }

  private func updateTabVisibility() {
    clampSelectedIndex()
    guard !subviews.isEmpty else { return }
    for (index, child) in subviews.enumerated() {
      let isVisible = index == selectedIndex
      if isVisible {
        if child.isHidden {
          child.alpha = 0
          child.isHidden = false
          child.layer.zPosition = 10
          UIView.animate(withDuration: 0.12) {
            child.alpha = 1
          }
        } else {
          child.layer.zPosition = 10
          child.alpha = 1
        }
      } else {
        if !child.isHidden {
          child.isHidden = true
          child.layer.zPosition = 0
          child.alpha = 1
        }
      }
    }
    setNeedsLayout()
  }
}
