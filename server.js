const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const SINA_QUOTE_ENDPOINT = "https://hq.sinajs.cn/list=";
const SINA_KLINE_ENDPOINT =
  "https://stock2.finance.sina.com.cn/futures/api/jsonp.php";
const SINA_REFERER = "https://finance.sina.com.cn/";
const KLINE_MIN_DATE = "2020-01-01";
const KLINE_MAX_BARS = 30000;

const DEFAULT_PRODUCT = "al";
const PRODUCT_CONFIGS = {
  al: {
    key: "al",
    code: "AL",
    label: "沪铝",
    product: "沪铝期货",
    defaultSymbol: "nf_AL0",
    contractUnit: "5吨/手",
    priceUnit: "元/吨",
    sourceUrl: "https://gu.sina.cn/ft/hq/nf.php?symbol=AL0"
  },
  rb: {
    key: "rb",
    code: "RB",
    label: "螺纹钢",
    product: "螺纹钢期货",
    defaultSymbol: "nf_RB0",
    contractUnit: "10吨/手",
    priceUnit: "元/吨",
    sourceUrl: "https://gu.sina.cn/ft/hq/nf.php?symbol=RB0"
  }
};

const PRODUCT_ALIASES = {
  aluminum: "al",
  alu: "al",
  "沪铝": "al",
  "铝": "al",
  rebar: "rb",
  "螺纹": "rb",
  "螺纹钢": "rb"
};

const KLINE_INTERVALS = {
  "1h": { label: "1小时", source: "minute", type: 60, limit: 120 },
  "3h": { label: "3小时", source: "minute", type: 180, limit: 120 },
  "5h": { label: "5小时", source: "minute-aggregate", type: 60, hours: 5, limit: 120 },
  "1d": { label: "日线", source: "daily", limit: 120 },
  "1w": { label: "周线", source: "daily-aggregate", period: "week", limit: 120 },
  "1mo": { label: "月线", source: "daily-aggregate", period: "month", limit: 120 }
};

const INTERVAL_ALIASES = {
  hour: "1h",
  "1hour": "1h",
  "3hour": "3h",
  "5hour": "5h",
  day: "1d",
  daily: "1d",
  week: "1w",
  weekly: "1w",
  month: "1mo",
  monthly: "1mo"
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalizeProduct(product, fallback = DEFAULT_PRODUCT) {
  const clean = String(product || "").trim();
  const lower = clean.toLowerCase();
  if (PRODUCT_CONFIGS[lower]) return lower;
  if (PRODUCT_ALIASES[lower]) return PRODUCT_ALIASES[lower];

  const upper = clean.toUpperCase();
  const matched = Object.values(PRODUCT_CONFIGS).find((item) => item.code === upper);
  return matched?.key || fallback;
}

function productKeyForCode(code) {
  const clean = String(code || "").toUpperCase();
  const matched = Object.values(PRODUCT_CONFIGS).find((item) => item.code === clean);
  return matched?.key || "";
}

function productKeyFromSymbol(symbol) {
  const clean = String(symbol || "").trim().toUpperCase().replace(/^NF_/, "");
  const prefix = clean.match(/^([A-Z]+)/)?.[1] || "";
  return productKeyForCode(prefix);
}

function productConfig(productKey) {
  return PRODUCT_CONFIGS[productKey] || PRODUCT_CONFIGS[DEFAULT_PRODUCT];
}

function buildDefaultSymbols(productKey = DEFAULT_PRODUCT, now = new Date()) {
  const product = productConfig(productKey);
  const symbols = [product.defaultSymbol];
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  // SHFE futures contracts are monthly. After the 15th, the nearby
  // delivery month is usually expired, so start from the next month.
  if (now.getDate() > 15) {
    month += 1;
  }

  for (let index = 0; index < 8; index += 1) {
    const contractYear = year + Math.floor((month - 1) / 12);
    const contractMonth = ((month - 1) % 12) + 1;
    const yy = String(contractYear).slice(-2);
    symbols.push(`nf_${product.code}${yy}${pad2(contractMonth)}`);
    month += 1;
  }

  return symbols;
}

function normalizeSymbol(symbol, productKey = "") {
  if (!symbol) return "";
  const clean = symbol.trim().toUpperCase();
  const match = clean.match(/^NF_([A-Z]+)(0|\d{4})$/) || clean.match(/^([A-Z]+)(0|\d{4})$/);
  if (!match) return "";

  const inferredProduct = productKeyForCode(match[1]);
  if (!inferredProduct || (productKey && inferredProduct !== productKey)) return "";
  return `nf_${match[1]}${match[2]}`;
}

function normalizeInterval(interval) {
  const clean = String(interval || "1d").trim().toLowerCase();
  return KLINE_INTERVALS[clean] ? clean : INTERVAL_ALIASES[clean] || "1d";
}

function cleanSymbols(input, productKey = DEFAULT_PRODUCT) {
  const requested = input
    ? input.split(",").map((item) => item.trim()).filter(Boolean)
    : buildDefaultSymbols(productKey);

  return Array.from(new Set(requested.map((item) => normalizeSymbol(item, productKey)).filter(Boolean)));
}

function symbolToSinaCode(symbol) {
  const normalized = normalizeSymbol(symbol);
  return normalized ? normalized.replace(/^nf_/, "") : "";
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(raw) {
  if (!raw || raw.length < 6) return "";
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
}

function parseDateParts(date) {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return { year, month, day };
}

function chinaTimestamp(value) {
  const normalized = value.includes(" ") ? value.replace(" ", "T") : `${value}T00:00:00`;
  return new Date(`${normalized}+08:00`).getTime();
}

function dateValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseRangeTimestamp(value, boundary = "start") {
  const clean = String(value || "").trim();
  if (!clean) return null;

  const dateOnly = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const time = boundary === "end" ? "23:59:59" : "00:00:00";
    return chinaTimestamp(`${clean} ${time}`);
  }

  const dateTime = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:T| )(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateTime) return null;

  const seconds = dateTime[6] || "00";
  return chinaTimestamp(`${dateTime[1]}-${dateTime[2]}-${dateTime[3]} ${dateTime[4]}:${dateTime[5]}:${seconds}`);
}

