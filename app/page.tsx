'use client';

import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'time-financial-life-simulator-v1';
const ASSET_KEYS = ['cash', 'deposit', 'bonds', 'stocks', 'realEstate', 'insurance'] as const;
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
  cash: 250000,
  deposit: 200000,
  bonds: 150000,
  stocks: 200000,
  realEstate: 150000,
  insurance: 50000,
};

const START_ALLOCATIONS: Allocation = {
  cash: 25,
  deposit: 20,
  bonds: 15,
  stocks: 20,
  realEstate: 15,
  insurance: 5,
};

const ASSET_META: Record<AssetKey, { label: string; short: string; liquidity: number }> = {
  cash: { label: '現金', short: 'Cash', liquidity: 1 },
  deposit: { label: '定存', short: 'Deposit', liquidity: 0.95 },
  bonds: { label: '債券', short: 'Bonds', liquidity: 0.8 },
  stocks: { label: '股票', short: 'Stocks', liquidity: 0.7 },
  realEstate: { label: '房地產', short: 'Real Estate', liquidity: 0.35 },
  insurance: { label: '長期保險', short: 'Insurance', liquidity: 0.2 },
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
  income: getAnnualIncome(25),
  expense: getAnnualExpense(25),
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

  useEffect(() => {
    setIsMounted(true);
    const saved = asyncLoadGame();
    if (saved) {
      setGame({ ...saved, pendingChoice: null, completed: false });
    }
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  }, [game, isMounted]);

  const totalAssets = useMemo(() => sumPortfolio(game.portfolio), [game.portfolio]);
  const realWeight = useMemo(() => getRealWealth(totalAssets, game.cumulativeInflation), [totalAssets, game.cumulativeInflation]);
  const liquidity = useMemo(() => getLiquidity(game.portfolio), [game.portfolio]);
  const allocationList = useMemo(() => ASSET_KEYS.map((asset) => ({ asset, percentage: game.allocations[asset], amount: totalAssets * (game.allocations[asset] / 100) })), [game.allocations, totalAssets]);

  const updateAllocation = (asset: AssetKey, delta: number) => {
    if (game.completed) return;
    setGame((current) => {
      const next = normalizeAllocations({
        ...current.allocations,
        [asset]: clamp(current.allocations[asset] + delta, 0, 100),
      });

      const otherKeys = ASSET_KEYS.filter((key) => key !== asset);
      const currentTotal = otherKeys.reduce((sum, key) => sum + next[key], 0);
      if (currentTotal <= 0) {
        return current;
      }

      const adjusted = { ...next };
      const remaining = 100 - next[asset];
      const otherTotal = otherKeys.reduce((sum, key) => sum + next[key], 0);
      otherKeys.forEach((key) => {
        adjusted[key] = (next[key] / otherTotal) * remaining;
      });
      adjusted[asset] = clamp(next[asset], 0, 100);

      const rounded = { ...adjusted } as Allocation;
      const totalPercent = ASSET_KEYS.reduce((sum, key) => sum + rounded[key], 0);
      const diff = 100 - totalPercent;
      if (Math.abs(diff) > 0.01) {
        rounded.cash += diff;
      }

      return { ...current, allocations: normalizeAllocations(rounded) };
    });
  };

  const handleRestart = () => {
    const fresh = buildInitialState();
    setGame(fresh);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    }
  };

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
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

    setGame((current) => {
      const totalBefore = sumPortfolio(current.portfolio);
      const rebalanced = getAssetValueByAllocation(totalBefore, current.allocations);

      const inflationRate = clamp(0.018 + Math.random() * 0.06, 0.01, 0.08);
      const marketEvent = randomFrom(MARKET_EVENTS);
      const lifeEvent = randomFrom(LIFE_EVENTS);
      const annualIncome = getAnnualIncome(current.age + 1);
      const annualExpense = getAnnualExpense(current.age + 1);

      const baseReturns: Record<AssetKey, number> = {
        cash: 0.014 + inflationRate * 0.2,
        deposit: 0.025 + (Math.random() * 0.04),
        bonds: 0.03 + (Math.random() * 0.04),
        stocks: 0.08 + (Math.random() * 0.12),
        realEstate: 0.045 + (Math.random() * 0.09),
        insurance: 0.038 + (Math.random() * 0.05),
      };

      let assetsAfterMarket: Portfolio = { ...rebalanced };
      ASSET_KEYS.forEach((key) => {
        const modifier = marketEvent.effect[key] ?? 0;
        assetsAfterMarket[key] = rebalanced[key] * (1 + baseReturns[key] + modifier);
      });

      let nextPortfolio = { ...assetsAfterMarket };
      let nextIncome = annualIncome;
      let nextExpense = annualExpense;
      let nextLifeStatus = `${current.lifeStatus}`;
      let nextEventHistory = [...current.eventHistory, `${marketEvent.title}: ${marketEvent.blurb}`];
      let nextAnalysis = current.analysis;

      // Salary and ordinary living costs matter every year, not only event years.
      nextPortfolio.cash += Math.max(nextIncome - nextExpense, 0);
      if (nextExpense > nextIncome) {
        nextPortfolio = applyForcedSale(nextPortfolio, nextExpense - nextIncome, 'cash');
      }

      const eventCost = lifeEvent.expense ?? 0;

      if (lifeEvent.expense && !lifeEvent.requiredChoice) {
        const canCover = getLiquidity(nextPortfolio) >= eventCost;
        if (canCover) {
          const fromCash = Math.min(nextPortfolio.cash, eventCost);
          nextPortfolio.cash -= fromCash;
          const shortfall = eventCost - fromCash;
          if (shortfall > 0) {
            nextPortfolio = applyForcedSale(nextPortfolio, shortfall, 'cash');
          }
          nextLifeStatus = `${lifeEvent.title}：支出 NT${roundMoney(eventCost).toLocaleString('en-US')}。`;
          nextAnalysis = `${lifeEvent.title}讓你更直覺理解現金流與人生事件的優先順序。`;
        } else {
          nextPortfolio = applyForcedSale(nextPortfolio, eventCost, 'cash');
          nextLifeStatus = `${lifeEvent.title}：你的生活計畫被迫壓縮，流動性問題被立即放大。`;
          nextAnalysis = '你在沒有足夠現金時被迫變賣資產，這正是 Liquidity Risk 的直接體驗。';
          nextEventHistory.push('流動性危機：你不得不變賣資產以支付人生開支。');
        }
      }

      if (lifeEvent.expense && lifeEvent.requiredChoice) {
        const pendingChoice: PendingChoice = {
          title: lifeEvent.title,
          description: lifeEvent.description,
          amount: eventCost,
          choices: lifeEvent.choices || [],
        };

        return {
          ...current,
          age: current.age + 1,
          year: current.year + 1,
          income: nextIncome,
          expense: nextExpense,
          lifeStatus: `${lifeEvent.title}：需要你做出資產處置選擇。`,
          inflationRate,
          cumulativeInflation: (1 + current.cumulativeInflation) * (1 + inflationRate) - 1,
          marketEvent,
          lastLifeEvent: lifeEvent,
          pendingChoice,
          portfolio: nextPortfolio,
          eventHistory: nextEventHistory,
          analysis: nextAnalysis,
          timeMachineUnlocked: current.timeMachineUnlocked || (current.age >= 35 && current.allocations.insurance >= 10),
        };
      }

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
        income: nextIncome,
        expense: nextExpense,
        lifeStatus: nextLifeStatus,
        inflationRate,
        cumulativeInflation: (1 + current.cumulativeInflation) * (1 + inflationRate) - 1,
        eventHistory: nextEventHistory,
        history: newHistory,
        marketEvent,
        lastLifeEvent: lifeEvent,
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

  const canAdvance = !game.pendingChoice && !game.completed;

  return (
    <main className="page-shell">
      <div className="app-wrap">
        <header className="topbar">
          <div>
            <div className="eyebrow">TIME</div>
            <h1>金融人生模擬器</h1>
          </div>
          <div className="header-actions">
            <button onClick={handleSave}>Save Game</button>
            <button onClick={handleContinue}>Continue Game</button>
            <button className="danger" onClick={handleRestart}>Restart</button>
          </div>
        </header>

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
            <span>今年收入</span>
            <strong>NT${roundMoney(game.income).toLocaleString('en-US')}</strong>
          </div>
          <div className="stat-card">
            <span>今年支出</span>
            <strong>NT${roundMoney(game.expense).toLocaleString('en-US')}</strong>
          </div>
          <div className="stat-card status">
            <span>人生狀態</span>
            <strong>{game.lifeStatus}</strong>
          </div>
        </section>

        <section className="layout">
          <div className="panel allocations-panel">
            <div className="panel-header">
              <h2>資產配置</h2>
              <span>總配置必須 100%</span>
            </div>
            {allocationList.map(({ asset, percentage, amount }) => (
              <div key={asset} className="allocation-row">
                <div className="asset-title-wrap">
                  <div className="asset-name">{ASSET_META[asset].label}</div>
                  <div className="asset-subtitle">{ASSET_META[asset].short}</div>
                </div>

                <div className="control-box">
                  <button onClick={() => updateAllocation(asset, -5)} aria-label={`Decrease ${ASSET_META[asset].label}`}>
                    −5%
                  </button>
                  <div className="value-box">
                    <strong>{percentage.toFixed(0)}%</strong>
                    <span>≈ NT${roundMoney(amount).toLocaleString('en-US')}</span>
                  </div>
                  <button onClick={() => updateAllocation(asset, 5)} aria-label={`Increase ${ASSET_META[asset].label}`}>
                    +5%
                  </button>
                </div>
              </div>
            ))}

            <div className="cta-row">
              <button className="primary" disabled={!canAdvance} onClick={advanceYear}>
                度過這一年 →
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

        {game.pendingChoice && (
          <div className="modal-overlay">
            <div className="modal-card">
              <div className="eyebrow">重大人生事件</div>
              <h2>{game.pendingChoice.title}</h2>
              <p>{game.pendingChoice.description}</p>
              <div className="modal-amount">需要：NT${roundMoney(game.pendingChoice.amount).toLocaleString('en-US')}</div>
              <div className="choice-list">
                {game.pendingChoice.choices.map((choice) => (
                  <button key={choice.label} onClick={() => resolveChoice(choice.action)}>
                    <span>{choice.label}</span>
                    <small>{choice.note}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

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
