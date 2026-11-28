//
//  ViewController.swift
//  Shared (App)
//

import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

let extensionBundleIdentifier = "com.synthszr.glossary.Extension"
private let allowedExternalHosts: Set<String> = [
    "www.synthszr.com",
    "synthszr.com",
    "synthszr.vercel.app"
]

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!
    private var webViewReady = false

#if os(macOS)
    nonisolated(unsafe) private var activationObserver: NSObjectProtocol?
#endif

    deinit {
#if os(macOS)
        if let observer = activationObserver {
            NotificationCenter.default.removeObserver(observer)
        }
#endif
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self
        self.webView.configuration.userContentController.add(self, name: "controller")

        if let mainURL = Bundle.main.url(forResource: "Main", withExtension: "html"),
           let resourceURL = Bundle.main.resourceURL {
            self.webView.loadFileURL(mainURL, allowingReadAccessTo: resourceURL)
        }

#if os(macOS)
        activationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refreshMacExtensionState()
            }
        }
#endif
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webViewReady = true
#if os(iOS)
        webView.evaluateJavaScript("window.show && window.show('ios')")
#elseif os(macOS)
        webView.evaluateJavaScript("window.show && window.show('mac')")
        refreshMacExtensionState()
#endif
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if url.isFileURL {
            decisionHandler(.allow)
            return
        }

        if isAllowedExternalURL(url) {
            openExternalURL(url)
        }
        decisionHandler(.cancel)
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        if let dict = message.body as? [String: Any],
           let action = dict["action"] as? String,
           action == "open-url",
           let rawUrl = dict["url"] as? String,
           let url = URL(string: rawUrl),
           isAllowedExternalURL(url) {
            openExternalURL(url)
            return
        }

        if let str = message.body as? String {
            if str.hasPrefix("open-url:") {
                let rawUrl = String(str.dropFirst("open-url:".count))
                if let url = URL(string: rawUrl), isAllowedExternalURL(url) {
                    openExternalURL(url)
                }
                return
            }

#if os(macOS)
            if str == "open-preferences" {
                SFSafariApplication.showPreferencesForExtension(
                    withIdentifier: extensionBundleIdentifier
                ) { _ in }
            }
#endif
        }
    }

#if os(macOS)
    private func refreshMacExtensionState() {
        guard webViewReady else { return }
        SFSafariExtensionManager.getStateOfSafariExtension(
            withIdentifier: extensionBundleIdentifier
        ) { [weak self] state, error in
            guard let state = state, error == nil else { return }
            DispatchQueue.main.async {
                guard let self = self else { return }
                let useSettings = if #available(macOS 13, *) { "true" } else { "false" }
                self.webView.evaluateJavaScript(
                    "window.show && window.show('mac', \(state.isEnabled ? "true" : "false"), \(useSettings))"
                )
            }
        }
    }
#endif

    private func isAllowedExternalURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased() else {
            return false
        }
        return allowedExternalHosts.contains(host)
    }

    private func openExternalURL(_ url: URL) {
#if os(macOS)
        NSWorkspace.shared.open(url)
#elseif os(iOS)
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
#endif
    }
}
