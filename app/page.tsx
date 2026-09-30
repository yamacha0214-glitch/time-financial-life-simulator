'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createAnnualTicket, createSettlementGuard, derivePortfolio, insuranceValue, settleYear, sellStockPosition as executeStockSale, withdrawPolicy, type CashFlow, type ProductHolding } from '@/lib/simulation';
import { decodeWorld, writeWorld, WORLD_SAVE_VERSION } from '@/lib/persistence';

const STORAGE_KEY = 'time-financial-life-simulator-v2';
const HOLDINGS_KEY = 'time-financial-life-simulator-v2-holdings';
const WORLD_KEY = 'time-financial-life-simulator-v2-world';
const SAVE_VERSION = WORLD_SAVE_VERSION;
const ASSET_KEYS = ['cash', 'deposit', 'bonds', 'stocks', 'realEstate', 'insurance'] as const;

// Participating-policy baseline calibrated from the supplied real benefit illustration.
// Values are surrender-value / total scheduled premium ratios. Intermediate years are interpolated.
// This is a generic TIME simulation curve, not a quotation for any insurer or policy.
const INSURANCE_SURRENDER_CURVE: Array<[number, number]> = [
  [1,0],[2,0],[3,0.26551],[4,0.409685],[5,0.58069],[10,1.255865],[15,1.74045],[20,2.54057],[25,3.53179],[30,4.9976],
  [43,11.24431],[48,15.92205],[53,22.835625],[58,33.086535],[63,44.14993],[68,59.457],[73,79.3135]
];
const insuranceCurveRatio=(policyYear:number)=>{
  const y=Math.max(1,policyYear);
  const exact=INSURANCE_SURRENDER_CURVE.find(([year])=>year===y); if(exact)return exact[1];
  const upper=INSURANCE_SURRENDER_CURVE.find(([year])=>year>y);
  if(!upper)return INSURANCE_SURRENDER_CURVE[INSURANCE_SURRENDER_CURVE.length-1][1];
  const ui=INSURANCE_SURRENDER_CURVE.indexOf(upper), lower=INSURANCE_SURRENDER_CURVE[Math.max(0,ui-1)];
  const t=(y-lower[0])/(upper[0]-lower[0]); return lower[1]+(upper[1]-lower[1])*t;
};
// TIME modelling assumption: keep fulfilment in a relatively narrow 90%-105% band.
// GL16 defines/discloses fulfilment ratios; GL34 requires fair/sustainable bonus governance and smoothing.
// Neither guideline itself prescribes this numeric band.
const insuranceFulfillment=(signals:MarketSignals)=>clamp(1+(signals.growth-0.025)*0.65-(signals.creditSpread-0.018)*0.8+signals.news*0.018,0.90,1.05);
const policyIrr=(annualPremium:number,paid:number,policyYear:number,value:number,cumulativeWithdrawals=0)=>{
  if(paid<=0||policyYear<=0||value<=0)return null;
  // Premiums are paid annually from policy year 1; surrender value is received at the current policy year.
  // Historical withdrawals are approximated as received at the current valuation date until yearly withdrawal cash flows are stored separately.
  const npv=(rate:number)=>{
    let total=0;
    for(let payment=0;payment<paid;payment++) total-=annualPremium/Math.pow(1+rate,payment);
    total+=(value+cumulativeWithdrawals)/Math.pow(1+rate,policyYear);
    return total;
  };
  let lo=-0.99,hi=0.50;
  if(npv(lo)*npv(hi)>0)return null;
  for(let n=0;n<100;n++){const mid=(lo+hi)/2;if(npv(mid)>0)lo=mid;else hi=mid;}
  return (lo+hi)/2;
};
const insuranceSurrenderValue=(annualPremium:number,premiumTerm:number,policyYear:number,signals:MarketSignals)=>{
  const scheduledPremium=annualPremium*premiumTerm;
  const base=scheduledPremium*insuranceCurveRatio(policyYear);
  // Early values stay close to the illustration; market effects gradually affect the non-guaranteed portion.
  const nonGuaranteedWeight=clamp((policyYear-2)/18,0,0.88);
  return Math.max(0,base*((1-nonGuaranteedWeight)+nonGuaranteedWeight*insuranceFulfillment(signals)));
};
const cumulativePolicyPremiums=(holding:ProductHolding)=>holding.policyCashFlows?.filter(flow=>flow.type==='premium').reduce((sum,flow)=>sum+flow.amount,0)??(holding.annualPremium||0)*(holding.premiumsPaid||0);
const STOCK_INITIAL_PRICES: Record<string, number> = { 'stock-world': 160, 'stock-tech': 740, 'stock-dividend': 165 };
const BOND_INITIAL_PRICES: Record<string, number> = { 'bond-5': 98, 'bond-10': 91, 'bond-corp': 96 };
const MARKET_MODEL_VERSION = 6;

type AnnualReport = { year:number; age:number; signals:MarketSignals; events:Array<{label:string; text:string}>; summary:string; settlementId?:string };
type MarketTrade = { year:number; age:number; asset:'stocks'|'bonds'; productId:string; label:string; side:'買入'|'賣出'; quantity:number; price:number; amount:number };
type AssetOperation = { id:string; year:number; age:number; asset:'deposit'|'bonds'|'stocks'|'realEstate'|'insurance'; kind:'buy'|'sell'|'withdraw'|'plan'|'rental'; label:string; detail:string; cashFlow?:CashFlow };
type MarketSnapshot = { year:number; age:number; signals:MarketSignals; stockPrices:Record<string,number>; stockPaths:Record<string,number[]>; bondPrices:Record<string,number>; settlementId?:string };
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

