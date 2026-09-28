'use client';

import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'time-financial-life-simulator-v2';
const HOLDINGS_KEY = 'time-financial-life-simulator-v2-holdings';
const ASSET_KEYS = ['cash', 'deposit', 'bonds', 'stocks', 'realEstate', 'insurance'] as const;
const STOCK_INITIAL_PRICES: Record<string, number> = { 'stock-world': 160, 'stock-tech': 740, 'stock-dividend': 165 };
const BOND_INITIAL_PRICES: Record<string, number> = { 'bond-5': 98, 'bond-10': 91, 'bond-corp': 96 };
const MARKET_MODEL_VERSION = 4;

type MarketSignals = {
  growth: number; inflation: number; policyRate: number; riskAppetite: number;
  earnings: number; flows: number; news: number; creditSpread: number;
};

const buildMarketSignals = (): MarketSignals => ({
  growth: -0.01 + Math.random()*0.055,
  inflation: 0.012 + Math.random()*0.045,
  policyRate: 0.01 + Math.random()*0.05,
  riskAppetite: -1 + Math.random()*2,
  earnings: -0.08 + Math.random()*0.24,
  flows: -1 + Math.random()*2,
  news: -1 + Math.random()*2,
  creditSpread: 0.006 + Math.random()*0.035,
});

const signalLabel = (v:number, good='偏強', bad='偏弱') => v > 0.3 ? good : v < -0.3 ? bad : '中性';
const productNoise = (scale=1) => (Math.random()+Math.random()-1)*scale;
const stableNoise = (key:string, scale=1) => {
  let h=2166136261;
  for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619)}
  return ((((h>>>0)%10000)/9999)*2-1)*scale;
};
const stockResearch = (id:string, signals:MarketSignals, hist:number[]) => {
  const techBias = id === 'stock-tech' ? 0.06 : id === 'stock-dividend' ? -0.025 : 0;
  const dividendBias = id === 'stock-dividend' ? 0.06 : 0;
  const seed=id+'|'+signals.growth.toFixed(4)+'|'+signals.inflation.toFixed(4)+'|'+signals.policyRate.toFixed(4)+'|'+signals.earnings.toFixed(4)+'|'+signals.flows.toFixed(4)+'|'+signals.news.toFixed(4)+'|'+signals.riskAppetite.toFixed(4)+'|'+hist.length;
  const fundamental = signals.earnings + signals.growth*1.4 - signals.policyRate*0.45 + techBias + stableNoise(seed+'|fundamental',0.18);
  const flow = signals.flows*0.55 + signals.riskAppetite*(id==='stock-tech'?0.35:0.18) + stableNoise(seed+'|flow',0.65);
  const news = signals.news*0.45 + dividendBias + stableNoise(seed+'|news',0.8);
  const recent = hist.length>2 ? hist[hist.length-1]/hist[Math.max(0,hist.length-7)]-1 : 0;
  const technical = recent*4 + stableNoise(seed+'|technical',0.55);
  return {fundamental,flow,news,technical};
};
const bondResearch = (id:string, signals:MarketSignals) => {
  const seed=id+'|'+signals.growth.toFixed(4)+'|'+signals.inflation.toFixed(4)+'|'+signals.policyRate.toFixed(4)+'|'+signals.news.toFixed(4)+'|'+signals.riskAppetite.toFixed(4)+'|'+signals.creditSpread.toFixed(4);
  return {
    fundamental:(id==='bond-corp'?signals.growth*3-signals.creditSpread*4:-signals.inflation*1.2)+stableNoise(seed+'|fundamental',0.25),
    flow:-signals.riskAppetite*0.45+stableNoise(seed+'|flow',0.65),
    news:signals.news*(id==='bond-corp'?0.6:0.25)+stableNoise(seed+'|news',0.65),
    rate:(0.035-signals.policyRate)*12+stableNoise(seed+'|rate',0.25),
  };
};


const buildPreGameMarket = () => {
  const signals = buildMarketSignals();
  const stockPrices: Record<string, number> = {};
  const stockPriceHistory: Record<string, number[]> = {};
  Object.entries(STOCK_INITIAL_PRICES).forEach(([id, base]) => {
    const profile = id === 'stock-tech'
      ? { drift: 0.10, vol: 0.24, fundamental: 1.35, flow: 1.15 }
      : id === 'stock-dividend'
        ? { drift: 0.055, vol: 0.12, fundamental: 0.75, flow: 0.7 }
        : { drift: 0.07, vol: 0.16, fundamental: 1.0, flow: 0.9 };
    const fundamentalImpact = (signals.growth*0.9 + signals.earnings*0.55 - Math.max(0,signals.policyRate-0.025)*0.8) * profile.fundamental;
    const flowImpact = signals.flows * 0.035 * profile.flow;
    const newsImpact = signals.news * 0.045;
    const sentimentImpact = signals.riskAppetite * 0.03;
    const idiosyncratic = productNoise(id === 'stock-tech' ? 0.10 : 0.065);
      const signalDrift = profile.drift + fundamentalImpact*0.62 + flowImpact*0.55 + newsImpact*0.45 + sentimentImpact*0.5 + idiosyncratic;
    let price = base;
    const path = [price];
    for (let month = 0; month < 12; month++) {
      const shock = (Math.random()+Math.random()+Math.random()+Math.random()-2) * (profile.vol / Math.sqrt(12));
      price = Math.max(5, price * (1 + signalDrift/12 + shock));
      path.push(price);
    }
    stockPrices[id] = price;
    stockPriceHistory[id] = path;
  });
  const rateShock = (Math.random()-0.5)*0.018 + (signals.inflation-0.025)*0.15;
  const bondPrices: Record<string, number> = {};
  Object.entries(BOND_INITIAL_PRICES).forEach(([id, base]) => {
    const duration = id === 'bond-10' ? 7.2 : id === 'bond-corp' ? 5.2 : 4.2;
    const creditShock = id === 'bond-corp' ? -(signals.creditSpread-0.018)*1.8 + signals.news*0.012 : signals.news*0.003;
    bondPrices[id] = clamp(base * (1-duration*rateShock+creditShock),65,125);
  });
  return { stockPrices, stockPriceHistory, bondPrices, signals };
};

type AssetKey = (typeof ASSET_KEYS)[number];
type Portfolio = Record<AssetKey, number>;
type Allocation = Record<AssetKey, number>;

type MarketEvent = {
  title: string;
  blurb: string;
  effect: Partial<Portfolio>;
  type: 'bull' | 'crisis' | 'inflation' | 'rate' | 'recession';
};

type LifeEvent = {
  title: string;
  description: string;
  expense?: number;
  income?: number;
  requiredChoice?: boolean;
  choiceLabel?: string;
  choices?: Array<{
    label: string;
    action: 'cash' | 'deposit' | 'stocks' | 'bonds' | 'realEstate' | 'insurance' | 'delay';
    note: string;
  }>;
};

type HistoryEntry = {
  year: number;
  age: number;
  total: number;
  real: number;
  liquidity: number;
  eventTitle: string;
};

type PendingChoice = {
  title: string;
  description: string;
  amount: number;
  choices: Array<{
    label: string;
    action: 'cash' | 'deposit' | 'stocks' | 'bonds' | 'realEstate' | 'insurance' | 'delay';
    note: string;
  }>;
};

type GameState = {
  age: number;
  year: number;
  portfolio: Portfolio;
  allocations: Allocation;
  income: number;
  expense: number;
  lifeStatus: string;
  inflationRate: number;
  cumulativeInflation: number;
  eventHistory: string[];
  history: HistoryEntry[];
  marketEvent: MarketEvent | null;
  lastLifeEvent: LifeEvent | null;
  pendingChoice: PendingChoice | null;
  forcedSellCount: number;
  liquidityCrisisCount: number;
  marketCrisisCount: number;
  maxDrawdown: number;
  timeMachineUnlocked: boolean;
  completed: boolean;
  analysis: string;
};

const BASE_PORTFOLIO: Portfolio = {
  cash: 1000000,
  deposit: 0,
  bonds: 0,
  stocks: 0,
  realEstate: 0,
  insurance: 0,
};

const START_ALLOCATIONS: Allocation = {
  cash: 100,
  deposit: 0,
  bonds: 0,
  stocks: 0,
  realEstate: 0,
  insurance: 0,
};

const ASSET_META: Record<AssetKey, { label: string; short: string; liquidity: number }> = {
  cash: { label: '現金', short: 'Cash', liquidity: 1 },
  deposit: { label: '定存', short: 'Deposit', liquidity: 0.95 },
  bonds: { label: '債券', short: 'Bonds', liquidity: 0.8 },
  stocks: { label: '股票', short: 'Stocks', liquidity: 0.7 },
  realEstate: { label: '房地產', short: 'Real Estate · 低流動性', liquidity: 0.35 },
  insurance: { label: '長期保險', short: 'Insurance · 長期契約', liquidity: 0.2 },
};

