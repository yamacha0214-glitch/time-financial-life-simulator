# TIME — Product Spec / North Star

> **Core principle:** 人生是主體，金融是物理引擎。
>
> **Premise:** 把現實的 40 年，濃縮成一場人生實驗。
>
> **Core question:** 如果時間本身也是一種金融資源，你會怎麼使用它？

## 1. Product identity

TIME is not a financial calculator and not an investment quiz. It is a **life simulation game powered by a realistic financial engine**.

The player should keep advancing because they want to know:

> 「如果這樣活下去，我的人生會變成什麼樣子？」

A choice may look reasonable today and reveal its cost ten years later. The game should show consequences rather than tell the player what the “correct” life is.

### Non-goals
- Do not optimize the whole game around maximum net worth.
- Do not reduce life choices to simplistic happiness/safety scores.
- Do not grade a life S/A/B/C.
- Do not make investment returns deterministic from visible signals.
- Do not turn TIME into a super spreadsheet.

## 2. Core loop

**LIFE → CHOICE → CASH FLOW / FINANCIAL CONSEQUENCE → TIME → NEW LIFE CHOICE**

Money can compound. Time can only be consumed.

Players may work, change jobs, quit, start a business, invest, buy or rent a home, build relationships, consume, travel, pursue wishes, or choose not to invest at all.

Example: spending money to see the aurora is not a “bad financial choice”. TIME should preserve the memory, calculate the real opportunity cost, and let the player decide what that life meant.

## 3. Life setup

TIME must not decide every player’s starting point or ending point.

### Entry modes
1. **快速開始** — current prototype/demo scenario.
2. **建立人生** — customize age, assets, liabilities, income, expenses and horizon.
3. **模擬我的現在** — enter a real current financial situation and compare alternate futures.

### Configurable inputs
- Current age
- End age, simulation years, goal-based ending, or no fixed ending
- Cash
- Existing assets
- Existing liabilities
- Job / income
- Fixed and life-generated expenses
- Existing property, investments and policies

The current 25-year-old / NT$1,000,000 / annual NT$300,000 added-capital model is a **prototype Quick Start scenario**, not the final universal rule.

## 4. Life engine

Income and expenses return as consequences of life, not disconnected +/− fields.

Examples:
- career → salary / bonus / unemployment
- housing → rent / mortgage
- family → recurring obligations
- travel → spending and irreversible memories
- entrepreneurship → capital needs and uncertain cash flow

The intended causal chain is:

**人生選擇 → Cash Flow → 金融選擇**

## 5. Story engine

TIME should evolve toward a visual-novel / Galgame-like structure without requiring a GTA-scale 3D world.

### Narrative form
**Scene → dialogue → choice → consequence**

Characters can differ in values, ambitions, risk tolerance and attitudes toward money. No character is the “correct” route.

Potential hubs:
- Home / Life
- Career
- Financial District
- Real Estate
- World / Travel
- Relationships

## 6. Memory and irreversible time

Do not convert meaningful life experiences into crude points such as “Aurora +20 happiness”.

Maintain a **Memory / Life Timeline** containing irreversible experiences, relationships, decisions and major events.

A future Decision Journal may record why a player made a decision and surface that reason years later beside the actual outcome.

## 7. Game systems

### World / black-swan events
Events should change the market regime rather than simply display “stocks −20%”.

A crisis can simultaneously affect:
- equity prices
- credit spreads
- policy rates
- property liquidity
- rental demand
- participating-policy non-guaranteed outcomes
- the value of holding cash

Crisis timing should not be memorisable.

### Personal events
Personal events can be opportunities as well as losses: overseas work, a startup, a family need, travel, a relationship decision, etc.

### Narrative pacing
Possible chapter structure:
- ACT I 起點
- ACT II 累積
- ACT III 風暴
- ACT IV 時間的力量
- FINAL

These are pacing devices, not fixed market-event dates.

## 8. Player goals and ending

TIME should support different definitions of a meaningful life: wealth, freedom, experiences, family, career, adventure, or combinations the game does not pre-judge.

Do not output a single life score.

The final **YOUR TIME** report can show:
- days worked
- lifetime income and consumption
- investment return
- age of financial freedom
- travel / countries
- wishes completed
- important relationships and memories
- crises survived
- forced sales
- major decisions

Then ask: **再活一次？**

## 9. Information complexity

The same simulation engine should power all modes. Difficulty changes **information visibility**, not the underlying reality.

### 金融小白
Human-language explanations; hide unnecessary market dimensions; teach contextually.

### 金融中人
Current V2-level information: fundamentals, flows, news, technical context, rates, inflation, yields, IRR, property equity and fulfilment ratio.

### 金融達人
Rawer information: K-line/candlesticks, volume, EPS growth, valuation, flows, volatility, yield curve, duration, credit spreads, detailed property data, GCV/NGV/fulfilment/IRR. Avoid direct “bullish/bearish” answers.

## 10. Financial physics engine

The engine remains rigorous even when the front end becomes narrative.

### Cash / deposits
Terms, rates, maturity, early termination, liquidity and inflation erosion.

### Stocks / ETFs
Shares × price, average cost, market value, realised/unrealised P&L, dividends, ex-dividend adjustment, market cycles.

### Bonds
Face value, coupon, price/yield/duration, maturity, rate risk, credit risk, spreads and secondary sale.

### Real estate
Purchase price, down payment, mortgage principal/interest, property value, rent, vacancy, regional supply/demand and equity.

### Participating insurance
Premium schedule, GCV, non-guaranteed value, annual/reversionary bonus concepts, terminal bonus, fulfilment ratio, smoothing, withdrawals, surrender and IRR. Mandatory premiums must be able to create a genuine liquidity crisis.

## 11. Review and learning

Annual review should explain:
**beginning value → trades → market/value change → cash flow → ending value → total return**

Opportunity-cost comparisons may show counterfactuals such as aurora trip vs ETF, but must not moralize.

## 12. UI / art direction

Current blue V2 UI is a prototype, not final art.

Long-term direction:
**financial terminal × life simulation × visual novel**

The asset dashboard remains useful, but becomes one subsystem of the player’s life rather than the whole game.

## 13. Roadmap

1. **PHASE 1 — FINANCIAL ENGINE** ← current
2. **PHASE 2 — LIFE ENGINE**
3. **PHASE 3 — STORY ENGINE**
4. **PHASE 4 — GAME SYSTEM**
5. **PHASE 5 — PLAYER MODES**
6. **PHASE 6 — TIME 2.0 UI**

Do not prematurely rewrite the working financial engine to add narrative. Stabilize the physics first, then layer life and story on top.

## 14. North-Star review for every feature

Before implementation:
1. Does this support **人生是主體，金融是物理引擎**?
2. Which roadmap phase does it belong to?
3. Does it advance TIME, or pull it back toward a financial calculator?

After implementation:
1. Did the implementation preserve real financial causality?
2. Did it accidentally introduce a “correct life”?
3. Did it increase entertainment / life consequence rather than merely add more numbers?
4. Does this Product Spec need to change because the product itself evolved?

This document is a North Star, not an immutable specification. If a better idea materially changes TIME, update this document deliberately rather than silently drifting.