function filterCandlesByRange(candles, startTs, endTs) {
  return candles.filter((candle) => {
    const ts = chinaTimestamp(candle.date);
    return (
      Number.isFinite(ts) &&
      (startTs === null || ts >= startTs) &&
      (endTs === null || ts <= endTs)
    );
  });
}

function isoWeekKey(date) {
  const { year, month, day } = parseDateParts(date);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayOfWeek);
  const weekYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNo = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
  return `${weekYear}-W${pad2(weekNo)}`;
}

function parseSinaPayload(text) {
  const quotes = [];
  const matcher = /var\s+hq_str_([A-Za-z0-9_]+)="([^"]*)";/g;
  let match;

  while ((match = matcher.exec(text)) !== null) {
    const symbol = match[1];
    const fields = match[2].split(",");
    if (!fields[0] || fields.length < 18) continue;

    const last = numberOrNull(fields[8]) ?? numberOrNull(fields[5]);
    const previousSettlement = numberOrNull(fields[10]);
    const change = last !== null && previousSettlement !== null ? last - previousSettlement : null;
    const changePct =
      change !== null && previousSettlement ? (change / previousSettlement) * 100 : null;
    const date = fields[17] || "";
    const time = formatTime(fields[1]);

    quotes.push({
      symbol,
      code: symbol.replace(/^nf_/, ""),
      name: fields[0],
      exchange: fields[15] || "沪",
      product: fields[16] || "铝",
      date,
      time,
      timestamp: date && time ? `${date} ${time}` : "",
      isContinuous: /0$/i.test(symbol),
      isMain: fields[18] === "1",
      open: numberOrNull(fields[2]),
      high: numberOrNull(fields[3]),
      low: numberOrNull(fields[4]),
      close: numberOrNull(fields[5]),
      bid: numberOrNull(fields[6]),
      ask: numberOrNull(fields[7]),
      last,
      settlement: numberOrNull(fields[9]),
      previousSettlement,
      bidVolume: numberOrNull(fields[11]),
      askVolume: numberOrNull(fields[12]),
      volume: numberOrNull(fields[13]),
      openInterest: numberOrNull(fields[14]),
      averagePrice: numberOrNull(fields[27]),
      change,
      changePct,
      raw: fields
    });
  }

  return quotes;
}

