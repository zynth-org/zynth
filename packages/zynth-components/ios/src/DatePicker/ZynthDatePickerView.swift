import Combine
import ZynthKit
import SwiftUI
import UIKit

@objcMembers
public final class ZynthDatePickerView: UIView {
  private weak var manager: SNUIManager?
  private weak var node: SNNode?
  private weak var activeController: ZynthDatePickerModalController?

  private var mode: String = "date"
  private var selection: Date?
  private var rangeStart: Date?
  private var rangeEnd: Date?
  private var titleText: String?
  private var confirmText: String?
  private var cancelText: String?

  private let overlayButton = UIButton(type: .custom)

  public override init(frame: CGRect) {
    super.init(frame: frame)
    setupOverlay()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupOverlay()
  }

  private func setupOverlay() {
    overlayButton.backgroundColor = .clear
    overlayButton.addTarget(self, action: #selector(handleTap), for: .touchUpInside)
    addSubview(overlayButton)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    overlayButton.frame = bounds
    bringSubviewToFront(overlayButton)
  }

  public override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    bringSubviewToFront(overlayButton)
  }

  public func bind(manager: SNUIManager, node: SNNode) {
    self.manager = manager
    self.node = node
  }

  public func reset() {
    dismiss()
    manager = nil
    node = nil
    mode = "date"
    selection = nil
    rangeStart = nil
    rangeEnd = nil
    titleText = nil
    confirmText = nil
    cancelText = nil
  }

  public func setMode(_ value: String?) {
    mode = value ?? "date"
  }

  public func setSelection(_ value: NSNumber?) {
    guard let value else {
      selection = nil
      return
    }
    selection = Date(timeIntervalSince1970: value.doubleValue / 1000.0)
  }

  public func setRangeSelection(start: NSNumber?, end: NSNumber?) {
    if let start {
      rangeStart = Date(timeIntervalSince1970: start.doubleValue / 1000.0)
    } else {
      rangeStart = nil
    }
    if let end {
      rangeEnd = Date(timeIntervalSince1970: end.doubleValue / 1000.0)
    } else {
      rangeEnd = nil
    }
  }

  public func setTitleText(_ value: String?) {
    titleText = value
  }

  public func setConfirmText(_ value: String?) {
    confirmText = value
  }

  public func setCancelText(_ value: String?) {
    cancelText = value
  }

  public func show() {
    guard activeController == nil else { return }
    guard let presenter = findViewController() else { return }

    let controller = ZynthDatePickerModalController(
      mode: mode,
      titleText: titleText,
      confirmText: confirmText,
      cancelText: cancelText,
      selection: selection,
      rangeStart: rangeStart,
      rangeEnd: rangeEnd
    )

    controller.onConfirmDate = { [weak self] date in
      guard let self else { return }
      let normalized = self.mode.lowercased() == "year"
        ? self.normalizeToYearStart(date)
        : date
      self.selection = normalized
      self.dispatchEvent(
        "onChange",
        payload: ["value": NSNumber(value: normalized.timeIntervalSince1970 * 1000.0)]
      )
    }

    controller.onConfirmRange = { [weak self] start, end in
      guard let self else { return }
      self.rangeStart = start
      self.rangeEnd = end
      self.dispatchEvent(
        "onRangeChange",
        payload: [
          "start": start.map { NSNumber(value: $0.timeIntervalSince1970 * 1000.0) } ?? NSNull(),
          "end": end.map { NSNumber(value: $0.timeIntervalSince1970 * 1000.0) } ?? NSNull(),
        ]
      )
    }

    controller.onCancel = { [weak self] in
      self?.dispatchEvent("onCancel", payload: [:])
    }

    controller.onDismiss = { [weak self] in
      self?.activeController = nil
      self?.dispatchEvent("onDismiss", payload: [:])
    }

    activeController = controller
    presenter.present(controller, animated: true)
  }

  public func dismiss() {
    activeController?.dismiss(animated: true)
    activeController = nil
  }

  @objc private func handleTap() {
    show()
  }

