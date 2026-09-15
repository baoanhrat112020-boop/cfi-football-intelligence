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

            let timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh") ?? .current
            let dateFormatter = DateFormatter()
            dateFormatter.locale = Locale(identifier: "en_US_POSIX")
            dateFormatter.timeZone = timeZone
            dateFormatter.dateFormat = "yyyy-MM-dd"

            guard let baseDate = dateFormatter.date(from: targetDate) else {
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
            let calendar = Calendar(identifier: .gregorian)
            let queryDates = [-1, 0, 1].compactMap { offset -> String? in
                guard let date = calendar.date(byAdding: .day, value: offset, to: baseDate) else { return nil }
                return dateFormatter.string(from: date)
            }

            let group = DispatchGroup()
            let lock = NSLock()
            var collected: [[String: Any]] = []
            var providersWithRows = Set<String>()
            var providerRequestSuccesses: [String: Int] = [:]
            var providerRequestFailures: [String: Int] = [:]

            func record(provider: String, rows: [[String: Any]], success: Bool) {
                lock.lock()
                defer { lock.unlock() }
                if success {
                    providerRequestSuccesses[provider, default: 0] += 1
                } else {
                    providerRequestFailures[provider, default: 0] += 1
                }
                if !rows.isEmpty {
                    providersWithRows.insert(provider)
                    collected.append(contentsOf: rows)
                }
            }

            func performJSON(
                provider: String,
                url: URL,
                parser: @escaping (Any) -> [[String: Any]]
            ) {
                group.enter()
                var request = URLRequest(url: url)
                request.timeoutInterval = 12
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("Mozilla/5.0 CFI-iOS/0.3", forHTTPHeaderField: "User-Agent")

                URLSession.shared.dataTask(with: request) { data, response, _ in
                    defer { group.leave() }
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

            func performHTML(
                provider: String,
                url: URL,
                parser: @escaping (String) -> [[String: Any]]
            ) {
                group.enter()
                var request = URLRequest(url: url)
                request.timeoutInterval = 12
                request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
                request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 CFI/0.3", forHTTPHeaderField: "User-Agent")

                URLSession.shared.dataTask(with: request) { data, response, _ in
                    defer { group.leave() }
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

            func localKickoff(_ date: String, _ time: String) -> Date? {
                let f = DateFormatter()
                f.locale = Locale(identifier: "en_US_POSIX")
                f.timeZone = timeZone
                f.dateFormat = "yyyy-MM-dd HH:mm"
                return f.date(from: "\(date) \(time)")
            }

            func eligibleKickoff(_ kickoff: Date) -> Bool {
                guard dateFormatter.string(from: kickoff) == targetDate else { return false }
                if targetDate == todayLocal && kickoff <= now { return false }
                return true
            }

            func fixtureRow(
                provider: String,
                providerId: String,
                home: String,
                away: String,
                competition: String,
                country: String,
                kickoff: Date,
                status: String
            ) -> [String: Any]? {
                let h = home.trimmingCharacters(in: .whitespacesAndNewlines)
                let a = away.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !h.isEmpty, !a.isEmpty, eligibleKickoff(kickoff) else { return nil }

                let time = DateFormatter()
                time.locale = Locale(identifier: "en_US_POSIX")
                time.timeZone = timeZone
                time.dateFormat = "HH:mm"

                return [
                    "provider": provider,
                    "providerId": providerId,
                    "home": h,
                    "away": a,
                    "competition": competition.isEmpty ? "Unknown competition" : competition,
                    "country": country,
                    "kickoff": Int(kickoff.timeIntervalSince1970 * 1000),
                    "kickoffIso": ISO8601DateFormatter().string(from: kickoff),
                    "kickoffLocal": time.string(from: kickoff),
                    "targetDate": targetDate,
                    "status": status
                ]
            }

            // 1) Sofascore — useful when its public schedule endpoint is reachable.
            for date in queryDates {
                for host in ["www.sofascore.com", "api.sofascore.com"] {
                    guard let url = URL(string: "https://\(host)/api/v1/sport/football/scheduled-events/\(date)") else { continue }
                    performJSON(provider: "SOFASCORE", url: url) { object in
                        guard
                            let root = object as? [String: Any],
                            let events = root["events"] as? [[String: Any]]
                        else { return [] }

                        let terminal: Set<String> = [
                            "finished", "inprogress", "canceled", "cancelled",
                            "postponed", "abandoned", "match finished", "ft", "in"
                        ]
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
                            let statusObject = event["status"] as? [String: Any]
                            let status = String(describing: statusObject?["type"] ?? statusObject?["description"] ?? "scheduled").lowercased()
                            if terminal.contains(status) { continue }

                            let tournament = event["tournament"] as? [String: Any]
                            let category = tournament?["category"] as? [String: Any]
                            let countryObject = category?["country"] as? [String: Any]
                            let competition = (tournament?["name"] as? String) ?? ""
                            let country = (countryObject?["name"] as? String) ?? (category?["name"] as? String) ?? ""
                            let providerID = String(describing: event["id"] ?? "\(home)-\(away)-\(timestamp)")

                            if let row = fixtureRow(
                                provider: "SOFASCORE",
                                providerId: providerID,
                                home: home,
                                away: away,
                                competition: competition,
                                country: country,
                                kickoff: kickoff,
                                status: status
                            ) {
                                rows.append(row)
                            }
                        }
                        return rows
                    }
                }
            }

            // 2) ESPN — broad, stable JSON scoreboards across many leagues.
            let espnLeagues = [
                "uefa.champions","uefa.europa","uefa.europa.conf",
                "eng.1","eng.2","eng.3","eng.4","eng.5",
                "esp.1","esp.2","ger.1","ger.2","ita.1","ita.2",
                "fra.1","fra.2","ned.1","por.1","bel.1","sco.1",
                "tur.1","usa.1","mex.1","bra.1","arg.1","col.1",
                "aus.1","jpn.1","kor.1","eng.w.1","usa.nwsl","uefa.wchampions"
            ]
            let espnDate = targetDate.replacingOccurrences(of: "-", with: "")
            for league in espnLeagues {
                guard let url = URL(string: "https://site.api.espn.com/apis/site/v2/sports/soccer/\(league)/scoreboard?dates=\(espnDate)&limit=1000") else { continue }
                performJSON(provider: "ESPN", url: url) { object in
                    guard
                        let root = object as? [String: Any],
                        let events = root["events"] as? [[String: Any]]
                    else { return [] }

                    var rows: [[String: Any]] = []
                    for event in events {
                        guard
                            let dateString = event["date"] as? String,
                            let kickoff = ISO8601DateFormatter().date(from: dateString),
                            let competitions = event["competitions"] as? [[String: Any]],
                            let competition = competitions.first,
                            let competitors = competition["competitors"] as? [[String: Any]]
                        else { continue }

                        let homeRow = competitors.first { ($0["homeAway"] as? String) == "home" }
                        let awayRow = competitors.first { ($0["homeAway"] as? String) == "away" }
                        let homeTeam = homeRow?["team"] as? [String: Any]
                        let awayTeam = awayRow?["team"] as? [String: Any]
                        let home = (homeTeam?["displayName"] as? String) ?? (homeTeam?["name"] as? String) ?? ""
                        let away = (awayTeam?["displayName"] as? String) ?? (awayTeam?["name"] as? String) ?? ""

                        let statusRoot = event["status"] as? [String: Any]
                        let statusType = statusRoot?["type"] as? [String: Any]
                        let status = String(describing: statusType?["state"] ?? statusType?["name"] ?? "pre").lowercased()
                        if ["post","in","finished"].contains(status) { continue }

                        let leagueName = (event["name"] as? String) ?? league
                        let providerID = String(describing: event["id"] ?? "\(home)-\(away)-\(dateString)")

                        if let row = fixtureRow(
                            provider: "ESPN",
                            providerId: providerID,
                            home: home,
                            away: away,
                            competition: leagueName,
                            country: "",
                            kickoff: kickoff,
                            status: status
                        ) {
                            rows.append(row)
                        }
                    }
                    return rows
                }
            }

            // 3) TheSportsDB — small free feed, still valuable as an independent fallback.
            for date in queryDates {
                guard let url = URL(string: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=\(date)&s=Soccer") else { continue }
                performJSON(provider: "THESPORTSDB", url: url) { object in
                    guard
                        let root = object as? [String: Any],
                        let events = root["events"] as? [[String: Any]]
                    else { return [] }

                    var rows: [[String: Any]] = []
                    let iso = ISO8601DateFormatter()

                    for event in events {
                        let home = event["strHomeTeam"] as? String ?? ""
                        let away = event["strAwayTeam"] as? String ?? ""
                        let status = String(describing: event["strStatus"] ?? "scheduled").lowercased()
                        if status.contains("finish") || status.contains("postpon") || status.contains("cancel") { continue }

                        var kickoff: Date?
                        if let timestamp = event["strTimestamp"] as? String, !timestamp.isEmpty {
                            kickoff = iso.date(from: timestamp)
                        }
                        if kickoff == nil {
                            let eventDate = event["dateEvent"] as? String ?? date
                            let eventTime = String((event["strTime"] as? String ?? "00:00").prefix(5))
                            kickoff = localKickoff(eventDate, eventTime)
                        }
                        guard let kickoff else { continue }

                        let leagueName = event["strLeague"] as? String ?? ""
                        let country = event["strCountry"] as? String ?? ""
                        let providerID = String(describing: event["idEvent"] ?? "\(home)-\(away)-\(kickoff.timeIntervalSince1970)")

                        if let row = fixtureRow(
                            provider: "THESPORTSDB",
                            providerId: providerID,
                            home: home,
                            away: away,
                            competition: leagueName,
                            country: country,
                            kickoff: kickoff,
                            status: status
                        ) {
                            rows.append(row)
                        }
                    }
                    return rows
                }
            }

            // 4) BongdaWap — static dated fixture table; independent from JSON providers.
            let vnDate = targetDate.split(separator: "-")
            if vnDate.count == 3 {
                let bdwDate = "\(vnDate[2])-\(vnDate[1])-\(vnDate[0])"
                if let url = URL(string: "https://bongdawap.com/lich-thi-dau-bong-da-ngay-\(bdwDate).html") {
                    performHTML(provider: "BONGDAWAP", url: url) { html in
                        let rowRegex = try? NSRegularExpression(pattern: #"(?is)<tr[^>]*>(.*?)</tr>"#)
                        let cellRegex = try? NSRegularExpression(pattern: #"(?is)<t[dh][^>]*>(.*?)</t[dh]>"#)
                        guard let rowRegex, let cellRegex else { return [] }

                        let ns = html as NSString
                        let rowMatches = rowRegex.matches(in: html, range: NSRange(location: 0, length: ns.length))
                        var rows: [[String: Any]] = []

                        for rowMatch in rowMatches {
                            guard rowMatch.numberOfRanges > 1 else { continue }
                            let fragment = ns.substring(with: rowMatch.range(at: 1))
                            let fns = fragment as NSString
                            let cellMatches = cellRegex.matches(in: fragment, range: NSRange(location: 0, length: fns.length))
                            let cells = cellMatches.compactMap { match -> String? in
                                guard match.numberOfRanges > 1 else { return nil }
                                return Self.cleanHTMLCell(fns.substring(with: match.range(at: 1)))
                            }

                            guard cells.count >= 6 else { continue }
                            let time = cells[1]
                            guard time.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil else { continue }
                            guard let kickoff = localKickoff(targetDate, time) else { continue }

                            let competition = cells[0]
                            let home = Self.cleanTeamName(cells[3])
                            let away = Self.cleanTeamName(cells[5])
                            let scoreCell = cells[4].lowercased()
                            if scoreCell != "vs" && scoreCell.range(of: #"\d+\s*-\s*\d+"#, options: .regularExpression) != nil {
                                continue
                            }

                            if let row = fixtureRow(
                                provider: "BONGDAWAP",
                                providerId: "BDW-\(targetDate)-\(time)-\(home)-\(away)",
                                home: home,
                                away: away,
                                competition: competition,
                                country: "",
                                kickoff: kickoff,
                                status: "scheduled"
                            ) {
                                rows.append(row)
                            }
                        }
                        return rows
                    }
                }
            }

            // 5) AiScore — public "today matches" page. It is dynamic, so this is
            // best-effort and never blocks the other providers.
            if targetDate == todayLocal, let url = URL(string: "https://www.aiscore.com/today-matches") {
                performHTML(provider: "AISCORE", url: url) { html in
                    let text = Self.plainTextFromHTML(html)
                    let lines = text
                        .components(separatedBy: .newlines)
                        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                        .filter { !$0.isEmpty }

                    var rows: [[String: Any]] = []
                    var lastCompetition = "AiScore"
                    var index = 0

                    while index < lines.count {
                        let line = lines[index]
                        if line.contains(":"),
                           line.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) == nil,
                           line.count < 100 {
                            lastCompetition = line
                        }

                        if line.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil,
                           index + 3 < lines.count {
                            let home = lines[index + 1]
                            let vs = lines[index + 2].uppercased()
                            let away = lines[index + 3]

                            if vs == "VS",
                               !home.isEmpty,
                               !away.isEmpty,
                               let kickoff = localKickoff(targetDate, line),
                               let row = fixtureRow(
                                   provider: "AISCORE",
                                   providerId: "AIS-\(targetDate)-\(line)-\(home)-\(away)",
                                   home: home,
                                   away: away,
                                   competition: lastCompetition,
                                   country: "",
                                   kickoff: kickoff,
                                   status: "scheduled"
                               ) {
                                rows.append(row)
                                index += 4
                                continue
                            }
                        }
                        index += 1
                    }
                    return rows
                }
            }

            group.notify(queue: .global(qos: .userInitiated)) { [weak self] in
                guard let self else { return }

                lock.lock()
                let rawRows = collected
                let providerNames = providersWithRows.sorted()
                let successMap = providerRequestSuccesses
                let failureMap = providerRequestFailures
                lock.unlock()

                var seen = Set<String>()
                var rows: [[String: Any]] = []

                for row in rawRows {
                    let home = String(describing: row["home"] ?? "").lowercased()
                        .replacingOccurrences(of: #"[^a-z0-9]+"#, with: " ", options: .regularExpression)
                        .trimmingCharacters(in: .whitespaces)
                    let away = String(describing: row["away"] ?? "").lowercased()
                        .replacingOccurrences(of: #"[^a-z0-9]+"#, with: " ", options: .regularExpression)
                        .trimmingCharacters(in: .whitespaces)
                    let kickoff = (row["kickoff"] as? NSNumber)?.int64Value ?? Int64(row["kickoff"] as? Int ?? 0)
                    let bucket = kickoff / 300_000
                    let key = "\(home)|\(away)|\(bucket)"
                    if seen.insert(key).inserted {
                        rows.append(row)
                    }
                }

                rows.sort {
                    let lhs = ($0["kickoff"] as? NSNumber)?.int64Value ?? Int64($0["kickoff"] as? Int ?? Int.max)
                    let rhs = ($1["kickoff"] as? NSNumber)?.int64Value ?? Int64($1["kickoff"] as? Int ?? Int.max)
                    return lhs < rhs
                }

                let totalSuccesses = successMap.values.reduce(0, +)
                let source: String
                if !providerNames.isEmpty {
                    source = providerNames.joined(separator: " + ")
                } else if totalSuccesses > 0 {
                    source = "MULTI_SOURCE_EMPTY"
                } else {
                    source = "MULTI_SOURCE_UNAVAILABLE"
                }

                let payload: [String: Any] = [
                    "status": "OK",
                    "action": "CFI_TODAY_FIXTURES",
                    "source": source,
                    "providers": providerNames,
                    "targetDate": targetDate,
                    "timeZone": "Asia/Ho_Chi_Minh",
                    "counts": [
                        "fixtures": rows.count,
                        "providerRequestsSucceeded": totalSuccesses,
                        "providerRequestSuccesses": successMap,
                        "providerRequestFailures": failureMap
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
