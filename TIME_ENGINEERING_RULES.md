# TIME — Engineering Rules

This file is the handoff contract for Codex or any coding agent working on TIME.

Read **TIME_PRODUCT_SPEC.md** and **V2_DESIGN.md** before substantial changes.

## 1. Repository workflow

- Repository: `yamacha0214-glitch/time-financial-life-simulator`
- Production branch: `main` (V1)
- Development branch: `time-v2`
- Do not implement V2 features on `main`.
- Keep V1 production stable unless explicitly instructed otherwise.
- Vercel Preview is downstream validation, **not the primary test runner**.

### Preferred implementation loop

**Understand requirement → inspect relevant code → implement coherent change → local build/test → review diff → fix → commit/push once → Vercel Preview → player test**

Avoid one commit/deployment per tiny edit when multiple related fixes can be validated locally first.

Documentation-only changes should not require a deployment when deployment-ignore rules are available.

## 2. Product invariants

- **人生是主體，金融是物理引擎。**
- TIME is not a financial calculator.
- Existing holdings persist; never silently rebalance them.
- Cash is the directly spendable balance.
- Buying a product creates a holding/contract.
- Product principal cannot be magically edited after purchase.
- Selling, terminating or surrendering must be explicit.
- Product cash flows return to cash.
- Maturity returns contractual principal/value to cash and removes the current holding while history remains.
- High net worth must not imply high liquidity.
- Visible information should influence probability distributions, not reveal deterministic future outcomes.
- Never leak future market information into earlier years.

## 3. Current accounting model

Core V2 loop:

**CASH FLOW → DECISION → TIME**

Long-term product loop:

**LIFE → CHOICE → CASH FLOW / FINANCIAL CONSEQUENCE → TIME → NEW LIFE CHOICE**

The current automatic NT$300,000 annual added capital is a temporary prototype mechanism for testing larger purchases. Do not hard-code it deeper into future architecture; Life Engine will eventually replace it with jobs/income/expenses.

## 4. Holdings are the intended source of truth

The code currently contains hybrid aggregate portfolio + product-holding accounting. This can drift.

Direction:
- `productHoldings` / product-specific holdings should become the authoritative asset state.
- Aggregate asset totals should be derived from holdings plus cash where possible.
- Do not add new features that deepen duplicated accounting unless unavoidable.
- When touching buy/sell logic, check cost basis, market value, realised P&L and cash separately.

Known risk: stock/bond/property/insurance aggregate values can diverge from holdings if mutations update only one side.

## 5. Time and causality

Each simulated year must settle predictably and atomically.

Target annual structure:
1. Establish state entering the year.
2. Resolve contractual cash flows due at the correct time.
3. Allow/resolve player decisions using available information and cash.
4. Resolve market/life outcomes without future leakage.
5. Update holdings and cash once.
6. Create immutable annual report/history snapshot.
7. Advance age/year.

Do not use render-time randomness for persistent market information. Random outcomes/signals used for a year/product must be generated once and persisted.

## 6. Asset rules

### Cash
- Immediately spendable.
- Inflation reduces real purchasing power, not nominal cash directly.

### Deposits
- Discrete contract with principal, rate and maturity.
- At maturity, principal + interest return to cash.
- Early termination must have an explicit consequence.

### Stocks / ETFs
- Integer shares.
- Market value = shares × current price.
- Track average cost, realised and unrealised P&L.
- Dividends flow to cash.
- Distribution/ex-dividend mechanics should reduce price/NAV consistently.
- Partial sales must not subtract sale proceeds as if they were cost basis.

### Bonds
- Track units/face value, coupon, price, yield/rate sensitivity, duration and maturity.
- Coupons flow to cash.
- Maturity returns face value.
- Early sale uses current market price.
- Credit spread matters for corporate bonds.

### Real estate
- Track purchase price/current value, down payment, mortgage balance, principal/interest and equity.
- Rent flows to cash.
- Vacancy should follow simulation logic rather than guaranteed income.
- Keep current scope simple unless the Product Spec explicitly expands taxes/maintenance/default/refinancing.