const buildAnnualReport = (year:number, age:number, x:MarketSignals, settlementId?:string):AnnualReport => {
  const events=[
    {label:'總體經濟',text:`經濟成長 ${(x.growth*100).toFixed(1)}%，景氣${x.growth>0.025?'偏強':x.growth<0.008?'偏弱':'溫和'}。`},
    {label:'物價環境',text:`通膨率 ${(x.inflation*100).toFixed(1)}%，${x.inflation>0.04?'物價壓力明顯':'物價壓力相對溫和'}。`},
    {label:'央行政策',text:`政策利率 ${(x.policyRate*100).toFixed(1)}%，${x.policyRate>0.04?'資金成本偏高':'資金成本相對溫和'}。`},
    {label:'企業獲利',text:`企業獲利成長 ${x.earnings>=0?'+':''}${(x.earnings*100).toFixed(1)}%，${x.earnings>=0?'企業獲利整體成長':'企業獲利整體衰退'}。`},
    {label:'市場資金',text:`${signalLabel(x.flows,'資金偏流入','資金偏流出')}，市場風險偏好為 ${signalLabel(x.riskAppetite,'偏高','偏低')}。`},
    {label:'市場消息',text:`政策、產業與信用消息整體${signalLabel(x.news,'偏正面','偏負面')}，信用利差 ${(x.creditSpread*100).toFixed(1)}%。`}
  ];
  const summary=`本年度景氣${x.growth>0.025?'較強':x.growth<0.008?'較弱':'溫和'}、通膨${x.inflation>0.04?'偏高':'相對穩定'}，利率${x.policyRate>0.04?'維持高檔':'壓力有限'}；企業獲利${x.earnings>=0?'成長':'轉弱'}，資金${x.flows>0.3?'偏向流入風險資產':x.flows<-0.3?'偏向撤出風險資產':'方向不明顯'}。不同訊號可能同時互相矛盾，市場價格不一定只受單一因素影響。`;
  return {year,age,signals:x,events,summary,settlementId};
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
  changes?: string[];
  openingPortfolio?: Portfolio;
  cashFlows?: CashFlow[];
  returnMethod?: string;
  settlementId?: string;
  operations?: AssetOperation[];
  holdingSnapshot?: ProductHolding[];
  propertySnapshot?: PropertyHolding[];
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
  simulationSeed: string;
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
  insurance: { label: '保單退保價值', short: 'Insurance · 長期契約', liquidity: 0.2 },
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
  simulationSeed: `time-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
  const [saveStatus,setSaveStatus]=useState<{state:'saved'|'unsaved'|'blocked';lastYear:number|null;message:string}>({state:'saved',lastYear:null,message:''});
  const loadComplete=useRef(false);
  const [productAmounts, setProductAmounts] = useState<Record<string, string>>({});
  const [productHoldings, setProductHoldings] = useState<ProductHolding[]>([]);
  const [productHistory, setProductHistory] = useState<Array<{ id: string; productId: string; asset: Exclude<AssetKey, 'cash'>; label: string; amount: number; boughtAge: number; premiumTerm?: number; premiumsPaid?: number; buyPrice?: number; shares?: number; bondUnits?: number; faceValue?: number; maturityYears?: number; couponRate?: number }>>([]);
  const [holdingView, setHoldingView] = useState<'current' | 'history'>('current');
  const [insuranceWithdrawals, setInsuranceWithdrawals] = useState<Record<string,string>>({});
  const [insuranceWithdrawalModes, setInsuranceWithdrawalModes] = useState<Record<string,'fixed'|'percent'>>({});
  const [insuranceWithdrawalPercents, setInsuranceWithdrawalPercents] = useState<Record<string,string>>({});
  const [insuranceWithdrawalStartYears, setInsuranceWithdrawalStartYears] = useState<Record<string,string>>({});
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
  const [assetOperations,setAssetOperations]=useState<AssetOperation[]>([]);
  const [researchOverlay, setResearchOverlay] = useState<{key:string; title:string; body:React.ReactNode} | null>(null);
  const [chartHover, setChartHover] = useState<{id:string; index:number} | null>(null);
  const [chartStartYear, setChartStartYear] = useState(0);
  const [propertyListings, setPropertyListings] = useState<PropertyListing[]>(()=>buildPropertyMarket(initialMarket.signals,0));
  const [propertyHoldings, setPropertyHoldings] = useState<PropertyHolding[]>([]);
  const [rentInputs, setRentInputs] = useState<Record<string,string>>({});
  const settlementLock=useRef(createSettlementGuard());
  const [isSettling,setIsSettling]=useState(false);
  const toggleResearch = (key:string, title:string, body:React.ReactNode) => {
    if (researchOverlay?.key===key) setResearchOverlay(null);
    else setResearchOverlay({key,title,body});
  };

  useEffect(() => {
    try {
      const rawWorld=window.localStorage.getItem(WORLD_KEY);
      const decoded=decodeWorld(rawWorld);
      if(decoded.ok){
        const world=decoded.value;
          setGame({...buildInitialState(),...world.game,pendingChoice:null});
          setProductHoldings(world.holdings);
          setProductHistory(Array.isArray(world.history)?world.history:[]);
          setStockPrices(world.market.stockPrices);setStockPriceHistory(world.market.stockPriceHistory);setBondPrices(world.market.bondPrices);setMarketSignals(world.market.marketSignals);
          setAnnualReports(world.market.annualReports);setMarketSnapshots(world.market.marketSnapshots);setMarketTrades(world.market.marketTrades);setAssetOperations(Array.isArray(world.market.assetOperations)?world.market.assetOperations:[]);setPropertyListings(world.propertyListings);setPropertyHoldings(world.properties);
          setSaveStatus(decoded.diagnostics.length?{state:'blocked',lastYear:world.game.year,message:decoded.diagnostics.join(' ')}:{state:'saved',lastYear:world.game.year,message:''});
          loadComplete.current=true;setIsMounted(true);
          return;
      }
      if(rawWorld!==null){setSaveStatus({state:'blocked',lastYear:null,message:decoded.diagnostics.join(' ')||'存檔無法載入；原始資料已保留。'});loadComplete.current=true;setIsMounted(true);return}
      const saved = asyncLoadGame();
      let legacyGame=saved?{ ...buildInitialState(), ...saved, simulationSeed:saved.simulationSeed||'legacy-v2', pendingChoice: null }:null;
      const savedProducts = window.localStorage.getItem(HOLDINGS_KEY);
      if (savedProducts) {
        const parsed = JSON.parse(savedProducts);
        if (Array.isArray(parsed.holdings)) {
          const recovered=parsed.holdings.map((holding:ProductHolding)=>{
            if(holding.asset!=='insurance')return holding;
            if(!Number.isFinite(holding.annualPremium)){
              const answer=window.prompt(`舊保單「${holding.label}」缺少可確認的固定年繳保費。請依原契約輸入；取消將停止載入，原存檔會保留。`);
              const premium=Number(answer);
              if(answer===null||!Number.isFinite(premium)||premium<=0)throw new Error('LEGACY_POLICY_PREMIUM_REQUIRED');
              return {...holding,annualPremium:premium,cashFlowHistoryComplete:false};
            }
            return {...holding,cashFlowHistoryComplete:Array.isArray(holding.policyCashFlows)};
          });
          setProductHoldings(recovered);
          if(legacyGame){
            const migratedPortfolio=derivePortfolio(legacyGame.portfolio.cash,recovered,Array.isArray(parsed.propertyHoldings)?parsed.propertyHoldings:[],parsed.stockPrices||stockPrices,parsed.bondPrices||bondPrices,parsed.marketSignals||marketSignals,legacyGame.age) as Portfolio;
            legacyGame={...legacyGame,portfolio:migratedPortfolio};
          }
        }
        if (Array.isArray(parsed.history)) setProductHistory(parsed.history);
        if (Array.isArray(parsed.marketSnapshots) && parsed.marketSnapshots.length) setMarketSnapshots(parsed.marketSnapshots);
        if (Array.isArray(parsed.marketTrades)) setMarketTrades(parsed.marketTrades);
        if (Array.isArray(parsed.assetOperations)) setAssetOperations(parsed.assetOperations);
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
      if(legacyGame)setGame(legacyGame);
      if(saved||savedProducts)setSaveStatus({state:'unsaved',lastYear:null,message:'舊存檔已載入記憶體；請確認診斷後按「儲存」建立新版完整存檔。缺少的保單現金流不會被猜造，歷史報酬可能不可靠。'});
    } catch(error) {setSaveStatus({state:'blocked',lastYear:null,message:error instanceof Error&&error.message==='LEGACY_POLICY_PREMIUM_REQUIRED'?'舊保單固定保費尚未確認，已停止載入；原始存檔保持不變。':'舊存檔無法安全載入；原始資料保持不變。'});}
    loadComplete.current=true;setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted||!loadComplete.current||saveStatus.state==='blocked') return;
    const saved=writeWorld(window.localStorage,WORLD_KEY,buildSaveEnvelope());
    if(saved.ok)setSaveStatus({state:'saved',lastYear:game.year,message:''});
    else setSaveStatus(current=>({state:'unsaved',lastYear:current.lastYear,message:'自動儲存失敗；目前進度只在記憶體中。請按「儲存」重試。'}));
    // buildSaveEnvelope intentionally reads the same committed render observed by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, productHoldings, productHistory, stockPrices, stockPriceHistory, bondPrices, marketSignals, annualReports, marketSnapshots, marketTrades, assetOperations, propertyListings, propertyHoldings, isMounted]);

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
    const purchased:PropertyHolding={
      ...listing,
      boughtAge: game.age,
      purchasePrice: listing.price,
      mortgageBalance: mortgage,
      monthlyRent: listing.marketRent,
      rentalMode: 'vacant',
      lastRentedMonths: 0,
      lastRentalIncome: 0,
      currentValue: listing.price,
    };
    const nextProperties=[...propertyHoldings,purchased];
    setPropertyHoldings(nextProperties);
    setPropertyListings((current) => current.filter((property) => property.id !== listing.id));
    setAssetOperations(current=>[...current,{id:`property-buy-${listing.id}`,year:game.year,age:game.age,asset:'realEstate',kind:'buy',label:`買入房產｜${listing.name}`,detail:`總價 NT$${roundMoney(listing.price).toLocaleString('en-US')}；頭期款 NT$${roundMoney(downPayment).toLocaleString('en-US')}`,cashFlow:{kind:'trade',asset:'realEstate',amount:-downPayment,holdingId:listing.id,label:`買入房產頭期款｜${listing.name}`}}]);
    const portfolio=derivePortfolio(game.portfolio.cash-downPayment,productHoldings,nextProperties,stockPrices,bondPrices,marketSignals,game.age) as Portfolio;
    setGame((current) => ({
      ...current, portfolio,
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
    const property=propertyHoldings.find(item=>item.id===id);if(property)setAssetOperations(current=>[...current,{id:`rental-${id}-${Date.now()}`,year:game.year,age:game.age,asset:'realEstate',kind:'rental',label:`出租設定｜${property.name}`,detail:mode==='rent'?`設定月租 NT$${roundMoney(requested>0?requested:property.monthlyRent).toLocaleString('en-US')}`:'設定為暫不出租'}]);
  };

  const sellProperty = (id:string) => {
    const property = propertyHoldings.find((item) => item.id === id);
    if (!property) return;
    const equity = property.currentValue - property.mortgageBalance;
    if(equity<0&&game.portfolio.cash+equity<0)return alert('房屋為負淨值，現金不足以清償出售後的剩餘房貸。');
    const nextProperties=propertyHoldings.filter((item) => item.id !== id);
    setPropertyHoldings(nextProperties);
    setAssetOperations(current=>[...current,{id:`property-sell-${id}-${Date.now()}`,year:game.year,age:game.age,asset:'realEstate',kind:'sell',label:`出售房產｜${property.name}`,detail:`清償房貸後淨收回 NT$${roundMoney(equity).toLocaleString('en-US')}`,cashFlow:{kind:'trade',asset:'realEstate',amount:equity,holdingId:id,label:`出售房產淨所得｜${property.name}`}}]);
    const portfolio=derivePortfolio(game.portfolio.cash+equity,productHoldings,nextProperties,stockPrices,bondPrices,marketSignals,game.age) as Portfolio;
    setGame((current) => ({
      ...current, portfolio,
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
    const product = productCatalog[asset].find((item) => item.id === productId);
    if (product) {
      const premiumTerm = productId === 'policy-5' ? 5 : productId === 'policy-10' ? 10 : undefined;
      const price = asset === 'stocks' ? (stockPrices[productId] || 100) : asset === 'bonds' ? (bondPrices[productId] || 100) : undefined;
      const maturityYears = productId === 'bond-5' ? 5 : productId === 'bond-10' ? 10 : productId === 'bond-corp' ? 7 : undefined;
      const couponRate = productId === 'bond-5' ? 0.028 : productId === 'bond-10' ? 0.032 : productId === 'bond-corp' ? 0.041 : undefined;
      const purchase:ProductHolding = { id: `${productId}-${Date.now()}`, productId, asset, label: product.label, amount, boughtAge: game.age, premiumTerm, premiumsPaid: premiumTerm ? 1 : undefined, annualPremium:premiumTerm?amount:undefined, policyScale:premiumTerm?1:undefined, policyCashFlows:premiumTerm?[{year:game.year,policyYear:1,type:'premium',amount}]:undefined, buyPrice: price, shares: asset === 'stocks' ? requestedShares : undefined, bondUnits: asset === 'bonds' ? requestedBondUnits : undefined, faceValue: asset === 'bonds' ? 10000 : undefined, maturityYears, couponRate };
      const nextHoldings=[...productHoldings,purchase];
      const nextPortfolio=derivePortfolio(game.portfolio.cash-amount,nextHoldings,propertyHoldings,stockPrices,bondPrices,marketSignals,game.age) as Portfolio;
      const total=sumPortfolio(nextPortfolio),allocations=Object.fromEntries(ASSET_KEYS.map(key=>[key,total>0?nextPortfolio[key]/total*100:0])) as Allocation;
      setProductHoldings(nextHoldings);
      setAssetOperations(current=>[...current,{id:`buy-${purchase.id}`,year:game.year,age:game.age,asset,kind:'buy',label:`買入｜${product.label.split('｜')[0]}`,detail:asset==='stocks'?`${requestedShares} 股，成交價 NT$${marketPrice.toFixed(2)}`:asset==='bonds'?`${requestedBondUnits} 張，報價 ${bondQuote.toFixed(2)}`:`投入 NT$${roundMoney(amount).toLocaleString('en-US')}`,cashFlow:{kind:'trade',asset,amount:-amount,holdingId:purchase.id,label:`買入支出｜${product.label.split('｜')[0]}`}}]);
      setGame(current=>({...current,portfolio:nextPortfolio,allocations,lifeStatus:`已購買商品，投入 NT$${roundMoney(amount).toLocaleString('en-US')}。持倉已成為資產總表來源。`}));
      setProductHistory((current) => [...current, purchase]);
      if (asset==='stocks' || asset==='bonds') setMarketTrades((current)=>[...current,{year:game.year,age:game.age,asset,productId,label:product.label.split('｜')[0],side:'買入',quantity:asset==='stocks'?requestedShares:requestedBondUnits,price:price||0,amount}]);
    }
    setProductAmounts((current) => ({ ...current, [productId]: '' }));
    if (asset === 'stocks') setStockTradeShares((current) => ({ ...current, [productId]: '' }));
    if (asset === 'bonds') setBondTradeUnits((current) => ({ ...current, [productId]: '' }));
  };

  const withdrawInsurance = (holdingId:string) => {
    const holding=productHoldings.find((h)=>h.id===holdingId&&h.asset==='insurance');
    if(!holding?.premiumTerm)return;
    const requested=Number(insuranceWithdrawals[holdingId]||0);
    if(requested<=0)return alert('請輸入提取金額');
    const currentValue=insuranceValue(holding,game.age,marketSignals);
    if(requested>currentValue)return alert('提取金額不能高於目前退保價值');
    const updated=withdrawPolicy(holding,requested,game.year,game.age,marketSignals);
    const nextHoldings=productHoldings.map(h=>h.id===holdingId?updated:h);
    const portfolio=derivePortfolio(game.portfolio.cash+requested,nextHoldings,propertyHoldings,stockPrices,bondPrices,marketSignals,game.age) as Portfolio;
    setProductHoldings(nextHoldings);
    setAssetOperations(current=>[...current,{id:`withdraw-${holdingId}-${Date.now()}`,year:game.year,age:game.age,asset:'insurance',kind:'withdraw',label:`保單提取｜${holding.label.split('｜')[0]}`,detail:`提取 NT$${roundMoney(requested).toLocaleString('en-US')}；固定年繳保費不變`,cashFlow:{kind:'withdrawal',asset:'insurance',amount:requested,holdingId,label:`保單提取｜${holding.label.split('｜')[0]}`}}]);
    setGame((current)=>({...current,portfolio,eventHistory:[...current.eventHistory,`保單提取：從 ${holding.label.split('｜')[0]} 提取 NT${roundMoney(requested).toLocaleString('en-US')}，已回到現金；原約定保費不變。`],lifeStatus:'已從分紅保單提取現金，提取時點與金額已記錄。'}));
    setInsuranceWithdrawals((x)=>({...x,[holdingId]:''}));
  };

  const setInsuranceWithdrawalPlan=(holdingId:string)=>{
    const mode=insuranceWithdrawalModes[holdingId]||'fixed';
    const startYear=Math.max(1,Number(insuranceWithdrawalStartYears[holdingId]||6));
    const amount=Number(insuranceWithdrawals[holdingId]||0);
    const percent=Number(insuranceWithdrawalPercents[holdingId]||0);
    if(mode==='fixed'&&amount<=0)return alert('請輸入每年固定提取金額');
    if(mode==='percent'&&(percent<=0||percent>100))return alert('請輸入 0～100% 的提取比例');
    setProductHoldings(cur=>cur.map(h=>h.id!==holdingId?h:{...h,withdrawalMode:mode,withdrawalAmount:mode==='fixed'?amount:undefined,withdrawalPercent:mode==='percent'?percent:undefined,withdrawalStartYear:startYear,cumulativeWithdrawals:h.cumulativeWithdrawals||0}));
    const planText=mode==='fixed'
      ? '每年固定提取 NT$'+roundMoney(amount).toLocaleString('en-US')
      : '每年提取原始總預定保費的 '+percent+'%';
    const holding=productHoldings.find(h=>h.id===holdingId);if(holding)setAssetOperations(current=>[...current,{id:`plan-${holdingId}-${Date.now()}`,year:game.year,age:game.age,asset:'insurance',kind:'plan',label:`保單提取計畫｜${holding.label.split('｜')[0]}`,detail:`第 ${startYear} 保單年度起，${planText}`}]);
    setGame(cur=>({...cur,eventHistory:[...cur.eventHistory,'保單提取計畫：設定第 '+startYear+' 保單年度起，'+planText+'。'],lifeStatus:'已設定分紅保單年度提取計畫。'}));
  };
  const cancelInsuranceWithdrawalPlan=(holdingId:string)=>{
    setProductHoldings(cur=>cur.map(h=>h.id!==holdingId?h:{...h,withdrawalMode:'none',withdrawalAmount:undefined,withdrawalPercent:undefined,withdrawalStartYear:undefined}));
    const holding=productHoldings.find(h=>h.id===holdingId);if(holding)setAssetOperations(current=>[...current,{id:`plan-cancel-${holdingId}-${Date.now()}`,year:game.year,age:game.age,asset:'insurance',kind:'plan',label:`取消提取計畫｜${holding.label.split('｜')[0]}`,detail:'取消後不再執行排程提取'}]);
  };

  const sellStockPosition = (productId:string) => {
    const lots=productHoldings.filter((h)=>h.asset==='stocks' && h.productId===productId);
    const owned=lots.reduce((n,h)=>n+(h.shares||0),0);
    const sharesToSell=Number(stockTradeShares['sell-position-'+productId]||0);
    if(!Number.isInteger(sharesToSell)||sharesToSell<=0) return alert('請輸入要賣出的整數股數');
    if(sharesToSell>owned) return alert('賣出股數不能超過目前持股');
    const price=stockPrices[productId]||100;
    const sale=executeStockSale(productHoldings,productId,sharesToSell,price), proceeds=sale.proceeds, avgCost=sale.costBasis/sharesToSell;
    const label=lots[0]?.label.split('｜')[0]||productId;
    setProductHoldings(sale.holdings);
    setAssetOperations(current=>[...current,{id:`stock-sell-${productId}-${Date.now()}`,year:game.year,age:game.age,asset:'stocks',kind:'sell',label:`賣出｜${label}`,detail:`${sharesToSell} 股，實現損益 NT$${roundMoney(sale.realizedPnl).toLocaleString('en-US')}`,cashFlow:{kind:'trade',asset:'stocks',amount:proceeds,label:`股票賣出所得｜${label}`}}]);
    const portfolio=derivePortfolio(game.portfolio.cash+proceeds,sale.holdings,propertyHoldings,stockPrices,bondPrices,marketSignals,game.age) as Portfolio;
    setGame((current)=>({...current,portfolio,lifeStatus:`已賣出 ${label} ${sharesToSell} 股，NT$${roundMoney(proceeds).toLocaleString('en-US')} 回到現金。`,eventHistory:[...current.eventHistory,`股票賣出：${label}，實現損益 NT$${roundMoney(sale.realizedPnl).toLocaleString('en-US')}。`]}));
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
    const nextHoldings=productHoldings.flatMap((item) => item.id !== holdingId ? [item] : units === owned ? [] : [{...item, bondUnits: owned-units, amount:item.amount-costSold}]);
    const portfolio=derivePortfolio(game.portfolio.cash+proceeds,nextHoldings,propertyHoldings,stockPrices,bondPrices,marketSignals,game.age) as Portfolio;
    setProductHoldings(nextHoldings);
    setAssetOperations(current=>[...current,{id:`bond-sell-${holdingId}-${Date.now()}`,year:game.year,age:game.age,asset:'bonds',kind:'sell',label:`賣出債券｜${holding.label.split('｜')[0]}`,detail:`${units} 張，實現損益 NT$${roundMoney(proceeds-costSold).toLocaleString('en-US')}`,cashFlow:{kind:'trade',asset:'bonds',amount:proceeds,holdingId,label:`債券賣出所得｜${holding.label.split('｜')[0]}`}}]);
    setGame((current) => ({...current, portfolio, eventHistory:[...current.eventHistory,`債券出售：${holding.label.split('｜')[0]} ${units} 張，實現損益 NT${roundMoney(proceeds-costSold).toLocaleString('en-US')}。`]}));
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
  const policyDue = productHoldings.filter((h) => h.asset === 'insurance' && h.premiumTerm && (h.premiumsPaid || 1) < h.premiumTerm).reduce((sum,h)=>sum+(h.annualPremium??0),0);

  const allocationTotal = ASSET_KEYS.reduce((sum, key) => sum + game.allocations[key], 0);
  const allocationAmountTotal = totalAssets * (allocationTotal / 100);
  const allocationDifference = totalAssets - allocationAmountTotal;
  const allocationValid = Math.abs(allocationDifference) < 1;

  const buildSaveEnvelope=()=>({version:SAVE_VERSION,savedAt:new Date().toISOString(),lastSettlementId:game.history.at(-1)?.settlementId,settlementHistoryComplete:game.history.length===0||Boolean(game.history.at(-1)?.settlementId),game,holdings:productHoldings,history:productHistory,properties:propertyHoldings,propertyListings,market:{stockPrices,stockPriceHistory,bondPrices,marketSignals,annualReports,marketSnapshots,marketTrades,assetOperations,marketModelVersion:MARKET_MODEL_VERSION}});

  const handleRestart = () => {
    if(saveStatus.state!=='saved'&&!window.confirm('目前有尚未成功儲存的進度。重新開始會放棄記憶體中的變更，確定繼續嗎？'))return;
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
    setAssetOperations([]);
    setPropertyHoldings([]);
    setPropertyListings(buildPropertyMarket(restartedMarket.signals,0));
    setStockTradeShares({});
    setBondTradeUnits({});
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      window.localStorage.removeItem(HOLDINGS_KEY);
      window.localStorage.removeItem(WORLD_KEY);
    }
    setSaveStatus({state:'saved',lastYear:1,message:''});
  };

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      if(saveStatus.state==='blocked'&&saveStatus.lastYear===null)return alert('目前存檔尚未通過驗證，請先使用「修復舊保單」補回契約資料；原始存檔不會被覆寫。');
      if(saveStatus.state==='blocked'&&!window.confirm('目前載入的總表與持倉不一致。確定以持倉推導的總表另存為新版完整存檔嗎？'))return;
      const saved=writeWorld(window.localStorage,WORLD_KEY,buildSaveEnvelope());
      if(saved.ok){setSaveStatus({state:'saved',lastYear:game.year,message:''});alert('完整世界已儲存')}
      else{setSaveStatus(current=>({state:'unsaved',lastYear:current.lastYear,message:'儲存失敗；目前進度只在記憶體中。請稍後按「儲存」重試。'}));alert('儲存失敗；上一份有效存檔仍保留。')}
    }
  };

  const handleRecoverLegacyPolicies=()=>{
    const raw=window.localStorage.getItem(WORLD_KEY);if(!raw)return alert('沒有可修復的完整世界存檔。');
    try{
      const candidate=JSON.parse(raw);
      if(!Array.isArray(candidate.holdings))return alert('存檔缺少持倉，無法自動修復。');
      candidate.holdings=candidate.holdings.map((holding:ProductHolding)=>{
        if(holding.asset!=='insurance'||Number.isFinite(holding.annualPremium))return holding;
        const answer=window.prompt(`請依原契約輸入「${holding.label}」的固定年繳保費。此值無法由舊 amount 安全推測。`);
        const premium=Number(answer);if(answer===null||!Number.isFinite(premium)||premium<=0)throw new Error('CANCELLED');
        return{...holding,annualPremium:premium,cashFlowHistoryComplete:Array.isArray(holding.policyCashFlows)};
      });
      const decoded=decodeWorld(JSON.stringify(candidate));if(!decoded.ok)return alert(`仍無法載入：${decoded.diagnostics.join(' ')}`);
      const world=decoded.value;setGame({...buildInitialState(),...world.game,pendingChoice:null});setProductHoldings(world.holdings);setProductHistory(world.history||[]);setPropertyHoldings(world.properties);setPropertyListings(world.propertyListings||[]);setStockPrices(world.market.stockPrices);setStockPriceHistory(world.market.stockPriceHistory);setBondPrices(world.market.bondPrices);setMarketSignals(world.market.marketSignals);setAnnualReports(world.market.annualReports);setMarketSnapshots(world.market.marketSnapshots);setMarketTrades(world.market.marketTrades);setAssetOperations(Array.isArray(world.market.assetOperations)?world.market.assetOperations:[]);
      setSaveStatus({state:'unsaved',lastYear:null,message:'契約固定保費已補回記憶體；原始存檔仍未改動。請按「儲存」確認建立新版存檔。缺失的歷史現金流仍標示為不完整。'});
    }catch{alert('未完成契約資料補回；原始存檔保持不變。')}
  };

  const handleContinue = () => {
    const decoded=decodeWorld(window.localStorage.getItem(WORLD_KEY));if(!decoded.ok)return alert(decoded.reason==='missing'?'目前沒有完整世界存檔；舊存檔會在重新載入頁面時遷移。':`存檔無法安全載入；原始資料已保留。${decoded.diagnostics.join(' ')}`);const world=decoded.value;setGame({...buildInitialState(),...world.game,pendingChoice:null});setProductHoldings(world.holdings);setProductHistory(world.history||[]);setPropertyHoldings(world.properties);setPropertyListings(world.propertyListings||[]);setStockPrices(world.market.stockPrices);setStockPriceHistory(world.market.stockPriceHistory);setBondPrices(world.market.bondPrices);setMarketSignals(world.market.marketSignals);setAnnualReports(world.market.annualReports);setMarketSnapshots(world.market.marketSnapshots);setMarketTrades(world.market.marketTrades);setAssetOperations(Array.isArray(world.market.assetOperations)?world.market.assetOperations:[]);setSaveStatus(decoded.diagnostics.length?{state:'blocked',lastYear:world.game.year,message:decoded.diagnostics.join(' ')}:{state:'saved',lastYear:world.game.year,message:''});alert(decoded.diagnostics.length?'完整世界已載入，但總表不一致；請檢查診斷後手動儲存。':'完整世界載入成功');
  };

  const advanceYear = () => {
    if (game.pendingChoice || game.completed || !settlementLock.current.acquire()) return;
    setIsSettling(true);
    const ticket=createAnnualTicket(game.simulationSeed||'legacy-v2',game.year,Object.keys(stockPrices),propertyHoldings);
    const openingPortfolio=derivePortfolio(game.portfolio.cash,productHoldings,propertyHoldings,stockPrices,bondPrices,marketSignals,game.age) as Portfolio;
    const result=settleYear({year:game.year,age:game.age,cash:game.portfolio.cash,holdings:productHoldings,properties:propertyHoldings,stockPrices,bondPrices,previousSignals:marketSignals,ticket,annualCapital:300000});
    if(!result.ok){
      settlementLock.current.release();setIsSettling(false);
      alert(result.message);
      return;
    }
    const signals=ticket.signals;
    const report=buildAnnualReport(game.year,game.age,signals,result.ticketKey);
    const closingPortfolio=result.portfolio as Portfolio;
    const finalTotal=sumPortfolio(closingPortfolio);
    const external=result.cashFlows.filter(flow=>flow.kind==='external').reduce((n,flow)=>n+flow.amount,0);
    const simpleReturn=sumPortfolio(openingPortfolio)>0?(finalTotal-external-sumPortfolio(openingPortfolio))/sumPortfolio(openingPortfolio):0;
    const flowLabels=result.cashFlows.map(flow=>`${flow.label}：${flow.amount>=0?'+':'-'}NT$${roundMoney(Math.abs(flow.amount)).toLocaleString('en-US')}`);
    const annualChanges=ASSET_KEYS.map(asset=>`${ASSET_META[asset].label}｜期初 NT$${roundMoney(openingPortfolio[asset]).toLocaleString('en-US')}｜期末 NT$${roundMoney(closingPortfolio[asset]).toLocaleString('en-US')}`);
    const nextAge=game.age+1;
    const yearOperations=assetOperations.filter(operation=>operation.year===game.year);
    const settlementOperations:AssetOperation[]=result.cashFlows.filter(flow=>flow.kind==='maturity'||flow.kind==='withdrawal').map((flow,index)=>({id:`settlement-${result.ticketKey}-${flow.kind}-${flow.holdingId||index}`,year:game.year,age:game.age,asset:flow.asset as AssetOperation['asset'],kind:flow.kind==='withdrawal'?'withdraw':'sell',label:flow.kind==='withdrawal'?'執行排程提取':'契約到期',detail:flow.label}));
    const allOperations=[...yearOperations,...settlementOperations];
    const operationCashFlows=yearOperations.flatMap(operation=>operation.cashFlow?[{...operation.cashFlow,label:`${operation.cashFlow.label}（操作 ${operation.id}）`}]:[]);
    const settlementCashFlows=result.cashFlows.map(flow=>{const operation=settlementOperations.find(item=>item.detail===flow.label);return{...flow,label:operation?`${flow.label}（操作 ${operation.id}）`:flow.label}});
    const nextHistory:HistoryEntry={year:game.year,age:game.age,total:finalTotal,real:getRealWealth(finalTotal,(1+game.cumulativeInflation)*(1+signals.inflation)-1),liquidity:getLiquidity(closingPortfolio),eventTitle:`第 ${game.year} 年財務結算`,portfolio:{...closingPortfolio},openingPortfolio:{...openingPortfolio},returnRate:simpleReturn,returnMethod:'簡化期末報酬：外部新增資金視為年末流入；非 TWR/MWR',actions:allOperations.map(operation=>`${operation.label}｜${operation.detail}`),operations:allOperations.map(operation=>({...operation,cashFlow:operation.cashFlow?{...operation.cashFlow}:undefined})),cashFlows:[...operationCashFlows,...settlementCashFlows],changes:annualChanges,settlementId:result.ticketKey,holdingSnapshot:result.holdings.map(holding=>({...holding,policyCashFlows:holding.policyCashFlows?.map(flow=>({...flow}))})),propertySnapshot:result.properties.map(property=>({...property}))};
    const histories=[...game.history,nextHistory];
    let peak=histories[0]?.total||finalTotal,maxDrawdown=0;
    histories.forEach(entry=>{peak=Math.max(peak,entry.total);if(peak>0)maxDrawdown=Math.max(maxDrawdown,1-entry.total/peak)});
    const nextGame:GameState={...game,age:nextAge,year:game.year+1,portfolio:{...closingPortfolio},allocations:Object.fromEntries(ASSET_KEYS.map(k=>[k,finalTotal>0?closingPortfolio[k]/finalTotal*100:0])) as Allocation,income:0,expense:0,lifeStatus:report.summary,inflationRate:signals.inflation,cumulativeInflation:(1+game.cumulativeInflation)*(1+signals.inflation)-1,eventHistory:[...game.eventHistory,...flowLabels,`第 ${game.year} 年金融年報：${report.summary}`],history:histories,marketEvent:null,lastLifeEvent:null,pendingChoice:null,marketCrisisCount:signals.growth<0&&signals.riskAppetite<-.55?game.marketCrisisCount+1:game.marketCrisisCount,maxDrawdown,completed:nextAge>=65};
    if(nextGame.completed)nextGame.analysis=buildFinalAnalysis(nextGame);
    // One validated settlement is committed as a single synchronous adapter action.
    setProductHoldings(result.holdings);
    setPropertyHoldings(result.properties);
    setStockPrices(result.stockPrices);
    setStockPriceHistory(current=>Object.fromEntries(Object.keys(result.stockPrices).map(id=>[id,[...(current[id]||[stockPrices[id]]),...(result.stockPaths[id]||[])]])));
    setBondPrices(result.bondPrices);
    setMarketSignals(signals);
    setMarketSnapshots(current=>[...current,{year:game.year,age:game.age,signals,stockPrices:{...result.stockPrices},stockPaths:Object.fromEntries(Object.entries(result.stockPaths).map(([id,path])=>[id,[...path]])),bondPrices:{...result.bondPrices},settlementId:result.ticketKey}]);
    setAnnualReports(current=>[...current,report]);
    setPropertyListings(buildPropertyMarket(signals,game.year));
    setGame(nextGame);
  };

  useEffect(()=>{settlementLock.current.release();setIsSettling(false)},[game.year]);

  // Legacy aggregate forced-sale/choice settlement is intentionally disconnected.
  // Future Life Engine choices must execute holding-level transactions through the simulation ledger.

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

  const canAdvance = !game.pendingChoice && !game.completed && allocationValid && !isSettling;

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
        {saveStatus.state!=='saved'&&<div role="status" style={{marginBottom:16,padding:'12px 16px',borderRadius:12,background:'#fff4e5',color:'#7a3f00'}}>
          <strong>{saveStatus.state==='blocked'?'存檔需要處理':'尚未儲存'}</strong>
          <span>｜{saveStatus.message} {saveStatus.lastYear!==null?`最後成功存檔：第 ${saveStatus.lastYear} 年。`:''}</span>
          <button style={{marginLeft:12}} onClick={saveStatus.state==='blocked'&&saveStatus.lastYear===null?handleRecoverLegacyPolicies:handleSave}>{saveStatus.state==='blocked'&&saveStatus.lastYear===null?'修復舊保單':'重試儲存'}</button>
        </div>}

        <nav className="workbook-tabs"><button className={mainView==='game'?'active':''} onClick={()=>setMainView('game')}>資產總表</button><button className={mainView==='market'?'active':''} onClick={()=>setMainView('market')}>投資市場</button><button onClick={()=>{setMainView('market');requestAnimationFrame(()=>document.getElementById('market-trade-history')?.scrollIntoView({behavior:'smooth'}))}}>股票／債券交易紀錄 ↓</button></nav>
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
                  <div className="holdings-strip">{productHoldings.map((holding) => {const displayedValue=holding.asset==='insurance'?insuranceValue(holding,game.age,marketSignals):holding.amount;return <div className="holding-chip" key={holding.id}>
                    <strong>{holding.label.split('｜')[0]}</strong><span>{holding.asset==='insurance'?'退保價值 ':''}NT${roundMoney(displayedValue).toLocaleString('en-US')}</span>
                    <small>{holding.asset==='insurance'?`持有 1 張 · 供款 ${holding.premiumsPaid||1}/${holding.premiumTerm} 期 · 累計已繳 NT$${roundMoney(cumulativePolicyPremiums(holding)).toLocaleString('en-US')}`:`${holding.boughtAge} 歲購入 · ${totalAssets > 0 ? ((holding.amount / totalAssets) * 100).toFixed(1) : '0.0'}% 總資產`}</small>
                    {holding.asset==='insurance'&&displayedValue===0&&<small>已持有保單；目前模型退保價值為 0，累計已繳保費不另加回總資產。</small>}
                  </div>})}</div>}
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
                        {holding.asset==='insurance'&&holding.premiumTerm ? (()=>{const py=Math.max(1,game.age-holding.boughtAge+1),sv=insuranceValue(holding,game.age,marketSignals),paid=holding.premiumsPaid||1,premium=holding.annualPremium||0,irr=policyIrr(premium,paid,py,sv,holding.cumulativeWithdrawals||0),fr=insuranceFulfillment(marketSignals);return <div className="insurance-policy-ui">
                          <div className="insurance-policy-head"><div><strong>{holding.label.split('｜')[0]}</strong><small>保單年度 第 {py} 年 · 供款 {paid}/{holding.premiumTerm} 年</small></div><b>退保價值 NT${roundMoney(sv).toLocaleString('en-US')}</b></div>
                          <div className="insurance-metrics"><div><span>持有張數</span><strong>1 張</strong></div><div><span>累計已繳（不另加回總資產）</span><strong>NT${roundMoney(cumulativePolicyPremiums(holding)).toLocaleString('en-US')}</strong></div><div><span>目前 IRR（近似）</span><strong>{irr==null?'—':(irr*100).toFixed(2)+'%'}</strong></div><div><span>模擬達成率</span><strong>{(fr*100).toFixed(1)}%</strong></div><div><span>供款狀態</span><strong>{paid>=holding.premiumTerm?'已完成':'尚餘 '+(holding.premiumTerm-paid)+' 年'}</strong></div></div>{sv===0&&<p>已持有保單；目前模型退保價值為 0。累計已繳保費僅供契約進度參考，不計入總資產。</p>}
                          <div className="insurance-withdraw"><label className="money-input-wrap"><span>NT$</span><input inputMode="numeric" pattern="[0-9]*" placeholder="單次提取金額" value={insuranceWithdrawals[holding.id]||''} onChange={(e)=>setInsuranceWithdrawals(x=>({...x,[holding.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label><button onClick={()=>withdrawInsurance(holding.id)}>單次提取</button></div>
                          <div className="insurance-plan"><strong>年度提取計畫</strong><label><span>提取方式</span><select value={insuranceWithdrawalModes[holding.id]||holding.withdrawalMode||'fixed'} onChange={e=>setInsuranceWithdrawalModes(x=>({...x,[holding.id]:e.target.value as 'fixed'|'percent'}))}><option value="fixed">每年固定金額</option><option value="percent">每年按總預定保費比例</option></select></label><label><span>開始保單年度</span><input inputMode="numeric" value={insuranceWithdrawalStartYears[holding.id]||holding.withdrawalStartYear||6} onChange={e=>setInsuranceWithdrawalStartYears(x=>({...x,[holding.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label>{(insuranceWithdrawalModes[holding.id]||holding.withdrawalMode||'fixed')==='fixed'?<label><span>每年提取 NT$</span><input inputMode="numeric" value={insuranceWithdrawals[holding.id]||holding.withdrawalAmount||''} onChange={e=>setInsuranceWithdrawals(x=>({...x,[holding.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label>:<label><span>總預定保費比例 %</span><input inputMode="decimal" value={insuranceWithdrawalPercents[holding.id]||holding.withdrawalPercent||''} onChange={e=>setInsuranceWithdrawalPercents(x=>({...x,[holding.id]:e.target.value.replace(/[^0-9.]/g,'')}))}/></label>}<div><button onClick={()=>setInsuranceWithdrawalPlan(holding.id)}>設定年度提取</button>{holding.withdrawalMode&&holding.withdrawalMode!=='none'&&<button onClick={()=>cancelInsuranceWithdrawalPlan(holding.id)}>取消計畫</button>}</div>{holding.withdrawalMode&&holding.withdrawalMode!=='none'&&<small>已啟用：第 {holding.withdrawalStartYear} 年起 · 累計已提取 NT${roundMoney(holding.cumulativeWithdrawals||0).toLocaleString('en-US')}</small>}</div>
                          <small>達成率依市場訊號平滑模擬於 90%～105%，只作用於非保證利益；此區間為 TIME 模型設定。</small>
                        </div>})() : <><div><strong>{holding.label.split('｜')[0]}</strong><small>{holding.boughtAge} 歲購入 · 本金鎖定</small></div><div><b>NT${roundMoney(holding.amount).toLocaleString('en-US')}</b><small>{totalAssets > 0 ? ((holding.amount / totalAssets) * 100).toFixed(1) : '0.0'}% 總資產</small></div></>}
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
                  <div className="history-year-picker"><select aria-label="歷史紀錄年度" value={item.year} onChange={(e)=>setReportOpen(Number(e.target.value))}>{[...game.history].reverse().map((x)=><option key={x.year} value={x.year}>{'第 '+x.year+' 年｜'+x.age+'歲'}</option>)}</select></div>
                  <button className="history-popup-trigger" onClick={()=>setResearchOverlay({key:'history-'+item.year,title:'第 '+item.year+' 年｜'+item.age+'歲',body:<div className="history-popup-body">
                    <div className="history-popup-total"><span>年度總資產</span><strong>NT${roundMoney(item.total).toLocaleString('en-US')}</strong></div>
                    <div className="history-return"><span>年度投資報酬率</span><strong>{item.returnRate == null ? '舊紀錄未保存' : (item.returnRate >= 0 ? '+' : '')+(item.returnRate*100).toFixed(1)+'%'}</strong></div>
                    <div className="history-assets">{p ? Object.entries({現金:p.cash,定存:p.deposit,債券:p.bonds,股票:p.stocks,房地產:p.realEstate,'保單退保價值':p.insurance}).map(([label,value])=><div key={label}><span>{label}</span><strong>NT${roundMoney(value).toLocaleString('en-US')}</strong></div>) : <p>這筆舊紀錄沒有保存各資產餘額；不以目前持倉替代舊年度資料。</p>}</div>
                    <div className="history-actions"><b>保單持有與供款</b>{item.holdingSnapshot ? (()=>{const policies=item.holdingSnapshot.filter(holding=>holding.asset==='insurance');const reportSignals=annualReports.find(report=>report.year===item.year)?.signals;return policies.length?policies.map(policy=>{const value=reportSignals?insuranceValue(policy,item.age+1,reportSignals):null;return <p key={policy.id}>持有 1 張｜{policy.label.split('｜')[0]}｜供款 {policy.premiumsPaid||1}/{policy.premiumTerm} 期｜累計已繳 NT${roundMoney(cumulativePolicyPremiums(policy)).toLocaleString('en-US')}（不另加回總資產）｜退保價值 {value==null?'舊資料缺少估值訊號':`NT$${roundMoney(value).toLocaleString('en-US')}${value===0?'（已持有保單；目前模型退保價值為 0）':''}`}</p>}):<p>該年度沒有保單持倉。</p>})():<p>這筆舊紀錄沒有保存持倉快照；不使用目前持倉猜造歷史。</p>}</div>
                    <div className="history-actions"><b>本年度資產變化</b>{item.changes?.length ? item.changes.map((x,i)=><p key={i}>{x}</p>) : <p>這筆舊紀錄沒有保存資產變化。</p>}</div>
                    <div className="history-actions"><b>資產操作</b>{item.operations?.length ? item.operations.map(operation=><p key={operation.id}>{operation.label}｜{operation.detail}{operation.cashFlow?'｜對應下方現金流':''}</p>) : <p>{item.actions?.length?'這筆舊紀錄只有未分類的操作摘要，無法可靠區分操作與現金流；不猜造分類。':'這個年度沒有可顯示的資產操作。'}</p>}</div>
                    <div className="history-actions"><b>現金流</b>{item.cashFlows?.length ? item.cashFlows.map((flow,i)=><p key={i}>{flow.label}｜{flow.amount>=0?'+':'-'}NT$${roundMoney(Math.abs(flow.amount)).toLocaleString('en-US')}</p>) : <p>這筆舊紀錄沒有保存可核對的現金流；不從目前狀態反推。</p>}</div>
                  </div>})}><span>第 {item.year} 年資產紀錄</span><b>查看詳情 →</b></button>
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
          <div className="panel-header"><h2>債券市場與持倉</h2><span>{bondHoldings.length} 筆</span></div>
          {productCatalog.bonds.map((product)=>{const research=bondResearch(product.id,selectedSignals);return <div className="market-card" key={'market-'+product.id}><div className="market-quote"><div><strong>{product.label.split('｜')[0]}</strong><small>每 100 面額市場報價</small></div><b>{(selectedMarket?.bondPrices[product.id]||100).toFixed(2)}</b></div><div className="research-tabs">
              {[
                ['fundamental','基本面',signalLabel(research.fundamental,'改善','承壓')],
                ['flow','籌碼面',signalLabel(research.flow,'需求偏強','需求偏弱')],
                ['news','消息面',signalLabel(research.news,'偏正面','偏負面')],
                ['rate','利率面',signalLabel(research.rate,'有利','不利')],
              ].map(([key,label,status])=><button key={key} onClick={()=>{
                const bodies:Record<string,React.ReactNode>={
                  fundamental:<><p>景氣成長 {(selectedSignals.growth*100).toFixed(1)}% · 信用利差 {(selectedSignals.creditSpread*100).toFixed(1)}%</p><p>目前景氣與信用環境尚可，信用利差仍在可控範圍。政府債信用風險較低；公司債則需留意企業償債能力是否轉弱。</p></>,
                  flow:<><p>{signalLabel(-selectedSignals.riskAppetite,'避險資金增加','避險資金減少')} · 需求訊號 {research.flow.toFixed(2)}</p><p>目前避險資金需求有限，債券買盤沒有明顯增強。若市場風險升高，高品質政府債可能獲得較多資金支持。</p></>,
                  news:<><p>消息強度 {research.news>=0?'+':''}{research.news.toFixed(2)}</p><p>近期央行、通膨與信用消息整體影響有限。若出現升息、降評級或通膨升溫，債券價格可能面臨較大壓力。</p></>,
                  rate:<><p>政策利率 {(selectedSignals.policyRate*100).toFixed(1)}% · 通膨 {(selectedSignals.inflation*100).toFixed(1)}%</p><p>目前利率水準對既有債券價格形成一定壓力。若利率繼續上升，長天期債券通常會比短天期債券承受更大的價格波動。</p></>
                }; toggleResearch(product.id+'-'+key,label+'詳細資訊',bodies[key]);
              }} className={researchOverlay?.key===product.id+'-'+key?'active':''}><span>{label}</span><b>{status}</b></button>)}
            </div></div>})}
          {bondHoldings.map(h=>{const quote=bondPrices[h.productId]||100;const value=(h.bondUnits||0)*(h.faceValue||10000)*quote/100;return <div className="stock-statement" key={'bond-'+h.id}><div><strong>{h.label.split('｜')[0]}</strong><small>{h.boughtAge}歲買入</small></div><div><span>持有張數</span><b>{h.bondUnits||0}</b></div><div><span>面額</span><b>NT${roundMoney((h.bondUnits||0)*(h.faceValue||10000)).toLocaleString('en-US')}</b></div><div><span>買入價</span><b>{(h.buyPrice||100).toFixed(2)}</b></div><div><span>目前報價</span><b>{quote.toFixed(2)}</b></div><div><span>目前市值</span><b>NT${roundMoney(value).toLocaleString('en-US')}</b></div><div><span>Coupon</span><b>{((h.couponRate||0)*100).toFixed(1)}%</b></div><div><span>剩餘年期</span><b>{Math.max(0,(h.boughtAge+(h.maturityYears||0))-game.age)} 年</b></div><div className="stock-sell-order"><label className="money-input-wrap"><span>賣出張數</span><input inputMode="numeric" pattern="[0-9]*" value={bondTradeUnits['sell-'+h.id]||''} onChange={(e)=>setBondTradeUnits(c=>({...c,['sell-'+h.id]:e.target.value.replace(/[^0-9]/g,'')}))}/></label></div><button className="danger" onClick={()=>sellBond(h.id)}>賣出債券</button></div>})}
          <details id="market-trade-history" className="market-year-trades"><summary><strong>股票／債券交易紀錄</strong><span>{selectedMarketYear===0?'遊戲開始前':`第 ${selectedMarketYear} 年`} · {selectedTrades.length} 筆</span></summary>{selectedTrades.length===0?<p>這個年度沒有股票或債券交易。</p>:<div className="market-trade-scroll">{selectedTrades.map((t,i)=><div className="market-trade-row" key={i}><strong>{t.side}｜{t.label}</strong><span>{t.quantity} {t.asset==='stocks'?'股':'張'} · {t.price.toFixed(2)}</span><em>NT${roundMoney(t.amount).toLocaleString('en-US')}</em></div>)}</div>}</details>
          <div className="panel-header"><h2>房地產市場與我的房產</h2><span>{propertyHoldings.length} 間持有</span></div>
          {propertyListings.map(p=><div className="market-card" key={"market-"+p.id}><div className="market-quote"><div><strong>{p.name}</strong><small>{p.district} · {p.ping.toFixed(1)} 坪</small></div><b>NT${(p.price/10000).toFixed(0)}萬</b></div><p>每坪 NT${roundMoney(p.price/p.ping).toLocaleString("en-US")} · 頭期 NT${roundMoney(p.price*p.downPaymentRate).toLocaleString("en-US")} · 房貸 {(p.mortgageRate*100).toFixed(2)}%</p><p>人口 {p.populationTrend>=0?"↑":"↓"} · 出生率 {(p.birthRate*100).toFixed(2)}% · 買氣 {p.demand>.8?"強":p.demand>.68?"中等":"偏弱"} · 市場租金約 NT${p.marketRent.toLocaleString("en-US")}/月</p></div>)}
          {propertyHoldings.map(p=>{const equity=p.currentValue-p.mortgageBalance;return <div className="stock-statement" key={"owned-"+p.id}><div><strong>{p.name}</strong><small>{p.district} · {p.ping.toFixed(1)}坪 · {p.boughtAge}歲購入</small></div><div><span>目前估值</span><b>NT${roundMoney(p.currentValue).toLocaleString("en-US")}</b></div><div><span>剩餘房貸</span><b>NT${roundMoney(p.mortgageBalance).toLocaleString("en-US")}</b></div><div><span>房屋淨值</span><b>NT${roundMoney(equity).toLocaleString("en-US")}</b></div><div><span>上年度出租結果</span><b>{p.rentalMode==="rent"?p.lastRentedMonths+"/12 個月":"未出租"}</b><small>{p.lastRentalIncome>0?"租金 NT$"+roundMoney(p.lastRentalIncome).toLocaleString("en-US")+" 已回到現金":""}</small></div><div className="stock-sell-order"><label className="money-input-wrap"><span>月租</span><input inputMode="numeric" value={rentInputs[p.id]??String(roundMoney(p.monthlyRent))} onChange={e=>setRentInputs(x=>({...x,[p.id]:e.target.value.replace(/[^0-9]/g,"")}))}/></label><small>市場行情約 NT${p.marketRent.toLocaleString("en-US")}/月</small></div><button onClick={()=>setPropertyRental(p.id,"rent")}>設定出租</button><button onClick={()=>setPropertyRental(p.id,"vacant")}>暫不出租</button><button className="danger" onClick={()=>sellProperty(p.id)}>出售房產</button></div>})}
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
