import SwiftUI
import UIKit

@objc(ZynthGlassEffectHostingView)
class ZynthGlassEffectHostingView: UIView {
    @objc var cornerRadius: CGFloat = 0 { didSet { updateView() } }
    @objc var cornerStyle: String = "continuous" { didSet { updateView() } }
    @objc var glassType: String = "regular" { didSet { updateView() } }
    @objc var interactive: Bool = true { didSet { updateView() } }
    @objc var glassTintColor: UIColor? { didSet { updateView() } }

    private var hostingController: UIHostingController<AnyView>?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isUserInteractionEnabled = false
        updateView()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .clear
        isUserInteractionEnabled = false
        updateView()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        hostingController?.view.frame = bounds
    }

    private func updateView() {
        let rootView: AnyView
        if #available(iOS 26.0, *) {
            rootView = AnyView(
                ZynthGlassEffectView(
                    cornerRadius: cornerRadius,
                    cornerStyle: cornerStyle,
                    glassType: glassType,
                    interactive: interactive,
                    tintColor: glassTintColor
                )
            )
        } else {
            rootView = AnyView(EmptyView())
        }

        if let hostingController {
            hostingController.rootView = rootView
        } else {
            let controller = UIHostingController(rootView: rootView)
            controller.view.backgroundColor = .clear
            controller.view.frame = bounds
            controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            addSubview(controller.view)
            hostingController = controller
        }
    }
}

@available(iOS 26.0, *)
private struct ZynthGlassEffectView: View {
    let cornerRadius: CGFloat
    let cornerStyle: String
    let glassType: String
    let interactive: Bool
    let tintColor: UIColor?

    var body: some View {
        let style = cornerStyle.lowercased() == "circular"
            ? RoundedCornerStyle.circular
            : RoundedCornerStyle.continuous
        RoundedRectangle(cornerRadius: cornerRadius, style: style)
            .fill(Color.clear)
            .glassEffect(
                makeGlass(),
                in: .rect(cornerRadius: cornerRadius, style: style)
            )
    }

    private func makeGlass() -> Glass {
        var glass: Glass
        switch glassType.lowercased() {
        case "clear":
            glass = .clear
        case "identity":
            glass = .identity
        case "regular":
            glass = .regular
        default:
            glass = .regular
        }
        if let tintColor {
            glass = glass.tint(Color(uiColor: tintColor))
        }
        if interactive {
            return glass.interactive()
        }
        return glass
    }
}
