# TIME V2 — Financial Life Simulator

## Core loop
CASH FLOW → DECISION → TIME

## Accounting model
Separate cash flow, assets, liabilities, and contracts. Existing holdings persist across years and are not silently rebalanced.

## Asset rules
- Cash: immediately spendable; exposed to inflation.
- Deposit: principal, rate, maturity, early-withdrawal consequence.
- Stocks/ETF: purchase cost, market value, explicit buy/sell.
- Bonds: principal/market value, coupon/maturity, interest-rate price sensitivity.
- Real estate: property value, down payment, mortgage balance/payment, rent, transaction costs.
- Participating policy: premium schedule, guaranteed/non-guaranteed values, low early liquidity, long-term horizon.

## Annual sequence
1. CASH FLOW: salary, rent and other income; living costs, mortgage, premiums and recurring expenses.
2. DECISION: player can only deploy available cash or explicitly sell/terminate holdings.
3. TIME: market returns, rates, inflation, property prices, policy values and life events resolve.

## Educational target
Create situations where net worth can be high while immediately available cash is low. Liquidity crises should arise from actual balance-sheet constraints rather than an abstract liquidity score.

## TIME MACHINE
Later chapter shifts the same insight to an insurer balance sheet: long-dated liabilities, ALM, duration, liquidity premium, participating fund, smoothing and capital constraints.
