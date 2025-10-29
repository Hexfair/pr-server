export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { url, locID } = req.query || {};
  let target = "";

  if (typeof url === "string" && url) {
    try {
      const u = new URL(url);
      if (u.hostname !== "notams.aim.faa.gov") {
        return res.status(400).json({ ok: false, error: "host not allowed" });
      }
      target = u.toString();
    } catch {
      return res.status(400).json({ ok: false, error: "invalid url" });
    }
  } else if (typeof locID === "string" && locID) {
    target = `https://notams.aim.faa.gov/notamSearch/airport?locID=${encodeURIComponent(
      locID
    )}`;
  } else {
    return res
      .status(400)
      .json({ ok: false, error: "locID or url is required" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const r = await fetch(target, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9,ru;q=0.7",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/118 Safari/537.36",
        referer: "https://notams.aim.faa.gov/notamSearch/nsapp.html",
      },
      signal: controller.signal,
    });

    const body = await r.text();
    const ct =
      r.headers.get("content-type") || "application/json; charset=utf-8";

    res.status(r.status);
    res.setHeader("content-type", ct);
    res.send(body);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e?.message || "fetch failed" });
  } finally {
    clearTimeout(timeout);
  }
}