const MARKET_EVENTS: MarketEvent[] = [
  { title: '全球牛市', blurb: '科技與企業信心回升，股市走高。', effect: { stocks: 0.25 }, type: 'bull' },
  { title: '全球金融危機', blurb: '信貸市場收縮，風險資產遭受重擊。', effect: { stocks: -0.42, realEstate: -0.15 }, type: 'crisis' },
  { title: '央行快速升息', blurb: '利率快速上升，債券價格下滑，房市承壓。', effect: { bonds: -0.12, realEstate: -0.08, deposit: 0.12 }, type: 'rate' },
  { title: '高通膨', blurb: '物價節節攀升，購買力受到壓迫。', effect: { cash: -0.07 }, type: 'inflation' },
  { title: '經濟衰退', blurb: '企業獲利放緩，失業率上升，資產價格承壓。', effect: { stocks: -0.22, realEstate: -0.12 }, type: 'recession' },
  { title: '房市熱潮', blurb: '購屋需求強勁，房價上揚。', effect: { realEstate: 0.18 }, type: 'bull' },
  { title: '科技龍頭表現強勁', blurb: '大型科技股帶動市場情緒。', effect: { stocks: 0.19 }, type: 'bull' },
  { title: '信用緊縮', blurb: '債券市場開始要求更高風險溢酬。', effect: { bonds: -0.18, stocks: -0.1 }, type: 'crisis' },
  { title: '大宗商品上漲', blurb: '能源與原物料拉高通膨壓力。', effect: { cash: -0.08, realEstate: 0.04 }, type: 'inflation' },
  { title: '政策刺激', blurb: '政府與央行放水，資產市場回暖。', effect: { stocks: 0.14, bonds: 0.06 }, type: 'bull' },
  { title: '債券殖利率急升', blurb: '長債價格下降，但定存收益變好。', effect: { bonds: -0.2, deposit: 0.14 }, type: 'rate' },
  { title: '匯率震盪', blurb: '出口產業受益，但消費壓力增加。', effect: { stocks: 0.08, realEstate: -0.05 }, type: 'recession' },
  { title: '消費者信心改善', blurb: '民間消費重啟，企業獲利回升。', effect: { stocks: 0.16, realEstate: 0.07 }, type: 'bull' },
  { title: '地產交易稀少', blurb: '市場觀望情緒強，房價壓力加大。', effect: { realEstate: -0.2 }, type: 'recession' },
  { title: '穩定成長環境', blurb: '景氣緩步回升，各資產輪動呈現平衡。', effect: { bonds: 0.06, stocks: 0.1, realEstate: 0.04 }, type: 'bull' },
];

const LIFE_EVENTS: LifeEvent[] = [
  { title: '出國進修', description: '你決定在 29 歲前往海外進修，開始一段學術旅程。', expense: 400000, requiredChoice: false },
  { title: '婚禮與新家庭', description: '你結婚了，婚禮與新生活支出開始增加。', expense: 300000, requiredChoice: false },
  { title: '孩子出生', description: '嬰兒到來，家庭支出與生活成本明顯提升。', expense: 220000, requiredChoice: false },
  { title: '購買第一間房', description: '你決定成立家計，準備首購與頭期款。', expense: 520000, requiredChoice: true, choiceLabel: '房屋與生活計畫', choices: [
    { label: '用現金支付', action: 'cash', note: '加快安定感，但降低流動性。' },
    { label: '出售部分股票', action: 'stocks', note: '短期變現，但可能在低點賣出。' },
    { label: '延後購屋', action: 'delay', note: '保留現金，但未來可能失去時機。' }
  ] },
  { title: '家人醫療支出', description: '家人突然需要一筆醫療費用，這筆支出迫在眉睫。', expense: 500000, requiredChoice: true, choiceLabel: '緊急支出', choices: [
    { label: '使用現金', action: 'cash', note: '最穩定，但流動性下降。' },
    { label: '出售債券', action: 'bonds', note: '快速變現，代價是可能不是最佳時點。' },
    { label: '出售股票', action: 'stocks', note: '可能被迫低點賣出。' },
    { label: '延後某項計畫', action: 'delay', note: '可保留資金，但人生目標被推遲。' }
  ] },
  { title: '職涯轉職', description: '你選擇轉職與再培訓，這筆投資正在改變未來收入構造。', expense: 250000, requiredChoice: false },
  { title: '創業支出', description: '你投資自己，開始一段創業計畫。', expense: 550000, requiredChoice: true, choiceLabel: '創業需要資金', choices: [
    { label: '使用定存', action: 'deposit', note: '穩定但可能失去更好的機會。' },
    { label: '出售部分房地產', action: 'realEstate', note: '流動性差，交易成本高。' },
    { label: '延後其他支出', action: 'delay', note: '保留資產，但年度生活品質會下降。' }
  ] },
  { title: '家庭旅遊計畫', description: '你與家人計畫一次長途旅遊，這是人生重要記憶。', expense: 180000, requiredChoice: false },
  { title: '父母照護支出', description: '照護支出增加，家庭責任與長期需求同步提升。', expense: 420000, requiredChoice: true, choices: [
    { label: '使用現金', action: 'cash', note: '最直接，但增加生活彈性壓力。' },
    { label: '出售股票', action: 'stocks', note: '方便但可能低點賣出。' },
    { label: '延後保險規劃', action: 'delay', note: '保留現金，風險轉嫁到未來。' }
  ] },
  { title: '教育基金建立', description: '你開始為未來子女教育規劃，資金需求逐步增加。', expense: 280000, requiredChoice: false },
  { title: '車輛與生活支出', description: '家庭生活品質提升，車輛與日常支出增加。', expense: 170000, requiredChoice: false },
  { title: '幫助家庭成員', description: '你選擇協助家人完成人生計畫，資金需要立即到位。', expense: 350000, requiredChoice: true, choices: [
    { label: '拿現金', action: 'cash', note: '最直接，但短期流動性受限。' },
    { label: '賣債券', action: 'bonds', note: '將資產變現，但可能錯過利率改善。' },
    { label: '延後投資計畫', action: 'delay', note: '這會影響你長期資產配置。' }
  ] },
  { title: '退休儲備轉向', description: '你開始重新思考退休對策，增加長期安全儲備。', expense: 160000, requiredChoice: false },
  { title: '家庭重建支出', description: '家事修繕與家庭調整帶來額外支出。', expense: 190000, requiredChoice: false },
  { title: '重大責任事件', description: '這一年你面對一項人生重大決定，會改變你接下來的資產配置與生活重心。', expense: 480000, requiredChoice: true, choices: [
    { label: '用現金處理', action: 'cash', note: '降低風險，但留不住長期資產彈性。' },
    { label: '出售股票', action: 'stocks', note: '快速變現，但可能低點賣出。' },
    { label: '暫停其他計畫', action: 'delay', note: '保留資產，未來需要付出更多代價。' }
  ] },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const roundMoney = (value: number) => Math.round(value);
const sumPortfolio = (portfolio: Portfolio) =>
  Object.values(portfolio).reduce((sum, value) => sum + value, 0);

const getAnnualIncome = (age: number) => {
  if (age < 30) return 420000;
  if (age < 35) return 560000;
  if (age < 45) return 720000;
  if (age < 55) return 840000;
  return 960000;
};

const getAnnualExpense = (age: number) => {
  if (age < 30) return 240000;
  if (age < 35) return 320000;
  if (age < 45) return 420000;
  if (age < 55) return 540000;
  return 620000;
};

const getRealWealth = (nominal: number, cumulativeInflation: number) => {
  return nominal / (1 + cumulativeInflation);
};

const getLiquidity = (portfolio: Portfolio) => {
  return (
    portfolio.cash +
    portfolio.deposit +
    portfolio.bonds * ASSET_META.bonds.liquidity +
    portfolio.stocks * ASSET_META.stocks.liquidity +
    portfolio.insurance * ASSET_META.insurance.liquidity
  );
};

const randomFrom = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

const getAssetValueByAllocation = (total: number, allocations: Allocation): Portfolio => ({
  cash: total * (allocations.cash / 100),
  deposit: total * (allocations.deposit / 100),
  bonds: total * (allocations.bonds / 100),
  stocks: total * (allocations.stocks / 100),
  realEstate: total * (allocations.realEstate / 100),
  insurance: total * (allocations.insurance / 100),
});

const buildInitialState = (): GameState => ({
  age: 25,
  year: 1,
  portfolio: { ...BASE_PORTFOLIO },
  allocations: { ...START_ALLOCATIONS },
  income: 0,
  expense: 0,
  lifeStatus: '你已經開始人生資產旅程。',
  inflationRate: 0.025,
  cumulativeInflation: 0.025,
  eventHistory: ['如果時間本身也是一種金融資源，你會怎麼使用它？'],
  history: [],
  marketEvent: null,
  lastLifeEvent: null,
  pendingChoice: null,
  forcedSellCount: 0,
  liquidityCrisisCount: 0,
  marketCrisisCount: 0,
  maxDrawdown: 0,
  timeMachineUnlocked: false,
  completed: false,
  analysis: '你正在建立一個長期配置與現金需求的平衡。',
});

const normalizeAllocations = (allocations: Allocation) => {
  const entries = Object.entries(allocations) as [AssetKey, number][];
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const normalized = { ...allocations } as Allocation;
  entries.forEach(([key, value]) => {
    normalized[key] = (value / total) * 100;
  });
  return normalized;
};

const asyncLoadGame = () => {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as GameState;
  } catch {
    return null;
  }
};

