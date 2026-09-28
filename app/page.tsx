'use client';

import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'time-financial-life-simulator-v2';
const HOLDINGS_KEY = 'time-financial-life-simulator-v2-holdings';
const ASSET_KEYS = ['cash', 'deposit', 'bonds', 'stocks', 'realEstate', 'insurance'] as const;
const STOCK_INITIAL_PRICES: Record<string, number> = { 'stock-world': 160, 'stock-tech': 740, 'stock-dividend': 165 };
const BOND_INITIAL_PRICES: Record<string, number> = { 'bond-5': 98, 'bond-10': 91, 'bond-corp': 96 };
const MARKET_MODEL_VERSION = 6;

type AnnualReport = { year:number; age:number; signals:MarketSignals; events:Array<{label:string; text:string}>; summary:string };
type MarketTrade = { year:number; age:number; asset:'stocks'|'bonds'; productId:string; label:string; side:'買入'|'賣出'; quantity:number; price:number; amount:number };
type MarketSnapshot = { year:number; age:number; signals:MarketSignals; stockPrices:Record<string,number>; stockPaths:Record<string,number[]>; bondPrices:Record<string,number> };
type PropertyListing = { id:string; name:string; district:string; ping:number; price:number; marketRent:number; demand:number; populationTrend:number; birthRate:number; downPaymentRate:number; mortgageRate:number; mortgageYears:number };
type PropertyHolding = PropertyListing & { boughtAge:number; purchasePrice:number; mortgageBalance:number; monthlyRent:number; rentalMode:'vacant'|'rent'; lastRentedMonths:number; lastRentalIncome:number; currentValue:number };
const PROPERTY_TEMPLATES = [
  {name:'都會捷運小宅',district:'核心都會區',ping:18.6,basePrice:3200000,marketRent:18500,demand:0.88,populationTrend:0.012,birthRate:0.0078},
  {name:'成熟商圈兩房',district:'都會生活圈',ping:24.8,basePrice:4200000,marketRent:23500,demand:0.82,populationTrend:0.006,birthRate:0.0084},
  {name:'郊區家庭宅',district:'外圍住宅區',ping:32.5,basePrice:3600000,marketRent:20500,demand:0.68,populationTrend:-0.004,birthRate:0.0091},
  {name:'新興重劃小宅',district:'新興重劃區',ping:21.2,basePrice:2900000,marketRent:16800,demand:0.73,populationTrend:0.018,birthRate:0.0102},
  {name:'衛星城市三房',district:'衛星城市',ping:36.8,basePrice:3900000,marketRent:22000,demand:0.64,populationTrend:-0.008,birthRate:0.0096},
];
const buildPropertyMarket=(signals:MarketSignals,year=0):PropertyListing[]=>PROPERTY_TEMPLATES.map((p,i)=>{
  const cycle=1+signals.growth*1.4-signals.policyRate*0.55+p.populationTrend*2+stableNoise('property|'+year+'|'+i,0.055);
  const price=Math.round(p.basePrice*cycle/10000)*10000;
  return {id:'property-'+year+'-'+i,name:p.name,district:p.district,ping:p.ping,price,marketRent:p.marketRent,demand:p.demand,populationTrend:p.populationTrend,birthRate:p.birthRate,downPaymentRate:0.2,mortgageRate:Math.max(0.018,signals.policyRate*0.55+0.012),mortgageYears:30};
}).filter((_,i)=>stableNoise('release|'+year+'|'+i,1)>-0.45).slice(0,4);

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