  private func normalizeToYearStart(_ date: Date) -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
    let year = calendar.component(.year, from: date)
    var components = DateComponents()
    components.calendar = calendar
    components.timeZone = calendar.timeZone
    components.year = year
    components.month = 1
    components.day = 1
    return calendar.date(from: components) ?? date
  }

  private func dispatchEvent(_ name: String, payload: [AnyHashable: Any]?) {
    guard let manager = manager, let node = node else { return }
    let selector = NSSelectorFromString("zynth_dispatchEvent:payload:toNode:")
    guard let method = manager.method(for: selector) else { return }
    typealias Imp = @convention(c) (AnyObject, Selector, NSString, NSDictionary?, SNNode) -> Void
    let function = unsafeBitCast(method, to: Imp.self)
    function(manager, selector, name as NSString, payload as NSDictionary?, node)
  }

  private func findViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let nextResponder = responder?.next {
      if let viewController = nextResponder as? UIViewController {
        return viewController
      }
      responder = nextResponder
    }

    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
       let window = windowScene.windows.first(where: { $0.isKeyWindow }) {
      return window.rootViewController?.presentedViewController ?? window.rootViewController
    }

    return nil
  }
}

private final class ZynthDatePickerModalController: UIViewController, UIAdaptivePresentationControllerDelegate {
  let mode: String
  let titleText: String?
  let confirmText: String?
  let cancelText: String?
  let selection: Date?
  let rangeStart: Date?
  let rangeEnd: Date?

  var onConfirmDate: ((Date) -> Void)?
  var onConfirmRange: ((Date?, Date?) -> Void)?
  var onCancel: (() -> Void)?
  var onDismiss: (() -> Void)?

  private var datePicker: UIDatePicker?
  private var startPicker: UIDatePicker?
  private var endPicker: UIDatePicker?
  private var rangeState: RangePickerState?
  private var rangeHostingController: UIViewController?
  private var didDismiss = false

  init(
    mode: String,
    titleText: String?,
    confirmText: String?,
    cancelText: String?,
    selection: Date?,
    rangeStart: Date?,
    rangeEnd: Date?
  ) {
    self.mode = mode.lowercased()
    self.titleText = titleText
    self.confirmText = confirmText
    self.cancelText = cancelText
    self.selection = selection
    self.rangeStart = rangeStart
    self.rangeEnd = rangeEnd
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .pageSheet
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 16
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)

    if let titleText, !titleText.isEmpty {
      let label = UILabel()
      label.text = titleText
      label.font = UIFont.preferredFont(forTextStyle: .headline)
      label.textAlignment = .center
      stack.addArrangedSubview(label)
    }

    if mode == "range" {
      if #available(iOS 16.0, *) {
        let state = RangePickerState(start: rangeStart, end: rangeEnd)
        let hosting = UIHostingController(rootView: DateRangePickerView(state: state))
        hosting.view.backgroundColor = .clear
        addChild(hosting)
        stack.addArrangedSubview(hosting.view)
        hosting.didMove(toParent: self)
        rangeState = state
        rangeHostingController = hosting
      } else {
        let startLabel = UILabel()
        startLabel.text = "Start"
        startLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
        stack.addArrangedSubview(startLabel)

        let startPicker = makeDatePicker(style: .wheels)
        if let rangeStart { startPicker.date = rangeStart }
        stack.addArrangedSubview(startPicker)
        self.startPicker = startPicker

        let endLabel = UILabel()
        endLabel.text = "End"
        endLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
        stack.addArrangedSubview(endLabel)

        let endPicker = makeDatePicker(style: .wheels)
        if let rangeEnd { endPicker.date = rangeEnd }
        stack.addArrangedSubview(endPicker)
        self.endPicker = endPicker
      }
    } else {
      let picker = makeDatePicker(style: .inline)
      if let selection { picker.date = selection }
      stack.addArrangedSubview(picker)
      self.datePicker = picker
    }

    let buttons = UIStackView()
    buttons.axis = .horizontal
    buttons.distribution = .fillEqually
    buttons.spacing = 12

    let cancelButton = UIButton(type: .system)
    cancelButton.setTitle(cancelText ?? "Cancel", for: .normal)
    cancelButton.addTarget(self, action: #selector(handleCancel), for: .touchUpInside)
    buttons.addArrangedSubview(cancelButton)

    let confirmButton = UIButton(type: .system)
    confirmButton.setTitle(confirmText ?? "OK", for: .normal)
    confirmButton.addTarget(self, action: #selector(handleConfirm), for: .touchUpInside)
    buttons.addArrangedSubview(confirmButton)

    stack.addArrangedSubview(buttons)

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      stack.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
    ])
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    presentationController?.delegate = self
    updatePreferredContentSize()
    configureSheetSizingIfNeeded()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    updatePreferredContentSize()
  }

  @objc private func handleConfirm() {
    if mode == "range" {
      if #available(iOS 16.0, *), let rangeState {
        let range = rangeState.resolveRange()
        onConfirmRange?(range.start, range.end)
      } else {
        onConfirmRange?(startPicker?.date, endPicker?.date)
      }
    } else if let date = datePicker?.date {
      onConfirmDate?(date)
    }
    dismiss(animated: true)
  }

  @objc private func handleCancel() {
    onCancel?()
    dismiss(animated: true)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    if didDismiss { return }
    didDismiss = true
    onDismiss?()
  }

  private func updatePreferredContentSize() {
    let targetWidth = view.bounds.width > 0 ? view.bounds.width : UIScreen.main.bounds.width
    let fittingSize = CGSize(width: targetWidth, height: UIView.layoutFittingCompressedSize.height)
    let size = view.systemLayoutSizeFitting(
      fittingSize,
      withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel
    )
    if size.height.isFinite && size.height > 0 {
      preferredContentSize = CGSize(width: targetWidth, height: size.height)
    }
  }

  private func configureSheetSizingIfNeeded() {
    guard let sheet = presentationController as? UISheetPresentationController else { return }
    if #available(iOS 16.0, *) {
      updatePreferredContentSize()
      sheet.detents = [
        .custom { [weak self] _ in
          guard let self else { return 320 }
          return max(240, self.preferredContentSize.height)
        }
      ]
      sheet.largestUndimmedDetentIdentifier = sheet.detents.first?.identifier
      sheet.selectedDetentIdentifier = sheet.detents.first?.identifier
      sheet.prefersScrollingExpandsWhenScrolledToEdge = false
    }
    sheet.prefersGrabberVisible = true
  }

  private func makeDatePicker(style: UIDatePickerStyle) -> UIDatePicker {
    let picker = UIDatePicker()
    picker.datePickerMode = .date
    picker.timeZone = TimeZone(secondsFromGMT: 0)
    if #available(iOS 14.0, *) {
      picker.preferredDatePickerStyle = style
    }
    return picker
  }
}

