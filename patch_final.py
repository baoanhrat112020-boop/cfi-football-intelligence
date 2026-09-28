import re
from pathlib import Path
HTML = Path("web/index.html")
src = HTML.read_text(encoding="utf-8")

# 1. API_BASE -> "" (relative, proxied by serve.py)
src = src.replace(
    'var API_BASE = "https://cfi-football-intelligence.baoanhrat112020.workers.dev";',
    'var API_BASE = "";'
)

# 2. Inject sanitize hook into polyfill IIFE
anchor = 'if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.cfiAPI) {'
sanitize = '''function cleanTeam(s){return String(s||"").replace(/\\s+\\d{4}-\\d{2}-\\d{2}\\s*$/,"").replace(/\\s+/g," ").trim();}
  document.addEventListener("DOMContentLoaded",function(){
    setTimeout(function(){
      var btn=document.getElementById("findBtn");
      if(!btn)return;
      btn.addEventListener("click",function(){
        var h=document.getElementById("homeInput"),a=document.getElementById("awayInput");
        if(h)h.value=cleanTeam(h.value);
        if(a)a.value=cleanTeam(a.value);
      },true);
    },300);
  });
  '''
src = src.replace(anchor, sanitize + anchor, 1)

HTML.write_text(src, encoding="utf-8")
print("OK patched:", HTML.stat().st_size, "bytes")
