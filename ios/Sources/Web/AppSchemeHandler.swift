import Foundation
import WebKit

/// Serves the bundled web app from `Bike.app/Web/` under `bike://app/`.
///
/// `loadFileURL` would be simpler, but a `file://` page can't load its own
/// `<script type="module">` (WebKit applies CORS to module scripts and
/// `file://` has no origin), and it gets an opaque origin for IndexedDB and
/// localStorage. A real scheme gives the page a stable origin, so ride
/// history and the Mapbox token survive relaunches.
@MainActor
final class AppSchemeHandler: NSObject {
    static let scheme = "bike"
    static let entryURL = URL(string: "bike://app/index.html")!

    private let root: URL? = Bundle.main.resourceURL?
        .appendingPathComponent("Web", isDirectory: true)
        .standardizedFileURL

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "webmanifest": "application/manifest+json",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "woff2": "font/woff2",
        "woff": "font/woff",
        "txt": "text/plain; charset=utf-8",
    ]

    private func resolve(_ url: URL) -> URL? {
        guard let root else { return nil }
        let relative = url.path.drop(while: { $0 == "/" })
        let candidate = root.appendingPathComponent(relative.isEmpty ? "index.html" : String(relative)).standardizedFileURL
        // `..` in a crafted URL must not walk out of the web root.
        guard candidate.path == root.path || candidate.path.hasPrefix(root.path + "/") else { return nil }

        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory) {
            return isDirectory.boolValue ? candidate.appendingPathComponent("index.html") : candidate
        }
        // Extensionless paths are app routes, not files.
        return candidate.pathExtension.isEmpty ? root.appendingPathComponent("index.html") : nil
    }

    private func respond(_ task: any WKURLSchemeTask, url: URL, status: Int, body: Data, mime: String) {
        let headers = [
            "Content-Type": mime,
            "Content-Length": String(body.count),
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }
}

extension AppSchemeHandler: @preconcurrency WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        guard let file = resolve(url) else {
            respond(urlSchemeTask, url: url, status: 404, body: Data("Not found".utf8), mime: "text/plain; charset=utf-8")
            return
        }
        do {
            // Synchronous on purpose. The largest file is the ~2 MB Mapbox
            // bundle, mapped rather than read, and answering inline means the
            // task can never be stopped between our check and our reply.
            let data = try Data(contentsOf: file, options: .mappedIfSafe)
            let mime = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
            respond(urlSchemeTask, url: url, status: 200, body: data, mime: mime)
        } catch {
            respond(urlSchemeTask, url: url, status: 500, body: Data(error.localizedDescription.utf8), mime: "text/plain; charset=utf-8")
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}
}