### Participating insurance
- Premium amount entered at purchase defines the recurring contractual premium for the premium term.
- Example: a 5-pay policy creates five equal scheduled annual premiums.
- Do not model the policy as a simple annual-return bucket.
- Track policy year, premiums paid, GCV/non-guaranteed value concepts, surrender value, fulfilment, smoothing, withdrawals and IRR.
- Early surrender may be far below cumulative premiums.
- Non-guaranteed outcomes may respond to market/participating-fund conditions.
- Current TIME fulfilment simulation band of **90%–105% is a model assumption**, not a claim that HK regulatory guidance mandates that range.
- If a mandatory premium is due and cash is insufficient, the final design must create a real liquidity decision (sell/terminate/raise cash), not silently pay it.
- Withdrawal IRR should eventually use actual policy-year withdrawal cash-flow timing rather than treating all historical withdrawals as occurring at the valuation date.

## 7. Market information

Current `MarketSignals` dimensions include growth, inflation, policy rate, risk appetite, earnings, flows, news and credit spread.

Rules:
- Product-specific research may be noisy.
- Research is evidence, not an answer key.
- Persist annual/product research instead of regenerating on render.
- Market-year inspection must never expose future data.
- Chart period controls must end at the selected inspection year.

Future information complexity:
- Beginner hides unnecessary raw dimensions.
- Intermediate exposes interpreted financial information.
- Expert exposes rawer data and removes direct directional labels.

## 8. History and reports

History must be annual, not accidentally cumulative.

Each year should preserve:
- year / age
- beginning and ending asset state
- per-asset changes
- product cash flows
- trades/actions from that year only
- return measure
- important market/life events

Old localStorage saves may lack newer fields. Maintain reasonable backward compatibility or migrate intentionally.

## 9. Persistence

Known V2 storage:
- game: `time-financial-life-simulator-v2`
- holdings: `time-financial-life-simulator-v2-holdings`

Do not casually rename storage keys or invalidate saves. If schema changes materially, implement migration/versioning.

## 10. Current technical debt / priorities

Before large narrative expansion, prioritize:
1. Refactor the simulation/year-advance engine into atomic predictable settlement.
2. Make holdings the single source of truth; derive aggregates.
3. Persist market information per year/product; eliminate persistent render randomness.
4. Enforce temporal causality/no future leakage.
5. Store insurance withdrawals with policy-year timing and calculate exact IRR.
6. Deepen annual reports per product.
7. Verify dividend distribution/ex-dividend price adjustment.
8. Complete interactive insurance Liquidity Crisis flow.
9. Improve bond history/reporting.
10. Review chart scaling and real-estate pacing.

Do not start a large 3D/open-world rewrite. The intended future narrative architecture is scene/hub/visual-novel based.

## 11. Testing requirements

Before pushing an implementation commit:
- Run the project build (currently expected: `npm run build`).
- Run available tests/lint/type checks if configured.
- Fix TypeScript/build errors before push.
- Inspect the diff for unrelated changes.
- For accounting changes, manually test at least: purchase → year advance → cash flow → partial/complete exit or maturity.
- For time-dependent changes, test multiple years.
- For insurance changes, test premium years, post-premium years, surrender, withdrawals and insufficient cash.
- For mobile UI changes, check narrow viewport behavior.

Do not use Vercel as the first place to discover a basic compile error.

## 12. Change discipline

Before coding, state internally:
- requirement
- affected subsystem
- financial invariants
- acceptance criteria

After coding:
- compare against `TIME_PRODUCT_SPEC.md`
- note any Product Spec change that is genuinely required
- report what changed, what was tested, and any known limitation

Prefer one coherent commit for one coherent feature/fix.

## 13. Current implementation status

Financial Engine prototype already includes:
- cash
- deposits with maturity
- stock/ETF holdings and trading
- bonds/coupons/maturity
- property/mortgage/rent
- participating-policy holdings
- annual market signals/research
- annual history/report UI
- policy surrender value / fulfilment / IRR display
- single and scheduled insurance withdrawal UI
- localStorage persistence

The UI is still a prototype. Do not mistake polishing the current dashboard for completion of the TIME product.

## 14. Immediate handoff checkpoint

At the time this file was introduced, the most recent work was mobile UI normalization for participating-policy annual withdrawal controls. The next engineering session should first verify the latest `time-v2` state and Preview before assuming that UI is deployed.

The product remains in **PHASE 1 — FINANCIAL ENGINE**.
