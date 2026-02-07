import Foundation
import WebKit
import ZynthKit

@objc(ZynthWebViewView)
@objcMembers
public final class ZynthWebViewView: UIView, WKNavigationDelegate, WKScriptMessageHandler {
  private weak var manager: ZynthUIManager?
  private weak var node: ZynthNode?

  private var webView: WKWebView!
  private var source: NSDictionary?
  private var loading = false
  private var pageTitle: String?
  private var lastCommandId: Int = -1
  private var javaScriptEnabled: Bool = true

  override public init(frame: CGRect) {
    super.init(frame: frame)
    setupWebView()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupWebView()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    webView.frame = bounds
  }

  deinit {
    cleanup()
  }

  func bindWithManager(_ manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
    print("[ZynthWebView] bind manager+node id=\(node.nid)")
  }

  func setSourceDictionary(_ source: NSDictionary) {
    print("[ZynthWebView] setSourceDictionary keys=\(source.allKeys)")
    if let current = self.source, current.isEqual(to: source as? [AnyHashable: Any] ?? [:]) {
      print("[ZynthWebView] source unchanged, skipping load")
      return
    }

    self.source = source
    loadSource(source)
  }

  func setJavaScriptEnabledValue(_ enabled: Bool) {
    javaScriptEnabled = enabled
    print("[ZynthWebView] setJavaScriptEnabledValue enabled=\(enabled)")
    applyJavaScriptEnabled(to: webView.configuration)
  }

  func setUserAgentValue(_ userAgent: String?) {
    print("[ZynthWebView] setUserAgentValue userAgent=\(userAgent ?? "(nil)")")
    webView.customUserAgent = userAgent
  }

  func handleCommand(_ command: NSDictionary) {
    print("[ZynthWebView] handleCommand raw=\(command)")
    guard let commandId = command["id"] as? NSNumber,
          let type = command["type"] as? String else {
      print("[ZynthWebView] handleCommand ignored: missing id/type")
      return
    }

    let id = commandId.intValue
    if id <= lastCommandId {
      print("[ZynthWebView] handleCommand ignored stale id=\(id) last=\(lastCommandId)")
      return
    }
    lastCommandId = id

    let payload = command["payload"] as? String
    executeCommand(type: type, payload: payload)
  }

