import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ComposedChart, Bar, Line, Area, AreaChart, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell
} from "recharts";
import {
  Star, Search, Bell, Maximize2, Settings, HelpCircle, Home, BarChart3,
  LineChart as LineChartIcon, TrendingUp, AlertTriangle, Newspaper, DollarSign,
  Percent, GitCompare, History, FlaskConical, Accessibility, Menu, X, Plus,
  Minus, ExternalLink, RefreshCw, ChevronUp, ChevronDown, Wifi, WifiOff,
  ArrowUpDown, Crown
} from "lucide-react";

/* ============================== CONSTANTES ============================== */

const MONITORED_DEFAULT = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
  { id: "binancecoin", symbol: "BNB" },
  { id: "ripple", symbol: "XRP" },
  { id: "cardano", symbol: "ADA" },
  { id: "dogecoin", symbol: "DOGE" },
  { id: "avalanche-2", symbol: "AVAX" },
  { id: "chainlink", symbol: "LINK" },
  { id: "polkadot", symbol: "DOT" },
  { id: "sui", symbol: "SUI" },
  { id: "the-open-network", symbol: "TON" },
];

const REFRESH_MS = 60000;
const HIST_REFRESH_MS = 5 * 60000;

const COLORS = {
  bg: "#0a0b0f",
  panel: "#12141a",
  panel2: "#181b22",
  border: "#26293580",
  gold: "#e8b93f",
  goldSoft: "#f0c65e",
  green: "#16c784",
  red: "#ea3943",
  text: "#eceef2",
  sub: "#9aa0ac",
};

/* ============================== MATH / INDICADORES ============================== */