private final class RangePickerState: ObservableObject {
  @Published var startDate: Date?
  @Published var endDate: Date?
  let calendar: Calendar

  init(start: Date?, end: Date?) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
    self.calendar = calendar
    startDate = start
    endDate = end
  }

  func resolveRange() -> (start: Date?, end: Date?) {
    return (startDate, endDate)
  }

  @available(iOS 16.0, *)
  func selectionBinding() -> Binding<Set<DateComponents>> {
    Binding {
      DateRangeHelper.getDatesInRange(
        startDate: self.startDate,
        endDate: self.endDate,
        calendar: self.calendar
      )
    } set: { newValue in
      DateRangeHelper.setDateRangeFromSelection(
        newValue: newValue,
        calendar: self.calendar,
        startDate: &self.startDate,
        endDate: &self.endDate
      )
    }
  }
}

@available(iOS 16.0, *)
private struct DateRangePickerView: View {
  @ObservedObject var state: RangePickerState

  var body: some View {
    MultiDatePicker("", selection: state.selectionBinding())
      .environment(\.calendar, state.calendar)
      .environment(\.timeZone, state.calendar.timeZone)
      .labelsHidden()
  }
}

private enum DateRangeHelper {
  static func getDatesInRange(
    startDate: Date?,
    endDate: Date?,
    calendar: Calendar
  ) -> Set<DateComponents> {
    var dates: Set<DateComponents> = []
    if let endDate, let startDate {
      var currentDate = startDate
      while currentDate <= endDate {
        let components = calendar.dateComponents([.year, .month, .day], from: currentDate)
        dates.insert(components)
        currentDate = calendar.date(byAdding: .day, value: 1, to: currentDate) ?? currentDate
      }
    } else if let startDate {
      let components = calendar.dateComponents([.year, .month, .day], from: startDate)
      dates.insert(components)
    }
    return dates
  }

  static func setDateRangeFromSelection(
    newValue: Set<DateComponents>,
    calendar: Calendar,
    startDate: inout Date?,
    endDate: inout Date?
  ) {
    let sortedDates = newValue.compactMap { calendar.date(from: $0) }.sorted()

    if startDate == nil {
      startDate = sortedDates.first
      endDate = nil
    } else if endDate == nil {
      startDate = sortedDates.first
      endDate = sortedDates.last
    } else {
      if let newLast = sortedDates.last, let currentEnd = endDate {
        if newLast > currentEnd {
          startDate = newLast
          endDate = nil
        } else if let newFirst = sortedDates.first, let currentStart = startDate {
          if newFirst < currentStart {
            startDate = newFirst
            endDate = nil
          } else {
            startDate = nil
          }
        }
      }
    }
  }
}
