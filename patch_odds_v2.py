import re
from pathlib import Path

HTML = Path("web/index.html")
src = HTML.read_text(encoding="utf-8")

# Remove old sidecar script block
pat = re.compile(r'<script>\s*/\* ==== CFI ODDS SIDECAR ==== \*/.*?</script>', re.DOTALL)
src = pat.sub('', src)

NEW_SCRIPT = """<script>
/* ==== CFI ODDS SIDECAR v2 ==== */
(function () {
  var API_BASE = "https://cfi-football-intelligence.baoanhrat112020.workers.dev";
  var CFI_RULES = { betMinEdge: 0.04, betMinEV: 0.05, leanMinEdge: 0.015 };
  var MARKETS = ["3+ HT", "7+ FT", "Other HT", "Other FT"];

  // 1. Polyfill iOS native bridge for Chrome testing
  if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.cfiAPI) {
    window.webkit = window.webkit || {};
    window.webkit.messageHandlers = window.webkit.messageHandlers || {};
    window.webkit.messageHandlers.cfiAPI = {
      postMessage: function (msg) {
        var id = msg.id, path = msg.path, method = msg.method, body = msg.body;
        fetch(API_BASE + path, {
          method: method || "GET",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined
        }).then(function (res) {
          return res.text().then(function (text) {
            var b64 = btoa(unescape(encodeURIComponent(text)));
            if (window.__cfiNativeResolve) window.__cfiNativeResolve(id, res.ok, res.status, b64);
          });
        }).catch(function (e) {
          if (window.__cfiNativeResolve) window.__cfiNativeResolve(id, false, 0, btoa(String(e.message)));
        });
      }
    };
  }

  // 2. Odds calc + badge
  function calc(p, o) {
    if (!o || o <= 1 || !p) return null;
    var implied = 1 / o;
    return {
      edge: p - implied,
      ev: p * (o - 1) - (1 - p),
      kelly: Math.max(0, (p * o - 1) / (o - 1)),
      fair: 1 / p
    };
  }
  function badgeHTML(p, o) {
    var r = calc(p, o); if (!r) return "";
    var cls = "odds-neutral";
    if (r.edge >= CFI_RULES.betMinEdge && r.ev >= CFI_RULES.betMinEV) cls = "odds-green";
    else if (r.edge >= CFI_RULES.leanMinEdge) cls = "odds-yellow";
    else if (r.edge < 0) cls = "odds-red";
    var e = (r.edge * 100).toFixed(2);
    var v = (r.ev * 100).toFixed(2);
    var k = (r.kelly * 100).toFixed(1);
    return '<span class="odds-badge ' + cls + '">edge ' + e + '% &middot; EV ' + v + '% &middot; fair ' + r.fair.toFixed(2) + ' &middot; kelly ' + k + '%</span>';
  }

  function attachToMarketRow(row) {
    if (row.dataset.oddsInjected === "1") return;
    var marketEl = row.querySelector("b");
    var probEl = row.querySelector(".prob");
    if (!marketEl || !probEl) return;
    var market = (marketEl.textContent || "").trim();
    if (MARKETS.indexOf(market) === -1) return;
    var probPct = parseFloat((probEl.textContent || "").replace("%", ""));
    if (!isFinite(probPct)) return;
    var prob = probPct / 100;

    var w = document.createElement("div");
    w.className = "odds-row cfi-odds-injected";
    w.innerHTML = '<span class="odds-label">odds</span><input class="odds-input" type="number" step="0.01" min="1.01" placeholder="2.50"><span class="odds-result"></span>';
    var inp = w.querySelector(".odds-input");
    var res = w.querySelector(".odds-result");
    inp.addEventListener("input", function () {
      res.innerHTML = badgeHTML(prob, parseFloat(inp.value));
    });
    row.parentNode.insertBefore(w, row.nextSibling);
    row.dataset.oddsInjected = "1";
  }

  function scanAll() {
    document.querySelectorAll("#marketList .market").forEach(attachToMarketRow);
  }

  function startObserver() {
    var target = document.getElementById("marketList");
    if (!target) { setTimeout(startObserver, 200); return; }
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType === 1) {
            if (n.classList && n.classList.contains("market")) attachToMarketRow(n);
            else if (n.querySelectorAll) n.querySelectorAll(".market").forEach(attachToMarketRow);
          }
        });
      });
    });
    mo.observe(target, { childList: true, subtree: true });
    scanAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }
})();
</script>"""

# Insert before </body>
idx = src.rfind("</body>")
src = src[:idx] + NEW_SCRIPT + "\n" + src[idx:]
HTML.write_text(src, encoding="utf-8")
print("OK - size:", HTML.stat().st_size, "bytes")
