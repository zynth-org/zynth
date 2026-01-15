import Foundation

@objc protocol ZynthScreenContainer: AnyObject {
  func screenDidAttach(_ screen: ZynthScreenView)
  func screenDidChangeActiveState(_ screen: ZynthScreenView)
  func screenHeaderOptionsDidChange(_ screen: ZynthScreenView)
  func screenAnimationDidChange(_ screen: ZynthScreenView)
  func refreshInteractiveGestureState()
}
