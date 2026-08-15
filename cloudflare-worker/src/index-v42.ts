import base from './index';

const OLD = `• Historical Database<br>• Team Trending DNA<br>• Home/Away form<br>• H2H + standings/context<br>• Randomness allowance`;
const FULL = `<b>DATA CORE</b><br>• Historical Database · H2H · Home/Away form · Team Trending DNA<br><br><b>MATCH STATE DNA</b><br>• Goal timing profile · Leading/Trailing behavior · Collapse DNA · Opponent surge<br><br><b>CONTEXT</b><br>• Standings & opponent strength · Rest/Fatigue · Motivation · Style matchup<br>• Goalkeeper/defensive stability · Starting XI continuity<br><br><b>LIVE & UNCERTAINTY</b><br>• Live momentum · Scoreline pressure · Red-card intelligence<br>• Referee volatility · Extreme weather/pitch · Random shock / uncertainty band`;

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo') {
      const internal = new Request(new URL('/api/predict', request.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ home: 'Wallern', away: 'Union Dietach', language: 'vi' })
      });
      return base.fetch(internal, env, ctx);
    }

    const res = await base.fetch(request, env, ctx);
    if (url.pathname !== '/' || !String(res.headers.get('content-type')).includes('text/html')) return res;
    let html = await res.text();
    html = html.replace(OLD, FULL).replaceAll('CFI v4.1', 'CFI v4.2');
    return new Response(html, { status: res.status, headers: res.headers });
  }
} satisfies ExportedHandler<any>;
