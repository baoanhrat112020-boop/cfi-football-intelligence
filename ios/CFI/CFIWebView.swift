import SwiftUI
import WebKit
import Foundation

struct CFIWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(context.coordinator, name: "cfiAPI")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView

        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.024, green: 0.082, blue: 0.133, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false

        loadBundledFrontend(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "cfiAPI")
        coordinator.webView = nil
    }

    private func loadBundledFrontend(in webView: WKWebView) {
        guard let indexURL = Bundle.main.url(forResource: "index", withExtension: "html") else {
            webView.loadHTMLString(Self.missingFrontendHTML, baseURL: nil)
            return
        }

        webView.loadFileURL(
            indexURL,
            allowingReadAccessTo: indexURL.deletingLastPathComponent()
        )
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?

        private let baseURL = URL(string: "https://cfi-football-intelligence.baoanhrat112020.workers.dev")!
        private let allowedPaths: Set<String> = [
            "/health",
            "/api/status",
            "/api/match-context",
            "/api/fixtures-day",
            "/api/discover",
            "/api/predict",
            "/api/prediction-history",
            "/api/results"
        ]

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard
                message.name == "cfiAPI",
                let payload = message.body as? [String: Any],
                let requestID = payload["id"] as? String,
                let path = payload["path"] as? String,
                let method = payload["method"] as? String,
                allowedPaths.contains(String(path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])),
                ["GET", "POST"].contains(method.uppercased())
            else {
                return
            }

            guard let url = URL(string: path, relativeTo: baseURL) else {
                complete(
                    requestID: requestID,
                    ok: false,
                    status: 0,
                    data: Self.jsonData(["message": "Invalid CFI API path"])
                )
                return
            }

            var request = URLRequest(url: url)
            request.httpMethod = method.uppercased()
            request.timeoutInterval = path == "/health" ? 4 : 25
            request.setValue("application/json", forHTTPHeaderField: "Accept")

            if request.httpMethod == "POST" {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                if let body = payload["body"], !(body is NSNull) {
                    guard JSONSerialization.isValidJSONObject(body) else {
                        complete(
                            requestID: requestID,
                            ok: false,
                            status: 0,
                            data: Self.jsonData(["message": "Invalid request body"])
                        )
                        return
                    }
                    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
                }
            }

            URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                guard let self else { return }

                if let error {
                    self.complete(
                        requestID: requestID,
                        ok: false,
                        status: 0,
                        data: Self.jsonData(["message": error.localizedDescription])
                    )
                    return
                }

                let http = response as? HTTPURLResponse
                let status = http?.statusCode ?? 0
                let responseData = data ?? Self.jsonData([:])
                let ok = (200...299).contains(status)

                self.complete(
                    requestID: requestID,
                    ok: ok,
                    status: status,
                    data: responseData
                )
            }.resume()
        }

        private func complete(
            requestID: String,
            ok: Bool,
            status: Int,
            data: Data
        ) {
            let base64 = data.base64EncodedString()
            let script = "window.__cfiNativeResolve(\(Self.jsString(requestID)), \(ok ? "true" : "false"), \(status), \(Self.jsString(base64)))"

            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript(script)
            }
        }

        private static func jsString(_ value: String) -> String {
            guard
                let data = try? JSONSerialization.data(withJSONObject: [value]),
                let encoded = String(data: data, encoding: .utf8),
                encoded.count >= 2
            else {
                return "\"\""
            }
            return String(encoded.dropFirst().dropLast())
        }

        private static func jsonData(_ object: [String: Any]) -> Data {
            (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        }
    }

    private static let missingFrontendHTML = """
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #061522;
            color: #eef5ff;
            font-family: -apple-system, system-ui, sans-serif;
          }
          main { padding: 32px; text-align: center; }
          p { color: #93a4bb; }
        </style>
      </head>
      <body>
        <main>
          <h1>CFI</h1>
          <p>Bundled frontend resource is missing.</p>
        </main>
      </body>
    </html>
    """
}