function parseKlinePayload(text, mode = "daily") {
  const match = text.match(/=\s*\((\[[\s\S]*\])\)\s*;?\s*$/);
  if (!match) {
    throw new Error("K-line source returned an unexpected format.");
  }

  const rows = JSON.parse(match[1]);
  return rows
    .map((row) => {
      const base = {
        date: row.d,
        open: numberOrNull(row.o),
        high: numberOrNull(row.h),
        low: numberOrNull(row.l),
        close: numberOrNull(row.c),
        settlement: numberOrNull(row.s)
      };

      if (mode === "minute") {
        return {
          ...base,
          volume: numberOrNull(row.v),
          cumulativeVolume: numberOrNull(row.p),
          openInterest: null
        };
      }

      return {
        ...base,
        openInterest: numberOrNull(row.v),
        volume: numberOrNull(row.p)
      };
    })
    .filter(
      (row) =>
        row.date &&
        row.open !== null &&
        row.high !== null &&
        row.low !== null &&
        row.close !== null
    )
    .sort((a, b) => chinaTimestamp(a.date) - chinaTimestamp(b.date));
}

function aggregateCandles(candles, keyFor) {
  const groups = new Map();

  for (const candle of candles) {
    const key = keyFor(candle);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candle);
  }

  return Array.from(groups.values()).map((items) => {
    const first = items[0];
    const last = items[items.length - 1];
    return {
      date: last.date,
      periodStart: first.date,
      periodEnd: last.date,
      open: first.open,
      high: Math.max(...items.map((item) => item.high)),
      low: Math.min(...items.map((item) => item.low)),
      close: last.close,
      volume: items.reduce((sum, item) => sum + (item.volume || 0), 0),
      cumulativeVolume: last.cumulativeVolume ?? null,
      openInterest: last.openInterest ?? null,
      settlement: last.settlement ?? null
    };
  });
}

