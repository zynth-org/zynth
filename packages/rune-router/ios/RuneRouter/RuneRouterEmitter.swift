import Foundation
import RuneKit

enum RuneRouterEvent: String {
  case stateChanged = "rune.router.stateChanged"
  case transitionStart = "rune.router.transitionStart"
  case transitionEnd = "rune.router.transitionEnd"
  case transitionProgress = "rune.router.transitionProgress"
  case focus = "rune.router.focus"
  case blur = "rune.router.blur"
  case back = "rune.router.back"
  case predictiveBack = "rune.router.predictiveBack"
  case beforeRemove = "rune.router.beforeRemove"
  case tabSelected = "rune.router.tabSelected"
}

final class RuneRouterEmitter {
  private weak var runtime: RuneRuntime?

  init(runtime: RuneRuntime) {
    self.runtime = runtime
  }

  func emitState(_ state: [String: Any]) {
    emit(.stateChanged, payload: ["state": state])
  }

  func emitTransitionStart(key: String, progress: Double = 0) {
    emit(.transitionStart, payload: ["key": key, "progress": progress])
  }

  func emitTransitionEnd(key: String, finished: Bool) {
    emit(.transitionEnd, payload: ["key": key, "finished": finished])
  }

  func emitTransitionProgress(key: String, progress: Double) {
    emit(.transitionProgress, payload: ["key": key, "progress": progress])
  }

  func emitFocus(key: String) {
    emit(.focus, payload: ["key": key])
  }

  func emitBlur(key: String) {
    emit(.blur, payload: ["key": key])
  }

  func emitPredictiveBack(key: String, progress: Double, velocity: Double?) {
    var payload: [String: Any] = ["key": key, "progress": progress]
    if let velocity {
      payload["velocity"] = velocity
    }
    emit(.predictiveBack, payload: payload)
  }

  func emitBeforeRemove(action: [String: Any], key: String, requestId: String) {
    emit(
      .beforeRemove,
      payload: [
        "key": key,
        "action": action,
        "requestId": requestId,
      ]
    )
  }

  func emitTabSelection(navigatorId: String, tabName: String) {
    emit(
      .tabSelected,
      payload: [
        "navigatorId": navigatorId,
        "tabName": tabName,
      ]
    )
  }

  private func emit(_ event: RuneRouterEvent, payload: [String: Any]) {
    #if DEBUG
      print("[RuneRouterEmitter] emit \(event.rawValue) payload=\(payload)")
    #endif
    runtime?.emitEvent(name: event.rawValue, payload: payload)
  }
}
