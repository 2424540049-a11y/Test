const KLINE_INTERVAL_LABELS = {
  "1h": "1小时",
  "3h": "3小时",
  "5h": "5小时",
  "1d": "日线",
  "1w": "周线",
  "1mo": "月线"
};

const STRATEGY_LABELS = {
  none: "空",
  al_update_1: "铝更新1",
  al_best_1: "铝-1Best",
  al_volume_price: "铝：量价"
};

const STRATEGY_CONFIGS = {
  al_update_1: {
    label: STRATEGY_LABELS.al_update_1,
    period: 24,
    deviationPeriod: 24,
    deviationMultiple: 1.8,
    buyThreshold: "mid",
    sellThreshold: "low",
    lines: ["mid", "low"]
  },
  al_best_1: {
    label: STRATEGY_LABELS.al_best_1,
    period: 24,
    deviationPeriod: 24,
    deviationMultiple: 1.3,
    buyThreshold: "up",
    sellThreshold: "mid",
    lines: ["up", "mid"]
  },
  al_volume_price: {
    label: STRATEGY_LABELS.al_volume_price,
    period: 24,
    deviationPeriod: 24,
    deviationMultiple: 1.3,
    buyThreshold: "up",
    sellThreshold: "mid",
    lines: ["up", "mid", "low"],
    positionLabels: true
  }
};

const savedStrategy = localStorage.getItem("strategy") || "none";
const savedTheme = localStorage.getItem("klineTheme") || "light";

const state = {
  payload: null,
  selectedSymbol: localStorage.getItem("selectedSymbol") || "nf_AL0",
  refreshMs: Number(localStorage.getItem("refreshMs") || 15000),
  klineLimit: Number(localStorage.getItem("klineLimit") || 120),
  klineInterval: localStorage.getItem("klineInterval") || "1d",
  maPeriod: Number(localStorage.getItem("maPeriod") || 5),
  strategy: STRATEGY_LABELS[savedStrategy] ? savedStrategy : "none",
  klineTheme: savedTheme === "dark" ? "dark" : "light",
  klinePayload: null,
  klineCacheMode: false,
  klineSymbol: null,
  klineIntervalLoaded: null,
  timer: null,
  installPrompt: null,
  cacheMode: false
};

