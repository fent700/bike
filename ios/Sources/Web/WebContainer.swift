import SwiftUI
import UIKit
import WebKit

struct WebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> HUDViewController {
        HUDViewController()
    }

    func updateUIViewController(_ controller: HUDViewController, context: Context) {}
}

/// Hosts the web HUD full-bleed. Everything visual is the web app in
/// `Bike.app/Web/`; this controller owns the web view's lifetime and wires it
/// to `NativeBridge` for the things a page can't do on its own.
@MainActor
final class HUDViewController: UIViewController {
    private var webView: WKWebView!
    private let bridge = NativeBridge()

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        // The bridge holds the web view weakly, so the content controller's
        // strong reference to it here is the only edge and there is no cycle.
        configuration.userContentController.add(bridge, name: "bike")
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        // Keeps the "Mobile" token the page and Mapbox look for, and names the
        // app to Overpass, whose fair-use policy asks clients to identify.
        configuration.applicationNameForUserAgent = "Mobile/15E148 Bike/1.0"

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .oled
        webView.scrollView.backgroundColor = .oled
        // The page lays itself out against env(safe-area-inset-*); letting
        // UIKit inset the scroll view as well would double every margin.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        // Safari ▸ Develop ▸ <iPhone> ▸ Bike attaches the Web Inspector to the
        // running HUD, console and all. Costs nothing when nobody attaches.
        webView.isInspectable = true
        webView.navigationDelegate = self
        webView.uiDelegate = self

        self.webView = webView
        bridge.attach(webView)
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        webView.load(URLRequest(url: AppSchemeHandler.entryURL))
    }

    @objc private func didBecomeActive() {
        bridge.setAppActive(true)
    }

    @objc private func willResignActive() {
        // Control Center pulled down, a call coming in: the page should keep
        // drawing, but this is the moment to tell it to save the ride.
        bridge.notifyResigning()
    }

    @objc private func didEnterBackground() {
        bridge.setAppActive(false)
    }
}

extension HUDViewController: @preconcurrency WKNavigationDelegate {
    /// iOS reclaims a backgrounded web content process under memory pressure,
    /// and what comes back is a blank white view. Reload; the page restores the
    /// in-progress ride from IndexedDB on its own.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        bridge.pageWillReload()
        webView.load(URLRequest(url: AppSchemeHandler.entryURL))
    }
}

extension HUDViewController: @preconcurrency WKUIDelegate {
    /// `target="_blank"` links (Mapbox's attribution and "Improve this map")
    /// go to Safari instead of silently doing nothing.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https", "mailto"].contains(url.scheme ?? "") {
            UIApplication.shared.open(url)
        }
        return nil
    }
}
