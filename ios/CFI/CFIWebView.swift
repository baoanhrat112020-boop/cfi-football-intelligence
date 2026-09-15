import SwiftUI
import WebKit

struct CFIWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        loadBundledFrontend(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

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
            background: #08111f;
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
