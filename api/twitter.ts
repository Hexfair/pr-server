// api/twitter.ts
function normalizeBase(input?: string): string {
  if (!input) return "";
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s.replace(/\/+$/, "");
}

function hostnameOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  // База инстанса: env или ?base=...
  const envBase = normalizeBase(
    process.env.NITTER_BASE || "https://nitter.net"
  );
  const base = normalizeBase(
    typeof req.query.base === "string" ? req.query.base : envBase
  );
  const baseHost = hostnameOf(base);

  // Разрешённые хосты для прямого url
  const allowedHosts = new Set<string>([baseHost, "pbs.twimg.com"]);

  const { username, url, debug } = req.query || {};
  let target = "";

  if (typeof username === "string" && username.trim()) {
    target = `${base}/${encodeURIComponent(username.trim())}`;
  } else if (typeof url === "string" && url.trim()) {
    try {
      const u = new URL(url);
      if (!allowedHosts.has(u.hostname)) {
        return res
          .status(400)
          .json({ ok: false, error: `host not allowed: ${u.hostname}` });
      }
      target = u.toString();
    } catch {
      return res.status(400).json({ ok: false, error: "invalid url" });
    }
  } else {
    return res
      .status(400)
      .json({ ok: false, error: "username or url is required" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const r = await fetch(target, {
      method: "GET",
      headers: {
        // Достаточный набор для HTML
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "upgrade-insecure-requests": "1",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());

    if (debug === "1") {
      // Отдадим диагностический JSON вместо HTML
      const headers: Record<string, string> = {};
      r.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return res.status(200).json({
        ok: r.ok,
        status: r.status,
        contentType: ct,
        target,
        base,
        headers,
        snippet: buf.toString("utf8").slice(0, 500),
      });
    }

    res.status(r.status);
    res.setHeader("content-type", ct || "text/html; charset=utf-8");
    res.send(buf);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e?.message || "fetch failed" });
  } finally {
    clearTimeout(timeout);
  }
}
