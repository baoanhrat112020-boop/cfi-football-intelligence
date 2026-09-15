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
            "/api/status",
            "/api/predict",
            "/api/prediction-history",
            "/api/results"
        ]

        private let nativeTodayFixturesPath = "/native/today-fixtures"

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
                (allowedPaths.contains(path) || path == nativeTodayFixturesPath),
                ["GET", "POST"].contains(method.uppercased())
            else {
                return
            }

            if path == nativeTodayFixturesPath {
                let body = payload["body"] as? [String: Any] ?? [:]
                fetchTodayFixtures(requestID: requestID, body: body)
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
            request.timeoutInterval = 25
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

        private func fetchTodayFixtures(
            requestID: String,
            body: [String: Any]
        ) {
            let targetDate = String(describing: body["target_date"] ?? "")
            guard targetDate.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
                complete(
                    requestID: requestID,
                    ok: false,
                    status: 400,
                    data: Self.jsonData(["message": "TARGET_DATE_INVALID"])
                )
                return
            }

            let utcFormatter = DateFormatter()
            utcFormatter.locale = Locale(identifier: "en_US_POSIX")
            utcFormatter.timeZone = TimeZone(secondsFromGMT: 0)
            utcFormatter.dateFormat = "yyyy-MM-dd"

            guard let baseDate = utcFormatter.date(from: targetDate) else {
                complete(
                    requestID: requestID,
                    ok: false,
                    status: 400,
                    data: Self.jsonData(["message": "TARGET_DATE_INVALID"])
                )
                return
            }

            let calendar = Calendar(identifier: .gregorian)
            let queryDates = [-1, 0, 1].compactMap { offset -> String? in
                guard let date = calendar.date(byAdding: .day, value: offset, to: baseDate) else { return nil }
                return utcFormatter.string(from: date)
            }

            let group = DispatchGroup()
            let lock = NSLock()
            var events: [[String: Any]] = []
            var successfulRequests = 0

            for date in queryDates {
                for host in ["www.sofascore.com", "api.sofascore.com"] {
                    guard let url = URL(string: "https://\(host)/api/v1/sport/football/scheduled-events/\(date)") else { continue }
                    group.enter()

                    var request = URLRequest(url: url)
                    request.timeoutInterval = 12
                    request.setValue("application/json", forHTTPHeaderField: "Accept")
                    request.setValue("CFI-iOS/0.2", forHTTPHeaderField: "User-Agent")

                    URLSession.shared.dataTask(with: request) { data, response, _ in
                        defer { group.leave() }

                        guard
                            let http = response as? HTTPURLResponse,
                            (200...299).contains(http.statusCode),
                            let data,
                            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                            let rows = object["events"] as? [[String: Any]]
                        else {
                            return
                        }

                        lock.lock()
                        successfulRequests += 1
                        events.append(contentsOf: rows)
                        lock.unlock()
                    }.resume()
                }
            }

            group.notify(queue: .global(qos: .userInitiated)) { [weak self] in
                guard let self else { return }

                let localZone = TimeZone(identifier: "Asia/Ho_Chi_Minh") ?? .current
                let localDateFormatter = DateFormatter()
                localDateFormatter.locale = Locale(identifier: "en_US_POSIX")
                localDateFormatter.timeZone = localZone
                localDateFormatter.dateFormat = "yyyy-MM-dd"

                let localTimeFormatter = DateFormatter()
                localTimeFormatter.locale = Locale(identifier: "en_US_POSIX")
                localTimeFormatter.timeZone = localZone
                localTimeFormatter.dateFormat = "HH:mm"

                let now = Date()
                let todayLocal = localDateFormatter.string(from: now)
                let terminal: Set<String> = [
                    "finished", "inprogress", "canceled", "cancelled",
                    "postponed", "abandoned", "match finished", "ft", "in"
                ]

                var seen = Set<String>()
                var rows: [[String: Any]] = []

                for event in events {
                    guard
                        let homeTeam = event["homeTeam"] as? [String: Any],
                        let awayTeam = event["awayTeam"] as? [String: Any],
                        let home = homeTeam["name"] as? String,
                        let away = awayTeam["name"] as? String,
                        let timestamp = event["startTimestamp"] as? NSNumber
                    else {
                        continue
                    }

                    let kickoff = Date(timeIntervalSince1970: timestamp.doubleValue)
                    guard localDateFormatter.string(from: kickoff) == targetDate else { continue }
                    if targetDate == todayLocal && kickoff <= now { continue }

                    let statusObject = event["status"] as? [String: Any]
                    let status = String(describing: statusObject?["type"] ?? statusObject?["description"] ?? "scheduled").lowercased()
                    if terminal.contains(status) { continue }

                    let tournament = event["tournament"] as? [String: Any]
                    let category = tournament?["category"] as? [String: Any]
                    let countryObject = category?["country"] as? [String: Any]
                    let competition = (tournament?["name"] as? String) ?? "Unknown competition"
                    let country = (countryObject?["name"] as? String) ?? (category?["name"] as? String) ?? ""
                    let providerID = String(describing: event["id"] ?? "\(home)-\(away)-\(timestamp)")
                    let key = "\(home.lowercased())|\(away.lowercased())|\(Int(timestamp.doubleValue))"
                    guard seen.insert(key).inserted else { continue }

                    rows.append([
                        "provider": "SOFASCORE",
                        "providerId": providerID,
                        "home": home,
                        "away": away,
                        "competition": competition,
                        "country": country,
                        "kickoff": Int(timestamp.doubleValue * 1000),
                        "kickoffIso": ISO8601DateFormatter().string(from: kickoff),
                        "kickoffLocal": localTimeFormatter.string(from: kickoff),
                        "targetDate": targetDate,
                        "status": status
                    ])
                }

                rows.sort {
                    let lhs = ($0["kickoff"] as? Int) ?? Int.max
                    let rhs = ($1["kickoff"] as? Int) ?? Int.max
                    return lhs < rhs
                }

                let payload: [String: Any] = [
                    "status": "OK",
                    "action": "CFI_TODAY_FIXTURES",
                    "source": rows.isEmpty ? (successfulRequests > 0 ? "SOFASCORE_EMPTY" : "SOFASCORE_UNAVAILABLE") : "SOFASCORE",
                    "targetDate": targetDate,
                    "timeZone": "Asia/Ho_Chi_Minh",
                    "counts": [
                        "fixtures": rows.count,
                        "providerRequestsSucceeded": successfulRequests
                    ],
                    "rows": rows
                ]

                self.complete(
                    requestID: requestID,
                    ok: true,
                    status: 200,
                    data: Self.jsonData(payload)
                )
            }
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