const els = {
  installButton: document.querySelector("#installButton"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshInterval: document.querySelector("#refreshInterval"),
  contractBadge: document.querySelector("#contractBadge"),
  marketState: document.querySelector("#marketState"),
  contractName: document.querySelector("#contractName"),
  lastPrice: document.querySelector("#lastPrice"),
  changeLine: document.querySelector("#changeLine"),
  quoteTime: document.querySelector("#quoteTime"),
  dataStatus: document.querySelector("#dataStatus"),
  openPrice: document.querySelector("#openPrice"),
  highPrice: document.querySelector("#highPrice"),
  lowPrice: document.querySelector("#lowPrice"),
  previousSettlement: document.querySelector("#previousSettlement"),
  bidPrice: document.querySelector("#bidPrice"),
  askPrice: document.querySelector("#askPrice"),
  volume: document.querySelector("#volume"),
  openInterest: document.querySelector("#openInterest"),
  contractsBody: document.querySelector("#contractsBody"),
  fetchStamp: document.querySelector("#fetchStamp"),
  klineTitle: document.querySelector("#klineTitle"),
  klineSubtitle: document.querySelector("#klineSubtitle"),
  klineStatus: document.querySelector("#klineStatus"),
  klineInterval: document.querySelector("#klineInterval"),
  klineRange: document.querySelector("#klineRange"),
  maPeriod: document.querySelector("#maPeriod"),
  klineTheme: document.querySelector("#klineTheme"),
  strategySelect: document.querySelector("#strategySelect"),
  klineChart: document.querySelector("#klineChart"),
  klineMeta: document.querySelector("#klineMeta"),
  toast: document.querySelector("#toast")
};

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function formatPrice(value) {
  return formatNumber(value, Number.isInteger(value) ? 0 : 2);
}

function formatChange(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPrice(value)}`;
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function localTime(isoString) {
  if (!isoString) return "--";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function trendClass(value) {
  if (value > 0) return "rise";
  if (value < 0) return "fall";
  return "neutral";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isMaEnabled(period) {
  return Number(period) > 0;
}

function findPrimaryQuote(quotes) {
  return (
    quotes.find((quote) => quote.symbol === state.selectedSymbol) ||
    quotes.find((quote) => quote.isContinuous) ||
    quotes[0] ||
    null
  );
}

function findSelectedQuote() {
  return state.payload?.quotes?.find((quote) => quote.symbol === state.selectedSymbol) || null;
}

function setText(id, value) {
  els[id].textContent = value;
}

function intervalLabel(interval = state.klineInterval) {
  return KLINE_INTERVAL_LABELS[interval] || interval;
}

function renderPrimary(quote) {
  if (!quote) return;
  const cls = trendClass(quote.change);

  setText("contractBadge", quote.code);
  setText("contractName", quote.name || quote.code);
  setText("lastPrice", formatPrice(quote.last));
  setText("quoteTime", quote.timestamp || "--");
  setText("openPrice", formatPrice(quote.open));
  setText("highPrice", formatPrice(quote.high));
  setText("lowPrice", formatPrice(quote.low));
  setText("previousSettlement", formatPrice(quote.previousSettlement));
  setText("bidPrice", formatPrice(quote.bid));
  setText("askPrice", formatPrice(quote.ask));
  setText("volume", formatNumber(quote.volume));
  setText("openInterest", formatNumber(quote.openInterest));

  els.changeLine.className = `change-line ${cls}`;
  els.changeLine.innerHTML = `
    <span>涨跌 ${formatChange(quote.change)}</span>
    <span>涨跌幅 ${formatPct(quote.changePct)}</span>
  `;

  const phase = quote.time >= "09:00:00" && quote.time <= "15:00:00" ? "日盘行情" : "最新行情";
  setText("marketState", quote.isMain ? `${phase} · 主力` : phase);
}

function quoteRow(quote) {
  const cls = trendClass(quote.change);
  const active = quote.symbol === state.selectedSymbol ? " class=\"active\"" : "";
  return `
    <tr data-symbol="${escapeHtml(quote.symbol)}"${active}>
      <td>
        <strong>${escapeHtml(quote.name || quote.code)}</strong>
        ${quote.isMain ? "<span class=\"contract-badge\">主力</span>" : ""}
      </td>
      <td><strong>${formatPrice(quote.last)}</strong></td>
      <td class="${cls}">${formatChange(quote.change)}</td>
      <td>${formatPrice(quote.open)}</td>
      <td>${formatPrice(quote.high)}</td>
      <td>${formatPrice(quote.low)}</td>
      <td>${formatNumber(quote.volume)}</td>
      <td>${formatNumber(quote.openInterest)}</td>
    </tr>
  `;
}

function renderTable(quotes) {
  if (!quotes.length) {
    els.contractsBody.innerHTML = "<tr><td colspan=\"8\" class=\"empty-cell\">暂无行情数据</td></tr>";
    return;
  }

  els.contractsBody.innerHTML = quotes.map(quoteRow).join("");
  els.contractsBody.querySelectorAll("tr[data-symbol]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedSymbol = row.dataset.symbol;
      localStorage.setItem("selectedSymbol", state.selectedSymbol);
      state.klineSymbol = null;
      render(state.payload);
    });
  });
}

function render(payload, cacheMode = false) {
  state.payload = payload;
  state.cacheMode = cacheMode;

  const quotes = payload?.quotes || [];
  const primary = findPrimaryQuote(quotes);
  if (primary && state.selectedSymbol !== primary.symbol && !quotes.some((q) => q.symbol === state.selectedSymbol)) {
    state.selectedSymbol = primary.symbol;
    localStorage.setItem("selectedSymbol", state.selectedSymbol);
  }

  renderPrimary(primary);
  renderTable(quotes);

  setText("dataStatus", cacheMode ? "离线缓存" : "已连接");
  setText("fetchStamp", `抓取时间 ${localTime(payload?.fetchedAt)}`);

  if (
    primary &&
    (state.klineSymbol !== primary.symbol || state.klineIntervalLoaded !== state.klineInterval)
  ) {
    fetchKline(primary.symbol);
  }
}

function showToast(message, duration = 3200) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    els.toast.hidden = true;
  }, duration);
}

function scheduleNext() {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(fetchQuotes, state.refreshMs);
}

async function fetchQuotes() {
  setText("dataStatus", "刷新中");

  try {
    const response = await fetch(`/api/quote?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.detail || errorPayload.error || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!payload.quotes?.length) throw new Error("没有返回可用行情");
    localStorage.setItem("lastQuotePayload", JSON.stringify(payload));
    render(payload, false);
  } catch (error) {
    const cached = localStorage.getItem("lastQuotePayload");
    if (cached) {
      render(JSON.parse(cached), true);
      showToast(`行情源暂时不可用，已显示最近缓存：${error.message}`);
    } else {
      setText("dataStatus", "连接失败");
      showToast(`行情获取失败：${error.message}`);
    }
  } finally {
    scheduleNext();
  }
}

