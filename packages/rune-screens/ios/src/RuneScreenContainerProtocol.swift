import Foundation

@objc protocol RuneScreenContainer: AnyObject {
  func screenDidAttach(_ screen: RuneScreenView)
  func screenDidChangeActiveState(_ screen: RuneScreenView)
  func screenHeaderOptionsDidChange(_ screen: RuneScreenView)
  func screenAnimationDidChange(_ screen: RuneScreenView)
  func refreshInteractiveGestureState()
}