export default function Page() {
  const [game, setGame] = useState<GameState>(buildInitialState);
  const [isMounted, setIsMounted] = useState(false);
  const [productAmounts, setProductAmounts] = useState<Record<string, string>>({});
  const [productHoldings, setProductHoldings] = useState<Array<{ id: string; productId: string; asset: Exclude<AssetKey, 'cash'>; label: string; amount: number; boughtAge: number; premiumTerm?: number; premiumsPaid?: number; buyPrice?: number; shares?: number; bondUnits?: number; faceValue?: number; maturityYears?: number; couponRate?: number }>>([]);
  const [productHistory, setProductHistory] = useState<Array<{ id: string; productId: string; asset: Exclude<AssetKey, 'cash'>; label: string; amount: number; boughtAge: number; premiumTerm?: number; premiumsPaid?: number; buyPrice?: number; shares?: number; bondUnits?: number; faceValue?: number; maturityYears?: number; couponRate?: number }>>([]);
  const [holdingView, setHoldingView] = useState<'current' | 'history'>('current');
  const [mainView, setMainView] = useState<'game' | 'market'>('game');
  const [initialMarket] = useState(buildPreGameMarket);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>(initialMarket.stockPrices);
  const [stockPriceHistory, setStockPriceHistory] = useState<Record<string, number[]>>(initialMarket.stockPriceHistory);
  const [stockTradeShares, setStockTradeShares] = useState<Record<string, string>>({});
  const [bondPrices, setBondPrices] = useState<Record<string, number>>(initialMarket.bondPrices);
  const [bondTradeUnits, setBondTradeUnits] = useState<Record<string, string>>({});
  const [marketSignals, setMarketSignals] = useState<MarketSignals>(initialMarket.signals);
  const [researchOverlay, setResearchOverlay] = useState<{key:string; title:string; body:React.ReactNode} | null>(null);
  const toggleResearch = (key:string, title:string, body:React.ReactNode) => {
    if (researchOverlay?.key===key) setResearchOverlay(null);
    else setResearchOverlay({key,title,body});
  };

  useEffect(() => {
    setIsMounted(true);
    const saved = asyncLoadGame();
    if (saved) {
      setGame({ ...saved, pendingChoice: null, completed: false });
    }
    try {
      const savedProducts = window.localStorage.getItem(HOLDINGS_KEY);
      if (savedProducts) {
        const parsed = JSON.parse(savedProducts);
        if (Array.isArray(parsed.holdings)) setProductHoldings(parsed.holdings);
        if (Array.isArray(parsed.history)) setProductHistory(parsed.history);
        if (parsed.marketModelVersion === MARKET_MODEL_VERSION) {
          if (parsed.stockPrices) setStockPrices(parsed.stockPrices);
          if (parsed.stockPriceHistory) setStockPriceHistory(parsed.stockPriceHistory);
          if (parsed.bondPrices) setBondPrices(parsed.bondPrices);
          if (parsed.marketSignals) setMarketSignals(parsed.marketSignals);
        } else {
          // Migrate old preview saves that used the obsolete all-100 market model.
          const migratedMarket = buildPreGameMarket();
          setStockPrices(migratedMarket.stockPrices);
          setStockPriceHistory(migratedMarket.stockPriceHistory);
          setBondPrices(migratedMarket.bondPrices);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  }, [game, isMounted]);

  useEffect(() => {
    if (!isMounted) return;
    window.localStorage.setItem(HOLDINGS_KEY, JSON.stringify({ holdings: productHoldings, history: productHistory, stockPrices, stockPriceHistory, bondPrices, marketSignals, marketModelVersion: MARKET_MODEL_VERSION }));
  }, [productHoldings, productHistory, stockPrices, stockPriceHistory, bondPrices, marketSignals, isMounted]);

  const totalAssets = useMemo(() => sumPortfolio(game.portfolio), [game.portfolio]);
  const realWeight = useMemo(() => getRealWealth(totalAssets, game.cumulativeInflation), [totalAssets, game.cumulativeInflation]);
  const liquidity = useMemo(() => getLiquidity(game.portfolio), [game.portfolio]);
  // V2 display ratios always come from the CURRENT portfolio values.
  // Never use the old target-allocation percentages for holdings display.
  const allocationList = useMemo(() => ASSET_KEYS.map((asset) => ({
    asset,
    percentage: totalAssets > 0 ? (game.portfolio[asset] / totalAssets) * 100 : 0,
    amount: game.portfolio[asset],
  })), [game.portfolio, totalAssets]);

  // V2 holdings are transaction-driven. Current cash is a balance, not a target
  // allocation input, so it must never be editable directly.


  const productCatalog: Record<Exclude<AssetKey, 'cash'>, Array<{ id: string; label: string }>> = {
    deposit: [{ id: 'deposit-1', label: '一年期定存｜2.0%｜1年到期' }, { id: 'deposit-3', label: '三年期定存｜2.4%｜3年到期' }],
    bonds: [{ id: 'bond-5', label: '5年期政府債券 A｜年息2.8%｜每年付息' }, { id: 'bond-10', label: '10年期政府債券 B｜年息3.2%｜每年付息' }, { id: 'bond-corp', label: '7年期投資級公司債 C｜年息4.1%｜每年付息' }],
    stocks: [{ id: 'stock-world', label: '全球股票 ETF｜股息率約2.0%' }, { id: 'stock-tech', label: '科技成長 ETF｜股息率約0.8%' }, { id: 'stock-dividend', label: '高股息 ETF｜股息率約4.0%' }],
    realEstate: [{ id: 'home-city', label: '都會小宅｜總價800萬｜頭期20%' }, { id: 'home-family', label: '郊區家庭宅｜總價1,200萬｜頭期20%' }],
    insurance: [{ id: 'policy-5', label: '5年繳長期分紅保單｜早期流動性低' }, { id: 'policy-10', label: '10年繳長期分紅保單｜長期累積' }],
  };

  const buyProduct = (asset: Exclude<AssetKey, 'cash'>, productId: string) => {
    const requestedShares = asset === 'stocks' ? Number(stockTradeShares[productId] || 0) : 0;
    const requestedBondUnits = asset === 'bonds' ? Number(bondTradeUnits[productId] || 0) : 0;
    const marketPrice = asset === 'stocks' ? (stockPrices[productId] || 100) : 0;
    const bondQuote = asset === 'bonds' ? (bondPrices[productId] || 100) : 0;
    const bondFaceValue = 10000;
    const amount = asset === 'stocks' ? requestedShares * marketPrice : asset === 'bonds' ? requestedBondUnits * bondFaceValue * bondQuote / 100 : Number(productAmounts[productId] || 0);
    if (asset === 'stocks' && (!Number.isInteger(requestedShares) || requestedShares <= 0)) return alert('請輸入要買入的整數股數');
    if (asset === 'bonds' && (!Number.isInteger(requestedBondUnits) || requestedBondUnits <= 0)) return alert('請輸入要買入的債券張數');
    if (asset !== 'stocks' && asset !== 'bonds' && amount <= 0) return alert('請先輸入投入金額');
    if (amount > game.portfolio.cash) return alert('現金不足');
    setGame((current) => {
      const nextPortfolio = { ...current.portfolio, cash: current.portfolio.cash - amount, [asset]: current.portfolio[asset] + amount };
      const total = sumPortfolio(nextPortfolio);
      const nextAllocations = { ...current.allocations };
      ASSET_KEYS.forEach((key) => { nextAllocations[key] = total > 0 ? (nextPortfolio[key] / total) * 100 : 0; });
      return { ...current, portfolio: nextPortfolio, allocations: nextAllocations, lifeStatus: `已購買商品，投入 NT${roundMoney(amount).toLocaleString('en-US')}。投入後不可直接修改本金。` };
    });
    const product = productCatalog[asset].find((item) => item.id === productId);
    if (product) {
      const premiumTerm = productId === 'policy-5' ? 5 : productId === 'policy-10' ? 10 : undefined;
      const price = asset === 'stocks' ? (stockPrices[productId] || 100) : asset === 'bonds' ? (bondPrices[productId] || 100) : undefined;
      const maturityYears = productId === 'bond-5' ? 5 : productId === 'bond-10' ? 10 : productId === 'bond-corp' ? 7 : undefined;
      const couponRate = productId === 'bond-5' ? 0.028 : productId === 'bond-10' ? 0.032 : productId === 'bond-corp' ? 0.041 : undefined;
      const purchase = { id: `${productId}-${Date.now()}`, productId, asset, label: product.label, amount, boughtAge: game.age, premiumTerm, premiumsPaid: premiumTerm ? 1 : undefined, buyPrice: price, shares: asset === 'stocks' ? requestedShares : undefined, bondUnits: asset === 'bonds' ? requestedBondUnits : undefined, faceValue: asset === 'bonds' ? 10000 : undefined, maturityYears, couponRate };
      setProductHoldings((current) => [...current, purchase]);
      setProductHistory((current) => [...current, purchase]);
    }
    setProductAmounts((current) => ({ ...current, [productId]: '' }));
    if (asset === 'stocks') setStockTradeShares((current) => ({ ...current, [productId]: '' }));
    if (asset === 'bonds') setBondTradeUnits((current) => ({ ...current, [productId]: '' }));
  };

  const sellStock = (holdingId: string) => {
    const holding = productHoldings.find((item) => item.id === holdingId && item.asset === 'stocks');
    if (!holding) return;
    const ownedShares = holding.shares || 0;
    const sharesToSell = Number(stockTradeShares['sell-'+holdingId] || 0);
    if (!Number.isInteger(sharesToSell) || sharesToSell <= 0) return alert('請輸入要賣出的整數股數');
    if (sharesToSell > ownedShares) return alert('賣出股數不能超過目前持股');
    const price = stockPrices[holding.productId] || 100;
    const proceeds = sharesToSell * price;
    const costBasisSold = (holding.buyPrice || 0) * sharesToSell;
    setProductHoldings((current) => current.flatMap((item) => item.id !== holdingId ? [item] : sharesToSell === ownedShares ? [] : [{ ...item, shares: ownedShares - sharesToSell, amount: item.amount - costBasisSold }]));
    setGame((current) => {
      const portfolio = { ...current.portfolio, cash: current.portfolio.cash + proceeds, stocks: Math.max(0, current.portfolio.stocks - proceeds) };
      return { ...current, portfolio, lifeStatus: `已賣出 ${holding.label.split('｜')[0]}，NT${roundMoney(proceeds).toLocaleString('en-US')} 回到現金。`, eventHistory: [...current.eventHistory, `股票賣出：${holding.label.split('｜')[0]}，實現損益 NT${roundMoney(proceeds - holding.amount).toLocaleString('en-US')}。`] };
    });
    setStockTradeShares((current) => ({ ...current, ['sell-'+holdingId]: '' }));
  };

  const sellBond = (holdingId: string) => {
    const holding = productHoldings.find((item) => item.id === holdingId && item.asset === 'bonds');
    if (!holding) return;
    const owned = holding.bondUnits || 0;
    const units = Number(bondTradeUnits['sell-'+holdingId] || 0);
    if (!Number.isInteger(units) || units <= 0) return alert('請輸入要賣出的整數張數');
    if (units > owned) return alert('賣出張數不能超過目前持有');
    const quote = bondPrices[holding.productId] || 100;
    const face = holding.faceValue || 10000;
    const proceeds = units * face * quote / 100;
    const costPerUnit = holding.amount / Math.max(owned, 1);
    const costSold = costPerUnit * units;
    setProductHoldings((current) => current.flatMap((item) => item.id !== holdingId ? [item] : units === owned ? [] : [{...item, bondUnits: owned-units, amount: item.amount-costSold}]));
    setGame((current) => ({...current, portfolio:{...current.portfolio,cash:current.portfolio.cash+proceeds,bonds:Math.max(0,current.portfolio.bonds-proceeds)}, eventHistory:[...current.eventHistory,`債券出售：${holding.label.split('｜')[0]} ${units} 張，實現損益 NT${roundMoney(proceeds-costSold).toLocaleString('en-US')}。`]}));
    setBondTradeUnits((current)=>({...current,['sell-'+holdingId]:''}));
  };

  const bondHoldings = productHoldings.filter((holding) => holding.asset === 'bonds');
  const stockHoldings = productHoldings.filter((holding) => holding.asset === 'stocks');
  const policyDue = productHoldings.filter((h) => h.asset === 'insurance' && h.premiumTerm && (h.premiumsPaid || 1) < h.premiumTerm).reduce((sum,h)=>sum+h.amount,0);

  const allocationTotal = ASSET_KEYS.reduce((sum, key) => sum + game.allocations[key], 0);
  const allocationAmountTotal = totalAssets * (allocationTotal / 100);
  const allocationDifference = totalAssets - allocationAmountTotal;
  const allocationValid = Math.abs(allocationDifference) < 1;

  const handleRestart = () => {
    const fresh = buildInitialState();
    setGame(fresh);
    setProductHoldings([]);
    setProductHistory([]);
    const restartedMarket = buildPreGameMarket();
    setStockPrices(restartedMarket.stockPrices);
    setStockPriceHistory(restartedMarket.stockPriceHistory);
    setBondPrices(restartedMarket.bondPrices);
    setStockTradeShares({});
    setBondTradeUnits({});
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      window.localStorage.removeItem(HOLDINGS_KEY);
    }
  };

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
      window.localStorage.setItem(HOLDINGS_KEY, JSON.stringify({ holdings: productHoldings, history: productHistory, stockPrices, stockPriceHistory, bondPrices, marketSignals, marketModelVersion: MARKET_MODEL_VERSION }));
      alert('遊戲已儲存');
    }
  };

  const handleContinue = () => {
    const saved = asyncLoadGame();
    if (saved) {
      setGame(saved);
      alert('載入進度成功');
    } else {
      alert('目前沒有可繼續的存檔');
    }
  };

  const advanceYear = () => {
    if (game.pendingChoice || game.completed) return;

    const signals = buildMarketSignals();
    setMarketSignals(signals);
    const nextStockPrices: Record<string, number> = { ...stockPrices };
    const newMonthlyPaths: Record<string, number[]> = {};
    Object.keys(nextStockPrices).forEach((id) => {
      const profile = id === 'stock-tech' ? { drift: 0.10, vol: 0.24 } : id === 'stock-dividend' ? { drift: 0.055, vol: 0.12 } : { drift: 0.07, vol: 0.16 };
      let price = nextStockPrices[id];
      const path:number[] = [];
      for (let month=0; month<12; month++) {
        const shock = (Math.random()+Math.random()+Math.random()+Math.random()-2) * (profile.vol / Math.sqrt(12));
        price = Math.max(5, price * (1 + profile.drift/12 + shock));
        path.push(price);
      }
      nextStockPrices[id] = price;
      newMonthlyPaths[id] = path;
    });
    setStockPrices(nextStockPrices);
    setStockPriceHistory((current) => {
      const next = { ...current };
      Object.keys(nextStockPrices).forEach((id) => { next[id] = [...(next[id] || [stockPrices[id]]), ...newMonthlyPaths[id]]; });
      return next;
    });

    // Bond quotes are per 100 face value. Rates up => prices down; longer duration moves more.
    const rateShock = (signals.policyRate - marketSignals.policyRate) + (signals.inflation-marketSignals.inflation)*0.35;
    const nextBondPrices:Record<string,number> = {...bondPrices};
    Object.keys(nextBondPrices).forEach((id)=>{
      const duration = id === 'bond-10' ? 7.2 : id === 'bond-corp' ? 5.2 : 4.2;
      const creditShock = id === 'bond-corp' ? (Math.random()-0.5)*0.035 : 0;
      nextBondPrices[id] = clamp(nextBondPrices[id] * (1 - duration*rateShock + creditShock), 65, 125);
    });
    setBondPrices(nextBondPrices);

    const stockMarketValue = productHoldings.filter((h)=>h.asset==='stocks').reduce((sum,h)=>sum+(h.shares||0)*(nextStockPrices[h.productId]||100),0);
    const bondMarketValue = productHoldings.filter((h)=>h.asset==='bonds').reduce((sum,h)=>sum+(h.bondUnits||0)*(h.faceValue||10000)*(nextBondPrices[h.productId]||100)/100,0);
    const bondCoupons = productHoldings.filter((h)=>h.asset==='bonds').reduce((sum,h)=>sum+(h.bondUnits||0)*(h.faceValue||10000)*(h.couponRate||0),0);
    const maturingBonds = productHoldings.filter((h)=>h.asset==='bonds' && h.maturityYears && game.age+1 >= h.boughtAge+h.maturityYears);
    const maturedFace = maturingBonds.reduce((sum,h)=>sum+(h.bondUnits||0)*(h.faceValue||10000),0);
    if (maturingBonds.length) setProductHoldings((current)=>current.filter((h)=>!maturingBonds.some((m)=>m.id===h.id)));
    setGame((current)=>({...current, portfolio:{...current.portfolio, stocks:stockMarketValue, bonds:Math.max(0,bondMarketValue-maturingBonds.reduce((sum,h)=>sum+(h.bondUnits||0)*(h.faceValue||10000)*(nextBondPrices[h.productId]||100)/100,0)), cash:current.portfolio.cash+bondCoupons+maturedFace}, eventHistory:[...current.eventHistory, ...(bondCoupons>0?[`債券票息：NT$${roundMoney(bondCoupons).toLocaleString('en-US')} 已進入現金。`]:[]), ...(maturedFace>0?[`債券到期：面額本金 NT$${roundMoney(maturedFace).toLocaleString('en-US')} 已償還至現金。`]:[])]}));

    // Participating policies are recurring premium contracts.
    // The first entered amount becomes the fixed annual premium for the full premium term.
    const activePolicies = productHoldings.filter((holding) => holding.asset === 'insurance' && holding.premiumTerm && (holding.premiumsPaid || 1) < holding.premiumTerm);
    if (activePolicies.length) {
      const due = activePolicies.reduce((sum, holding) => sum + holding.amount, 0);
      if (game.portfolio.cash < due) {
        alert(`保單續期保費 NT${roundMoney(due).toLocaleString('en-US')} 即將到期，但目前現金不足。請先保留足夠現金；保費屬於既有契約的強制年度支出。`);
        return;
      }
      setProductHoldings((current) => current.map((holding) => {
        if (holding.asset !== 'insurance' || !holding.premiumTerm || (holding.premiumsPaid || 1) >= holding.premiumTerm) return holding;
        return { ...holding, premiumsPaid: (holding.premiumsPaid || 1) + 1 };
      }));
      setGame((current) => ({
        ...current,
        portfolio: { ...current.portfolio, cash: current.portfolio.cash - due, insurance: current.portfolio.insurance + due },
        eventHistory: [...current.eventHistory, `保單續期：本年度自動繳交保費 NT${roundMoney(due).toLocaleString('en-US')}。`],
        lifeStatus: `既有保單續期保費 NT${roundMoney(due).toLocaleString('en-US')} 已自動從現金扣除。`,
      }));
    }

    // Mature fixed deposits before the new year's market/life simulation.
    // Principal + contractual interest returns to cash, and the holding disappears.
    const maturingDeposits = productHoldings.filter((holding) => {
      if (holding.asset !== 'deposit') return false;
      const term = holding.productId === 'deposit-1' ? 1 : holding.productId === 'deposit-3' ? 3 : 0;
      return term > 0 && game.age + 1 >= holding.boughtAge + term;
    });
    if (maturingDeposits.length) {
      const proceeds = maturingDeposits.reduce((sum, holding) => {
        const term = holding.productId === 'deposit-1' ? 1 : 3;
        const rate = holding.productId === 'deposit-1' ? 0.02 : 0.024;
        return sum + holding.amount * (1 + rate * term);
      }, 0);
      const principal = maturingDeposits.reduce((sum, holding) => sum + holding.amount, 0);
      setProductHoldings((current) => current.filter((holding) => !maturingDeposits.some((matured) => matured.id === holding.id)));
      setGame((current) => {
        const portfolio = { ...current.portfolio, deposit: Math.max(0, current.portfolio.deposit - principal), cash: current.portfolio.cash + proceeds };
        const total = sumPortfolio(portfolio);
        const allocations = { ...current.allocations };
        ASSET_KEYS.forEach((key) => { allocations[key] = total > 0 ? (portfolio[key] / total) * 100 : 0; });
        return { ...current, portfolio, allocations, eventHistory: [...current.eventHistory, `定存到期：本金與利息 NT${roundMoney(proceeds).toLocaleString('en-US')} 已回到現金。`] };
      });
    }

    setGame((current) => {
      const totalBefore = sumPortfolio(current.portfolio);
      const rebalanced = { ...current.portfolio };

      const inflationRate = clamp(0.018 + Math.random() * 0.06, 0.01, 0.08);
      const marketEvent = randomFrom(MARKET_EVENTS);
      // V2 focus: market conditions and asset allocation only.
      // No salary, living expense, or random life-event cash-flow system.

      const baseReturns: Record<AssetKey, number> = {
        cash: 0.014 + inflationRate * 0.2,
        deposit: 0.025 + (Math.random() * 0.04),
        bonds: 0,
        stocks: 0,
        realEstate: 0.045 + (Math.random() * 0.09),
        insurance: 0.038 + (Math.random() * 0.05),
      };

      let assetsAfterMarket: Portfolio = { ...rebalanced };
      ASSET_KEYS.forEach((key) => {
        const modifier = (key === 'stocks' || key === 'bonds') ? 0 : (marketEvent.effect[key] ?? 0);
        assetsAfterMarket[key] = rebalanced[key] * (1 + baseReturns[key] + modifier);
      });

      let nextPortfolio = { ...assetsAfterMarket };
      const nextIncome = 0;
      const nextExpense = 0;
      const nextLifeStatus = `${marketEvent.title}：${marketEvent.blurb}`;
      const nextEventHistory = [...current.eventHistory, `${marketEvent.title}: ${marketEvent.blurb}`];
      const nextAnalysis = '本年度只反映市場環境與既有金融商品的現金流，不額外加入薪資、生活支出或人生事件。';

      const finalTotal = sumPortfolio(nextPortfolio);
      const nextAge = current.age + 1;
      const nextHistory: HistoryEntry = {
        year: current.year,
        age: current.age,
        total: finalTotal,
        real: getRealWealth(finalTotal, (1 + current.cumulativeInflation) * (1 + inflationRate) - 1),
        liquidity: getLiquidity(nextPortfolio),
        eventTitle: marketEvent.title,
      };

      const newHistory = [...current.history, nextHistory];
      const maxDrawdown = Math.max(
        current.maxDrawdown,
        1 - Math.min(...newHistory.map((entry) => entry.total)) / Math.max(...newHistory.map((entry) => entry.total), 1)
      );

      const finalized: GameState = {
        ...current,
        age: nextAge,
        year: current.year + 1,
        portfolio: nextPortfolio,
        income: 0,
        expense: 0,
        lifeStatus: nextLifeStatus,
        inflationRate,
        cumulativeInflation: (1 + current.cumulativeInflation) * (1 + inflationRate) - 1,
        eventHistory: nextEventHistory,
        history: newHistory,
        marketEvent,
        lastLifeEvent: null,
        pendingChoice: null,
        timeMachineUnlocked: current.timeMachineUnlocked || (current.age >= 35 && current.allocations.insurance >= 10),
        marketCrisisCount: marketEvent.type === 'crisis' ? current.marketCrisisCount + 1 : current.marketCrisisCount,
        maxDrawdown,
        completed: nextAge >= 65,
      };

      if (nextAge >= 65) {
        finalized.analysis = buildFinalAnalysis(finalized);
      }

      return finalized;
    });
  };

  const resolveChoice = (action: 'cash' | 'deposit' | 'stocks' | 'bonds' | 'realEstate' | 'insurance' | 'delay') => {
    setGame((current) => {
      if (!current.pendingChoice || !current.lastLifeEvent) return current;

      const eventAmount = current.pendingChoice.amount;
      let nextPortfolio = { ...current.portfolio };
      let status = `${current.lastLifeEvent.title}：你選擇 ${action}.`;
      let increasedCrisis = current.liquidityCrisisCount;
      let increasedForcedSell = current.forcedSellCount;

      if (action === 'cash') {
        if (nextPortfolio.cash >= eventAmount) {
          nextPortfolio.cash -= eventAmount;
        } else {
          nextPortfolio = applyForcedSale(nextPortfolio, eventAmount - nextPortfolio.cash, 'cash');
          nextPortfolio.cash = 0;
          increasedForcedSell += 1;
          increasedCrisis += 1;
          status = `${current.lastLifeEvent.title}：現金不足，你被迫賣出資產。`;
        }
      } else if (action === 'deposit') {
        if (nextPortfolio.deposit >= eventAmount) {
          nextPortfolio.deposit -= eventAmount;
        } else {
          const shortfall = eventAmount - nextPortfolio.deposit;
          nextPortfolio.deposit = 0;
          nextPortfolio = applyForcedSale(nextPortfolio, shortfall, 'deposit');
          increasedForcedSell += 1;
          status = `${current.lastLifeEvent.title}：定存不足，你必須動用其他資產。`;
        }
      } else if (action === 'stocks') {
        if (nextPortfolio.stocks >= eventAmount) {
          nextPortfolio.stocks -= eventAmount;
        } else {
          const shortfall = eventAmount - nextPortfolio.stocks;
          nextPortfolio.stocks = 0;
          nextPortfolio = applyForcedSale(nextPortfolio, shortfall, 'stocks');
          increasedForcedSell += 1;
          status = `${current.lastLifeEvent.title}：股票不足，你被迫在低點賣出。`;
        }
      } else if (action === 'bonds') {
        if (nextPortfolio.bonds >= eventAmount) {
          nextPortfolio.bonds -= eventAmount;
        } else {
          const shortfall = eventAmount - nextPortfolio.bonds;
          nextPortfolio.bonds = 0;
          nextPortfolio = applyForcedSale(nextPortfolio, shortfall, 'bonds');
          increasedForcedSell += 1;
          status = `${current.lastLifeEvent.title}：債券不足，流動性危機加劇。`;
        }
      } else if (action === 'realEstate') {
        if (nextPortfolio.realEstate >= eventAmount) {
          nextPortfolio.realEstate -= eventAmount;
        } else {
          const shortfall = eventAmount - nextPortfolio.realEstate;
          nextPortfolio.realEstate = 0;
          nextPortfolio = applyForcedSale(nextPortfolio, shortfall, 'realEstate');
          increasedForcedSell += 1;
          status = `${current.lastLifeEvent.title}：房地產變現成本高，會讓你面臨更大流動壓力。`;
        }
      } else if (action === 'insurance') {
        if (nextPortfolio.insurance >= eventAmount) {
          nextPortfolio.insurance -= eventAmount;
        } else {
          const shortfall = eventAmount - nextPortfolio.insurance;
          nextPortfolio.insurance = 0;
          nextPortfolio = applyForcedSale(nextPortfolio, shortfall, 'insurance');
          increasedForcedSell += 1;
          status = `${current.lastLifeEvent.title}：保險的長期流動性有限，你只好變賣其他資產。`;
        }
      } else if (action === 'delay') {
        status = `${current.lastLifeEvent.title}：你延後計畫，保留資金，但未來的生活成本會更重。`;
      }

      const nextAge = current.age;
      const newHistory = [...current.history, {
        year: current.year - 1,
        age: current.age,
        total: sumPortfolio(nextPortfolio),
        real: getRealWealth(sumPortfolio(nextPortfolio), current.cumulativeInflation),
        liquidity: getLiquidity(nextPortfolio),
        eventTitle: current.lastLifeEvent.title,
      }];

      const finalState: GameState = {
        ...current,
        age: nextAge,
        year: current.year,
        portfolio: nextPortfolio,
        lastLifeEvent: null,
        pendingChoice: null,
        lifeStatus: status,
        eventHistory: [...current.eventHistory, status],
        history: newHistory,
        forcedSellCount: increasedForcedSell,
        liquidityCrisisCount: increasedCrisis,
        completed: nextAge >= 65,
      };

      if (nextAge >= 65) {
        finalState.analysis = buildFinalAnalysis(finalState);
      }

      return finalState;
    });
  };

  const applyForcedSale = (portfolio: Portfolio, amount: number, preferred: AssetKey): Portfolio => {
    const next = { ...portfolio };
    let remaining = amount;

    const salesPriority: AssetKey[] = ['stocks', 'bonds', 'realEstate', 'insurance', 'deposit', 'cash'];
    const ordered = salesPriority.filter((key) => key !== preferred);

    ordered.forEach((asset) => {
      if (remaining <= 0) return;
      const sellNow = Math.min(next[asset], remaining);
      next[asset] -= sellNow;
      next.cash += sellNow;
      remaining -= sellNow;
    });

    if (remaining > 0) {
      next.cash = Math.max(next.cash - remaining, 0);
    }

    return next;
  };

  const buildFinalAnalysis = (state: GameState) => {
    if (state.completed) {
      const liquidityScore = clamp(Math.round((state.liquidityCrisisCount > 0 ? 100 - state.liquidityCrisisCount * 12 : 100) * 0.8), 0, 100);
      const riskScore = clamp(Math.round((100 - state.marketCrisisCount * 12 + state.forcedSellCount * 8)), 0, 100);
      const longTermScore = clamp(Math.round(100 - state.cumulativeInflation * 80), 0, 100);

      if (state.forcedSellCount > 0) {
        return '你非常重視長期報酬，但多次在短期現金需求時被迫出場。這是資產價值與流動性之間的典型 Trade-off。';
      }
      if (state.cumulativeInflation > 0.9) {
        return '你的資產波動較低，但長期購買力受到通膨侵蝕。穩定在手上的資產不等於長期購買力保持不變。';
      }
      return `你的媒介是長期配置與流動性管理的平衡：Liquidity Preference ${liquidityScore}/100、Risk Exposure ${riskScore}/100、Long-term Allocation ${longTermScore}/100。`;
    }
    return '你正在處理風險、流動性與時間資源之間的取捨。';
  };

  const canAdvance = !game.pendingChoice && !game.completed && allocationValid;

  return (
    <main className="page-shell">
      <div className="app-wrap">
        <header className="topbar">
          <div>
            <div className="eyebrow">TIME · V2 DEVELOPMENT</div>
            <h1>金融人生模擬器</h1>
          </div>
          <div className="header-actions">
            <button onClick={handleSave}>Save Game</button>
            <button onClick={handleContinue}>Continue Game</button>
            <button className="danger" onClick={handleRestart}>Restart</button>
          </div>
        </header>

        <nav className="workbook-tabs"><button className={mainView==='game'?'active':''} onClick={()=>setMainView('game')}>遊戲主畫面</button><button className={mainView==='market'?'active':''} onClick={()=>setMainView('market')}>股票市場</button></nav>
        {mainView === 'game' ? <>
        <section className="stats-row">
          <div className="stat-card">
            <span>目前年齡</span>
            <strong>{game.age}</strong>
          </div>
          <div className="stat-card">
            <span>總資產</span>
            <strong>NT${roundMoney(totalAssets).toLocaleString('en-US')}</strong>
          </div>
          <div className="stat-card">
            <span>實質購買力</span>
            <strong>NT${roundMoney(realWeight).toLocaleString('en-US')}</strong>
          </div>
          <div className="stat-card">
            <span>可動用流動資產</span>
            <strong>NT${roundMoney(liquidity).toLocaleString('en-US')}</strong>
          </div>
          <div className="stat-card">
            <span>累積通膨</span>
            <strong>{(game.cumulativeInflation * 100).toFixed(1)}%</strong>
          </div>
          <div className="stat-card status">
            <span>人生狀態</span>
            <strong>{game.lifeStatus}</strong>
          </div>
        </section>

        <section className="layout">
          <div className="panel allocations-panel">
            <div className="holdings-status">
              <div className="holdings-tabs">
                <button className={holdingView === 'current' ? 'active' : ''} onClick={() => setHoldingView('current')}>當下持有</button>
                <button className={holdingView === 'history' ? 'active' : ''} onClick={() => setHoldingView('history')}>歷史紀錄</button>
              </div>
              {holdingView === 'current' ? <>
                <div className="panel-header"><h2>當下持有</h2><span>{productHoldings.length} 筆持倉</span></div>
                {productHoldings.length === 0 ? <p className="empty-holdings">目前沒有持有中的金融商品。</p> :
                  <div className="holdings-strip">{productHoldings.map((holding) => <div className="holding-chip" key={holding.id}>
                    <strong>{holding.label.split('｜')[0]}</strong><span>NT${roundMoney(holding.amount).toLocaleString('en-US')}</span>
                    <small>{holding.boughtAge} 歲購入 · {totalAssets > 0 ? ((holding.amount / totalAssets) * 100).toFixed(1) : '0.0'}% 總資產</small>
                  </div>)}</div>}
              </> : <>
                <div className="panel-header"><h2>歷史紀錄</h2><span>累計 {productHistory.length} 筆</span></div>
                {productHistory.length === 0 ? <p className="empty-holdings">目前還沒有任何購買紀錄。</p> :
                  <div className="holdings-strip">{[...productHistory].reverse().map((holding) => <div className="holding-chip history-chip" key={'history-'+holding.id}>
                    <strong>{holding.label.split('｜')[0]}</strong><span>NT${roundMoney(holding.amount).toLocaleString('en-US')}</span>
                    <small>{holding.boughtAge} 歲購入 · 永久保留購買紀錄</small>
                  </div>)}</div>}
              </>}
            </div>
            <div className="panel-header">
              <h2>V2 開發分支：資產持有與交易</h2>
              <span className={allocationValid ? '' : 'allocation-warning'}>{allocationValid ? '配置完成 ✓' : `尚差 NT${roundMoney(Math.abs(allocationDifference)).toLocaleString('en-US')} ${allocationDifference > 0 ? '未配置' : '超額配置'}`}</span>
            </div>
            {allocationList.map(({ asset, percentage, amount }) => (
              asset === 'cash' ?
              <div key={asset} className="allocation-row">
                <div className="asset-title-wrap">
                  <div className="asset-name">{ASSET_META[asset].label}</div>
                  <div className="asset-subtitle">{ASSET_META[asset].short}</div>
                </div>

                <div className="control-box amount-control">
                  <label className="money-input-wrap">
                    <span>NT$</span>
                    <input
                      value={roundMoney(game.portfolio.cash).toLocaleString('en-US')}
                      readOnly
                      aria-label="目前現金餘額"
                    />
                  </label>
                  <div className="value-box compact-value">
                    <strong>{percentage.toFixed(1)}%</strong>
                    <span>占總資產</span>
                  </div>
                </div>
              </div>
              : <details key={asset} className="product-drawer">
                  <summary><strong>{ASSET_META[asset].label}</strong><span>展開查看商品與持有部位</span></summary>
                  <div className="product-options">
                    {productHoldings.filter((holding) => holding.asset === asset).length > 0 && <div className="drawer-holdings">
                      <div className="shop-label">目前持有倉位</div>
                      {productHoldings.filter((holding) => holding.asset === asset).map((holding) => <div className="holding-card" key={holding.id}>
                        <div><strong>{holding.label.split('｜')[0]}</strong><small>{holding.asset === 'insurance' && holding.premiumTerm ? `年繳 NT${roundMoney(holding.amount).toLocaleString('en-US')} · 已繳 ${holding.premiumsPaid || 1}/${holding.premiumTerm} 年 · 尚餘 ${Math.max(0, holding.premiumTerm - (holding.premiumsPaid || 1))} 年` : `${holding.boughtAge} 歲購入 · 本金鎖定`}</small></div>
                        <div><b>NT${roundMoney(holding.amount).toLocaleString('en-US')}</b><small>{totalAssets > 0 ? ((holding.amount / totalAssets) * 100).toFixed(1) : '0.0'}% 總資產</small></div>
                      </div>)}
                    </div>}
                    <div className="shop-label">可購買商品</div>
                    {productCatalog[asset].map((product) => (
                      <div className="shop-product-card" key={product.id}>
                        <strong>{product.label}</strong>
                        <div className="shop-buy-row">
                          {asset === 'stocks' ? <div className="stock-order-box">
                            <div className="stock-live-price">目前每股 <b>NT${(stockPrices[product.id] || 100).toFixed(2)}</b></div>
                            <label className="money-input-wrap"><span>股數</span><input inputMode="numeric" pattern="[0-9]*" placeholder="輸入買入股數" value={stockTradeShares[product.id] || ''} onChange={(event) => setStockTradeShares((current) => ({ ...current, [product.id]: event.target.value.replace(/[^0-9]/g, '') }))} /></label>
                            <small>預估成交金額：NT${roundMoney(Number(stockTradeShares[product.id] || 0) * (stockPrices[product.id] || 100)).toLocaleString('en-US')}</small>
                          </div> : asset === 'bonds' ? <div className="stock-order-box"><div className="stock-live-price">目前價格 <b>{(bondPrices[product.id]||100).toFixed(2)}</b> / 面額100</div><label className="money-input-wrap"><span>張數</span><input inputMode="numeric" pattern="[0-9]*" placeholder="輸入買入張數" value={bondTradeUnits[product.id]||''} onChange={(e)=>setBondTradeUnits(c=>({...c,[product.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label><small>每張面額 NT$10,000 · 預估成交 NT${roundMoney(Number(bondTradeUnits[product.id]||0)*10000*(bondPrices[product.id]||100)/100).toLocaleString('en-US')}</small></div> : <label className="money-input-wrap"><span>NT$</span><input inputMode="numeric" pattern="[0-9]*" placeholder="輸入投入金額" value={productAmounts[product.id] || ''} onChange={(event) => setProductAmounts((current) => ({ ...current, [product.id]: event.target.value.replace(/[^0-9]/g, '') }))} /></label>}
                          <button onClick={() => buyProduct(asset, product.id)}>購買</button>
                        </div>
                      </div>
                    ))}
                    <p>購買時才輸入投入金額；確認購買後形成持倉，不能再直接修改本金。</p>
                  </div>
                </details>
            ))}

            <div className="cta-row">
              <div className="panel" style={{marginBottom:12}}>
                <div className="eyebrow">V2 CORE MODEL</div>
                <p>接下來的 V2 將改成 CASH FLOW → DECISION → TIME。現有資產會持續存在，玩家只能用可用現金買入新資產，賣出後才會回到現金。</p>
              </div>
              <button className="primary" disabled={!canAdvance} onClick={advanceYear}>
                讓時間前進一年 →
              </button>
            </div>
          </div>

          <div className="side-stack">
            <div className="panel event-card">
              <div className="panel-header compact">
                <h2>年度事件</h2>
              </div>
              {game.marketEvent ? (
                <>
                  <div className="event-year">YEAR {game.year}</div>
                  <h3>{game.marketEvent.title}</h3>
                  <p>{game.marketEvent.blurb}</p>
                  <div className="mini-badges">
                    {ASSET_KEYS.map((asset) => {
                      const effect = game.marketEvent?.effect[asset];
                      if (!effect) return null;
                      return (
                        <span key={asset} className="badge">
                          {ASSET_META[asset].label} {effect > 0 ? '+' : ''}{(effect * 100).toFixed(0)}%
                        </span>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p>每年都會出現新的市場環境與人生難題。</p>
              )}
            </div>

            <div className="panel timeline-panel">
              <div className="panel-header compact">
                <h2>歷史紀錄</h2>
              </div>
              <ul className="history-list">
                {game.history.length === 0 ? (
                  <li>還沒有歷史紀錄，第一年即將開始。</li>
                ) : (
                  [...game.history].slice(-5).reverse().map((item, idx) => (
                    <li key={`${item.year}-${idx}`}>
                      <strong>{item.age}歲</strong>
                      <span>{item.eventTitle}</span>
                      <em>NT${roundMoney(item.total).toLocaleString('en-US')}</em>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </section>

        </> : <section className="panel stock-market-page">
          <div className="panel-header"><div><div className="eyebrow">MARKET TERMINAL</div><h2>股票市場價格與持股明細</h2></div><span>AGE {game.age}</span></div>
          <div className="signal-dashboard">
            <div><span>總體景氣</span><b>{marketSignals.growth>0.025?'擴張':marketSignals.growth<0.008?'疲弱':'溫和'}</b><small>成長 {(marketSignals.growth*100).toFixed(1)}%</small></div>
            <div><span>通膨 / 利率</span><b>{(marketSignals.inflation*100).toFixed(1)}% / {(marketSignals.policyRate*100).toFixed(1)}%</b><small>影響估值與債券 Duration</small></div>
            <div><span>企業基本面</span><b>{marketSignals.earnings>=0?'+':''}{(marketSignals.earnings*100).toFixed(1)}%</b><small>模擬獲利成長</small></div>
            <div><span>籌碼面</span><b>{signalLabel(marketSignals.flows,'資金流入','資金流出')}</b><small>機構與基金資金流</small></div>
            <div><span>消息面</span><b>{signalLabel(marketSignals.news,'偏正面','偏負面')}</b><small>政策、產業與信用消息</small></div>
            <div><span>風險偏好</span><b>{signalLabel(marketSignals.riskAppetite,'Risk-on','Risk-off')}</b><small>影響成長型資產估值</small></div>
          </div>
          {productCatalog.stocks.map((product) => {
            const price=stockPrices[product.id]||100; const hist=stockPriceHistory[product.id]||[100];
            const min=Math.min(...hist), max=Math.max(...hist), range=Math.max(1,max-min);
            const points=hist.map((v,i)=>`${hist.length===1?0:(i/(hist.length-1))*100},${90-((v-min)/range)*80}`).join(' ');
            const research=stockResearch(product.id,marketSignals,hist);
            return <div className="market-card" key={product.id}><div className="market-quote"><div><strong>{product.label.split('｜')[0]}</strong><small>虛擬市場價格</small></div><b>NT${price.toFixed(2)}</b></div>
              <svg className="price-chart" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={points}/></svg>
              <div className="market-years"><span>遊戲開始前 1 年</span><span>現在 {game.age}歲</span></div>
              <div className="research-tabs">
                {[
                  ['fundamental','基本面',signalLabel(research.fundamental,'改善','承壓')],
                  ['flow','籌碼面',signalLabel(research.flow,'流入','流出')],
                  ['news','消息面',signalLabel(research.news,'偏正面','偏負面')],
                  ['technical','技術面',signalLabel(research.technical,'偏強','偏弱')],
                ].map(([key,label,status])=><button key={key} onClick={()=>{
                  const bodies:Record<string,React.ReactNode>={
                    fundamental:<><p>企業獲利成長 {(marketSignals.earnings*100).toFixed(1)}% · 景氣成長 {(marketSignals.growth*100).toFixed(1)}% · 政策利率 {(marketSignals.policyRate*100).toFixed(1)}%</p><p>你可以把基本面想成「這家公司本身過得好不好」。會看它有沒有賺錢、景氣好不好，以及借錢成本高不高。公司很會賺錢通常是好事，但股價短期不一定馬上上漲。</p></>,
                    flow:<><p>資金動能 {research.flow>=0?'+':''}{research.flow.toFixed(2)} · {signalLabel(marketSignals.riskAppetite,'Risk-on','Risk-off')}</p><p>籌碼面是在看「現在大家的錢往哪裡跑」。大型基金和投資人一直買，通常會增加買盤；一直賣則可能形成壓力。但很多人買，不代表它一定便宜。</p></>,
                    news:<><p>消息強度 {research.news>=0?'+':''}{research.news.toFixed(2)} · 通膨 {(marketSignals.inflation*100).toFixed(1)}%</p><p>消息面是在看「最近發生了什麼事」。例如新產品、政府政策、戰爭或利率消息，都可能讓大家改變想法。但市場常常會提前猜到消息，所以看到好消息時，價格不一定還會繼續漲。</p></>,
                    technical:<><p>近 6 月價格動能 {hist.length>2?(((price/hist[Math.max(0,hist.length-7)])-1)*100).toFixed(1):'0.0'}% · 技術訊號 {research.technical.toFixed(2)}</p><p>技術面是在看「價格最近怎麼走」。如果最近一直漲，代表目前走勢比較強；一直跌則比較弱。但它比較像看車子現在往哪個方向開，不代表它等等不會轉彎。</p></>
                  }; toggleResearch(product.id+'-'+key,label+'詳細資訊',bodies[key]);
                }} className={researchOverlay?.key===product.id+'-'+key?'active':''}><span>{label}</span><b>{status}</b></button>)}
              </div>
            </div>
          })}
          <div className="panel-header"><h2>債券市場與持倉</h2><span>{bondHoldings.length} 筆</span></div>
          {productCatalog.bonds.map((product)=>{const research=bondResearch(product.id,marketSignals);return <div className="market-card" key={'market-'+product.id}><div className="market-quote"><div><strong>{product.label.split('｜')[0]}</strong><small>每 100 面額市場報價</small></div><b>{(bondPrices[product.id]||100).toFixed(2)}</b></div><div className="research-tabs">
              {[
                ['fundamental','基本面',signalLabel(research.fundamental,'改善','承壓')],
                ['flow','籌碼面',signalLabel(research.flow,'需求偏強','需求偏弱')],
                ['news','消息面',signalLabel(research.news,'偏正面','偏負面')],
                ['rate','利率面',signalLabel(research.rate,'有利','不利')],
              ].map(([key,label,status])=><button key={key} onClick={()=>{
                const bodies:Record<string,React.ReactNode>={
                  fundamental:<><p>景氣成長 {(marketSignals.growth*100).toFixed(1)}% · 信用利差 {(marketSignals.creditSpread*100).toFixed(1)}%</p><p>債券的基本面是在看「借錢給它安不安全」。政府債主要看通膨、利率和政府償債能力；公司債還要看公司有沒有能力按時付利息、還本金。</p></>,
                  flow:<><p>{signalLabel(-marketSignals.riskAppetite,'避險資金增加','避險資金減少')} · 需求訊號 {research.flow.toFixed(2)}</p><p>籌碼面是在看「市場的錢正在往哪裡移動」。大家害怕風險時，資金常跑去比較安全的政府債；但公司債還是可能因為大家擔心公司還不起錢而被賣掉。</p></>,
                  news:<><p>消息強度 {research.news>=0?'+':''}{research.news.toFixed(2)}</p><p>消息面是在看「最近有沒有事情改變大家對這張債券的看法」。例如央行升息、公司被降評級或通膨突然變高，都可能影響債券價格。</p></>,
                  rate:<><p>政策利率 {(marketSignals.policyRate*100).toFixed(1)}% · 通膨 {(marketSignals.inflation*100).toFixed(1)}%</p><p>利率面可以先記一個簡單規則：市場利率上升時，舊債券通常會變得比較不值錢；利率下降時則相反。而且通常剩越久才到期的債券，價格受到利率影響越大。</p></>
                }; toggleResearch(product.id+'-'+key,label+'詳細資訊',bodies[key]);
              }} className={researchOverlay?.key===product.id+'-'+key?'active':''}><span>{label}</span><b>{status}</b></button>)}
            </div></div>})}
          {bondHoldings.map(h=>{const quote=bondPrices[h.productId]||100;const value=(h.bondUnits||0)*(h.faceValue||10000)*quote/100;return <div className="stock-statement" key={'bond-'+h.id}><div><strong>{h.label.split('｜')[0]}</strong><small>{h.boughtAge}歲買入</small></div><div><span>持有張數</span><b>{h.bondUnits||0}</b></div><div><span>面額</span><b>NT${roundMoney((h.bondUnits||0)*(h.faceValue||10000)).toLocaleString('en-US')}</b></div><div><span>買入價</span><b>{(h.buyPrice||100).toFixed(2)}</b></div><div><span>目前報價</span><b>{quote.toFixed(2)}</b></div><div><span>目前市值</span><b>NT${roundMoney(value).toLocaleString('en-US')}</b></div><div><span>Coupon</span><b>{((h.couponRate||0)*100).toFixed(1)}%</b></div><div><span>剩餘年期</span><b>{Math.max(0,(h.boughtAge+(h.maturityYears||0))-game.age)} 年</b></div><div className="stock-sell-order"><label className="money-input-wrap"><span>賣出張數</span><input inputMode="numeric" pattern="[0-9]*" value={bondTradeUnits['sell-'+h.id]||''} onChange={(e)=>setBondTradeUnits(c=>({...c,['sell-'+h.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label></div><button className="danger" onClick={()=>sellBond(h.id)}>賣出債券</button></div>})}
          <div className="panel-header"><h2>我的持股明細</h2><span>{stockHoldings.length} 筆</span></div>
          {stockHoldings.length===0?<p>目前沒有持股。</p>:stockHoldings.map(h=>{const price=stockPrices[h.productId]||100;const value=(h.shares||0)*price;const pnl=value-h.amount;return <div className="stock-statement" key={h.id}>
            <div><strong>{h.label.split('｜')[0]}</strong><small>{h.boughtAge}歲買入</small></div>
            <div><span>買入價</span><b>NT${(h.buyPrice||0).toFixed(2)}</b></div><div><span>持股單位</span><b>{(h.shares||0).toFixed(2)}</b></div><div><span>目前市價</span><b>NT${price.toFixed(2)}</b></div><div><span>市值</span><b>NT${roundMoney(value).toLocaleString('en-US')}</b></div><div><span>未實現損益</span><b>{pnl>=0?'+':''}NT${roundMoney(pnl).toLocaleString('en-US')}</b></div>
            <div className="stock-sell-order"><label className="money-input-wrap"><span>賣出股數</span><input inputMode="numeric" pattern="[0-9]*" placeholder="輸入股數" value={stockTradeShares['sell-'+h.id] || ''} onChange={(e)=>setStockTradeShares(c=>({...c,['sell-'+h.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label><small>預估賣出金額 NT${roundMoney(Number(stockTradeShares['sell-'+h.id]||0)*price).toLocaleString('en-US')}</small></div><button className="danger" onClick={()=>sellStock(h.id)}>賣出</button></div>})}
        </section>}
        {game.timeMachineUnlocked && !game.completed && (
          <section className="panel" style={{ marginTop: 18 }}>
            <div className="eyebrow">TIME MACHINE UNLOCKED</div>
            <h2>時間本身，也是一種金融資源。</h2>
            <p>
              當一部分資金可以承受較低的短期流動性，資產配置就能拉長投資期限。
              這不是免費報酬，而是用流動性換取不同的長期投資能力。
            </p>
            <div className="mini-badges">
              <span className="badge">Liquidity ↓</span>
              <span className="badge">Time ↑</span>
              <span className="badge">Long-term Capacity ↑</span>
            </div>
          </section>
        )}

        {researchOverlay && <div className="research-overlay-backdrop" onClick={()=>setResearchOverlay(null)}><div className="research-overlay-card" onClick={(e)=>e.stopPropagation()}><button className="research-close" onClick={()=>setResearchOverlay(null)}>×</button><strong>{researchOverlay.title}</strong>{researchOverlay.body}</div></div>}
        {game.completed && (
          <div className="modal-overlay">
            <div className="report-card">
              <div className="eyebrow">你的金融人生報告</div>
              <h2>《TIME — 金融人生報告》</h2>
              <div className="report-grid">
                <div><span>Final Wealth</span><strong>NT${roundMoney(sumPortfolio(game.portfolio)).toLocaleString('en-US')}</strong></div>
                <div><span>Real Wealth</span><strong>NT${roundMoney(getRealWealth(sumPortfolio(game.portfolio), game.cumulativeInflation)).toLocaleString('en-US')}</strong></div>
                <div><span>最大回撤</span><strong>{(game.maxDrawdown * 100).toFixed(1)}%</strong></div>
                <div><span>金融危機次數</span><strong>{game.marketCrisisCount}</strong></div>
                <div><span>被迫出售次數</span><strong>{game.forcedSellCount}</strong></div>
                <div><span>流動性危機次數</span><strong>{game.liquidityCrisisCount}</strong></div>
                <div><span>累積通膨</span><strong>{(game.cumulativeInflation * 100).toFixed(1)}%</strong></div>
                <div><span>人生目標完成率</span><strong>{Math.max(45, Math.min(95, Math.round((sumPortfolio(game.portfolio) / 20000000) * 100)))}%</strong></div>
              </div>
              <p>{game.analysis}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