async function fetchKline(symbol = state.selectedSymbol) {
  const quote = findSelectedQuote();
  const interval = state.klineInterval;
  const label = intervalLabel(interval);
  state.klineSymbol = symbol;
  state.klineIntervalLoaded = interval;
  els.klineTitle.textContent = `${quote?.name || symbol.replace(/^nf_/, "")} ${label} K线`;
  els.klineSubtitle.textContent = `正在加载${label}数据...`;
  els.klineStatus.textContent = "加载中";
  els.klineChart.className = "chart-empty";
  els.klineChart.textContent = "正在加载 K 线...";
  els.klineMeta.innerHTML = "";

  const cacheKey = `lastKlinePayload:${symbol}:${interval}:${state.klineLimit}`;

  try {
    const response = await fetch(
      `/api/kline?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
        interval
      )}&limit=${state.klineLimit}&t=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.detail || errorPayload.error || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!payload.candles?.length) throw new Error("没有返回可用K线");
    localStorage.setItem(cacheKey, JSON.stringify(payload));
    renderKline(payload, false);
  } catch (error) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      renderKline(JSON.parse(cached), true);
      showToast(`K线源暂时不可用，已显示缓存：${error.message}`);
    } else {
      els.klineStatus.textContent = "加载失败";
      els.klineSubtitle.textContent = "K 线数据暂时不可用";
      els.klineChart.className = "chart-empty";
      els.klineChart.textContent = `K 线获取失败：${error.message}`;
    }
  }
}

function movingAverage(candles, period) {
  if (!isMaEnabled(period)) return candles.map(() => null);

  const values = [];
  let sum = 0;

  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index].close;
    if (index >= period) sum -= candles[index - period].close;
    values.push(index >= period - 1 ? sum / period : null);
  }

  return values;
}

function rollingStd(candles, period) {
  const values = [];

  for (let index = 0; index < candles.length; index += 1) {
    if (index < period - 1) {
      values.push(null);
      continue;
    }

    let sum = 0;
    for (let item = index - period + 1; item <= index; item += 1) {
      sum += candles[item].close;
    }

    const mean = sum / period;
    let varianceSum = 0;
    for (let item = index - period + 1; item <= index; item += 1) {
      const distance = candles[item].close - mean;
      varianceSum += distance * distance;
    }

    values.push(Math.sqrt(varianceSum / period));
  }

  return values;
}

function lineValuesForStrategy(config, candles) {
  const mid = movingAverage(candles, config.period);
  const std = rollingStd(candles, config.deviationPeriod);
  const up = mid.map((value, index) =>
    isFiniteNumber(value) && isFiniteNumber(std[index])
      ? value + std[index] * config.deviationMultiple
      : null
  );
  const low = mid.map((value, index) =>
    isFiniteNumber(value) && isFiniteNumber(std[index])
      ? value - std[index] * config.deviationMultiple
      : null
  );

  return { up, mid, low };
}

function strategyThreshold(lineValues, threshold, index) {
  return lineValues[threshold]?.[index] ?? null;
}

function strategySignal(index, label, price, className, dy) {
  return {
    index,
    label,
    price,
    className,
    dy
  };
}

function alternatingSignals(candles, rawBuy, rawSell) {
  const signals = [];
  const noSignalDistance = 1000000;
  let lastBuyDistance = noSignalDistance;
  let lastSellDistance = noSignalDistance;

  for (let index = 0; index < candles.length; index += 1) {
    const preBuyDistance = lastBuyDistance;
    const preSellDistance = lastSellDistance;
    const buy0 = rawBuy[index] && preSellDistance <= preBuyDistance;
    const sell0 = rawSell[index] && preBuyDistance < preSellDistance;
    const buySignal = buy0;
    const sellSignal = sell0 && !buy0;

    if (buySignal) {
      signals.push(strategySignal(index, "升高", candles[index].low, "strategy-buy", 16));
    } else if (sellSignal) {
      signals.push(strategySignal(index, "降低", candles[index].high, "strategy-sell", -8));
    }

    lastBuyDistance = rawBuy[index] ? 0 : lastBuyDistance + 1;
    lastSellDistance = rawSell[index] ? 0 : lastSellDistance + 1;
  }

  return signals;
}

function positionChangeSignals(candles) {
  const signals = [];

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (!isFiniteNumber(current.openInterest) || !isFiniteNumber(previous.openInterest)) continue;

    const openInterestChange = current.openInterest - previous.openInterest;
    if (current.close > previous.close && openInterestChange > 0) {
      signals.push(
        strategySignal(index, "多增", current.low * 0.998, "position-long-add", 16)
      );
    }
    if (current.close < previous.close && openInterestChange < 0) {
      signals.push(
        strategySignal(index, "多减", current.high * 1.002, "position-long-reduce", -8)
      );
    }
    if (current.close < previous.close && openInterestChange > 0) {
      signals.push(
        strategySignal(index, "空增", current.high * 1.004, "position-short-add", -8)
      );
    }
    if (current.close > previous.close && openInterestChange < 0) {
      signals.push(
        strategySignal(index, "空减", current.low * 0.996, "position-short-reduce", 16)
      );
    }
  }

  return signals;
}

function computeStrategy(candles, strategyKey) {
  const config = STRATEGY_CONFIGS[strategyKey];
  if (!config || !candles.length) return null;

  const lineValues = lineValuesForStrategy(config, candles);
  const rawBuy = candles.map((item, index) => {
    const threshold = strategyThreshold(lineValues, config.buyThreshold, index);
    return isFiniteNumber(threshold) && item.high >= threshold;
  });
  const rawSell = candles.map((item, index) => {
    const threshold = strategyThreshold(lineValues, config.sellThreshold, index);
    return isFiniteNumber(threshold) && item.close <= threshold;
  });

  const lineClassByName = {
    up: "strategy-line-up",
    mid: "strategy-line-mid",
    low: "strategy-line-low"
  };
  const lineLabelByName = {
    up: "上轨",
    mid: "中轨",
    low: "下轨"
  };
  const lines = config.lines.map((name) => ({
    name,
    label: lineLabelByName[name],
    className: lineClassByName[name],
    values: lineValues[name]
  }));
  const signals = alternatingSignals(candles, rawBuy, rawSell);

  if (config.positionLabels) {
    signals.push(...positionChangeSignals(candles));
  }

  return {
    key: strategyKey,
    label: config.label,
    lines,
    signals
  };
}

function renderKline(payload, cacheMode = false) {
  state.klinePayload = payload;
  state.klineCacheMode = cacheMode;

  const quote = state.payload?.quotes?.find((item) => item.symbol === payload.symbol);
  const candles = payload.candles || [];
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const maValues = movingAverage(candles, state.maPeriod);
  const strategy = computeStrategy(candles, state.strategy);
  const latestMa = maValues[maValues.length - 1];
  const change = latest && previous ? latest.close - previous.close : null;
  const changePct = change !== null && previous?.close ? (change / previous.close) * 100 : null;
  const label = payload.intervalLabel || intervalLabel(payload.interval);
  const maText = isMaEnabled(state.maPeriod) ? `MA${state.maPeriod}` : "均线 空";
  const strategyText = strategy ? ` · 策略 ${strategy.label}` : "";
  const openInterestLabel = latest?.openInterest === null ? "累计量" : "持仓量";
  const openInterestValue =
    latest?.openInterest === null ? latest?.cumulativeVolume : latest?.openInterest;

  els.klineTitle.textContent = `${quote?.name || payload.code} ${label} K线`;
  els.klineSubtitle.textContent = `${label} · 最近 ${candles.length} 根 · ${maText}${strategyText} · ${payload.priceUnit}`;
  els.klineStatus.textContent = cacheMode ? "离线缓存" : `更新 ${localTime(payload.fetchedAt)}`;
  els.klineChart.className = `kline-chart theme-${state.klineTheme}`;
  els.klineChart.innerHTML = buildKlineSvg(
    candles,
    maValues,
    state.maPeriod,
    payload.interval,
    strategy
  );
  setupChartPointer(candles);
  els.klineMeta.innerHTML = latest
    ? `
      <div><span>时间</span><strong>${escapeHtml(latest.date)}</strong></div>
      <div><span>开盘</span><strong>${formatPrice(latest.open)}</strong></div>
      <div><span>最高</span><strong>${formatPrice(latest.high)}</strong></div>
      <div><span>最低</span><strong>${formatPrice(latest.low)}</strong></div>
      <div><span>收盘</span><strong>${formatPrice(latest.close)}</strong></div>
      <div><span>涨跌</span><strong class="${trendClass(change)}">${formatChange(change)} / ${formatPct(changePct)}</strong></div>
      <div><span>${maText}</span><strong>${isMaEnabled(state.maPeriod) ? formatPrice(latestMa) : "空"}</strong></div>
      <div><span>成交量</span><strong>${formatNumber(latest.volume)}</strong></div>
      <div><span>${openInterestLabel}</span><strong>${formatNumber(openInterestValue)}</strong></div>
    `
    : "";
}

function shortDateLabel(date, interval) {
  if (date.includes(" ")) {
    const [day, time] = date.split(" ");
    return `${day.slice(5)} ${time.slice(0, 5)}`;
  }
  if (interval === "1mo") return date.slice(0, 7);
  return date.slice(5);
}

function linePath(values, xFor, yFor) {
  let path = "";
  let started = false;
  values.forEach((value, index) => {
    if (value === null || value === undefined || Number.isNaN(value)) return;
    path += `${started ? "L" : "M"} ${xFor(index).toFixed(2)} ${yFor(value).toFixed(2)} `;
    started = true;
  });
  return path.trim();
}

function setupChartPointer(candles) {
  const chart = els.klineChart;
  const svg = chart.querySelector("svg");
  const crosshair = svg?.querySelector(".crosshair");
  if (!svg || !crosshair || !candles.length) return;

  const vLine = crosshair.querySelector(".crosshair-v");
  const hLine = crosshair.querySelector(".crosshair-h");
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.hidden = true;
  chart.appendChild(tooltip);

  const meta = {
    width: Number(svg.dataset.width),
    height: Number(svg.dataset.height),
    left: Number(svg.dataset.left),
    right: Number(svg.dataset.right),
    priceTop: Number(svg.dataset.priceTop),
    priceHeight: Number(svg.dataset.priceHeight),
    yMax: Number(svg.dataset.yMax),
    yMin: Number(svg.dataset.yMin)
  };
  const plotRight = meta.width - meta.right;
  const plotWidth = plotRight - meta.left;
  const priceBottom = meta.priceTop + meta.priceHeight;
  const priceRange = Math.max(meta.yMax - meta.yMin, 1);
  const slot = plotWidth / candles.length;

  const showPointer = (event) => {
    const svgRect = svg.getBoundingClientRect();
    const chartRect = chart.getBoundingClientRect();
    const x = ((event.clientX - svgRect.left) / svgRect.width) * meta.width;
    const y = ((event.clientY - svgRect.top) / svgRect.height) * meta.height;
    const pointerX = clamp(x, meta.left, plotRight);
    const pointerY = clamp(y, meta.priceTop, priceBottom);
    const index = clamp(Math.floor((pointerX - meta.left) / slot), 0, candles.length - 1);
    const candle = candles[index];
    const price = meta.yMax - ((pointerY - meta.priceTop) / meta.priceHeight) * priceRange;

    vLine.setAttribute("x1", pointerX);
    vLine.setAttribute("x2", pointerX);
    hLine.setAttribute("y1", pointerY);
    hLine.setAttribute("y2", pointerY);
    crosshair.setAttribute("visibility", "visible");

    tooltip.innerHTML = `
      <strong>${formatPrice(price)} 元/吨</strong>
      <span>${escapeHtml(candle.date)}</span>
      <span>开 ${formatPrice(candle.open)} 高 ${formatPrice(candle.high)}</span>
      <span>低 ${formatPrice(candle.low)} 收 ${formatPrice(candle.close)}</span>
    `;

    const cssX = event.clientX - chartRect.left + 14;
    const cssY = event.clientY - chartRect.top + 14;
    tooltip.style.left = `${clamp(cssX, 8, Math.max(chartRect.width - 188, 8))}px`;
    tooltip.style.top = `${clamp(cssY, 8, Math.max(chartRect.height - 104, 8))}px`;
    tooltip.hidden = false;
  };

  const hidePointer = () => {
    crosshair.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  };

  svg.addEventListener("pointermove", showPointer);
  svg.addEventListener("pointerleave", hidePointer);
}

function buildKlineSvg(candles, maValues, maPeriod, interval, strategy) {
  if (!candles.length) return "";

  const width = 980;
  const height = 450;
  const margin = { top: 24, right: 64, bottom: 44, left: 70 };
  const priceTop = margin.top;
  const priceHeight = 286;
  const volumeTop = 342;
  const volumeHeight = 62;
  const plotWidth = width - margin.left - margin.right;
  const highs = candles.map((item) => item.high);
  const lows = candles.map((item) => item.low);
  const maForRange = maValues.filter(isFiniteNumber);
  const strategyLineValues = strategy
    ? strategy.lines.flatMap((line) => line.values.filter(isFiniteNumber))
    : [];
  const strategySignalPrices = strategy
    ? strategy.signals.map((signal) => signal.price).filter(isFiniteNumber)
    : [];
  const maxPrice = Math.max(...highs, ...maForRange, ...strategyLineValues, ...strategySignalPrices);
  const minPrice = Math.min(...lows, ...maForRange, ...strategyLineValues, ...strategySignalPrices);
  const pricePadding = Math.max((maxPrice - minPrice) * 0.08, 10);
  const yMax = maxPrice + pricePadding;
  const yMin = minPrice - pricePadding;
  const priceRange = Math.max(yMax - yMin, 1);
  const volumes = candles.map((item) => item.volume || 0);
  const maxVolume = Math.max(...volumes, 1);
  const slot = plotWidth / candles.length;
  const bodyWidth = clamp(slot * 0.58, 2, 10);

  const xFor = (index) => margin.left + slot * index + slot / 2;
  const yFor = (value) => priceTop + ((yMax - value) / priceRange) * priceHeight;
  const volumeY = (value) => volumeTop + volumeHeight - (value / maxVolume) * volumeHeight;
  const maPath = linePath(maValues, xFor, yFor);
  const strategyLinesSvg = strategy
    ? strategy.lines
        .map((line) => {
          const path = linePath(line.values, xFor, yFor);
          return path
            ? `<path d="${path}" class="strategy-line ${line.className}"><title>${escapeHtml(
                strategy.label
              )} ${escapeHtml(line.label)}</title></path>`
            : "";
        })
        .join("")
    : "";

  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const y = priceTop + priceHeight * ratio;
    const price = yMax - priceRange * ratio;
    return `
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}" class="chart-grid" />
      <text x="${width - margin.right + 10}" y="${y + 4}" class="axis-label">${formatPrice(price)}</text>
    `;
  }).join("");

  const candlesSvg = candles
    .map((item, index) => {
      const x = xFor(index);
      const openY = yFor(item.open);
      const closeY = yFor(item.close);
      const highY = yFor(item.high);
      const lowY = yFor(item.low);
      const isRise = item.close >= item.open;
      const cls = isRise ? "candle-rise" : "candle-fall";
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
      const volY = volumeY(item.volume || 0);
      const volHeight = volumeTop + volumeHeight - volY;
      return `
        <g>
          <title>${escapeHtml(item.date)} 开:${formatPrice(item.open)} 高:${formatPrice(item.high)} 低:${formatPrice(item.low)} 收:${formatPrice(item.close)}</title>
          <line x1="${x}" x2="${x}" y1="${highY}" y2="${lowY}" class="${cls}" />
          <rect x="${x - bodyWidth / 2}" y="${bodyTop}" width="${bodyWidth}" height="${bodyHeight}" rx="1" class="${cls}" />
          <rect x="${x - bodyWidth / 2}" y="${volY}" width="${bodyWidth}" height="${volHeight}" rx="1" class="${cls} volume-bar" />
        </g>
      `;
    })
    .join("");

  const strategySignalsSvg = strategy
    ? strategy.signals
        .map((signal) => {
          if (!isFiniteNumber(signal.price)) return "";
          const x = xFor(signal.index);
          const y = clamp(
            yFor(signal.price) + signal.dy,
            priceTop + 14,
            priceTop + priceHeight - 4
          );
          const candle = candles[signal.index];
          const labelWidth = Math.max(42, signal.label.length * 16 + 14);
          const labelHeight = 20;
          return `
            <g class="strategy-signal-group ${signal.className}">
              <title>${escapeHtml(candle?.date || "")} ${escapeHtml(signal.label)} ${formatPrice(signal.price)}</title>
              <rect x="${(x - labelWidth / 2).toFixed(2)}" y="${(y - 15).toFixed(2)}" width="${labelWidth}" height="${labelHeight}" rx="5" class="strategy-signal-bg" />
              <text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="strategy-signal">${escapeHtml(signal.label)}</text>
            </g>
          `;
        })
        .join("")
    : "";

  const labelIndexes = [0, Math.floor((candles.length - 1) / 2), candles.length - 1];
  const dateLabels = Array.from(new Set(labelIndexes))
    .map((index) => {
      const x = xFor(index);
      return `<text x="${x}" y="${height - 14}" class="date-label">${escapeHtml(shortDateLabel(candles[index].date, interval))}</text>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="K线图" data-width="${width}" data-height="${height}" data-left="${margin.left}" data-right="${margin.right}" data-price-top="${priceTop}" data-price-height="${priceHeight}" data-y-max="${yMax}" data-y-min="${yMin}">
      <rect x="0" y="0" width="${width}" height="${height}" class="chart-bg" />
      ${grid}
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${priceTop + priceHeight}" y2="${priceTop + priceHeight}" class="chart-axis" />
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${volumeTop + volumeHeight}" y2="${volumeTop + volumeHeight}" class="chart-axis" />
      <text x="${margin.left}" y="${volumeTop - 10}" class="axis-label">成交量</text>
      ${isMaEnabled(maPeriod) ? `<text x="${margin.left}" y="17" class="ma-label">MA${maPeriod}</text>` : ""}
      ${strategy ? `<text x="${isMaEnabled(maPeriod) ? margin.left + 58 : margin.left}" y="17" class="strategy-legend">${escapeHtml(strategy.label)}</text>` : ""}
      ${candlesSvg}
      ${strategyLinesSvg}
      ${maPath ? `<path d="${maPath}" class="ma-line" />` : ""}
      ${strategySignalsSvg}
      <g class="crosshair" visibility="hidden">
        <line x1="${margin.left}" x2="${margin.left}" y1="${priceTop}" y2="${priceTop + priceHeight}" class="crosshair-line crosshair-v" />
        <line x1="${margin.left}" x2="${width - margin.right}" y1="${priceTop}" y2="${priceTop}" class="crosshair-line crosshair-h" />
      </g>
      ${dateLabels}
    </svg>
  `;
}

function setupInstallButton() {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;

  els.installButton.hidden = false;

  if (isStandalone) {
    els.installButton.textContent = "已安装";
    els.installButton.disabled = true;
    return;
  }

  els.installButton.textContent = "安装";

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    els.installButton.hidden = false;
  });

  els.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) {
      showToast(getInstallHelpText(), 9000);
      return;
    }
    state.installPrompt.prompt();
    const result = await state.installPrompt.userChoice;
    state.installPrompt = null;
    if (result.outcome === "accepted") {
      els.installButton.textContent = "已安装";
      els.installButton.disabled = true;
    }
  });
}

function getInstallHelpText() {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) {
    return "iPhone/iPad：请用 Safari 打开这个地址，点底部分享按钮，再选“添加到主屏幕”。";
  }
  if (/android/.test(ua)) {
    return "安卓手机：请用 Chrome 或 Edge 打开，点右上角菜单，再选“安装应用”或“添加到主屏幕”。";
  }
  return "电脑：请用 Edge 或 Chrome 打开，点地址栏右侧安装图标；如果没有图标，点右上角菜单 → 应用 → 将此站点安装为应用。Codex 内置浏览器通常不会显示系统安装入口。";
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      showToast("离线缓存注册失败，不影响实时行情。");
    });
  });
}

els.refreshInterval.value = String(state.refreshMs);
els.refreshInterval.addEventListener("change", () => {
  state.refreshMs = Number(els.refreshInterval.value);
  localStorage.setItem("refreshMs", String(state.refreshMs));
  scheduleNext();
});

els.klineInterval.value = state.klineInterval;
els.klineInterval.addEventListener("change", () => {
  state.klineInterval = els.klineInterval.value;
  state.klineIntervalLoaded = null;
  localStorage.setItem("klineInterval", state.klineInterval);
  fetchKline(state.selectedSymbol);
});

els.klineRange.value = String(state.klineLimit);
els.klineRange.addEventListener("change", () => {
  state.klineLimit = Number(els.klineRange.value);
  localStorage.setItem("klineLimit", String(state.klineLimit));
  fetchKline(state.selectedSymbol);
});

els.maPeriod.value = String(state.maPeriod);
els.maPeriod.addEventListener("change", () => {
  state.maPeriod = Number(els.maPeriod.value);
  localStorage.setItem("maPeriod", String(state.maPeriod));
  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
  }
});

els.klineTheme.value = state.klineTheme;
els.klineTheme.addEventListener("change", () => {
  state.klineTheme = els.klineTheme.value === "dark" ? "dark" : "light";
  localStorage.setItem("klineTheme", state.klineTheme);
  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
  }
});

els.strategySelect.value = state.strategy;
els.strategySelect.addEventListener("change", () => {
  state.strategy = els.strategySelect.value;
  localStorage.setItem("strategy", state.strategy);
  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
  }
});

els.refreshButton.addEventListener("click", () => {
  window.clearTimeout(state.timer);
  state.klineSymbol = null;
  fetchQuotes();
});

setupInstallButton();
setupServiceWorker();
fetchQuotes();