const buildAnnualReport = (year:number, age:number, x:MarketSignals):AnnualReport => {
  const events=[
    {label:'總體經濟',text:`經濟成長 ${(x.growth*100).toFixed(1)}%，景氣${x.growth>0.025?'偏強':x.growth<0.008?'偏弱':'溫和'}。`},
    {label:'物價環境',text:`通膨率 ${(x.inflation*100).toFixed(1)}%，${x.inflation>0.04?'物價壓力明顯':'物價壓力相對溫和'}。`},
    {label:'央行政策',text:`政策利率 ${(x.policyRate*100).toFixed(1)}%，${x.policyRate>0.04?'資金成本偏高':'資金成本相對溫和'}。`},
    {label:'企業獲利',text:`企業獲利成長 ${x.earnings>=0?'+':''}${(x.earnings*100).toFixed(1)}%，${x.earnings>=0?'企業獲利整體成長':'企業獲利整體衰退'}。`},
    {label:'市場資金',text:`${signalLabel(x.flows,'資金偏流入','資金偏流出')}，市場風險偏好為 ${signalLabel(x.riskAppetite,'偏高','偏低')}。`},
    {label:'市場消息',text:`政策、產業與信用消息整體${signalLabel(x.news,'偏正面','偏負面')}，信用利差 ${(x.creditSpread*100).toFixed(1)}%。`}
  ];
  const summary=`本年度景氣${x.growth>0.025?'較強':x.growth<0.008?'較弱':'溫和'}、通膨${x.inflation>0.04?'偏高':'相對穩定'}，利率${x.policyRate>0.04?'維持高檔':'壓力有限'}；企業獲利${x.earnings>=0?'成長':'轉弱'}，資金${x.flows>0.3?'偏向流入風險資產':x.flows<-0.3?'偏向撤出風險資產':'方向不明顯'}。不同訊號可能同時互相矛盾，市場價格不一定只受單一因素影響。`;
  return {year,age,signals:x,events,summary};
};

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
  return { stockPrices, stockPriceHistory, bondPrices, signals, preGameReport: buildAnnualReport(0, 24, signals) };
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
  portfolio?: Portfolio;
  returnRate?: number;
  actions?: string[];
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
  const [annualReports, setAnnualReports] = useState<AnnualReport[]>([initialMarket.preGameReport]);
  const [reportOpen, setReportOpen] = useState<number | null>(null);
  const [marketYear, setMarketYear] = useState<number | null>(null);
  const [marketSnapshots, setMarketSnapshots] = useState<MarketSnapshot[]>([{year:0,age:24,signals:initialMarket.signals,stockPrices:initialMarket.stockPrices,stockPaths:initialMarket.stockPriceHistory,bondPrices:initialMarket.bondPrices}]);
  const [marketTrades, setMarketTrades] = useState<MarketTrade[]>([]);
  const [researchOverlay, setResearchOverlay] = useState<{key:string; title:string; body:React.ReactNode} | null>(null);
  const [chartHover, setChartHover] = useState<{id:string; index:number} | null>(null);
  const [chartStartYear, setChartStartYear] = useState(0);
  const [propertyListings, setPropertyListings] = useState<PropertyListing[]>(()=>buildPropertyMarket(initialMarket.signals,0));
  const [propertyHoldings, setPropertyHoldings] = useState<PropertyHolding[]>([]);
  const [rentInputs, setRentInputs] = useState<Record<string,string>>({});
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
        if (Array.isArray(parsed.marketSnapshots) && parsed.marketSnapshots.length) setMarketSnapshots(parsed.marketSnapshots);
        if (Array.isArray(parsed.marketTrades)) setMarketTrades(parsed.marketTrades);
        if (Array.isArray(parsed.propertyListings)) setPropertyListings(parsed.propertyListings);
        if (Array.isArray(parsed.propertyHoldings)) setPropertyHoldings(parsed.propertyHoldings);
        const hasSavedReports = Array.isArray(parsed.annualReports) && parsed.annualReports.length > 0;
        if (hasSavedReports) setAnnualReports(parsed.annualReports);
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
          setMarketSignals(migratedMarket.signals);
          if (!hasSavedReports) setAnnualReports([migratedMarket.preGameReport]);
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
    window.localStorage.setItem(HOLDINGS_KEY, JSON.stringify({ holdings: productHoldings, history: productHistory, stockPrices, stockPriceHistory, bondPrices, marketSignals, annualReports, marketSnapshots, marketTrades, propertyListings, propertyHoldings, marketModelVersion: MARKET_MODEL_VERSION }));
  }, [productHoldings, productHistory, stockPrices, stockPriceHistory, bondPrices, marketSignals, annualReports, marketSnapshots, marketTrades, propertyListings, propertyHoldings, isMounted]);

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
    realEstate: [],
    insurance: [{ id: 'policy-5', label: '5年繳長期分紅保單｜早期流動性低' }, { id: 'policy-10', label: '10年繳長期分紅保單｜長期累積' }],
  };

  const buyProperty = (listing:PropertyListing) => {
    const downPayment = listing.price * listing.downPaymentRate;
    if (game.portfolio.cash < downPayment) return alert('現金不足以支付頭期款');
    const mortgage = listing.price - downPayment;
    setPropertyHoldings((current) => [...current, {
      ...listing,
      boughtAge: game.age,
      purchasePrice: listing.price,
      mortgageBalance: mortgage,
      monthlyRent: listing.marketRent,
      rentalMode: 'vacant',
      lastRentedMonths: 0,
      lastRentalIncome: 0,
      currentValue: listing.price,
    }]);
    setPropertyListings((current) => current.filter((property) => property.id !== listing.id));
    setGame((current) => ({
      ...current,
      portfolio: {
        ...current.portfolio,
        cash: current.portfolio.cash - downPayment,
        realEstate: current.portfolio.realEstate + downPayment,
      },
      eventHistory: [...current.eventHistory, '買入房產：' + listing.name + '，總價 NT$' + listing.price.toLocaleString('en-US') + '，頭期 NT$' + roundMoney(downPayment).toLocaleString('en-US') + '。'],
      lifeStatus: '已購入 ' + listing.name + '，房貸將逐年攤還。',
    }));
  };

  const setPropertyRental = (id:string, mode:'vacant'|'rent') => {
    const requested = Number(rentInputs[id] || 0);
    setPropertyHoldings((current) => current.map((property) => property.id !== id ? property : {
      ...property,
      rentalMode: mode,
      monthlyRent: mode === 'rent' && requested > 0 ? requested : property.monthlyRent,
    }));
  };

  const sellProperty = (id:string) => {
    const property = propertyHoldings.find((item) => item.id === id);
    if (!property) return;
    const equity = Math.max(0, property.currentValue - property.mortgageBalance);
    setPropertyHoldings((current) => current.filter((item) => item.id !== id));
    setGame((current) => ({
      ...current,
      portfolio: {
        ...current.portfolio,
        cash: current.portfolio.cash + equity,
        realEstate: Math.max(0, current.portfolio.realEstate - equity),
      },
      eventHistory: [...current.eventHistory, '出售房產：' + property.name + '，清償剩餘房貸後回收 NT$' + roundMoney(equity).toLocaleString('en-US') + '。'],
      lifeStatus: '已出售 ' + property.name + '。',
    }));
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
      if (asset==='stocks' || asset==='bonds') setMarketTrades((current)=>[...current,{year:game.year,age:game.age,asset,productId,label:product.label.split('｜')[0],side:'買入',quantity:asset==='stocks'?requestedShares:requestedBondUnits,price:price||0,amount}]);
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
    setMarketTrades((current)=>[...current,{year:game.year,age:game.age,asset:'stocks',productId:holding.productId,label:holding.label.split('｜')[0],side:'賣出',quantity:sharesToSell,price,amount:proceeds}]);
    setStockTradeShares((current) => ({ ...current, ['sell-'+holdingId]: '' }));
  };

  const sellStockPosition = (productId:string) => {
    const lots=productHoldings.filter((h)=>h.asset==='stocks' && h.productId===productId);
    const owned=lots.reduce((n,h)=>n+(h.shares||0),0);
    const sharesToSell=Number(stockTradeShares['sell-position-'+productId]||0);
    if(!Number.isInteger(sharesToSell)||sharesToSell<=0) return alert('請輸入要賣出的整數股數');
    if(sharesToSell>owned) return alert('賣出股數不能超過目前持股');
    const price=stockPrices[productId]||100, totalCost=lots.reduce((n,h)=>n+h.amount,0), avgCost=owned>0?totalCost/owned:0, proceeds=sharesToSell*price;
    let remaining=sharesToSell;
    setProductHoldings((current)=>current.flatMap((item)=>{if(item.asset!=='stocks'||item.productId!==productId||remaining<=0)return[item];const q=item.shares||0,take=Math.min(q,remaining);remaining-=take;if(take===q)return[];return[{...item,shares:q-take,amount:item.amount-avgCost*take,buyPrice:avgCost}]}));
    const label=lots[0]?.label.split('｜')[0]||productId;
    setGame((current)=>({...current,portfolio:{...current.portfolio,cash:current.portfolio.cash+proceeds,stocks:Math.max(0,current.portfolio.stocks-proceeds)},lifeStatus:`已賣出 ${label} ${sharesToSell} 股，NT$${roundMoney(proceeds).toLocaleString('en-US')} 回到現金。`,eventHistory:[...current.eventHistory,`股票賣出：${label}，實現損益 NT$${roundMoney(proceeds-avgCost*sharesToSell).toLocaleString('en-US')}。`]}));
    setMarketTrades((current)=>[...current,{year:game.year,age:game.age,asset:'stocks',productId,label,side:'賣出',quantity:sharesToSell,price,amount:proceeds}]);
    setStockTradeShares((current)=>({...current,['sell-position-'+productId]:''}));
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
    setMarketTrades((current)=>[...current,{year:game.year,age:game.age,asset:'bonds',productId:holding.productId,label:holding.label.split('｜')[0],side:'賣出',quantity:units,price:quote,amount:proceeds}]);
    setBondTradeUnits((current)=>({...current,['sell-'+holdingId]:''}));
  };

  const bondHoldings = productHoldings.filter((holding) => holding.asset === 'bonds');
  const stockHoldings = productHoldings.filter((holding) => holding.asset === 'stocks');
  const stockPositions = productCatalog.stocks.map((product)=>{
    const lots=stockHoldings.filter((h)=>h.productId===product.id);
    const shares=lots.reduce((n,h)=>n+(h.shares||0),0);
    const cost=lots.reduce((n,h)=>n+h.amount,0);
    return {product,lots,shares,cost,avgCost:shares>0?cost/shares:0};
  }).filter((x)=>x.shares>0);
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
    setMarketSignals(restartedMarket.signals);
    setAnnualReports([restartedMarket.preGameReport]);
    setReportOpen(null);
    setMarketYear(null);
    setMarketSnapshots([{year:0,age:24,signals:restartedMarket.signals,stockPrices:restartedMarket.stockPrices,stockPaths:restartedMarket.stockPriceHistory,bondPrices:restartedMarket.bondPrices}]);
    setMarketTrades([]);
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
      window.localStorage.setItem(HOLDINGS_KEY, JSON.stringify({ holdings: productHoldings, history: productHistory, stockPrices, stockPriceHistory, bondPrices, marketSignals, annualReports, marketSnapshots, marketTrades, propertyListings, propertyHoldings, marketModelVersion: MARKET_MODEL_VERSION }));
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
    setAnnualReports((current)=>[...current, buildAnnualReport(game.year, game.age, signals)]);
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
    const rateShock = (signals.policyRate - selectedSignals.policyRate) + (signals.inflation-selectedSignals.inflation)*0.35;
    const nextBondPrices:Record<string,number> = {...bondPrices};
    Object.keys(nextBondPrices).forEach((id)=>{
      const duration = id === 'bond-10' ? 7.2 : id === 'bond-corp' ? 5.2 : 4.2;
      const creditShock = id === 'bond-corp' ? (Math.random()-0.5)*0.035 : 0;
      nextBondPrices[id] = clamp(nextBondPrices[id] * (1 - duration*rateShock + creditShock), 65, 125);
    });
    setBondPrices(nextBondPrices);
    setMarketSnapshots((current)=>[...current,{year:game.year,age:game.age,signals,stockPrices:nextStockPrices,stockPaths:newMonthlyPaths,bondPrices:nextBondPrices}]);

    const stockMarketValue = productHoldings.filter((h)=>h.asset==='stocks').reduce((sum,h)=>sum+(h.shares||0)*(nextStockPrices[h.productId]||100),0);
    const bondMarketValue = productHoldings.filter((h)=>h.asset==='bonds').reduce((sum,h)=>sum+(h.bondUnits||0)*(h.faceValue||10000)*(nextBondPrices[h.productId]||100)/100,0);
    const bondCoupons = productHoldings.filter((h)=>h.asset==='bonds').reduce((sum,h)=>sum+(h.bondUnits||0)*(h.faceValue||10000)*(h.couponRate||0),0);
    const maturingBonds = productHoldings.filter((h)=>h.asset==='bonds' && h.maturityYears && game.age+1 >= h.boughtAge+h.maturityYears);
    const maturedFace = maturingBonds.reduce((sum,h)=>sum+(h.bondUnits||0)*(h.faceValue||10000),0);
    if (maturingBonds.length) setProductHoldings((current)=>current.filter((h)=>!maturingBonds.some((m)=>m.id===h.id)));
    setGame((current)=>({...current, portfolio:{...current.portfolio, stocks:stockMarketValue, bonds:Math.max(0,bondMarketValue-maturingBonds.reduce((sum,h)=>sum+(h.bondUnits||0)*(h.faceValue||10000)*(nextBondPrices[h.productId]||100)/100,0)), cash:current.portfolio.cash+bondCoupons+maturedFace}, eventHistory:[...current.eventHistory, ...(bondCoupons>0?[`債券票息：NT$${roundMoney(bondCoupons).toLocaleString('en-US')} 已進入現金。`]:[]), ...(maturedFace>0?[`債券到期：面額本金 NT$${roundMoney(maturedFace).toLocaleString('en-US')} 已償還至現金。`]:[])]}));

    // Real estate: price, mortgage and rental results are simulated once per year.
    let propertyCashFlow=0;
    let propertyEquity=0;
    const nextProperties=propertyHoldings.map((p)=>{
      const appreciation=clamp(0.025+signals.growth*0.9-signals.policyRate*0.45+p.populationTrend*1.5+productNoise(0.035),-0.12,0.14);
      const currentValue=Math.max(500000,p.currentValue*(1+appreciation));
      const monthlyRate=p.mortgageRate/12;
      const months=p.mortgageYears*12;
      const payment=p.mortgageBalance>0 ? p.mortgageBalance*(monthlyRate*Math.pow(1+monthlyRate,months))/(Math.pow(1+monthlyRate,months)-1) : 0;
      let balance=p.mortgageBalance, annualMortgage=0;
      for(let m=0;m<12 && balance>0;m++){const interest=balance*monthlyRate;const principal=Math.min(balance,Math.max(0,payment-interest));balance-=principal;annualMortgage+=interest+principal;}
      let rentedMonths=0, rentalIncome=0;
      if(p.rentalMode==='rent'){
        const priceRatio=p.monthlyRent/Math.max(1,p.marketRent);
        const occupancy=clamp(p.demand-(priceRatio-1)*0.85+signals.growth*0.8+productNoise(0.12),0.05,1);
        rentedMonths=Math.max(0,Math.min(12,Math.round(occupancy*12)));
        rentalIncome=p.monthlyRent*rentedMonths;
      }
      propertyCashFlow += rentalIncome-annualMortgage;
      propertyEquity += Math.max(0,currentValue-balance);
      return {...p,currentValue,mortgageBalance:balance,lastRentedMonths:rentedMonths,lastRentalIncome:rentalIncome,mortgageRate:Math.max(0.018,signals.policyRate*0.55+0.012)};
    });
    if(nextProperties.length) setPropertyHoldings(nextProperties);
    setPropertyListings(buildPropertyMarket(signals,game.year));

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

      // One market world: the same MarketSignals drive the annual report and asset behaviour.
      const inflationRate = signals.inflation;
      const reReturn = clamp(
        0.035 + signals.growth*1.25 - signals.policyRate*0.65 - signals.creditSpread*0.35 + productNoise(0.045),
        -0.16, 0.18
      );
      const insuranceReturn = clamp(
        0.04 + signals.growth*0.30 - signals.creditSpread*0.18 + productNoise(0.018),
        0.005, 0.075
      );
      const cashReturn = Math.max(0, signals.policyRate*0.45);
      const depositReturn = Math.max(0.005, signals.policyRate*0.72);

      let nextPortfolio: Portfolio = {
        ...rebalanced,
        cash: rebalanced.cash * (1 + cashReturn),
        deposit: rebalanced.deposit * (1 + depositReturn),
        // Stocks and bonds are valued from their discrete holdings/market engines above.
        stocks: stockMarketValue,
        bonds: Math.max(0, bondMarketValue - maturedFace),
        realEstate: nextProperties.length ? propertyEquity : rebalanced.realEstate * (1 + reReturn),
        insurance: rebalanced.insurance * (1 + insuranceReturn),
      };
      // Annual Capital: simplified outside investable cash flow.
      // Living costs and salary management stay outside the game; the player simply receives
      // NT$300,000 of fresh investable capital each year.
      const annualCapital = 300000;
      nextPortfolio.cash += bondCoupons + maturedFace + propertyCashFlow + annualCapital;

      const report = buildAnnualReport(current.year, current.age, signals);
      const nextLifeStatus = report.summary;
      const nextEventHistory = [...current.eventHistory, `年度新增資金：NT$300,000 已進入現金。`, `第 ${current.year} 年金融年報：${report.summary}`];
      const nextAnalysis = '本年度資產表現與金融年報共用同一組市場訊號，不再由單一隨機事件額外修改資產價格。';

      const finalTotal = sumPortfolio(nextPortfolio);
      const nextAge = current.age + 1;
      const nextHistory: HistoryEntry = {
        year: current.year,
        age: current.age,
        total: finalTotal,
        real: getRealWealth(finalTotal, (1 + current.cumulativeInflation) * (1 + inflationRate) - 1),
        liquidity: getLiquidity(nextPortfolio),
        eventTitle: `第 ${current.year} 年金融年報`,
        portfolio: nextPortfolio,
        returnRate: (() => { const startTotal = current.history.length ? current.history[current.history.length - 1].total : sumPortfolio(current.portfolio); return startTotal > 0 ? (finalTotal - annualCapital - startTotal) / startTotal : 0; })(),
        actions: nextEventHistory.slice(current.history.length ? current.eventHistory.lastIndexOf(current.history[current.history.length - 1].eventTitle) + 1 : 0).filter((x) => !x.includes('金融年報：')),
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
        marketEvent: null,
        lastLifeEvent: null,
        pendingChoice: null,
        timeMachineUnlocked: current.timeMachineUnlocked || (current.age >= 35 && current.allocations.insurance >= 10),
        marketCrisisCount: (signals.growth < 0 && signals.riskAppetite < -0.55) ? current.marketCrisisCount + 1 : current.marketCrisisCount,
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

  const selectedMarketYear = marketYear ?? (marketSnapshots[marketSnapshots.length-1]?.year ?? 0);
  const selectedMarket = marketSnapshots.find((x)=>x.year===selectedMarketYear) ?? marketSnapshots[marketSnapshots.length-1];
  const selectedSignals = selectedMarket?.signals ?? marketSignals;
  const selectedTrades = marketTrades.filter((t)=>t.year===selectedMarketYear);
  const availableMarketYears = marketSnapshots.map((x)=>x.year).sort((a,b)=>a-b);
  const effectiveChartEndYear = selectedMarketYear;
  const chartStartSnapshot = marketSnapshots.find((x)=>x.year===Math.min(chartStartYear,effectiveChartEndYear)) ?? marketSnapshots[0];
  const chartEndSnapshot = marketSnapshots.find((x)=>x.year===effectiveChartEndYear) ?? selectedMarket;
  const chartRangeSnapshots = marketSnapshots.filter((x)=>x.year>=chartStartSnapshot.year && x.year<=effectiveChartEndYear).sort((a,b)=>a.year-b.year);
  const chartYearLabel = (year:number) => year===0 ? '遊戲開始前一年' : `${marketSnapshots.find((x)=>x.year===year)?.age ?? 24+year}歲`;
  const setChartLookback = (years:number) => setChartStartYear(Math.max(0,effectiveChartEndYear-years+1));

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

        <nav className="workbook-tabs"><button className={mainView==='game'?'active':''} onClick={()=>setMainView('game')}>資產總表</button><button className={mainView==='market'?'active':''} onClick={()=>setMainView('market')}>投資市場</button></nav>
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
          <div className="stat-card">
            <span>年度新增資金</span>
            <strong>NT$300,000</strong>
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
                    {asset === 'realEstate' && <div className="property-shop">
                    <div className="shop-label">本年度市場釋出物件</div>
                    {propertyListings.length===0?<p>本年度暫無合適物件釋出。</p>:propertyListings.map(p=><div className="shop-product-card" key={p.id}>
                    <strong>{p.name}｜{p.district}</strong>
                    <small>{p.ping.toFixed(1)} 坪 · 每坪 NT${roundMoney(p.price/p.ping).toLocaleString('en-US')} · 總價 NT${p.price.toLocaleString('en-US')}</small>
                    <small>頭期 20%：NT${roundMoney(p.price*p.downPaymentRate).toLocaleString('en-US')} · 房貸 {(p.mortgageRate*100).toFixed(2)}% · 30年</small>
                    <small>人口 {p.populationTrend>=0?'↑':'↓'} {(Math.abs(p.populationTrend)*100).toFixed(1)}% · 出生率 {(p.birthRate*100).toFixed(2)}% · 買氣 {p.demand>.8?'強':p.demand>.68?'中等':'偏弱'} · 市場月租約 NT${p.marketRent.toLocaleString('en-US')}</small>
                    <button onClick={()=>buyProperty(p)}>支付頭期並買入</button>
                    </div>)}
                    </div>} {productCatalog[asset].map((product) => (
                      <div className="shop-product-card" key={product.id}>
                        <strong>{product.label}</strong>
                        <div className="shop-buy-row">
                          {asset === 'stocks' ? <div className="stock-order-box">
                            <div className="stock-live-price">目前每股 <b>NT${(stockPrices[product.id] || 100).toFixed(2)}</b></div>
                            <label className="money-input-wrap"><span>股數</span><input inputMode="numeric" pattern="[0-9]*" placeholder="輸入買入股數" value={stockTradeShares[product.id] || ''} onChange={(event) => setStockTradeShares((current) => ({ ...current, [product.id]: event.target.value.replace(/[^0-9]/g, '') }))} /></label>
                            <small>預估成交金額：NT${roundMoney(Number(stockTradeShares[product.id] || 0) * (stockPrices[product.id] || 100)).toLocaleString('en-US')}</small>
                          </div> : asset === 'bonds' ? <div className="stock-order-box"><div className="stock-live-price">目前價格 <b>{(selectedMarket?.bondPrices[product.id]||bondPrices[product.id]||100).toFixed(2)}</b> / 面額100</div><label className="money-input-wrap"><span>張數</span><input inputMode="numeric" pattern="[0-9]*" placeholder="輸入買入張數" value={bondTradeUnits[product.id]||''} onChange={(e)=>setBondTradeUnits(c=>({...c,[product.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label><small>每張面額 NT$10,000 · 預估成交 NT${roundMoney(Number(bondTradeUnits[product.id]||0)*10000*(bondPrices[product.id]||100)/100).toLocaleString('en-US')}</small></div> : <label className="money-input-wrap"><span>NT$</span><input inputMode="numeric" pattern="[0-9]*" placeholder="輸入投入金額" value={productAmounts[product.id] || ''} onChange={(event) => setProductAmounts((current) => ({ ...current, [product.id]: event.target.value.replace(/[^0-9]/g, '') }))} /></label>}
                          <button onClick={() => buyProduct(asset, product.id)}>購買</button>
                        </div>
                      </div>
                    ))}
                    <p>購買時才輸入投入金額；確認購買後形成持倉，不能再直接修改本金。</p>
                  </div>
                </details>
            ))}

            <div className="cta-row">
              <button className="primary advance-year-button" disabled={!canAdvance} onClick={advanceYear}>
                讓時間前進一年 →
              </button>
            </div>
          </div>

          <div className="side-stack">
            <div className="panel event-card">
              <div className="panel-header compact"><h2>金融年報</h2><span>{annualReports.length} 份</span></div>
              {annualReports.length===0 ? <p>第一個年度結束後，這裡會整理當年的經濟、利率、企業獲利、資金與市場消息。</p> :
                <>
                  <p>{annualReports[annualReports.length-1].summary}</p>
                  <div className="annual-report-picker">
                    <label htmlFor="annual-report-year">查看金融年報</label>
                    <select
                      id="annual-report-year"
                      value={reportOpen ?? annualReports[annualReports.length-1].year}
                      onChange={(e)=>setReportOpen(Number(e.target.value))}
                    >
                      {[...annualReports].reverse().map((report)=>
                        <option key={report.year} value={report.year}>
                          {report.year===0?'遊戲開始前一年｜市場背景':`第 ${report.year} 年｜${report.age}歲`}
                        </option>
                      )}
                    </select>
                  </div>
                  {(()=>{
                    const selectedYear = reportOpen ?? annualReports[annualReports.length-1].year;
                    const report = annualReports.find((item)=>item.year===selectedYear) ?? annualReports[annualReports.length-1];
                    return <div className="annual-report-detail annual-report-selected">
                      <div className="annual-report-selected-title">
                        <strong>{report.year===0?'遊戲開始前一年｜金融年報':`第 ${report.year} 年金融年報`}</strong>
                        <span>{report.year===0?'市場背景':`${report.age}歲`}</span>
                      </div>
                      {report.events.map((event)=><p key={event.label}><b>{event.label}</b><span>{event.text}</span></p>)}
                      <div className="annual-report-summary"><b>年度摘要</b><span>{report.summary}</span></div>
                    </div>;
                  })()}
                </>}
            </div>

            <div className="panel timeline-panel">
              <div className="panel-header compact">
                <h2>歷史紀錄</h2>
              </div>
              {game.history.length === 0 ? <p>還沒有歷史紀錄，第一年即將開始。</p> : (() => {
                const selectedYear = reportOpen ?? game.history[game.history.length - 1].year;
                const item = game.history.find((x) => x.year === selectedYear) ?? game.history[game.history.length - 1];
                const p = item.portfolio;
                return <>
                  <div className="history-year-picker"><select aria-label="歷史紀錄年度" value={item.year} onChange={(e)=>setReportOpen(Number(e.target.value))}>{[...game.history].reverse().map((x)=><option key={x.year} value={x.year}>{'第 '+x.year+' 年｜'+x.age+'歲　　　　　　　　 NT$'+roundMoney(x.total).toLocaleString('en-US')}</option>)}</select></div>
                  <div className="history-detail-block">
                    <div className="history-detail-head"><strong>第 {item.year} 年｜{item.age}歲</strong><b>總資產 NT${roundMoney(item.total).toLocaleString('en-US')}</b></div>
                    <div className="history-return"><span>年度投資報酬率</span><strong>{item.returnRate == null ? '舊紀錄未保存' : (item.returnRate >= 0 ? '+' : '')+(item.returnRate*100).toFixed(1)+'%'}</strong></div>
                    <div className="history-assets">{p ? Object.entries({現金:p.cash,定存:p.deposit,債券:p.bonds,股票:p.stocks,房地產:p.realEstate,長期保險:p.insurance}).map(([label,value])=><div key={label}><span>{label}</span><strong>NT${roundMoney(value).toLocaleString('en-US')}</strong></div>) : <p>這筆舊紀錄沒有保存各資產餘額；新年度開始後會自動記錄。</p>}</div>
                    <div className="history-actions"><b>當年度操作</b>{item.actions?.length ? item.actions.map((x,i)=><p key={i}>{x}</p>) : <p>這個年度沒有可顯示的操作紀錄。</p>}</div>
                  </div>
                </>;
              })()}
            </div>
          </div>
        </section>

        </> : <section className="panel stock-market-page">
          <div className="panel-header"><div><div className="eyebrow">MARKET TERMINAL</div><h2>投資市場價格與持倉明細</h2></div><span>{selectedMarketYear===0?'PRE-GAME':`YEAR ${selectedMarketYear}`}</span></div>
          <div className="market-year-picker"><label htmlFor="market-year">檢視年度</label><select id="market-year" value={selectedMarketYear} onChange={(e)=>{const y=Number(e.target.value);setMarketYear(y);setChartStartYear((s)=>Math.min(s,y));setResearchOverlay(null)}}>{[...marketSnapshots].reverse().map((x)=><option key={x.year} value={x.year}>{x.year===0?'遊戲開始前一年｜市場背景':`第 ${x.year} 年｜${x.age}歲`}</option>)}</select></div>
          <div className="chart-range-panel"><div className="chart-range-title"><strong>走勢圖期間</strong><span>終點跟隨檢視年度</span></div><div className="chart-range-controls chart-range-controls-single"><select aria-label="圖表起始年份" value={chartStartSnapshot.year} onChange={(e)=>setChartStartYear(Number(e.target.value))}>{availableMarketYears.filter(y=>y<=effectiveChartEndYear).map(y=><option key={y} value={y}>{chartYearLabel(y)}</option>)}</select><span>→</span><div className="chart-range-end">{chartYearLabel(effectiveChartEndYear)}</div></div><div className="chart-range-shortcuts">{[1,3,5,10].map(n=><button key={n} onClick={()=>setChartLookback(n)}>{n}年</button>)}<button onClick={()=>setChartStartYear(0)}>全部</button></div><p className="chart-range-note">圖表不會顯示檢視年度之後的未來資料。</p></div>
          {productCatalog.stocks.map((product) => {
            const price=selectedMarket?.stockPrices[product.id]||stockPrices[product.id]||100;
            const selectedHist=selectedMarket?.stockPaths[product.id]||stockPriceHistory[product.id]||[100];
            const hist=chartRangeSnapshots.flatMap((snap)=>snap.stockPaths[product.id]||[]);
            const chartHist=hist.length?hist:selectedHist;
            const min=Math.min(...chartHist), max=Math.max(...chartHist), range=Math.max(1,max-min);
            const points=chartHist.map((v,i)=>`${chartHist.length===1?0:(i/(chartHist.length-1))*100},${90-((v-min)/range)*80}`).join(' ');
            const research=stockResearch(product.id,selectedSignals,selectedHist);
            return <div className="market-card" key={product.id}><div className="market-quote"><div><strong>{product.label.split('｜')[0]}</strong><small>虛擬市場價格</small></div><b>NT${price.toFixed(2)}</b></div>
              <div className="interactive-chart" onPointerMove={(e)=>{const rect=e.currentTarget.getBoundingClientRect();const ratio=clamp((e.clientX-rect.left)/rect.width,0,1);setChartHover({id:product.id,index:Math.round(ratio*(chartHist.length-1))})}} onPointerLeave={()=>setChartHover(null)} onPointerDown={(e)=>{const rect=e.currentTarget.getBoundingClientRect();const ratio=clamp((e.clientX-rect.left)/rect.width,0,1);setChartHover({id:product.id,index:Math.round(ratio*(chartHist.length-1))})}}>
                <div className="chart-y-axis"><span>NT${max.toFixed(0)}</span><span>NT${((max+min)/2).toFixed(0)}</span><span>NT${min.toFixed(0)}</span></div>
                <svg className="price-chart" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={points}/>{chartHover?.id===product.id&&<line className="chart-crosshair" x1={(chartHover.index/Math.max(1,chartHist.length-1))*100} x2={(chartHover.index/Math.max(1,chartHist.length-1))*100} y1="0" y2="100"/>}</svg>
                {chartHover?.id===product.id&&(()=>{const i=clamp(chartHover.index,0,chartHist.length-1);const v=chartHist[i];const snapIndex=Math.min(chartRangeSnapshots.length-1,Math.floor(i/12));const monthIndex=(i%12)+1;const snap=chartRangeSnapshots[snapIndex];const label=snap?.year===0?`遊戲開始前 · 第 ${monthIndex} 月`:`${snap?.age ?? ''}歲 · 第 ${monthIndex} 月`;return <div className="chart-tooltip" style={{left:`${clamp((i/Math.max(1,chartHist.length-1))*100,12,82)}%`}}><strong>{label}</strong><span>NT${v.toFixed(2)}</span></div>})()}
              </div>
              <div className="market-years"><span>{chartYearLabel(chartStartSnapshot.year)}</span><span>{chartYearLabel(chartEndSnapshot.year)}</span></div>
              <div className="research-tabs">
                {[
                  ['fundamental','基本面',signalLabel(research.fundamental,'改善','承壓')],
                  ['flow','籌碼面',signalLabel(research.flow,'流入','流出')],
                  ['news','消息面',signalLabel(research.news,'偏正面','偏負面')],
                  ['technical','技術面',signalLabel(research.technical,'偏強','偏弱')],
                ].map(([key,label,status])=><button key={key} onClick={()=>{
                  const bodies:Record<string,React.ReactNode>={
                    fundamental:<><p>企業獲利成長 {(selectedSignals.earnings*100).toFixed(1)}% · 景氣成長 {(selectedSignals.growth*100).toFixed(1)}% · 政策利率 {(selectedSignals.policyRate*100).toFixed(1)}%</p><p>目前企業獲利偏弱，景氣接近持平，利率仍在相對高位。整體基本面偏中性至保守，短期缺乏明顯推升估值的力量。</p></>,
                    flow:<><p>資金動能 {research.flow>=0?'+':''}{research.flow.toFixed(2)} · {signalLabel(selectedSignals.riskAppetite,'Risk-on','Risk-off')}</p><p>目前大型資金動能偏弱，市場風險偏好有限。買盤力道不足，短期資金面對價格的支撐較弱。</p></>,
                    news:<><p>消息強度 {research.news>=0?'+':''}{research.news.toFixed(2)} · 通膨 {(selectedSignals.inflation*100).toFixed(1)}%</p><p>近期政策、產業與企業消息整體偏正面，但部分利多可能已提前反映在價格中。消息環境有利，仍需觀察市場後續反應。</p></>,
                    technical:<><p>近 6 月價格動能 {hist.length>2?(((price/hist[Math.max(0,hist.length-7)])-1)*100).toFixed(1):'0.0'}% · 技術訊號 {research.technical.toFixed(2)}</p><p>近期價格動能偏強，走勢維持向上。短期趨勢仍有支撐，但過去的上漲不代表下一期一定延續。</p></>
                  }; toggleResearch(product.id+'-'+key,label+'詳細資訊',bodies[key]);
                }} className={researchOverlay?.key===product.id+'-'+key?'active':''}><span>{label}</span><b>{status}</b></button>)}
              </div>
            </div>
          })}
          <div className="market-year-trades"><div className="panel-header compact"><h2>當年度買賣紀錄</h2><span>{selectedTrades.length} 筆</span></div>{selectedTrades.length===0?<p>這個年度沒有股票或債券交易。</p>:<div className="market-trade-scroll">{selectedTrades.map((t,i)=><div className="market-trade-row" key={i}><strong>{t.side}｜{t.label}</strong><span>{t.quantity} {t.asset==='stocks'?'股':'張'} · {t.price.toFixed(2)}</span><em>NT{roundMoney(t.amount).toLocaleString('en-US')}</em></div>)}</div>}</div>
          <div className="panel-header"><h2>債券市場與持倉</h2><span>{bondHoldings.length} 筆</span></div>
          {productCatalog.bonds.map((product)=>{const research=bondResearch(product.id,selectedSignals);return <div className="market-card" key={'market-'+product.id}><div className="market-quote"><div><strong>{product.label.split('｜')[0]}</strong><small>每 100 面額市場報價</small></div><b>{(bondPrices[product.id]||100).toFixed(2)}</b></div><div className="research-tabs">
              {[
                ['fundamental','基本面',signalLabel(research.fundamental,'改善','承壓')],
                ['flow','籌碼面',signalLabel(research.flow,'需求偏強','需求偏弱')],
                ['news','消息面',signalLabel(research.news,'偏正面','偏負面')],
                ['rate','利率面',signalLabel(research.rate,'有利','不利')],
              ].map(([key,label,status])=><button key={key} onClick={()=>{
                const bodies:Record<string,React.ReactNode>={
                  fundamental:<><p>景氣成長 {(selectedSignals.growth*100).toFixed(1)}% · 信用利差 {(marketSignals.creditSpread*100).toFixed(1)}%</p><p>目前景氣與信用環境尚可，信用利差仍在可控範圍。政府債信用風險較低；公司債則需留意企業償債能力是否轉弱。</p></>,
                  flow:<><p>{signalLabel(-selectedSignals.riskAppetite,'避險資金增加','避險資金減少')} · 需求訊號 {research.flow.toFixed(2)}</p><p>目前避險資金需求有限，債券買盤沒有明顯增強。若市場風險升高，高品質政府債可能獲得較多資金支持。</p></>,
                  news:<><p>消息強度 {research.news>=0?'+':''}{research.news.toFixed(2)}</p><p>近期央行、通膨與信用消息整體影響有限。若出現升息、降評級或通膨升溫，債券價格可能面臨較大壓力。</p></>,
                  rate:<><p>政策利率 {(selectedSignals.policyRate*100).toFixed(1)}% · 通膨 {(selectedSignals.inflation*100).toFixed(1)}%</p><p>目前利率水準對既有債券價格形成一定壓力。若利率繼續上升，長天期債券通常會比短天期債券承受更大的價格波動。</p></>
                }; toggleResearch(product.id+'-'+key,label+'詳細資訊',bodies[key]);
              }} className={researchOverlay?.key===product.id+'-'+key?'active':''}><span>{label}</span><b>{status}</b></button>)}
            </div></div>})}
          {bondHoldings.map(h=>{const quote=bondPrices[h.productId]||100;const value=(h.bondUnits||0)*(h.faceValue||10000)*quote/100;return <div className="stock-statement" key={'bond-'+h.id}><div><strong>{h.label.split('｜')[0]}</strong><small>{h.boughtAge}歲買入</small></div><div><span>持有張數</span><b>{h.bondUnits||0}</b></div><div><span>面額</span><b>NT${roundMoney((h.bondUnits||0)*(h.faceValue||10000)).toLocaleString('en-US')}</b></div><div><span>買入價</span><b>{(h.buyPrice||100).toFixed(2)}</b></div><div><span>目前報價</span><b>{quote.toFixed(2)}</b></div><div><span>目前市值</span><b>NT${roundMoney(value).toLocaleString('en-US')}</b></div><div><span>Coupon</span><b>{((h.couponRate||0)*100).toFixed(1)}%</b></div><div><span>剩餘年期</span><b>{Math.max(0,(h.boughtAge+(h.maturityYears||0))-game.age)} 年</b></div><div className="stock-sell-order"><label className="money-input-wrap"><span>賣出張數</span><input inputMode="numeric" pattern="[0-9]*" value={bondTradeUnits['sell-'+h.id]||''} onChange={(e)=>setBondTradeUnits(c=>({...c,['sell-'+h.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label></div><button className="danger" onClick={()=>sellBond(h.id)}>賣出債券</button></div>})}
          <div className="panel-header"><h2>房地產市場與我的房產</h2><span>{propertyHoldings.length} 間持有</span></div>
          {propertyListings.map(p=><div className="market-card" key={"market-"+p.id}><div className="market-quote"><div><strong>{p.name}</strong><small>{p.district} · {p.ping.toFixed(1)} 坪</small></div><b>NT${(p.price/10000).toFixed(0)}萬</b></div><p>每坪 NT${roundMoney(p.price/p.ping).toLocaleString("en-US")} · 頭期 NT${roundMoney(p.price*p.downPaymentRate).toLocaleString("en-US")} · 房貸 {(p.mortgageRate*100).toFixed(2)}%</p><p>人口 {p.populationTrend>=0?"↑":"↓"} · 出生率 {(p.birthRate*100).toFixed(2)}% · 買氣 {p.demand>.8?"強":p.demand>.68?"中等":"偏弱"} · 市場租金約 NT${p.marketRent.toLocaleString("en-US")}/月</p></div>)}
          {propertyHoldings.map(p=>{const equity=Math.max(0,p.currentValue-p.mortgageBalance);return <div className="stock-statement" key={"owned-"+p.id}><div><strong>{p.name}</strong><small>{p.district} · {p.ping.toFixed(1)}坪 · {p.boughtAge}歲購入</small></div><div><span>目前估值</span><b>NT${roundMoney(p.currentValue).toLocaleString("en-US")}</b></div><div><span>剩餘房貸</span><b>NT${roundMoney(p.mortgageBalance).toLocaleString("en-US")}</b></div><div><span>房屋淨值</span><b>NT${roundMoney(equity).toLocaleString("en-US")}</b></div><div><span>上年度出租結果</span><b>{p.rentalMode==="rent"?p.lastRentedMonths+"/12 個月":"未出租"}</b><small>{p.lastRentalIncome>0?"租金 NT$"+roundMoney(p.lastRentalIncome).toLocaleString("en-US")+" 已回到現金":""}</small></div><div className="stock-sell-order"><label className="money-input-wrap"><span>月租</span><input inputMode="numeric" value={rentInputs[p.id]??String(roundMoney(p.monthlyRent))} onChange={e=>setRentInputs(x=>({...x,[p.id]:e.target.value.replace(/[^0-9]/g,"")}))}/></label><small>市場行情約 NT${p.marketRent.toLocaleString("en-US")}/月</small></div><button onClick={()=>setPropertyRental(p.id,"rent")}>設定出租</button><button onClick={()=>setPropertyRental(p.id,"vacant")}>暫不出租</button><button className="danger" onClick={()=>sellProperty(p.id)}>出售房產</button></div>})}
          <div className="panel-header"><h2>我的持股明細</h2><span>{stockPositions.length} 檔</span></div>
          {stockPositions.length===0?<p>目前沒有持股。</p>:stockPositions.map(pos=>{const price=stockPrices[pos.product.id]||100;const value=pos.shares*price;const pnl=value-pos.cost;return <div className="stock-statement" key={'position-'+pos.product.id}>
            <div><strong>{pos.product.label.split('｜')[0]}</strong><small>{pos.lots.length} 筆買入紀錄 · 平均成本</small></div>
            <div><span>平均成本</span><b>NT${pos.avgCost.toFixed(2)}</b></div><div><span>持股單位</span><b>{pos.shares.toFixed(2)}</b></div><div><span>目前市價</span><b>NT${price.toFixed(2)}</b></div><div><span>市值</span><b>NT${roundMoney(value).toLocaleString('en-US')}</b></div><div><span>未實現損益</span><b>{pnl>=0?'+':''}NT${roundMoney(pnl).toLocaleString('en-US')}</b></div>
            <details className="stock-lot-details"><summary>查看買入明細</summary>{pos.lots.map(h=><div className="stock-lot-row" key={h.id}><span>{h.boughtAge}歲</span><span>{(h.shares||0).toFixed(0)} 股</span><span>NT${(h.buyPrice||0).toFixed(2)}</span></div>)}</details>
            <div className="stock-sell-order"><label className="money-input-wrap"><span>賣出股數</span><input inputMode="numeric" pattern="[0-9]*" placeholder="輸入股數" value={stockTradeShares['sell-position-'+pos.product.id]||''} onChange={(e)=>setStockTradeShares(c=>({...c,['sell-position-'+pos.product.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label><small>預估賣出金額 NT${roundMoney(Number(stockTradeShares['sell-position-'+pos.product.id]||0)*price).toLocaleString('en-US')}</small></div><button className="danger" onClick={()=>sellStockPosition(pos.product.id)}>賣出</button></div>})}
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