  func cleanup() {
    print("[ZynthWebView] cleanup")
    webView?.navigationDelegate = nil
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "zynthWebView")
    webView?.stopLoading()
  }

  public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "zynthWebView" else { return }

    let data: String
    if let stringData = message.body as? String {
      data = stringData
    } else {
      data = "\(message.body)"
    }

    emit("onMessage", payload: [
      "data": data,
      "url": webView.url?.absoluteString ?? ""
    ])
    print("[ZynthWebView] didReceive message from page data=\(data)")
  }

  public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    loading = true
    print("[ZynthWebView] didStartProvisionalNavigation url=\(webView.url?.absoluteString ?? "(nil)")")
    let payload = navigationPayload(loading: true)
    emit("onLoadStart", payload: payload)
    emit("onNavigationStateChange", payload: payload)
  }

  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loading = false
    pageTitle = webView.title
    print("[ZynthWebView] didFinish url=\(webView.url?.absoluteString ?? "(nil)") title=\(webView.title ?? "(nil)")")
    injectMessagingBridge()
    let payload = navigationPayload(loading: false)
    emit("onLoad", payload: payload)
    emit("onLoadEnd", payload: payload)
    emit("onNavigationStateChange", payload: payload)
  }

  public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    print("[ZynthWebView] didFail navigation error=\((error as NSError).localizedDescription)")
    reportError(error)
  }

  public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    print("[ZynthWebView] didFailProvisionalNavigation error=\((error as NSError).localizedDescription)")
    reportError(error)
  }

  private func setupWebView() {
    let contentController = WKUserContentController()
    contentController.add(self, name: "zynthWebView")
    contentController.addUserScript(WKUserScript(source: messagingBridgeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: false))

    let configuration = WKWebViewConfiguration()
    configuration.userContentController = contentController
    applyJavaScriptEnabled(to: configuration)

    let webView = WKWebView(frame: bounds, configuration: configuration)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.navigationDelegate = self
    addSubview(webView)

    self.webView = webView
    print("[ZynthWebView] setupWebView complete")
  }

  private func loadSource(_ source: NSDictionary) {
    print("[ZynthWebView] loadSource source=\(source)")
    if let uri = source["uri"] as? String,
       let url = URL(string: uri) {
      print("[ZynthWebView] loadSource uri=\(uri)")
      var request = URLRequest(url: url)

      if let headers = source["headers"] as? [String: String] {
        for (key, value) in headers {
          request.setValue(value, forHTTPHeaderField: key)
        }
      }

      webView.load(request)
      return
    }

    if let html = source["html"] as? String {
      print("[ZynthWebView] loadSource htmlLength=\(html.count)")
      let baseURL: URL?
      if let baseURLString = source["baseUrl"] as? String {
        baseURL = URL(string: baseURLString)
      } else {
        baseURL = nil
      }
      print("[ZynthWebView] loadSource baseURL=\(baseURL?.absoluteString ?? "(nil)")")
      webView.loadHTMLString(html, baseURL: baseURL)
      return
    }

    print("[ZynthWebView] loadSource ignored: no uri/html key")
  }

  private func executeCommand(type: String, payload: String?) {
    print("[ZynthWebView] executeCommand type=\(type) payloadLength=\(payload?.count ?? 0)")
    switch type {
    case "reload":
      if let source = source {
        print("[ZynthWebView] reload using cached source")
        loadSource(source)
      } else {
        print("[ZynthWebView] reload via webView.reload() fallback")
        webView.reload()
      }
    case "goBack":
      if webView.canGoBack {
        webView.goBack()
      }
    case "goForward":
      if webView.canGoForward {
        webView.goForward()
      }
    case "stopLoading":
      webView.stopLoading()
    case "injectJavaScript":
      guard let script = payload else { return }
      webView.evaluateJavaScript(script) { _, error in
        if let error = error {
          print("[ZynthWebView] injectJavaScript error=\(error.localizedDescription)")
        } else {
          print("[ZynthWebView] injectJavaScript success")
        }
      }
    case "postMessage":
      guard let message = payload,
            let data = try? JSONSerialization.data(withJSONObject: ["value": message], options: []),
            let json = String(data: data, encoding: .utf8) else {
        return
      }
      let script = "(function(){var __z = \(json);var __d = __z.value;var __evt;try{__evt=new MessageEvent('message',{data:__d});}catch(e){__evt=document.createEvent('MessageEvent');__evt.initMessageEvent('message',true,true,__d,'','','',null);}if(typeof window.onmessage==='function'){try{window.onmessage(__evt);}catch(_){}}if(typeof document.onmessage==='function'){try{document.onmessage(__evt);}catch(_){}}try{window.dispatchEvent(__evt);}catch(_){}try{document.dispatchEvent(__evt);}catch(_){};})();"
      webView.evaluateJavaScript(script) { _, error in
        if let error = error {
          print("[ZynthWebView] postMessage->page eval error=\(error.localizedDescription)")
        } else {
          print("[ZynthWebView] postMessage->page eval success")
        }
      }
    default:
      print("[ZynthWebView] executeCommand unknown type=\(type)")
      break
    }
  }

  private func reportError(_ error: Error) {
    loading = false
    let nsError = error as NSError
    var payload = navigationPayload(loading: false)
    payload["code"] = nsError.code
    payload["domain"] = nsError.domain
    payload["description"] = nsError.localizedDescription

    emit("onError", payload: payload)
    emit("onLoadEnd", payload: payload)
    emit("onNavigationStateChange", payload: navigationPayload(loading: false))
    print("[ZynthWebView] reportError domain=\(nsError.domain) code=\(nsError.code) desc=\(nsError.localizedDescription)")
  }

  private func navigationPayload(loading: Bool) -> [String: Any] {
    return [
      "url": webView.url?.absoluteString ?? "",
      "title": pageTitle ?? webView.title ?? "",
      "loading": loading,
      "canGoBack": webView.canGoBack,
      "canGoForward": webView.canGoForward
    ]
  }

  private func emit(_ name: String, payload: [String: Any]) {
    guard let manager = manager,
          let node = node else {
      return
    }

    manager.zynth_dispatchEvent(name, payload: payload as [AnyHashable: Any], to: node)
    print("[ZynthWebView] emit event=\(name) payload=\(payload)")
  }

  private func injectMessagingBridge() {
    webView.evaluateJavaScript(messagingBridgeScript()) { _, error in
      if let error = error {
        print("[ZynthWebView] injectMessagingBridge error=\(error.localizedDescription)")
      } else {
        print("[ZynthWebView] injectMessagingBridge success")
      }
    }
  }

  private func messagingBridgeScript() -> String {
    return "(function(){if(window.ZynthWebView&&window.ZynthWebView.postMessage){return;}window.ZynthWebView={postMessage:function(data){window.webkit.messageHandlers.zynthWebView.postMessage(String(data));}};window.ReactNativeWebView=window.ZynthWebView;})();"
  }

  private func applyJavaScriptEnabled(to configuration: WKWebViewConfiguration) {
    if #available(iOS 14.0, *) {
      configuration.defaultWebpagePreferences.allowsContentJavaScript = javaScriptEnabled
    } else {
      configuration.preferences.javaScriptEnabled = javaScriptEnabled
    }
  }
}
