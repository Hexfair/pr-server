function isAllowedHost(h: string) {
  return (
    h === "nitter.net" || h.endsWith(".nitter.net") || h === "pbs.twimg.com"
  );
}

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { username, url } = req.query || {};
  let target = "";

  if (typeof username === "string" && username) {
    target = `https://nitter.net/${encodeURIComponent(username)}`;
  } else if (typeof url === "string" && url) {
    try {
      const u = new URL(url);
      if (!isAllowedHost(u.hostname)) {
        return res.status(400).json({ ok: false, error: "host not allowed" });
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
        // близко к твоему примеру
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141 Safari/537.36",
        "upgrade-insecure-requests": "1",
        "sec-fetch-user": "?1",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-dest": "document",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const ct = r.headers.get("content-type") || "";
    //@ts-ignore
    const buf = Buffer.from(await r.arrayBuffer());

    res.status(r.status);
    res.setHeader("content-type", ct || "text/html; charset=utf-8");
    res.send(buf);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e?.message || "fetch failed" });
  } finally {
    clearTimeout(timeout);
  }
}
