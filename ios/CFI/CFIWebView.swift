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

            let timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh") ?? .current
            let dateFormatter = DateFormatter()
            dateFormatter.locale = Locale(identifier: "en_US_POSIX")
            dateFormatter.timeZone = timeZone
            dateFormatter.dateFormat = "yyyy-MM-dd"

            guard dateFormatter.date(from: targetDate) != nil else {
                complete(
                    requestID: requestID,
                    ok: false,
                    status: 400,
                    data: Self.jsonData(["message": "TARGET_DATE_INVALID"])
                )
                return
            }

            let now = Date()
            let todayLocal = dateFormatter.string(from: now)
            let lock = NSLock()
            var collected: [[String: Any]] = []
            var providersWithRows = Set<String>()
            var successes: [String: Int] = [:]
            var failures: [String: Int] = [:]
            var completed = false

            func timeFormatter() -> DateFormatter {
                let f = DateFormatter()
                f.locale = Locale(identifier: "en_US_POSIX")
                f.timeZone = timeZone
                f.dateFormat = "HH:mm"
                return f
            }

            func localKickoff(_ time: String) -> Date? {
                let f = DateFormatter()
                f.locale = Locale(identifier: "en_US_POSIX")
                f.timeZone = timeZone
                f.dateFormat = "yyyy-MM-dd HH:mm"
                return f.date(from: "\(targetDate) \(time)")
            }

            func row(
                provider: String,
                providerId: String,
                home: String,
                away: String,
                competition: String,
                country: String,
                kickoff: Date?,
                localTime: String,
                status: String
            ) -> [String: Any]? {
                let h = Self.cleanTeamName(home)
                let a = Self.cleanTeamName(away)
                guard !h.isEmpty, !a.isEmpty, h.lowercased() != "h2h", a.lowercased() != "h2h" else { return nil }

                let resolvedKickoff = kickoff ?? localKickoff(localTime)
                let kickoffMs = resolvedKickoff.map { Int($0.timeIntervalSince1970 * 1000) } ?? 0
                let kickoffIso = resolvedKickoff.map { ISO8601DateFormatter().string(from: $0) } ?? ""

                return [
                    "provider": provider,
                    "providerId": providerId,
                    "home": h,
                    "away": a,
                    "competition": competition.isEmpty ? "Unknown competition" : competition,
                    "country": country,
                    "kickoff": kickoffMs,
                    "kickoffIso": kickoffIso,
                    "kickoffLocal": localTime,
                    "targetDate": targetDate,
                    "status": status
                ]
            }

            func dedupe(_ rows: [[String: Any]]) -> [[String: Any]] {
                var seen = Set<String>()
                var out: [[String: Any]] = []

                for item in rows {
                    let home = String(describing: item["home"] ?? "")
                        .lowercased()
                        .replacingOccurrences(of: #"[^a-z0-9]+"#, with: " ", options: .regularExpression)
                        .trimmingCharacters(in: .whitespaces)
                    let away = String(describing: item["away"] ?? "")
                        .lowercased()
                        .replacingOccurrences(of: #"[^a-z0-9]+"#, with: " ", options: .regularExpression)
                        .trimmingCharacters(in: .whitespaces)
                    let time = String(describing: item["kickoffLocal"] ?? "")
                    let key = "\(home)|\(away)|\(time)"
                    guard !home.isEmpty, !away.isEmpty, seen.insert(key).inserted else { continue }
                    out.append(item)
                }

                out.sort {
                    let lt = String(describing: $0["kickoffLocal"] ?? "99:99")
                    let rt = String(describing: $1["kickoffLocal"] ?? "99:99")
                    if lt == rt {
                        return String(describing: $0["competition"] ?? "") < String(describing: $1["competition"] ?? "")
                    }
                    return lt < rt
                }
                return out
            }

            func finish(force: Bool = false) {
                lock.lock()
                if completed {
                    lock.unlock()
                    return
                }
                let rows = dedupe(collected)
                if !force && rows.count < 20 {
                    lock.unlock()
                    return
                }
                completed = true
                let providerNames = providersWithRows.sorted()
                let successMap = successes
                let failureMap = failures
                lock.unlock()

                let source: String
                if !providerNames.isEmpty {
                    source = providerNames.joined(separator: " + ")
                } else if successMap.values.reduce(0, +) > 0 {
                    source = "MULTI_SOURCE_EMPTY"
                } else {
                    source = "MULTI_SOURCE_UNAVAILABLE"
                }

                complete(
                    requestID: requestID,
                    ok: true,
                    status: 200,
                    data: Self.jsonData([
                        "status": "OK",
                        "action": "CFI_TODAY_FIXTURES",
                        "source": source,
                        "providers": providerNames,
                        "targetDate": targetDate,
                        "timeZone": "Asia/Ho_Chi_Minh",
                        "counts": [
                            "fixtures": rows.count,
                            "providerRequestSuccesses": successMap,
                            "providerRequestFailures": failureMap
                        ],
                        "rows": Array(rows.prefix(400))
                    ])
                )
            }

            func record(provider: String, rows: [[String: Any]], success: Bool) {
                lock.lock()
                if completed {
                    lock.unlock()
                    return
                }
                if success {
                    successes[provider, default: 0] += 1
                } else {
                    failures[provider, default: 0] += 1
                }
                if !rows.isEmpty {
                    providersWithRows.insert(provider)
                    collected.append(contentsOf: rows)
                }
                let currentCount = dedupe(collected).count
                lock.unlock()

                if currentCount >= 20 {
                    finish()
                }
            }

            func requestHTML(
                provider: String,
                url: URL,
                timeout: TimeInterval = 5,
                parser: @escaping (String) -> [[String: Any]]
            ) {
                var req = URLRequest(url: url)
                req.timeoutInterval = timeout
                req.cachePolicy = .reloadIgnoringLocalCacheData
                req.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
                req.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", forHTTPHeaderField: "User-Agent")

                URLSession.shared.dataTask(with: req) { data, response, _ in
                    guard
                        let http = response as? HTTPURLResponse,
                        (200...299).contains(http.statusCode),
                        let data,
                        let html = String(data: data, encoding: .utf8)
                    else {
                        record(provider: provider, rows: [], success: false)
                        return
                    }
                    record(provider: provider, rows: parser(html), success: true)
                }.resume()
            }

            func requestJSON(
                provider: String,
                url: URL,
                timeout: TimeInterval = 5,
                parser: @escaping (Any) -> [[String: Any]]
            ) {
                var req = URLRequest(url: url)
                req.timeoutInterval = timeout
                req.cachePolicy = .reloadIgnoringLocalCacheData
                req.setValue("application/json", forHTTPHeaderField: "Accept")
                req.setValue("CFI-iOS/0.4", forHTTPHeaderField: "User-Agent")

                URLSession.shared.dataTask(with: req) { data, response, _ in
                    guard
                        let http = response as? HTTPURLResponse,
                        (200...299).contains(http.statusCode),
                        let data,
                        let object = try? JSONSerialization.jsonObject(with: data)
                    else {
                        record(provider: provider, rows: [], success: false)
                        return
                    }
                    record(provider: provider, rows: parser(object), success: true)
                }.resume()
            }

            func parseAiScore(_ html: String) -> [[String: Any]] {
                let lines = Self.plainTextFromHTML(html)
                    .components(separatedBy: .newlines)
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }

                var rows: [[String: Any]] = []
                var competition = "AiScore"
                var i = 0

                func isNoise(_ value: String) -> Bool {
                    let lower = value.lowercased()
                    return [
                        "h2h","prediction","live","football","basketball","tennis",
                        "cricket","baseball","esports","volleyball","hockey","favorites",
                        "figure legends","lineups","live stream","goals","penalty",
                        "own goal","substitution","whistle","red card","yellow card"
                    ].contains(lower)
                }

                while i < lines.count {
                    let value = lines[i]

                    if value.contains(":"),
                       value.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) == nil,
                       value.count < 120,
                       !isNoise(value) {
                        competition = value
                    }

                    if value.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil {
                        let time = value
                        var cursor = i + 1
                        var home: String?
                        var away: String?
                        var sawVS = false

                        while cursor < min(lines.count, i + 12) {
                            let candidate = lines[cursor]
                            if candidate.uppercased() == "FT" || candidate.range(of: #"\d+\s*-\s*\d+"#, options: .regularExpression) != nil {
                                break
                            }
                            if candidate.uppercased() == "VS" {
                                sawVS = true
                                cursor += 1
                                continue
                            }
                            if !isNoise(candidate) && candidate.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) == nil {
                                if home == nil {
                                    home = candidate
                                } else if sawVS && away == nil {
                                    away = candidate
                                    break
                                }
                            }
                            cursor += 1
                        }

                        if let home, let away,
                           let item = row(
                               provider: "AISCORE",
                               providerId: "AIS-\(targetDate)-\(time)-\(home)-\(away)",
                               home: home,
                               away: away,
                               competition: competition,
                               country: "",
                               kickoff: localKickoff(time),
                               localTime: time,
                               status: "scheduled"
                           ) {
                            rows.append(item)
                        }
                    }
                    i += 1
                }
                return rows
            }

            func parseBongdaWap(_ html: String) -> [[String: Any]] {
                let text = Self.plainTextFromHTML(html)
                let lines = text
                    .components(separatedBy: .newlines)
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }

                var rows: [[String: Any]] = []
                var competition = "BongdaWap"
                var i = 0

                while i < lines.count {
                    let value = lines[i]
                    if value.count < 80,
                       value.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) == nil,
                       !value.lowercased().contains("lịch thi đấu"),
                       !value.lowercased().contains("bảng xếp hạng") {
                        competition = value
                    }

                    if value.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil,
                       i >= 1, i + 1 < lines.count {
                        let time = value
                        let home = lines[i - 1]
                        let away = lines[i + 1]

                        if let item = row(
                            provider: "BONGDAWAP",
                            providerId: "BDW-\(targetDate)-\(time)-\(home)-\(away)",
                            home: home,
                            away: away,
                            competition: competition,
                            country: "",
                            kickoff: localKickoff(time),
                            localTime: time,
                            status: "scheduled"
                        ) {
                            rows.append(item)
                        }
                    }
                    i += 1
                }
                return rows
            }

            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 5.5) {
                finish(force: true)
            }

            if targetDate == todayLocal {
                [
                    "https://www.aiscore.com/today-matches",
                    "https://vnm.aiscore.com/",
                    "https://www.aiscore.com/?theme=black&width=1380"
                ].compactMap(URL.init(string:)).forEach { url in
                    requestHTML(provider: "AISCORE", url: url, timeout: 4.5, parser: parseAiScore)
                }
            }

            let parts = targetDate.split(separator: "-")
            if parts.count == 3,
               let url = URL(string: "https://bongdawap.com/lich-thi-dau-bong-da-ngay-\(parts[2])-\(parts[1])-\(parts[0]).html") {
                requestHTML(provider: "BONGDAWAP", url: url, timeout: 4.5, parser: parseBongdaWap)
            }

            if let sofaURL = URL(string: "https://www.sofascore.com/api/v1/sport/football/scheduled-events/\(targetDate)") {
                requestJSON(provider: "SOFASCORE", url: sofaURL, timeout: 4.5) { object in
                    guard
                        let root = object as? [String: Any],
                        let events = root["events"] as? [[String: Any]]
                    else { return [] }

                    let tf = timeFormatter()
                    var rows: [[String: Any]] = []
                    for event in events {
                        guard
                            let homeTeam = event["homeTeam"] as? [String: Any],
                            let awayTeam = event["awayTeam"] as? [String: Any],
                            let home = homeTeam["name"] as? String,
                            let away = awayTeam["name"] as? String,
                            let timestamp = event["startTimestamp"] as? NSNumber
                        else { continue }

                        let kickoff = Date(timeIntervalSince1970: timestamp.doubleValue)
                        guard dateFormatter.string(from: kickoff) == targetDate else { continue }

                        let statusObject = event["status"] as? [String: Any]
                        let status = String(describing: statusObject?["type"] ?? "scheduled").lowercased()
                        if ["finished","inprogress","canceled","cancelled","postponed","abandoned"].contains(status) {
                            continue
                        }

                        let tournament = event["tournament"] as? [String: Any]
                        let category = tournament?["category"] as? [String: Any]
                        let countryObject = category?["country"] as? [String: Any]

                        if let item = row(
                            provider: "SOFASCORE",
                            providerId: String(describing: event["id"] ?? "\(home)-\(away)-\(timestamp)"),
                            home: home,
                            away: away,
                            competition: tournament?["name"] as? String ?? "",
                            country: countryObject?["name"] as? String ?? category?["name"] as? String ?? "",
                            kickoff: kickoff,
                            localTime: tf.string(from: kickoff),
                            status: status
                        ) {
                            rows.append(item)
                        }
                    }
                    return rows
                }
            }

            if let sportsDbURL = URL(string: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=\(targetDate)&s=Soccer") {
                requestJSON(provider: "THESPORTSDB", url: sportsDbURL, timeout: 4.5) { object in
                    guard
                        let root = object as? [String: Any],
                        let events = root["events"] as? [[String: Any]]
                    else { return [] }

                    var rows: [[String: Any]] = []
                    for event in events {
                        let home = event["strHomeTeam"] as? String ?? ""
                        let away = event["strAwayTeam"] as? String ?? ""
                        let time = String((event["strTime"] as? String ?? "00:00").prefix(5))
                        if let item = row(
                            provider: "THESPORTSDB",
                            providerId: String(describing: event["idEvent"] ?? "\(home)-\(away)-\(time)"),
                            home: home,
                            away: away,
                            competition: event["strLeague"] as? String ?? "",
                            country: event["strCountry"] as? String ?? "",
                            kickoff: localKickoff(time),
                            localTime: time,
                            status: String(describing: event["strStatus"] ?? "scheduled")
                        ) {
                            rows.append(item)
                        }
                    }
                    return rows
                }
            }

            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.8) {
                let leagues = [
                    "eng.1","eng.2","eng.3","eng.4","eng.5",
                    "esp.1","esp.2","ger.1","ita.1","fra.1",
                    "ned.1","por.1","bel.1","sco.1","usa.1",
                    "mex.1","bra.1","arg.1","jpn.1","kor.1",
                    "eng.w.1","usa.nwsl"
                ]
                let espnDate = targetDate.replacingOccurrences(of: "-", with: "")
                for league in leagues {
                    lock.lock()
                    let alreadyDone = completed
                    lock.unlock()
                    if alreadyDone { break }

                    guard let url = URL(string: "https://site.api.espn.com/apis/site/v2/sports/soccer/\(league)/scoreboard?dates=\(espnDate)&limit=1000") else { continue }

                    requestJSON(provider: "ESPN", url: url, timeout: 3.5) { object in
                        guard
                            let root = object as? [String: Any],
                            let events = root["events"] as? [[String: Any]]
                        else { return [] }

                        let tf = timeFormatter()
                        var rows: [[String: Any]] = []
                        for event in events {
                            guard
                                let dateString = event["date"] as? String,
                                let kickoff = ISO8601DateFormatter().date(from: dateString),
                                dateFormatter.string(from: kickoff) == targetDate,
                                let competitions = event["competitions"] as? [[String: Any]],
                                let competition = competitions.first,
                                let competitors = competition["competitors"] as? [[String: Any]]
                            else { continue }

                            let homeRow = competitors.first { ($0["homeAway"] as? String) == "home" }
                            let awayRow = competitors.first { ($0["homeAway"] as? String) == "away" }
                            let homeTeam = homeRow?["team"] as? [String: Any]
                            let awayTeam = awayRow?["team"] as? [String: Any]
                            let home = homeTeam?["displayName"] as? String ?? homeTeam?["name"] as? String ?? ""
                            let away = awayTeam?["displayName"] as? String ?? awayTeam?["name"] as? String ?? ""
                            let statusRoot = event["status"] as? [String: Any]
                            let statusType = statusRoot?["type"] as? [String: Any]
                            let status = String(describing: statusType?["state"] ?? "pre").lowercased()
                            if status == "post" || status == "in" { continue }

                            if let item = row(
                                provider: "ESPN",
                                providerId: String(describing: event["id"] ?? "\(home)-\(away)-\(dateString)"),
                                home: home,
                                away: away,
                                competition: event["name"] as? String ?? league,
                                country: "",
                                kickoff: kickoff,
                                localTime: tf.string(from: kickoff),
                                status: status
                            ) {
                                rows.append(item)
                            }
                        }
                        return rows
                    }
                }
            }
        }

        private static func cleanHTMLCell(_ raw: String) -> String {
            plainTextFromHTML(raw)
                .components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }

        private static func cleanTeamName(_ value: String) -> String {
            value
                .replacingOccurrences(of: #"\[[^\]]+\]"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }

        private static func plainTextFromHTML(_ html: String) -> String {
            var value = html
            value = value.replacingOccurrences(
                of: #"(?is)<script[^>]*>.*?</script>"#,
                with: "",
                options: .regularExpression
            )
            value = value.replacingOccurrences(
                of: #"(?is)<style[^>]*>.*?</style>"#,
                with: "",
                options: .regularExpression
            )
            value = value.replacingOccurrences(
                of: #"(?i)<br\s*/?>"#,
                with: "\n",
                options: .regularExpression
            )
            value = value.replacingOccurrences(
                of: #"(?i)</(div|p|li|tr|td|th|a|span|h1|h2|h3|h4|h5|h6)>"#,
                with: "\n",
                options: .regularExpression
            )
            value = value.replacingOccurrences(
                of: #"<[^>]+>"#,
                with: "",
                options: .regularExpression
            )

            let entities: [String: String] = [
                "&nbsp;": " ",
                "&amp;": "&",
                "&quot;": "\"",
                "&#39;": "'",
                "&lt;": "<",
                "&gt;": ">"
            ]
            for (entity, replacement) in entities {
                value = value.replacingOccurrences(of: entity, with: replacement)
            }
            return value
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