function ema(values, period) {
  if (!values || values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev;
  values.forEach((v, i) => {
    if (i === 0) { prev = v; }
    else { prev = v * k + prev * (1 - k); }
    out.push(prev);
  });
  return out;
}
function sma(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += values[j];
    out.push(s / period);
  }
  return out;
}
function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
function macdCalc(values) {
  if (values.length < 26) return { macd: null, signal: null, hist: null };
  const ema12 = ema(values, 12), ema26 = ema(values, 26);
  const macdLine = values.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = ema(macdLine, 9);
  const last = macdLine.length - 1;
  return { macd: macdLine[last], signal: signalLine[last], hist: macdLine[last] - signalLine[last] };
}
function stddev(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    const slice = values.slice(i - period + 1, i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / period;
    const v = slice.reduce((a, b) => a + (b - m) ** 2, 0) / period;
    out.push(Math.sqrt(v));
  }
  return out;
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function computeIndicators(closes) {
  if (!closes || closes.length < 30) return null;
  const e9 = ema(closes, 9), e21 = ema(closes, 21), e50 = ema(closes, 50);
  const e200 = closes.length >= 200 ? ema(closes, 200) : null;
  const s50 = sma(closes, 50), s200 = closes.length >= 200 ? sma(closes, 200) : null;
  const last = closes.length - 1;
  const r = rsi(closes.slice(-100));
  const m = macdCalc(closes);
  const sma20 = sma(closes, 20), sd20 = stddev(closes, 20);
  const bbMid = sma20[last], bbSd = sd20[last];
  const bbUpper = bbMid != null ? bbMid + 2 * bbSd : null;
  const bbLower = bbMid != null ? bbMid - 2 * bbSd : null;
  const recentSlice = closes.slice(-60);
  const support = Math.min(...recentSlice);
  const resistance = Math.max(...recentSlice);
  return {
    price: closes[last],
    ema9: e9[last], ema21: e21[last], ema50: e50[last], ema200: e200 ? e200[last] : null,
    sma50: s50[last], sma200: s200 ? s200[last] : null,
    rsi14: r, macd: m, bbUpper, bbLower, bbMid,
    support, resistance,
  };
}

/* Score de Oportunidade 0-100 (pesos conforme especificação do usuário) */
function computeScore(market, ind) {
  if (!ind) return null;
  let trendScore = 50;
  const aligns = [ind.ema9 > ind.ema21, ind.ema21 > ind.ema50, ind.price > ind.ema50];
  trendScore = 30 + aligns.filter(Boolean).length * 23.3;
  trendScore = clamp(trendScore, 0, 100);

  let rsiScore = 50;
  if (ind.rsi14 != null) {
    if (ind.rsi14 <= 30) rsiScore = 85 - (30 - ind.rsi14);
    else if (ind.rsi14 <= 50) rsiScore = 60 + (50 - ind.rsi14) * 0.8;
    else if (ind.rsi14 <= 70) rsiScore = 60 - (ind.rsi14 - 50) * 0.8;
    else rsiScore = clamp(40 - (ind.rsi14 - 70), 0, 40);
  }

  let macdScore = 50;
  if (ind.macd.hist != null) macdScore = clamp(50 + ind.macd.hist / (ind.price * 0.002) * 10, 0, 100);

  let distScore = 50;
  if (ind.ema50) {
    const distPct = ((ind.price - ind.ema50) / ind.ema50) * 100;
    distScore = clamp(70 - Math.abs(distPct) * 3, 10, 90);
    if (distPct > 0 && distPct < 8) distScore += 15;
  }

  let srScore = 50;
  if (ind.support && ind.resistance && ind.resistance !== ind.support) {
    const pos = (ind.price - ind.support) / (ind.resistance - ind.support);
    srScore = clamp(90 - pos * 60, 20, 90);
  }

  const vol24 = market.total_volume || 0;
  const mcap = market.market_cap || 1;
  const liquidity = vol24 / mcap;
  const volumeScore = clamp(liquidity * 800, 10, 90);

  const mom = (market.price_change_percentage_24h_in_currency || 0) * 0.5 +
              (market.price_change_percentage_7d_in_currency || 0) * 0.5;
  const momentumScore = clamp(50 + mom * 2.5, 0, 100);

  const range24 = market.high_24h && market.low_24h ? ((market.high_24h - market.low_24h) / market.current_price) * 100 : 5;
  const riskScore = clamp(90 - range24 * 6, 5, 90);

  const score =
    trendScore * 0.20 + rsiScore * 0.15 + macdScore * 0.10 + distScore * 0.10 +
    srScore * 0.15 + volumeScore * 0.10 + momentumScore * 0.10 + riskScore * 0.10;

  return Math.round(clamp(score, 0, 100));
}

function scoreLabel(score) {
  if (score >= 90) return { text: "Oportunidade excepcional", color: COLORS.gold };
  if (score >= 80) return { text: "Muito interessante", color: COLORS.green };
  if (score >= 70) return { text: "Interessante", color: COLORS.green };
  if (score >= 60) return { text: "Observar", color: "#c9d14a" };
  if (score >= 50) return { text: "Neutra", color: COLORS.sub };
  if (score >= 40) return { text: "Atenção", color: "#e08a3c" };
  return { text: "Risco elevado", color: COLORS.red };
}

function computeDiscount(market, ind) {
  const athChange = market.ath_change_percentage; // negativo
  if (athChange == null || !ind) return { level: "—", label: "Dados insuficientes", drop: null };
  const drop = Math.abs(athChange);
  if (drop < 15) return { level: "none", label: "Próximo da máxima", drop };

  const rsiOk = ind.rsi14 != null && ind.rsi14 > 30 && ind.rsi14 < 60;
  const aboveEma21 = ind.price > ind.ema21;
  const macdTurning = ind.macd.hist != null && ind.macd.hist > -Math.abs(ind.price * 0.001);
  const mom7d = market.price_change_percentage_7d_in_currency || 0;

  const positives = [rsiOk, aboveEma21, macdTurning, mom7d > 0].filter(Boolean).length;

  if (positives >= 3) return { level: "green", label: "Desconto com possível recuperação", drop };
  if (positives >= 1) return { level: "yellow", label: "Desconto — aguardar confirmação", drop };
  return { level: "red", label: "Queda forte — tendência de baixa", drop };
}

/* ============================== FORMATADORES ============================== */

const fmtUSD = (v) => v == null ? "DADO NÃO DISPONÍVEL" :
  v >= 1 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${v.toPrecision(4)}`;
const fmtBRL = (v) => v == null ? "DADO NÃO DISPONÍVEL" :
  `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: v >= 1 ? 2 : 6 })}`;
const fmtPct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const fmtCompact = (v) => v == null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);

/* ============================== APP ============================== */

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [markets, setMarkets] = useState({});
  const [globalData, setGlobalData] = useState(null);
  const [fng, setFng] = useState(null);
  const [usdbrl, setUsdbrl] = useState(null);
  const [monitored, setMonitored] = useState(MONITORED_DEFAULT);
  const [histCache, setHistCache] = useState({});
  const [favorites, setFavorites] = useState(["bitcoin", "ethereum", "solana"]);
  const [selectedCoin, setSelectedCoin] = useState("bitcoin");
  const [timeframe, setTimeframe] = useState("1D");
  const [connected, setConnected] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [nextUpdate, setNextUpdate] = useState(REFRESH_MS / 1000);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [capital, setCapital] = useState(5000);
  const [riskPct, setRiskPct] = useState(1);
  const [compareIds, setCompareIds] = useState(["bitcoin", "ethereum"]);
  const [ohlcData, setOhlcData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [alertRules, setAlertRules] = useState([
    { id: 1, coin: "bitcoin", symbol: "BTC", cond: "RSI abaixo de 30", active: true },
    { id: 2, coin: "ethereum", symbol: "ETH", cond: "Cruzamento EMA 9/21", active: true },
  ]);
  const [triggeredAlerts, setTriggeredAlerts] = useState([]);

  // acessibilidade
  const [fontScale, setFontScale] = useState(1);
  const [highContrast, setHighContrast] = useState(false);
  const [bigButtons, setBigButtons] = useState(false);

  const errCountRef = useRef(0);

  /* ---------- fetch de mercado (preço, variações, volume) ---------- */
  const fetchMarkets = useCallback(async () => {
    try {
      const ids = monitored.map((m) => m.id).join(",");
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&price_change_percentage=1h,24h,7d,30d&sparkline=true`
      );
      if (!res.ok) throw new Error("market fetch failed");
      const data = await res.json();
      const map = {};
      data.forEach((c) => { map[c.id] = c; });
      setMarkets(map);
      setConnected(true);
      errCountRef.current = 0;
      setLastUpdate(new Date());
    } catch (e) {
      errCountRef.current += 1;
      if (errCountRef.current >= 2) setConnected(false);
    }
  }, [monitored]);

  const fetchGlobal = useCallback(async () => {
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/global");
      const data = await res.json();
      setGlobalData(data.data);
    } catch (e) { /* mantem ultimo valor conhecido */ }
  }, []);

  const fetchFng = useCallback(async () => {
    try {
      const res = await fetch("https://api.alternative.me/fng/?limit=1");
      const data = await res.json();
      setFng(data.data[0]);
    } catch (e) {}
  }, []);

  const fetchFx = useCallback(async () => {
    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=BRL");
      const data = await res.json();
      setUsdbrl({ rate: data.rates.BRL, date: data.date });
    } catch (e) {}
  }, []);

  const fetchHistFor = useCallback(async (id) => {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=220&interval=daily`
      );
      const data = await res.json();
      const closes = data.prices.map((p) => p[1]);
      return closes;
    } catch (e) { return null; }
  }, []);

  const refreshAllHistory = useCallback(async () => {
    const next = {};
    for (const c of monitored) {
      const closes = await fetchHistFor(c.id);
      if (closes) next[c.id] = closes;
    }
    setHistCache((prev) => ({ ...prev, ...next }));
  }, [monitored, fetchHistFor]);

  const fetchOhlc = useCallback(async (id, tf) => {
    setChartLoading(true);
    const daysMap = { "15m": 1, "1H": 7, "4H": 14, "1D": 90, "1W": 365 };
    const days = daysMap[tf] || 30;
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`);
      const data = await res.json();
      const parsed = data.map((d) => ({
        time: new Date(d[0]).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        open: d[1], high: d[2], low: d[3], close: d[4],
      }));
      setOhlcData(parsed.slice(-90));
    } catch (e) { setOhlcData([]); }
    setChartLoading(false);
  }, []);

  useEffect(() => { fetchMarkets(); fetchGlobal(); fetchFng(); fetchFx(); refreshAllHistory(); }, []); // eslint-disable-line
  useEffect(() => { fetchOhlc(selectedCoin, timeframe); }, [selectedCoin, timeframe, fetchOhlc]);

  useEffect(() => {
    const iv = setInterval(() => {
      fetchMarkets(); fetchGlobal(); fetchFng();
      setNextUpdate(REFRESH_MS / 1000);
    }, REFRESH_MS);
    const histIv = setInterval(() => { refreshAllHistory(); fetchFx(); }, HIST_REFRESH_MS);
    const tick = setInterval(() => setNextUpdate((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => { clearInterval(iv); clearInterval(histIv); clearInterval(tick); };
  }, [fetchMarkets, fetchGlobal, refreshAllHistory, fetchFx]);

  /* ---------- busca de moedas ---------- */
  useEffect(() => {
    if (searchQuery.trim().length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults((data.coins || []).slice(0, 6));
      } catch (e) { setSearchResults([]); }
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const addCoin = (coin) => {
    if (!monitored.find((m) => m.id === coin.id)) {
      setMonitored((prev) => [...prev, { id: coin.id, symbol: coin.symbol.toUpperCase() }]);
      fetchHistFor(coin.id).then((closes) => closes && setHistCache((p) => ({ ...p, [coin.id]: closes })));
    }
    setSearchQuery(""); setSearchResults([]);
  };

  const toggleFavorite = (id) => {
    setFavorites((prev) => prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]);
  };

  /* ---------- dados derivados ---------- */
  const enriched = useMemo(() => {
    return monitored.map((c) => {
      const m = markets[c.id];
      const closes = histCache[c.id];
      const ind = closes ? computeIndicators(closes) : null;
      const score = m && ind ? computeScore(m, ind) : null;
      const discount = m ? computeDiscount(m, ind) : null;
      return { ...c, market: m, ind, score, discount };
    }).filter((c) => c.market);
  }, [monitored, markets, histCache]);

  const topOpportunities = useMemo(() =>
    [...enriched].filter((c) => c.score != null).sort((a, b) => b.score - a.score).slice(0, 10),
    [enriched]);

  const discounted = useMemo(() =>
    enriched.filter((c) => c.discount && c.discount.drop != null && c.discount.drop >= 15)
      .sort((a, b) => b.discount.drop - a.discount.drop),
    [enriched]);

  const gainers = useMemo(() =>
    [...enriched].sort((a, b) => (b.market.price_change_percentage_24h_in_currency || -999) - (a.market.price_change_percentage_24h_in_currency || -999)).slice(0, 5),
    [enriched]);
  const losers = useMemo(() =>
    [...enriched].sort((a, b) => (a.market.price_change_percentage_24h_in_currency || 999) - (b.market.price_change_percentage_24h_in_currency || 999)).slice(0, 5),
    [enriched]);

  const favData = enriched.filter((c) => favorites.includes(c.id));
  const selected = enriched.find((c) => c.id === selectedCoin);

  /* ---------- avaliação de alertas (client-side, sessão atual) ---------- */
  useEffect(() => {
    const fired = [];
    alertRules.filter((r) => r.active).forEach((rule) => {
      const coin = enriched.find((c) => c.id === rule.coin);
      if (!coin || !coin.ind) return;
      let hit = false;
      if (rule.cond.includes("RSI abaixo de 30") && coin.ind.rsi14 != null && coin.ind.rsi14 < 30) hit = true;
      if (rule.cond.includes("Cruzamento EMA 9/21") && coin.ind.ema9 > coin.ind.ema21) hit = true;
      if (hit) fired.push({ ...rule, time: new Date().toLocaleTimeString("pt-BR") });
    });
    if (fired.length) setTriggeredAlerts((prev) => [...fired, ...prev].slice(0, 20));
  }, [enriched]); // eslint-disable-line

  /* ============================== ESTILO / ACESSIBILIDADE ============================== */
  const scale = fontScale;
  const rootStyle = {
    "--gold": COLORS.gold, "--green": COLORS.green, "--red": COLORS.red,
    fontSize: `${14 * scale}px`,
    background: highContrast ? "#000000" : COLORS.bg,
    color: highContrast ? "#ffffff" : COLORS.text,
    minHeight: "100%",
    fontFamily: "'Inter', system-ui, sans-serif",
  };
  const panelBg = highContrast ? "#000000" : COLORS.panel;
  const panelBorder = highContrast ? "1px solid #ffffff" : `1px solid ${COLORS.border}`;
  const btnPad = bigButtons ? "14px 20px" : "8px 14px";
  const cardPad = bigButtons ? "20px" : "16px";

  const MENU = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "mercado", label: "Mercado", icon: BarChart3 },
    { id: "favoritas", label: "Minhas Favoritas", icon: Star },
    { id: "graficos", label: "Gráficos", icon: LineChartIcon },
    { id: "analises", label: "Análises", icon: TrendingUp },
    { id: "alertas", label: "Alertas", icon: AlertTriangle },
    { id: "noticias", label: "Notícias", icon: Newspaper },
    { id: "conversor", label: "Conversor de Moedas", icon: DollarSign },
    { id: "taxas", label: "Taxas", icon: Percent },
    { id: "comparador", label: "Comparador", icon: GitCompare },
    { id: "backtest", label: "Backtest", icon: FlaskConical },
    { id: "acessibilidade", label: "Acessibilidade", icon: Accessibility },
  ];

  return (
    <div style={rootStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .ct-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
        .ct-scroll::-webkit-scrollbar-thumb { background: #3a3d47; border-radius: 4px; }
        .ct-font-display { font-family: 'Playfair Display', serif; }
        button:focus-visible, input:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }
        .ct-btn { transition: transform .12s ease, background .12s ease; }
        .ct-btn:hover { transform: translateY(-1px); }
        .ct-row:hover { background: #1d212b; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* ---------------- SIDEBAR ---------------- */}
        <aside
          className="ct-scroll"
          style={{
            width: menuOpen ? 230 : 0, overflow: menuOpen ? "auto" : "hidden",
            background: panelBg, borderRight: panelBorder, transition: "width .2s ease",
            position: "sticky", top: 0, height: "100vh", flexShrink: 0,
          }}
        >
          <div style={{ padding: "18px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: panelBorder }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, background: `linear-gradient(135deg, ${COLORS.gold}, #8a6a1c)`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Crown size={18} color="#0a0b0f" />
            </div>
            <div style={{ lineHeight: 1.1 }}>
              <div className="ct-font-display" style={{ fontSize: `${15 * scale}px`, fontWeight: 800, color: COLORS.gold }}>CRIPTOTRADER</div>
              <div style={{ fontSize: `${10 * scale}px`, letterSpacing: 2, color: COLORS.sub }}>LUIZ ALVES</div>
            </div>
          </div>
          <nav style={{ padding: 10 }}>
            {MENU.map((m) => (
              <button key={m.id} onClick={() => setTab(m.id)}
                className="ct-btn"
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: btnPad, marginBottom: 4, borderRadius: 8, border: "none", cursor: "pointer",
                  background: tab === m.id ? "#22262f" : "transparent",
                  color: tab === m.id ? COLORS.gold : COLORS.text,
                  fontWeight: tab === m.id ? 700 : 500, textAlign: "left", fontSize: `${13 * scale}px`,
                }}>
                <m.icon size={bigButtons ? 20 : 16} />
                {m.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* ---------------- MAIN ---------------- */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* HEADER */}
          <header style={{
            position: "sticky", top: 0, zIndex: 10, background: panelBg, borderBottom: panelBorder,
            padding: "12px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
          }}>
            <button onClick={() => setMenuOpen((v) => !v)} className="ct-btn" style={{ background: "none", border: "none", color: COLORS.text, cursor: "pointer" }}>
              <Menu size={20} />
            </button>
            <div className="ct-font-display" style={{ fontSize: `${19 * scale}px`, fontWeight: 800, color: COLORS.text, whiteSpace: "nowrap" }}>
              Criptotrader <span style={{ color: COLORS.gold }}>Luiz Alves</span>
            </div>
            <div style={{ position: "relative", flex: 1, minWidth: 160, maxWidth: 320 }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.sub }} />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Buscar moeda..."
                style={{
                  width: "100%", padding: "8px 10px 8px 30px", borderRadius: 8, border: panelBorder,
                  background: "#0e1015", color: COLORS.text, fontSize: `${13 * scale}px`,
                }} />
              {searchResults.length > 0 && (
                <div style={{ position: "absolute", top: "110%", left: 0, right: 0, background: "#14161d", border: panelBorder, borderRadius: 8, zIndex: 20, overflow: "hidden" }}>
                  {searchResults.map((r) => (
                    <div key={r.id} onClick={() => addCoin(r)} className="ct-row" style={{ padding: "8px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
                      <span>{r.name}</span><span style={{ color: COLORS.sub }}>{r.symbol.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
              <HeaderIcon icon={Star} onClick={() => setTab("favoritas")} />
              <HeaderIcon icon={Maximize2} onClick={() => document.documentElement.requestFullscreen?.()} />
              <div style={{ position: "relative" }}>
                <HeaderIcon icon={Bell} onClick={() => setTab("alertas")} />
                {triggeredAlerts.length > 0 && (
                  <span style={{ position: "absolute", top: -4, right: -4, background: COLORS.red, color: "#fff", fontSize: 10, borderRadius: 10, padding: "1px 5px" }}>{triggeredAlerts.length}</span>
                )}
              </div>
              <HeaderIcon icon={Accessibility} onClick={() => setTab("acessibilidade")} />
              <HeaderIcon icon={Settings} onClick={() => setTab("acessibilidade")} />
              <HeaderIcon icon={HelpCircle} onClick={() => setTab("ajuda")} />
              {connected ? <Wifi size={16} color={COLORS.green} /> : <WifiOff size={16} color={COLORS.red} />}
            </div>
          </header>

          {/* status bar */}
          <div style={{ padding: "6px 20px", display: "flex", gap: 20, flexWrap: "wrap", fontSize: `${11 * scale}px`, color: COLORS.sub, borderBottom: panelBorder }}>
            <span style={{ color: connected ? COLORS.green : COLORS.red, fontWeight: 700 }}>{connected ? "🟢 CONECTADO" : "🔴 CONEXÃO INDISPONÍVEL"}</span>
            <span>Última atualização: {lastUpdate ? lastUpdate.toLocaleTimeString("pt-BR") : "--:--:--"}</span>
            <span>Próxima atualização: 00:{String(Math.floor(nextUpdate / 60)).padStart(2, "0")}:{String(nextUpdate % 60).padStart(2, "0")}</span>
            <span style={{ marginLeft: "auto" }}>Dados fornecidos por CoinGecko, alternative.me, Frankfurter (BCE)</span>
          </div>

          {/* CONTENT */}
          <main style={{ padding: 20 }} className="ct-scroll">
            {tab === "dashboard" && (
              <Dashboard {...{ enriched, globalData, fng, usdbrl, favData, topOpportunities, discounted, gainers, losers, triggeredAlerts, toggleFavorite, favorites, setTab, setSelectedCoin, COLORS, panelBg, panelBorder, cardPad, scale, bigButtons }} />
            )}
            {tab === "mercado" && (
              <MarketTable title="📊 Mercado" coins={enriched} favorites={favorites} toggleFavorite={toggleFavorite} setSelectedCoin={setSelectedCoin} setTab={setTab} COLORS={COLORS} panelBg={panelBg} panelBorder={panelBorder} scale={scale} />
            )}
            {tab === "favoritas" && (
              <MarketTable title="⭐ Minhas Favoritas" coins={favData} favorites={favorites} toggleFavorite={toggleFavorite} setSelectedCoin={setSelectedCoin} setTab={setTab} COLORS={COLORS} panelBg={panelBg} panelBorder={panelBorder} scale={scale} showFull empty="Você ainda não marcou nenhuma criptomoeda como favorita. Clique na estrela ⭐ na tabela de Mercado." />
            )}
            {tab === "graficos" && (
              <ChartsView {...{ enriched, selected, selectedCoin, setSelectedCoin, timeframe, setTimeframe, ohlcData, chartLoading, COLORS, panelBg, panelBorder, scale }} />
            )}
            {tab === "analises" && (
              <AnalysisView {...{ topOpportunities, discounted, COLORS, panelBg, panelBorder, scale, setTab, setSelectedCoin }} />
            )}
            {tab === "alertas" && (
              <AlertsView {...{ alertRules, setAlertRules, triggeredAlerts, monitored, COLORS, panelBg, panelBorder, scale }} />
            )}
            {tab === "noticias" && <NewsView COLORS={COLORS} panelBg={panelBg} panelBorder={panelBorder} scale={scale} />}
            {tab === "conversor" && <ConverterView {...{ enriched, usdbrl, COLORS, panelBg, panelBorder, scale }} />}
            {tab === "taxas" && <FeesView {...{ enriched, COLORS, panelBg, panelBorder, scale }} />}
            {tab === "comparador" && <CompareView {...{ enriched, compareIds, setCompareIds, COLORS, panelBg, panelBorder, scale }} />}
            {tab === "backtest" && <BacktestView {...{ enriched, selectedCoin, setSelectedCoin, COLORS, panelBg, panelBorder, scale }} />}
            {tab === "acessibilidade" && (
              <AccessibilityView {...{ fontScale, setFontScale, highContrast, setHighContrast, bigButtons, setBigButtons, capital, setCapital, riskPct, setRiskPct, COLORS, panelBg, panelBorder, scale }} />
            )}
            {tab === "ajuda" && <HelpView COLORS={COLORS} panelBg={panelBg} panelBorder={panelBorder} scale={scale} />}
          </main>

          {/* mobile bottom nav */}
          <nav style={{
            position: "sticky", bottom: 0, display: "flex", justifyContent: "space-around",
            background: panelBg, borderTop: panelBorder, padding: "8px 0",
          }} className="mobile-nav">
            {[["dashboard", Home, "Início"], ["mercado", BarChart3, "Mercado"], ["favoritas", Star, "Favoritos"], ["graficos", LineChartIcon, "Gráficos"], ["alertas", AlertTriangle, "Alertas"]].map(([id, Icon, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{ background: "none", border: "none", color: tab === id ? COLORS.gold : COLORS.sub, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", fontSize: 10 }}>
                <Icon size={20} /><span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

/* ============================== COMPONENTES AUXILIARES ============================== */

function HeaderIcon({ icon: Icon, onClick }) {
  return (
    <button onClick={onClick} className="ct-btn" style={{ background: "#1c1f27", border: "none", borderRadius: 8, padding: 8, cursor: "pointer", color: "#eceef2" }}>
      <Icon size={16} />
    </button>
  );
}

function Card({ children, style, ...rest }) {
  return <div {...rest} style={{ background: "#12141a", border: "1px solid #26293580", borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}

function ScoreBadge({ score, COLORS }) {
  if (score == null) return <span style={{ color: COLORS.sub }}>—</span>;
  const l = scoreLabel(score);
  return <span style={{ color: l.color, fontWeight: 700 }}>{score}</span>;
}

function DiscountTag({ discount, COLORS }) {
  if (!discount || discount.level === "none" || discount.level === "—") return <span style={{ color: COLORS.sub }}>—</span>;
  const map = { green: ["🟢", COLORS.green], yellow: ["🟡", "#e0c23c"], red: ["🔴", COLORS.red] };
  const [emoji, color] = map[discount.level] || ["", COLORS.sub];
  return <span style={{ color, fontSize: 12 }}>{emoji} {discount.label}</span>;
}

/* ---------------- DASHBOARD ---------------- */
function Dashboard(p) {
  const { enriched, globalData, fng, usdbrl, favData, topOpportunities, discounted, gainers, losers, triggeredAlerts, toggleFavorite, favorites, setTab, setSelectedCoin, COLORS, panelBorder, cardPad, scale, bigButtons } = p;
  const btc = enriched.find((c) => c.id === "bitcoin");
  const eth = enriched.find((c) => c.id === "ethereum");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 14 }}>
        <MetricCard label="₿ BTC/USDT" value={btc ? fmtUSD(btc.market.current_price) : "..."} change={btc?.market.price_change_percentage_24h_in_currency} COLORS={COLORS} panelBorder={panelBorder} cardPad={cardPad} />
        <MetricCard label="Ξ ETH/USDT" value={eth ? fmtUSD(eth.market.current_price) : "..."} change={eth?.market.price_change_percentage_24h_in_currency} COLORS={COLORS} panelBorder={panelBorder} cardPad={cardPad} />
        <MetricCard label="📈 Total Market Cap" value={globalData ? fmtCompact(globalData.total_market_cap?.usd) : "..."} change={globalData?.market_cap_change_percentage_24h_usd} COLORS={COLORS} panelBorder={panelBorder} cardPad={cardPad} prefix="$" />
        <MetricCard label="₿ Dominância BTC" value={globalData ? `${globalData.market_cap_percentage?.btc?.toFixed(2)}%` : "..."} COLORS={COLORS} panelBorder={panelBorder} cardPad={cardPad} />
        <MetricCard label="😨 Medo & Ganância" value={fng ? fng.value : "..."} sub={fng?.value_classification} COLORS={COLORS} panelBorder={panelBorder} cardPad={cardPad} />
        <MetricCard label="💱 USD/BRL" value={usdbrl ? `R$ ${usdbrl.rate.toFixed(4)}` : "..."} sub={usdbrl ? `Câmbio BCE ${usdbrl.date}` : ""} COLORS={COLORS} panelBorder={panelBorder} cardPad={cardPad} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }} className="dash-grid">
        <Card style={{ padding: cardPad }}>
          <SectionTitle icon={TrendingUp} title="🏆 Top Oportunidades" COLORS={COLORS} />
          <MiniOppTable rows={topOpportunities.slice(0, 5)} COLORS={COLORS} setTab={setTab} setSelectedCoin={setSelectedCoin} />
        </Card>
        <Card style={{ padding: cardPad }}>
          <SectionTitle icon={Star} title="⭐ Favoritas" COLORS={COLORS} />
          {favData.length === 0 && <p style={{ color: COLORS.sub, fontSize: 13 }}>Nenhuma favorita ainda.</p>}
          {favData.slice(0, 5).map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid #ffffff10" }}>
              <span>{c.symbol}</span>
              <span>{fmtUSD(c.market.current_price)}</span>
              <span style={{ color: (c.market.price_change_percentage_24h_in_currency || 0) >= 0 ? COLORS.green : COLORS.red }}>{fmtPct(c.market.price_change_percentage_24h_in_currency)}</span>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="dash-grid">
        <Card style={{ padding: cardPad }}>
          <SectionTitle icon={TrendingUp} title="🔥 Maiores Altas" COLORS={COLORS} />
          {gainers.map((c) => <MoverRow key={c.id} c={c} COLORS={COLORS} />)}
        </Card>
        <Card style={{ padding: cardPad }}>
          <SectionTitle icon={TrendingUp} title="📉 Maiores Quedas" COLORS={COLORS} />
          {losers.map((c) => <MoverRow key={c.id} c={c} COLORS={COLORS} />)}
        </Card>
      </div>

      <Card style={{ padding: cardPad }}>
        <SectionTitle icon={AlertTriangle} title="🚨 Alertas Recentes" COLORS={COLORS} />
        {triggeredAlerts.length === 0 && <p style={{ color: COLORS.sub, fontSize: 13 }}>Nenhum alerta disparado nesta sessão.</p>}
        {triggeredAlerts.slice(0, 4).map((a, i) => (
          <div key={i} style={{ fontSize: 13, padding: "4px 0", color: COLORS.text }}>
            <b style={{ color: COLORS.gold }}>{a.symbol}</b> — {a.cond} <span style={{ color: COLORS.sub }}>({a.time})</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, COLORS }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontWeight: 700, color: COLORS.text }}>
      <Icon size={16} color={COLORS.gold} /> {title}
    </div>
  );
}
function MetricCard({ label, value, change, sub, COLORS, panelBorder, cardPad, prefix }) {
  return (
    <Card style={{ padding: cardPad }}>
      <div style={{ fontSize: 12, color: COLORS.sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
      {change != null && <div style={{ color: change >= 0 ? COLORS.green : COLORS.red, fontSize: 13, marginTop: 2 }}>{fmtPct(change)} (24h)</div>}
      {sub && <div style={{ color: COLORS.sub, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}
function MoverRow({ c, COLORS }) {
  const chg = c.market.price_change_percentage_24h_in_currency;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid #ffffff10" }}>
      <span>{c.symbol}/USDT</span>
      <span>{fmtUSD(c.market.current_price)}</span>
      <span style={{ color: chg >= 0 ? COLORS.green : COLORS.red, fontWeight: 700 }}>{fmtPct(chg)}</span>
    </div>
  );
}
function MiniOppTable({ rows, COLORS, setTab, setSelectedCoin }) {
  if (rows.length === 0) return <p style={{ color: COLORS.sub, fontSize: 13 }}>Calculando indicadores... aguarde o carregamento do histórico.</p>;
  return (
    <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
      <thead><tr style={{ color: COLORS.sub, textAlign: "left" }}><th>Moeda</th><th>Preço</th><th>24h</th><th>Score</th><th></th></tr></thead>
      <tbody>
        {rows.map((c, i) => (
          <tr key={c.id} className="ct-row" style={{ cursor: "pointer", borderTop: "1px solid #ffffff10" }} onClick={() => { setSelectedCoin(c.id); setTab("graficos"); }}>
            <td style={{ padding: "6px 0" }}>{["🥇", "🥈", "🥉"][i] || `${i + 1}º`} {c.symbol}</td>
            <td>{fmtUSD(c.market.current_price)}</td>
            <td style={{ color: (c.market.price_change_percentage_24h_in_currency || 0) >= 0 ? COLORS.green : COLORS.red }}>{fmtPct(c.market.price_change_percentage_24h_in_currency)}</td>
            <td><ScoreBadge score={c.score} COLORS={COLORS} /></td>
            <td><ExternalLink size={12} color={COLORS.sub} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- TABELA DE MERCADO ---------------- */
function MarketTable({ title, coins, favorites, toggleFavorite, setSelectedCoin, setTab, COLORS, panelBorder, scale, showFull, empty }) {
  const [sortKey, setSortKey] = useState("market_cap");
  const sorted = useMemo(() => {
    const arr = [...coins];
    arr.sort((a, b) => {
      if (sortKey === "score") return (b.score || 0) - (a.score || 0);
      if (sortKey === "gain") return (b.market.price_change_percentage_24h_in_currency || -999) - (a.market.price_change_percentage_24h_in_currency || -999);
      if (sortKey === "volume") return (b.market.total_volume || 0) - (a.market.total_volume || 0);
      if (sortKey === "name") return a.symbol.localeCompare(b.symbol);
      return (b.market.market_cap || 0) - (a.market.market_cap || 0);
    });
    return arr;
  }, [coins, sortKey]);

  if (coins.length === 0 && empty) {
    return <Card style={{ padding: 30, textAlign: "center", color: COLORS.sub }}>{empty}</Card>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h2 className="ct-font-display" style={{ margin: 0, fontSize: 20 }}>{title}</h2>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={{ background: "#181b22", color: COLORS.text, border: "1px solid #333", borderRadius: 8, padding: "6px 10px" }}>
          <option value="market_cap">Ordenar: Market Cap</option>
          <option value="gain">Maior alta 24h</option>
          <option value="score">Maior Score</option>
          <option value="volume">Maior Volume</option>
          <option value="name">Nome</option>
        </select>
      </div>
      <div className="ct-scroll" style={{ overflowX: "auto", border: "1px solid #26293580", borderRadius: 12 }}>
        <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#181b22", textAlign: "left", color: COLORS.sub }}>
              {["", "Moeda", "Preço", "1h", "4h", "24h", "7d", "RSI", "Tendência", "Volume", "Score", "Status", ""].map((h) => (
                <th key={h} style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const chg1h = c.market.price_change_percentage_1h_in_currency;
              const chg24h = c.market.price_change_percentage_24h_in_currency;
              const chg7d = c.market.price_change_percentage_7d_in_currency;
              const trend = c.ind ? (c.ind.ema9 > c.ind.ema21 && c.ind.ema21 > c.ind.ema50 ? "Alta" : c.ind.ema9 < c.ind.ema21 && c.ind.ema21 < c.ind.ema50 ? "Baixa" : "Lateral") : "—";
              return (
                <tr key={c.id} className="ct-row" style={{ borderTop: "1px solid #ffffff10" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <button onClick={() => toggleFavorite(c.id)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                      <Star size={16} fill={favorites.includes(c.id) ? COLORS.gold : "none"} color={COLORS.gold} />
                    </button>
                  </td>
                  <td style={{ padding: "10px 12px", cursor: "pointer", fontWeight: 700 }} onClick={() => { setSelectedCoin(c.id); setTab("graficos"); }}>{c.symbol}/USDT</td>
                  <td style={{ padding: "10px 12px" }}>{fmtUSD(c.market.current_price)}</td>
                  <td style={{ padding: "10px 12px", color: chg1h >= 0 ? COLORS.green : COLORS.red }}>{fmtPct(chg1h)}</td>
                  <td style={{ padding: "10px 12px", color: COLORS.sub }}>—</td>
                  <td style={{ padding: "10px 12px", color: chg24h >= 0 ? COLORS.green : COLORS.red }}>{fmtPct(chg24h)}</td>
                  <td style={{ padding: "10px 12px", color: chg7d >= 0 ? COLORS.green : COLORS.red }}>{fmtPct(chg7d)}</td>
                  <td style={{ padding: "10px 12px" }}>{c.ind?.rsi14 != null ? c.ind.rsi14.toFixed(1) : "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{trend}</td>
                  <td style={{ padding: "10px 12px" }}>{fmtCompact(c.market.total_volume)}</td>
                  <td style={{ padding: "10px 12px" }}><ScoreBadge score={c.score} COLORS={COLORS} /></td>
                  <td style={{ padding: "10px 12px" }}><DiscountTag discount={c.discount} COLORS={COLORS} /></td>
                  <td style={{ padding: "10px 12px" }}>
                    <a href={`https://www.binance.com/en/trade/${c.symbol}_USDT`} target="_blank" rel="noreferrer" style={{ color: COLORS.gold, fontSize: 11, textDecoration: "none", whiteSpace: "nowrap" }}>Binance ↗</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: COLORS.sub, fontSize: 11, marginTop: 6 }}>Variação de 4h ainda não disponível na fonte gratuita utilizada — exibindo "DADO NÃO DISPONÍVEL".</p>
    </div>
  );
}

/* ---------------- GRÁFICOS ---------------- */
function CandleShape(bodyMode) {
  return (props) => {
    const { x, y, width, height, payload } = props;
    const isUp = payload.close >= payload.open;
    const color = isUp ? COLORS.green : COLORS.red;
    if (bodyMode === "wick") {
      const cx = x + width / 2 - 1;
      return <rect x={cx} y={y} width={2} height={Math.max(height, 1)} fill={color} />;
    }
    const w = Math.max(width * 0.6, 3);
    const cx = x + width / 2 - w / 2;
    return <rect x={cx} y={y} width={w} height={Math.max(height, 1)} fill={color} />;
  };
}

function ChartsView({ enriched, selected, selectedCoin, setSelectedCoin, timeframe, setTimeframe, ohlcData, chartLoading, COLORS, panelBorder, scale }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [showEma, setShowEma] = useState(true);
  const [showBB, setShowBB] = useState(false);

  const chartData = useMemo(() => {
    if (!ohlcData.length) return [];
    const closes = ohlcData.map((d) => d.close);
    const e9 = ema(closes, 9), e21 = ema(closes, 21), e50 = ema(closes, 50);
    return ohlcData.map((d, i) => ({ ...d, wickRange: [d.low, d.high], bodyRange: [Math.min(d.open, d.close), Math.max(d.open, d.close)], ema9: e9[i], ema21: e21[i], ema50: e50[i] }));
  }, [ohlcData]);

  return (
    <div style={{ display: fullscreen ? "block" : "grid", gridTemplateColumns: fullscreen ? "1fr" : "220px 1fr", gap: 14 }}>
      {!fullscreen && (
        <Card style={{ padding: 12, maxHeight: 500, overflow: "auto" }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: COLORS.gold }}>Moedas monitoradas</div>
          {enriched.map((c) => (
            <div key={c.id} onClick={() => setSelectedCoin(c.id)} className="ct-row"
              style={{ padding: "8px 6px", borderRadius: 6, cursor: "pointer", background: selectedCoin === c.id ? "#22262f" : "transparent", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>{c.symbol}</span><span>{fmtUSD(c.market.current_price)}</span>
            </div>
          ))}
        </Card>
      )}
      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <div>
            <div className="ct-font-display" style={{ fontSize: 18, fontWeight: 800 }}>{selected ? `${selected.symbol}/USDT` : "..."}</div>
            <div style={{ color: COLORS.sub, fontSize: 12 }}>{selected ? fmtUSD(selected.market.current_price) : ""} · Binance (referência CoinGecko)</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["15m", "1H", "4H", "1D", "1W"].map((tf) => (
              <button key={tf} onClick={() => setTimeframe(tf)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #333", background: timeframe === tf ? COLORS.gold : "#181b22", color: timeframe === tf ? "#0a0b0f" : COLORS.text, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>{tf}</button>
            ))}
            <button onClick={() => setShowEma((v) => !v)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #333", background: showEma ? "#2a2f1c" : "#181b22", color: COLORS.text, cursor: "pointer", fontSize: 12 }}>EMAs</button>
            <button onClick={() => setFullscreen((v) => !v)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #333", background: "#181b22", color: COLORS.gold, cursor: "pointer", fontSize: 12 }}>⛶ {fullscreen ? "Sair" : "Tela cheia"}</button>
          </div>
        </div>

        {chartLoading && <p style={{ color: COLORS.sub }}>Carregando dados reais de candles...</p>}
        {!chartLoading && chartData.length > 0 && (
          <ResponsiveContainer width="100%" height={fullscreen ? 520 : 340}>
            <ComposedChart data={chartData} margin={{ left: 0, right: 10 }}>
              <CartesianGrid stroke="#22252c" vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: COLORS.sub }} minTickGap={30} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: COLORS.sub }} orientation="right" width={70} />
              <Tooltip contentStyle={{ background: "#14161d", border: "1px solid #333", fontSize: 12 }} />
              <Bar dataKey="wickRange" shape={CandleShape("wick")} isAnimationActive={false} />
              <Bar dataKey="bodyRange" shape={CandleShape("body")} isAnimationActive={false} />
              {showEma && <Line type="monotone" dataKey="ema9" stroke="#5cc8ff" dot={false} strokeWidth={1.4} />}
              {showEma && <Line type="monotone" dataKey="ema21" stroke="#e8b93f" dot={false} strokeWidth={1.4} />}
              {showEma && <Line type="monotone" dataKey="ema50" stroke="#c85cff" dot={false} strokeWidth={1.4} />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {!chartLoading && chartData.length === 0 && <p style={{ color: COLORS.sub }}>DADO NÃO DISPONÍVEL para este período.</p>}

        {selected?.ind && (
          <>
            <div style={{ marginTop: 14, fontSize: 12, color: COLORS.sub }}>RSI 14: <span style={{ color: COLORS.text, fontWeight: 700 }}>{selected.ind.rsi14?.toFixed(1) ?? "—"}</span></div>
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={chartData}>
                <YAxis domain={[0, 100]} hide />
                <ReferenceLine y={70} stroke="#EA394350" strokeDasharray="3 3" />
                <ReferenceLine y={30} stroke="#16C78450" strokeDasharray="3 3" />
                <Line type="monotone" dataKey={() => selected.ind.rsi14} stroke="#c85cff" dot={false} strokeWidth={1.4} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginTop: 14, fontSize: 12 }}>
              <IndicatorBox label="MACD" value={selected.ind.macd.macd?.toFixed(2)} COLORS={COLORS} />
              <IndicatorBox label="Sinal" value={selected.ind.macd.signal?.toFixed(2)} COLORS={COLORS} />
              <IndicatorBox label="EMA 200" value={selected.ind.ema200 ? fmtUSD(selected.ind.ema200) : "DADO NÃO DISPONÍVEL"} COLORS={COLORS} />
              <IndicatorBox label="Suporte (60d)" value={fmtUSD(selected.ind.support)} COLORS={COLORS} />
              <IndicatorBox label="Resistência (60d)" value={fmtUSD(selected.ind.resistance)} COLORS={COLORS} />
              <IndicatorBox label="Bollinger Sup." value={selected.ind.bbUpper ? fmtUSD(selected.ind.bbUpper) : "—"} COLORS={COLORS} />
            </div>
          </>
        )}

        {selected && (
          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href={`https://www.binance.com/en/trade/${selected.symbol}_USDT`} target="_blank" rel="noreferrer" style={{ background: COLORS.gold, color: "#0a0b0f", padding: "10px 16px", borderRadius: 8, fontWeight: 800, textDecoration: "none" }}>🟡 Comprar na Binance</a>
            <a href={`https://www.binance.com/en/trade/${selected.symbol}_USDT`} target="_blank" rel="noreferrer" style={{ background: "#181b22", color: COLORS.text, padding: "10px 16px", borderRadius: 8, textDecoration: "none", border: "1px solid #333" }}>🔗 Acessar par na Binance</a>
          </div>
        )}
        <p style={{ color: COLORS.sub, fontSize: 11, marginTop: 8 }}>Verifique taxas e condições diretamente na Binance antes de operar. Este site não executa ordens.</p>
      </Card>
    </div>
  );
}
function IndicatorBox({ label, value, COLORS }) {
  return (
    <div style={{ background: "#181b22", borderRadius: 8, padding: 10 }}>
      <div style={{ color: COLORS.sub, fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value ?? "—"}</div>
    </div>
  );
}

/* ---------------- ANÁLISES (Score / Desconto) ---------------- */
function AnalysisView({ topOpportunities, discounted, COLORS, panelBorder, scale, setTab, setSelectedCoin }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card style={{ padding: 18 }}>
        <SectionTitle icon={TrendingUp} title="🏆 Top 10 Oportunidades — Score 0 a 100" COLORS={COLORS} />
        <p style={{ color: COLORS.sub, fontSize: 12, marginTop: -4, marginBottom: 10 }}>
          Cálculo: Tendência 20% · RSI 15% · MACD 10% · Distância de médias 10% · Suporte/Resistência 15% · Volume 10% · Momentum 10% · Risco/volatilidade 10%.
        </p>
        <div className="ct-scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 700, fontSize: 13, borderCollapse: "collapse" }}>
            <thead><tr style={{ color: COLORS.sub, textAlign: "left" }}><th>#</th><th>Moeda</th><th>Preço</th><th>24h</th><th>RSI</th><th>Score</th><th>Classificação</th></tr></thead>
            <tbody>
              {topOpportunities.map((c, i) => {
                const l = scoreLabel(c.score);
                return (
                  <tr key={c.id} className="ct-row" style={{ borderTop: "1px solid #ffffff10", cursor: "pointer" }} onClick={() => { setSelectedCoin(c.id); setTab("graficos"); }}>
                    <td style={{ padding: "8px 4px" }}>{["🥇", "🥈", "🥉"][i] || i + 1}</td>
                    <td style={{ fontWeight: 700 }}>{c.symbol}</td>
                    <td>{fmtUSD(c.market.current_price)}</td>
                    <td style={{ color: (c.market.price_change_percentage_24h_in_currency || 0) >= 0 ? COLORS.green : COLORS.red }}>{fmtPct(c.market.price_change_percentage_24h_in_currency)}</td>
                    <td>{c.ind?.rsi14?.toFixed(1) ?? "—"}</td>
                    <td style={{ fontWeight: 800, color: l.color }}>{c.score}</td>
                    <td style={{ color: l.color }}>{l.text}</td>
                  </tr>
                );
              })}
              {topOpportunities.length === 0 && <tr><td colSpan={7} style={{ color: COLORS.sub, padding: 10 }}>Calculando... aguarde o carregamento do histórico de preços.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={{ padding: 18 }}>
        <SectionTitle icon={DollarSign} title="💰 Moedas Mais Descontadas — Índice de Desconto" COLORS={COLORS} />
        <p style={{ color: COLORS.sub, fontSize: 12, marginTop: -4, marginBottom: 10 }}>
          Uma queda grande não significa automaticamente uma boa oportunidade — o índice cruza queda desde a máxima com RSI, médias, tendência, momentum e volume.
        </p>
        {discounted.length === 0 && <p style={{ color: COLORS.sub, fontSize: 13 }}>Nenhuma moeda monitorada está com desconto relevante (&gt;15% da máxima histórica) no momento.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {discounted.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#181b22", borderRadius: 8, padding: "10px 14px", flexWrap: "wrap", gap: 6 }}>
              <span style={{ fontWeight: 700, width: 60 }}>{c.symbol}</span>
              <span>{fmtUSD(c.market.current_price)}</span>
              <span style={{ color: COLORS.red }}>-{c.discount.drop.toFixed(1)}% da ATH</span>
              <DiscountTag discount={c.discount} COLORS={COLORS} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------------- ALERTAS ---------------- */
function AlertsView({ alertRules, setAlertRules, triggeredAlerts, monitored, COLORS, panelBorder, scale }) {
  const [newCoin, setNewCoin] = useState(monitored[0]?.id || "");
  const [newCond, setNewCond] = useState("RSI abaixo de 30");
  const conds = ["RSI abaixo de 30", "RSI acima de 70", "Cruzamento EMA 9/21", "Cruzamento EMA 50/200", "Rompimento de resistência", "Perda de suporte", "Score acima de 80"];

  const addRule = () => {
    const coinObj = monitored.find((m) => m.id === newCoin);
    setAlertRules((prev) => [...prev, { id: Date.now(), coin: newCoin, symbol: coinObj?.symbol, cond: newCond, active: true }]);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ padding: 18 }}>
        <SectionTitle icon={AlertTriangle} title="🚨 Configurar Alerta" COLORS={COLORS} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select value={newCoin} onChange={(e) => setNewCoin(e.target.value)} style={{ background: "#181b22", color: COLORS.text, border: "1px solid #333", borderRadius: 8, padding: "8px 12px" }}>
            {monitored.map((m) => <option key={m.id} value={m.id}>{m.symbol}</option>)}
          </select>
          <select value={newCond} onChange={(e) => setNewCond(e.target.value)} style={{ background: "#181b22", color: COLORS.text, border: "1px solid #333", borderRadius: 8, padding: "8px 12px" }}>
            {conds.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={addRule} style={{ background: COLORS.gold, color: "#0a0b0f", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>+ Adicionar</button>
        </div>
      </Card>
      <Card style={{ padding: 18 }}>
        <SectionTitle icon={Bell} title="Regras ativas" COLORS={COLORS} />
        {alertRules.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid #ffffff10" }}>
            <span>🚨 <b>{r.symbol}</b> — "{r.cond}"</span>
            <button onClick={() => setAlertRules((prev) => prev.map((x) => x.id === r.id ? { ...x, active: !x.active } : x))}
              style={{ background: r.active ? COLORS.green : "#333", border: "none", borderRadius: 20, padding: "4px 12px", color: "#fff", cursor: "pointer", fontSize: 12 }}>
              {r.active ? "Ativo" : "Inativo"}
            </button>
          </div>
        ))}
      </Card>
      <Card style={{ padding: 18 }}>
        <SectionTitle icon={AlertTriangle} title="Alertas disparados nesta sessão" COLORS={COLORS} />
        {triggeredAlerts.length === 0 && <p style={{ color: COLORS.sub, fontSize: 13 }}>Nenhum alerta disparado ainda — os dados reais são verificados a cada atualização.</p>}
        {triggeredAlerts.map((a, i) => (
          <div key={i} style={{ padding: "6px 0", fontSize: 13 }}><b style={{ color: COLORS.gold }}>{a.symbol}</b> — {a.cond} <span style={{ color: COLORS.sub }}>({a.time})</span></div>
        ))}
        <p style={{ color: COLORS.sub, fontSize: 11, marginTop: 10 }}>
          ⚠️ Estes alertas são verificados no navegador enquanto esta página estiver aberta. Para receber notificações push mesmo com o site fechado, é necessário um serviço de backend agendado — veja a explicação de implantação.
        </p>
      </Card>
    </div>
  );
}

/* ---------------- NOTÍCIAS ---------------- */
function NewsView({ COLORS, panelBorder, scale }) {
  return (
    <Card style={{ padding: 24, textAlign: "center" }}>
      <Newspaper size={36} color={COLORS.gold} style={{ marginBottom: 10 }} />
      <h3 style={{ margin: "0 0 8px" }}>📰 Notícias — configuração pendente</h3>
      <p style={{ color: COLORS.sub, maxWidth: 520, margin: "0 auto", fontSize: 13 }}>
        Para evitar inventar notícias, esta seção só é exibida com uma fonte real conectada.
        Cadastre uma chave gratuita ou paga de um provedor como CryptoPanic, CryptoCompare News ou NewsAPI
        e conecte o endpoint aqui — cada notícia será classificada automaticamente como 🟢 positiva, 🟡 incerta ou 🔴 negativa, sempre com a fonte original visível.
      </p>
    </Card>
  );
}

/* ---------------- CONVERSOR ---------------- */
function ConverterView({ enriched, usdbrl, COLORS, panelBorder, scale }) {
  const [amount, setAmount] = useState(1);
  const [from, setFrom] = useState("USD");
  const options = ["USD", "BRL", ...enriched.map((c) => c.symbol)];
  const priceOf = (sym) => {
    if (sym === "USD") return 1;
    if (sym === "BRL") return usdbrl ? 1 / usdbrl.rate : null;
    const c = enriched.find((c) => c.symbol === sym);
    return c ? c.market.current_price : null;
  };
  const [to, setTo] = useState("BRL");
  const fromUsd = priceOf(from);
  const toUsd = priceOf(to);
  const result = fromUsd != null && toUsd != null ? (amount * fromUsd) / toUsd : null;

  return (
    <Card style={{ padding: 24, maxWidth: 480 }}>
      <SectionTitle icon={DollarSign} title="💱 Conversor de Moedas" COLORS={COLORS} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: 120, padding: 10, borderRadius: 8, border: "1px solid #333", background: "#181b22", color: COLORS.text }} />
        <select value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #333", background: "#181b22", color: COLORS.text }}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <ArrowUpDown size={18} color={COLORS.gold} onClick={() => { setFrom(to); setTo(from); }} style={{ cursor: "pointer" }} />
        <select value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #333", background: "#181b22", color: COLORS.text }}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 20, fontSize: 26, fontWeight: 800, color: COLORS.gold }}>
        {result != null ? `${result.toLocaleString("pt-BR", { maximumFractionDigits: 8 })} ${to}` : "DADO NÃO DISPONÍVEL"}
      </div>
      <div style={{ color: COLORS.sub, fontSize: 12, marginTop: 8 }}>
        Taxa USD/BRL: {usdbrl ? usdbrl.rate.toFixed(4) : "—"} · Atualizado em: {usdbrl?.date || "—"}
      </div>
    </Card>
  );
}

/* ---------------- TAXAS ---------------- */
function FeesView({ enriched, COLORS, panelBorder, scale }) {
  const networkFees = { BTC: "0.0001 BTC (estimada, variável)", ETH: "variável conforme gas (estimada)", SOL: "≈0.000005 SOL (estimada)", BNB: "0.0005 BNB (estimada)", XRP: "0.00001 XRP fixa (rede)", ADA: "≈0.17 ADA (rede)", DOGE: "≈1 DOGE (rede)", AVAX: "variável (estimada)", LINK: "variável conforme gas (estimada)", DOT: "≈0.01 DOT (estimada)", SUI: "variável (estimada)", TON: "≈0.01 TON (estimada)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ padding: 18 }}>
        <SectionTitle icon={Percent} title="💳 Taxas — Binance (referência pública)" COLORS={COLORS} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, fontSize: 13 }}>
          <IndicatorBox label="Taxa Spot (padrão)" value="0,10% por operação (estimada)" COLORS={COLORS} />
          <IndicatorBox label="Taxa com BNB" value="0,075% (desconto — estimada)" COLORS={COLORS} />
          <IndicatorBox label="Depósito em cripto" value="Gratuito (padrão Binance)" COLORS={COLORS} />
          <IndicatorBox label="Depósito PIX (BRL)" value="Gratuito, dependente de campanha" COLORS={COLORS} />
        </div>
        <p style={{ color: COLORS.sub, fontSize: 11, marginTop: 10 }}>
          Valores públicos e sujeitos a alteração pela Binance. Nenhuma taxa é inventada — confirme sempre em{" "}
          <a href="https://www.binance.com/en/fee/schedule" target="_blank" rel="noreferrer" style={{ color: COLORS.gold }}>binance.com/fee/schedule</a>.
        </p>
      </Card>
      <Card style={{ padding: 18 }}>
        <SectionTitle icon={Percent} title="Taxas de rede por criptomoeda (estimadas)" COLORS={COLORS} />
        <div className="ct-scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead><tr style={{ color: COLORS.sub, textAlign: "left" }}><th>Moeda</th><th>Taxa de saque (rede)</th></tr></thead>
            <tbody>
              {enriched.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid #ffffff10" }}>
                  <td style={{ padding: "8px 0", fontWeight: 700 }}>{c.symbol}</td>
                  <td style={{ color: COLORS.sub }}>{networkFees[c.symbol] || "DADO NÃO DISPONÍVEL"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ color: COLORS.sub, fontSize: 11, marginTop: 10 }}>Taxas de rede variam conforme congestionamento e são dependentes do tipo de operação — sempre variáveis.</p>
      </Card>
    </div>
  );
}

/* ---------------- COMPARADOR ---------------- */
function CompareView({ enriched, compareIds, setCompareIds, COLORS, panelBorder, scale }) {
  const coins = compareIds.map((id) => enriched.find((c) => c.id === id)).filter(Boolean);
  const rows = [
    ["Preço", (c) => fmtUSD(c.market.current_price)],
    ["24h", (c) => fmtPct(c.market.price_change_percentage_24h_in_currency)],
    ["7d", (c) => fmtPct(c.market.price_change_percentage_7d_in_currency)],
    ["30d", (c) => fmtPct(c.market.price_change_percentage_30d_in_currency)],
    ["Volume 24h", (c) => fmtCompact(c.market.total_volume)],
    ["Market Cap", (c) => fmtCompact(c.market.market_cap)],
    ["RSI 14", (c) => c.ind?.rsi14?.toFixed(1) ?? "—"],
    ["Score", (c) => c.score ?? "—"],
    ["Dist. ATH", (c) => fmtPct(c.market.ath_change_percentage)],
  ];
  return (
    <Card style={{ padding: 18 }}>
      <SectionTitle icon={GitCompare} title="⚖️ Comparar Criptomoedas" COLORS={COLORS} />
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {[0, 1, 2].map((slot) => (
          <select key={slot} value={compareIds[slot] || ""} onChange={(e) => setCompareIds((prev) => { const n = [...prev]; n[slot] = e.target.value; return n.filter(Boolean); })}
            style={{ background: "#181b22", color: COLORS.text, border: "1px solid #333", borderRadius: 8, padding: "8px 12px" }}>
            <option value="">-- nenhuma --</option>
            {enriched.map((c) => <option key={c.id} value={c.id}>{c.symbol}</option>)}
          </select>
        ))}
      </div>
      <div className="ct-scroll" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", minWidth: 400 }}>
          <thead><tr><th style={{ textAlign: "left", color: COLORS.sub }}>Critério</th>{coins.map((c) => <th key={c.id} style={{ color: COLORS.gold, textAlign: "left", padding: "6px 10px" }}>{c.symbol}</th>)}</tr></thead>
          <tbody>
            {rows.map(([label, fn]) => (
              <tr key={label} style={{ borderTop: "1px solid #ffffff10" }}>
                <td style={{ padding: "8px 0", color: COLORS.sub }}>{label}</td>
                {coins.map((c) => <td key={c.id} style={{ padding: "8px 10px" }}>{fn(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {coins.length >= 2 && (() => {
        const best = [...coins].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        return <p style={{ marginTop: 12, fontSize: 13 }}>Segundo os critérios do sistema, <b style={{ color: COLORS.gold }}>{best.symbol}</b> apresenta atualmente a melhor configuração (Score {best.score}).</p>;
      })()}
    </Card>
  );
}

/* ---------------- BACKTEST ---------------- */
function BacktestView({ enriched, selectedCoin, setSelectedCoin, COLORS, panelBorder, scale }) {
  const [coinId, setCoinId] = useState(selectedCoin);
  const coin = enriched.find((c) => c.id === coinId);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const runBacktest = async () => {
    setRunning(true);
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=220&interval=daily`);
      const data = await res.json();
      const closes = data.prices.map((p) => p[1]);
      const e9 = ema(closes, 9), e21 = ema(closes, 21);
      let position = null, entryPrice = 0, trades = [], equity = 1;
      for (let i = 21; i < closes.length; i++) {
        const crossUp = e9[i - 1] <= e21[i - 1] && e9[i] > e21[i];
        const crossDown = e9[i - 1] >= e21[i - 1] && e9[i] < e21[i];
        if (!position && crossUp) { position = "long"; entryPrice = closes[i]; }
        else if (position && crossDown) {
          const ret = (closes[i] - entryPrice) / entryPrice;
          equity *= 1 + ret;
          trades.push(ret);
          position = null;
        }
      }
      const wins = trades.filter((t) => t > 0).length;
      const maxDD = trades.reduce((acc, t) => Math.min(acc, t), 0);
      setResult({
        totalTrades: trades.length,
        winRate: trades.length ? ((wins / trades.length) * 100).toFixed(1) : "0",
        totalReturn: ((equity - 1) * 100).toFixed(1),
        worstTrade: (maxDD * 100).toFixed(1),
        avgTrade: trades.length ? ((trades.reduce((a, b) => a + b, 0) / trades.length) * 100).toFixed(2) : "0",
      });
    } catch (e) { setResult(null); }
    setRunning(false);
  };

  return (
    <Card style={{ padding: 18 }}>
      <SectionTitle icon={FlaskConical} title="🧪 Backtest — Cruzamento EMA 9/21 (dados reais, ~220 dias)" COLORS={COLORS} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <select value={coinId} onChange={(e) => setCoinId(e.target.value)} style={{ background: "#181b22", color: COLORS.text, border: "1px solid #333", borderRadius: 8, padding: "8px 12px" }}>
          {enriched.map((c) => <option key={c.id} value={c.id}>{c.symbol}</option>)}
        </select>
        <button onClick={runBacktest} disabled={running} style={{ background: COLORS.gold, color: "#0a0b0f", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>
          {running ? "Calculando..." : "Rodar backtest"}
        </button>
      </div>
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <IndicatorBox label="Operações" value={result.totalTrades} COLORS={COLORS} />
          <IndicatorBox label="Taxa de acerto" value={`${result.winRate}%`} COLORS={COLORS} />
          <IndicatorBox label="Retorno acumulado" value={`${result.totalReturn}%`} COLORS={COLORS} />
          <IndicatorBox label="Pior operação" value={`${result.worstTrade}%`} COLORS={COLORS} />
          <IndicatorBox label="Retorno médio/op." value={`${result.avgTrade}%`} COLORS={COLORS} />
        </div>
      )}
      <p style={{ color: COLORS.sub, fontSize: 11, marginTop: 14 }}>
        Resultado histórico calculado com preços reais de fechamento diário. Desempenho passado NÃO é garantia de resultado futuro.
      </p>
    </Card>
  );
}

/* ---------------- ACESSIBILIDADE ---------------- */
function AccessibilityView({ fontScale, setFontScale, highContrast, setHighContrast, bigButtons, setBigButtons, capital, setCapital, riskPct, setRiskPct, COLORS, panelBorder, scale }) {
  const riscoFinanceiro = capital * (riskPct / 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ padding: 18 }}>
        <SectionTitle icon={Accessibility} title="🔍 Acessibilidade" COLORS={COLORS} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <AccBtn label="🔎 - Diminuir" onClick={() => setFontScale((s) => clamp(s - 0.1, 0.8, 2))} COLORS={COLORS} />
          <AccBtn label="🔎 + Aumentar" onClick={() => setFontScale((s) => clamp(s + 0.1, 0.8, 2))} COLORS={COLORS} />
          <AccBtn label="AUMENTAR TUDO" onClick={() => { setFontScale(1.5); setBigButtons(true); }} highlight COLORS={COLORS} />
          <AccBtn label="MODO GRANDE" onClick={() => { setFontScale(1.8); setBigButtons(true); }} COLORS={COLORS} />
          <AccBtn label="TAMANHO NORMAL" onClick={() => { setFontScale(1); setBigButtons(false); }} COLORS={COLORS} />
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={highContrast} onChange={(e) => setHighContrast(e.target.checked)} /> Modo de alto contraste
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={bigButtons} onChange={(e) => setBigButtons(e.target.checked)} /> Botões e espaçamento maiores
          </label>
        </div>
        <p style={{ color: COLORS.sub, fontSize: 11, marginTop: 12 }}>
          Escala atual do texto: {(fontScale * 100).toFixed(0)}%. ⚠️ Como artifacts não podem usar armazenamento do navegador, estas preferências duram apenas a sessão atual — no seu site publicado (fora do Claude), configure-as para salvar automaticamente em localStorage ou no perfil do usuário.
        </p>
      </Card>

      <Card style={{ padding: 18 }}>
        <SectionTitle icon={DollarSign} title="💰 Meu Capital e Gerenciamento de Risco" COLORS={COLORS} />
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div>
            <label style={{ color: COLORS.sub, fontSize: 12 }}>Capital (R$)</label><br />
            <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} style={{ padding: 10, borderRadius: 8, border: "1px solid #333", background: "#181b22", color: COLORS.text, width: 160 }} />
          </div>
          <div>
            <label style={{ color: COLORS.sub, fontSize: 12 }}>Risco por operação (%)</label><br />
            <input type="number" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} style={{ padding: 10, borderRadius: 8, border: "1px solid #333", background: "#181b22", color: COLORS.text, width: 160 }} />
          </div>
        </div>
        <div style={{ marginTop: 14, fontSize: 14 }}>
          Capital: <b>R$ {capital.toLocaleString("pt-BR")}</b> · Risco por operação: <b>{riskPct}%</b> · Risco financeiro: <b style={{ color: COLORS.red }}>R$ {riscoFinanceiro.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</b>
        </div>
        <p style={{ color: COLORS.sub, fontSize: 11, marginTop: 10 }}>
          Estes são apenas cálculos de gerenciamento de risco a partir dos valores que você informou — não é garantia de resultado nem recomendação de investimento.
        </p>
      </Card>
    </div>
  );
}
function AccBtn({ label, onClick, highlight, COLORS }) {
  return (
    <button onClick={onClick} style={{ padding: "12px 18px", borderRadius: 10, border: highlight ? "none" : "1px solid #333", background: highlight ? COLORS.gold : "#181b22", color: highlight ? "#0a0b0f" : COLORS.text, fontWeight: 700, cursor: "pointer" }}>
      {label}
    </button>
  );
}

/* ---------------- AJUDA ---------------- */
function HelpView({ COLORS, panelBorder, scale }) {
  return (
    <Card style={{ padding: 20, maxWidth: 640 }}>
      <SectionTitle icon={HelpCircle} title="❓ Ajuda" COLORS={COLORS} />
      <p style={{ fontSize: 13, color: COLORS.text, lineHeight: 1.7 }}>
        O Criptotrader Luiz Alves é uma ferramenta de <b>análise e monitoramento</b>. Ele não executa compras ou vendas
        e não promete lucro. Todos os preços vêm da CoinGecko em tempo quase real, o câmbio USD/BRL vem do Banco Central Europeu (via Frankfurter)
        e o índice de Medo & Ganância vem da alternative.me. Use o botão 🟡 "Comprar na Binance" para ser redirecionado ao par correspondente
        na corretora — nunca informe sua senha ou chave privada aqui.
      </p>
    </Card>
  );
}
