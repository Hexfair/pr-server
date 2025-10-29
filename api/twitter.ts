// api/twitter.ts
export const config = { runtime: "nodejs" };

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
function isVerificationPage(html: string): boolean {
  const t = html.toLowerCase();
  return (
    t.includes("verifying your browser") ||
    t.includes("ddos") ||
    t.includes("captcha")
  );
}
function parseBases(queryBase?: string): string[] {
  // приоритет: ?base=a,b → NITTER_BASES → NITTER_BASE → дефолтный список
  const fromQuery = (queryBase || "")
    .split(",")
    .map(normalizeBase)
    .filter(Boolean);
  if (fromQuery.length) return fromQuery;

  const envList = (process.env.NITTER_BASES || "")
    .split(",")
    .map(normalizeBase)
    .filter(Boolean);
  if (envList.length) return envList;

  const single = normalizeBase(process.env.NITTER_BASE || "");
  if (single) return [single];

  // дефолт: твой рабочий + несколько запасных
  return [
    "https://nitter.tiekoetter.com",
    "https://nitter.lacontrevoie.fr",
    "https://nitter.rawbit.ch",
    "https://nitter.uni-sonia.com",
    "https://nitter.net",
  ];
}

function buildPageHeaders(base: string) {
  return {
    // как в твоём примере
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language":
      "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7,es;q=0.6,zh-TW;q=0.5,zh;q=0.4",
    priority: "u=0, i",
    "sec-ch-ua":
      '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    referer: base,
  };
}

function buildBinaryHeaders(host: string) {
  // для картинок с pbs/инстанса; sec-fetch-site меняем на cross-site
  return {
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "sec-fetch-dest": "image",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "cross-site",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    referer: `https://${host}/`,
  };
}

export default async function handler(req: any, res: any) {
  // CORS + no-store
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { username, url, debug } = req.query || {};
  const bases = parseBases(
    typeof req.query.base === "string" ? req.query.base : undefined
  );
  const attempts: any[] = [];

  // Режим бинаря: url=...
  if (typeof url === "string" && url.trim()) {
    try {
      const u = new URL(url);
      const allowedHosts = new Set<string>([
        ...bases.map((b) => hostnameOf(b)),
        "pbs.twimg.com",
      ]);
      if (!allowedHosts.has(u.hostname)) {
        return res
          .status(400)
          .json({ ok: false, error: `host not allowed: ${u.hostname}` });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const r = await fetch(u.toString(), {
          method: "GET",
          headers: buildBinaryHeaders(u.hostname),
          redirect: "follow",
          signal: controller.signal,
        });
        const ct = r.headers.get("content-type") || "application/octet-stream";
        const ab = await r.arrayBuffer();
        res.status(r.status);
        res.setHeader("content-type", ct);
        return res.send(Buffer.from(ab));
      } catch (e: any) {
        return res
          .status(502)
          .json({ ok: false, error: e?.message || "fetch failed" });
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return res.status(400).json({ ok: false, error: "invalid url" });
    }
  }

  // Режим страницы: username=...
  if (!(typeof username === "string" && username.trim())) {
    return res
      .status(400)
      .json({ ok: false, error: "username or url is required" });
  }

  for (const base of bases) {
    const target = `${base}/${encodeURIComponent(username.trim())}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const r = await fetch(target, {
        method: "GET",
        headers: buildPageHeaders(base),
        redirect: "follow",
        signal: controller.signal,
      });

      const ct = r.headers.get("content-type") || "";
      const ab = await r.arrayBuffer();
      const buf = Buffer.from(ab);
      const snippet = buf.toString("utf8", 0, Math.min(600, buf.length));

      attempts.push({
        base,
        status: r.status,
        contentType: ct,
        snippet: snippet.slice(0, 200),
      });

      // Успех: 200 + HTML и не "verifying"
      if (r.ok && ct.includes("text/html") && !isVerificationPage(snippet)) {
        if (debug === "1") {
          return res.status(200).json({
            ok: true,
            base,
            status: r.status,
            contentType: ct,
            target,
            snippet: snippet.slice(0, 500),
          });
        }
        res.status(r.status);
        res.setHeader("content-type", ct);
        return res.send(buf);
      }

      // 403/429/503/anti-bot — пробуем следующий base
      if (
        r.status === 403 ||
        r.status === 429 ||
        r.status === 503 ||
        isVerificationPage(snippet)
      ) {
        continue;
      }
      // другие статусы — тоже пробуем дальше
      continue;
    } catch (e: any) {
      attempts.push({ base, error: e?.message || "fetch error" });
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (debug === "1") {
    return res
      .status(502)
      .json({ ok: false, error: "all bases failed", attempts });
  }
  return res.status(502).json({ ok: false, error: "fetch failed" });
}