async function fetchSinaText(url, encoding = "gb18030") {
  const response = await fetch(url, {
    headers: {
      Referer: SINA_REFERER,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SHFE-Aluminum-PWA"
    }
  });

  if (!response.ok) {
    throw new Error(`Data source returned HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder(encoding);
  return decoder.decode(buffer);
}

async function fetchQuotes(symbols) {
  const list = symbols.map((symbol) => encodeURIComponent(symbol)).join(",");
  return fetchSinaText(`${SINA_QUOTE_ENDPOINT}${list}`);
}

async function fetchDailyKline(symbol) {
  const code = symbolToSinaCode(symbol);
  if (!code) throw new Error("Invalid futures symbol.");

  const variableName = `_${code}_day`;
  const url = `${SINA_KLINE_ENDPOINT}/var%20${encodeURIComponent(
    variableName
  )}=/InnerFuturesNewService.getDailyKLine?symbol=${encodeURIComponent(code)}`;

  return fetchSinaText(url, "utf-8");
}

async function fetchMinuteKline(symbol, type) {
  const code = symbolToSinaCode(symbol);
  if (!code) throw new Error("Invalid futures symbol.");

  const variableName = `_${code}_${type}`;
  const url = `${SINA_KLINE_ENDPOINT}/var%20${encodeURIComponent(
    variableName
  )}=/InnerFuturesNewService.getFewMinLine?symbol=${encodeURIComponent(
    code
  )}&type=${encodeURIComponent(type)}`;

  return fetchSinaText(url, "utf-8");
}

async function loadKline(symbol, intervalKey) {
  const config = KLINE_INTERVALS[intervalKey];

  if (config.source === "minute") {
    const text = await fetchMinuteKline(symbol, config.type);
    return parseKlinePayload(text, "minute");
  }

  if (config.source === "minute-aggregate") {
    const text = await fetchMinuteKline(symbol, config.type);
    const candles = parseKlinePayload(text, "minute");
    const bucketMs = config.hours * 60 * 60 * 1000;
    return aggregateCandles(candles, (candle) => Math.floor(chinaTimestamp(candle.date) / bucketMs));
  }

  const text = await fetchDailyKline(symbol);
  const candles = parseKlinePayload(text, "daily");

  if (config.source === "daily-aggregate" && config.period === "week") {
    return aggregateCandles(candles, (candle) => isoWeekKey(candle.date));
  }

  if (config.source === "daily-aggregate" && config.period === "month") {
    return aggregateCandles(candles, (candle) => candle.date.slice(0, 7));
  }

  return candles;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function handleQuote(req, res, url) {
  try {
    const productKey = normalizeProduct(url.searchParams.get("product"));
    const product = productConfig(productKey);
    const symbols = cleanSymbols(url.searchParams.get("symbols"), productKey);
    if (symbols.length === 0) {
      sendJson(res, 400, { error: "No valid futures symbols requested." });
      return;
    }

    const text = await fetchQuotes(symbols);
    const quotes = parseSinaPayload(text);
    sendJson(res, 200, {
      productKey,
      product: product.product,
      productLabel: product.label,
      defaultSymbol: product.defaultSymbol,
      exchange: "上海期货交易所",
      contractUnit: product.contractUnit,
      priceUnit: product.priceUnit,
      source: "新浪财经期货行情接口",
      sourceUrl: product.sourceUrl,
      fetchedAt: new Date().toISOString(),
      requestedSymbols: symbols,
      quotes
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "行情源暂时不可用",
      detail: error.message
    });
  }
}

async function handleKline(req, res, url) {
  try {
    const requestedSymbol = url.searchParams.get("symbol");
    const productKey = normalizeProduct(
      url.searchParams.get("product"),
      productKeyFromSymbol(requestedSymbol) || DEFAULT_PRODUCT
    );
    const product = productConfig(productKey);
    const symbol = normalizeSymbol(requestedSymbol || product.defaultSymbol, productKey);
    const interval = normalizeInterval(url.searchParams.get("interval"));
    const config = KLINE_INTERVALS[interval];
    const today = dateValue(new Date());
    const startTs =
      parseRangeTimestamp(url.searchParams.get("start"), "start") ??
      parseRangeTimestamp(KLINE_MIN_DATE, "start");
    const endTs =
      parseRangeTimestamp(url.searchParams.get("end"), "end") ??
      parseRangeTimestamp(today, "end");
    const requestedLimit = Number(url.searchParams.get("limit") || KLINE_MAX_BARS);
    const limit = clamp(Number.isFinite(requestedLimit) ? requestedLimit : KLINE_MAX_BARS, 30, KLINE_MAX_BARS);

    if (!symbol) {
      sendJson(res, 400, { error: "No valid futures symbol requested." });
      return;
    }

    const candles = await loadKline(symbol, interval);
    const rangedCandles = filterCandlesByRange(candles, startTs, endTs);
    const limitedCandles = rangedCandles.slice(-limit);
    sendJson(res, 200, {
      productKey,
      product: product.product,
      productLabel: product.label,
      symbol,
      code: symbolToSinaCode(symbol),
      interval,
      intervalLabel: config.label,
      priceUnit: product.priceUnit,
      source:
        config.source.includes("aggregate")
          ? "新浪财经期货 K 线接口，服务端聚合"
          : "新浪财经期货 K 线接口",
      fetchedAt: new Date().toISOString(),
      total: candles.length,
      rangeTotal: rangedCandles.length,
      limit,
      requestedStart: url.searchParams.get("start") || KLINE_MIN_DATE,
      requestedEnd: url.searchParams.get("end") || today,
      availableStart: candles[0]?.date || "",
      availableEnd: candles[candles.length - 1]?.date || "",
      candles: limitedCandles
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "K线数据暂时不可用",
      detail: error.message
    });
  }
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    const finalPath = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const ext = path.extname(finalPath).toLowerCase();
    const stream = fs.createReadStream(finalPath);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    stream.pipe(res);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "shfe-futures-app",
      time: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/quote") {
    handleQuote(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/kline") {
    handleKline(req, res, url);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, url);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`SHFE futures app is running at http://localhost:${PORT}`);
});
