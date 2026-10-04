import OSLog
import UIKit
import WebKit

/// The seam between the web HUD and the phone.
///
/// JS → native: `window.webkit.messageHandlers.bike.postMessage({ type, … })`
/// native → JS: `window.__bikeNative.receive({ type, … })` — see web/src/lib/native.js
///
/// Nothing is sent until the page says `ready`, so no event can land before
/// its handler exists. Location fixes that arrive while the app is in the
/// background (JS is suspended then) are buffered and replayed as one batch
/// on return; the ride recorder works from fix timestamps, so a replayed batch
/// produces the same totals as a live stream.
@MainActor
final class NativeBridge: NSObject {
    private weak var webView: WKWebView?
    private let location = LocationService()
    private let speech = SpeechOutput()
    private let log = Logger(subsystem: "com.bike.hud", category: "bridge")

    private var pageReady = false
    private var appActive = true
    private var keepAwake = true
    private var pendingFixes: [[String: Any]] = []

    /// A full day of 1 Hz fixes. Beyond this the oldest go — a ride left
    /// recording in a pocket for a week shouldn't grow without bound.
    private static let pendingLimit = 86_400
    private static let batchSize = 1_500

    override init() {
        super.init()
        location.onFixes = { [weak self] fixes in self?.deliver(fixes) }
        location.onHeading = { [weak self] heading, accuracy in
            self?.send(["type": "heading", "heading": heading, "accuracy": accuracy])
        }
        location.onAuthorization = { [weak self] status in
            self?.send(["type": "authorization", "status": status])
        }
    }

    func attach(_ webView: WKWebView) {
        self.webView = webView
        applyIdleTimer()
    }

    // MARK: Lifecycle

    func setAppActive(_ active: Bool) {
        if !active {
            send(["type": "appState", "active": false])
        }
        appActive = active
        location.setForeground(active)
        applyIdleTimer()
        if active {
            send(["type": "appState", "active": true])
            flushPending()
        }
    }

    func notifyResigning() {
        send(["type": "appState", "active": false])
    }

    func pageWillReload() {
        pageReady = false
    }

    // MARK: Native → JS

    private func deliver(_ fixes: [[String: Any]]) {
        guard pageReady, appActive else {
            pendingFixes.append(contentsOf: fixes)
            if pendingFixes.count > Self.pendingLimit {
                pendingFixes.removeFirst(pendingFixes.count - Self.pendingLimit)
            }
            return
        }
        send(["type": "location", "fixes": fixes])
    }

    private func flushPending() {
        guard pageReady, appActive, !pendingFixes.isEmpty else { return }
        let fixes = pendingFixes
        pendingFixes.removeAll()
        // Chunked: one evaluateJavaScript carrying an hour of fixes is a
        // multi-megabyte string literal the JS parser has to swallow at once.
        var start = 0
        while start < fixes.count {
            let end = min(start + Self.batchSize, fixes.count)
            send(["type": "location", "fixes": Array(fixes[start..<end])])
            start = end
        }
    }

    private func send(_ message: [String: Any]) {
        guard pageReady, let webView else { return }
        guard JSONSerialization.isValidJSONObject(message),
              let data = try? JSONSerialization.data(withJSONObject: message),
              let json = String(data: data, encoding: .utf8)
        else {
            log.error("dropped unserializable message \(String(describing: message["type"]), privacy: .public)")
            return
        }
        webView.evaluateJavaScript("window.__bikeNative&&window.__bikeNative.receive(\(json))", completionHandler: nil)
    }

    // MARK: JS → native

    private func handle(_ body: [String: Any]) {
        guard let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            pageReady = true
            send(["type": "authorization", "status": location.authorizationStatus])
            location.start()
            location.replayLatest()
            flushPending()
        case "setRecording":
            location.setRecording(body["on"] as? Bool ?? false)
        case "setKeepAwake":
            keepAwake = body["on"] as? Bool ?? true
            applyIdleTimer()
        case "haptic":
            Haptics.play(body["style"] as? String ?? "light")
        case "speak":
            if let text = body["text"] as? String { speech.speak(text) }
        case "share":
            if let filename = body["filename"] as? String, let content = body["content"] as? String {
                share(filename: filename, content: content)
            }
        case "openSettings":
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        case "fetch":
            fetch(body)
        default:
            log.notice("unknown message \(type, privacy: .public)")
        }
    }

    // MARK: Fetch proxy

    /// Overpass answers 406 to a browser User-Agent whose Origin isn't
    /// http(s), which is every request from bike://app. URLSession can name
    /// the app instead — what Overpass's usage policy asks clients to do.
    /// Limited to the Overpass mirrors web/src/lib/bikeInfra.js uses, so the
    /// page can't be turned into a general-purpose proxy.
    private static let fetchHosts: Set<String> = [
        "overpass-api.de",
        "maps.mail.ru",
        "overpass.private.coffee",
        "overpass.kumi.systems",
    ]
    private static let userAgent = "Bike/1.0 (+https://github.com/fent700/bike)"

    private func fetch(_ body: [String: Any]) {
        guard let id = body["id"] as? String else { return }
        guard let string = body["url"] as? String,
              let url = URL(string: string),
              url.scheme == "https",
              let host = url.host, Self.fetchHosts.contains(host)
        else {
            send(["type": "fetchResult", "id": id, "status": 0, "error": "Host not allowed"])
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 40)
        request.httpMethod = body["method"] as? String ?? "GET"
        if let headers = body["headers"] as? [String: String] {
            for (field, value) in headers { request.setValue(value, forHTTPHeaderField: field) }
        }
        if let payload = body["body"] as? String {
            request.httpBody = Data(payload.utf8)
        }
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        let prepared = request

        Task {
            do {
                let (data, response) = try await URLSession.shared.data(for: prepared)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                self.send(["type": "fetchResult", "id": id, "status": status, "body": String(decoding: data, as: UTF8.self)])
            } catch {
                self.send(["type": "fetchResult", "id": id, "status": 0, "error": error.localizedDescription])
            }
        }
    }

    // MARK: Helpers

    private func applyIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = keepAwake && appActive
    }

    private func share(filename: String, content: String) {
        let safeName = filename.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            log.error("share write failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        guard let presenter = topViewController() else { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 120, width: 1, height: 1)
        }
        presenter.present(sheet, animated: true)
    }

    private func topViewController() -> UIViewController? {
        var top = webView?.window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

extension NativeBridge: @preconcurrency WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        handle(body)
    }
}

enum Haptics {
    @MainActor
    static func play(_ style: String) {
        switch style {
        case "success":
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning":
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "selection":
            UISelectionFeedbackGenerator().selectionChanged()
        case "medium":
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "heavy":
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        default:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}
