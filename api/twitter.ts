// api/twitter.ts
// Важно: в этом репо установи @types/node и в tsconfig добавь "types": ["node"]
// Или в этом файле добавь: import { Buffer } from 'node:buffer';

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
  // Порядок приоритета:
  // 1) ?base=a,b,c (через запятую)
  // 2) env NITTER_BASES="a,b,c"
  // 3) env NITTER_BASE (один)
  // 4) дефолтный список
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

  // дефолтные фолбэки (можешь подправить)
  return [
    "https://nitter.lacontrevoie.fr",
    "https://nitter.rawbit.ch",
    "https://nitter.uni-sonia.com",
    "https://nitter.net",
    "https://nitter.poast.org",
  ];
}

export default async function handler(req: any, res: any) {
  // CORS + запрет кэширования
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { username, url, debug } = req.query || {};
  const attempts: any[] = [];

  // Если передан url — разрешаем только pbs.twimg.com (картинки)
  if (typeof url === "string" && url.trim()) {
    try {
      const u = new URL(url);
      if (u.hostname !== "pbs.twimg.com") {
        return res
          .status(400)
          .json({ ok: false, error: `host not allowed: ${u.hostname}` });
      }
      // Проксируем бинарь
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const r = await fetch(u.toString(), {
          method: "GET",
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141 Safari/537.36",
          },
          signal: controller.signal,
        });
        const ct = r.headers.get("content-type") || "application/octet-stream";
        const buf = Buffer.from(await r.arrayBuffer());
        res.status(r.status);
        res.setHeader("content-type", ct);
        return res.send(buf);
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

  // Иначе работаем в режиме username через список инстансов
  if (!(typeof username === "string" && username.trim())) {
    return res
      .status(400)
      .json({ ok: false, error: "username or url is required" });
  }

  const bases = parseBases(
    typeof req.query.base === "string" ? req.query.base : undefined
  );

  for (const base of bases) {
    const target = `${base}/${encodeURIComponent(username.trim())}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const r = await fetch(target, {
        method: "GET",
        headers: {
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
      const snippet = buf.toString("utf8", 0, Math.min(600, buf.length));

      attempts.push({
        base,
        status: r.status,
        contentType: ct,
        snippet: snippet.slice(0, 200),
      });

      // Успех: 200 и HTML, не «verifying»
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

      // Если «verifying browser» или 403/429/503 — пробуем следующий базовый
      if (
        r.status === 403 ||
        r.status === 429 ||
        r.status === 503 ||
        isVerificationPage(snippet)
      ) {
        continue;
      }

      // Любая другая ошибка — пробуем дальше
      continue;
    } catch (e: any) {
      attempts.push({ base, error: e?.message || "fetch error" });
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Если все инстансы провалились
  if (debug === "1") {
    return res
      .status(502)
      .json({ ok: false, error: "all bases failed", attempts });
  }
  return res.status(502).json({ ok: false, error: "fetch failed" });
}
