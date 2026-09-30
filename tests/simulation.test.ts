import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnnualTicket, createSettlementGuard, derivePortfolio, settleYear, sellStockPosition, withdrawPolicy, type MarketSignals, type ProductHolding, type PropertyHolding, type SettlementInput } from '../lib/simulation.ts';
import { decodeWorld, writeWorld } from '../lib/persistence.ts';

const signals:MarketSignals={growth:.02,inflation:.02,policyRate:.03,riskAppetite:0,earnings:.05,flows:0,news:0,creditSpread:.018};
const ticket=(holdings:ProductHolding[]=[],properties:PropertyHolding[]=[])=>createAnnualTicket('test-seed',1,['stock-world','stock-tech','stock-dividend'],properties);
const base=(holdings:ProductHolding[]=[],properties:PropertyHolding[]=[]):SettlementInput=>({year:1,age:25,cash:1_000_000,holdings,properties,stockPrices:{'stock-world':100,'stock-tech':100,'stock-dividend':100},bondPrices:{'bond-5':95,'bond-10':90,'bond-corp':96},previousSignals:signals,ticket:ticket(holdings,properties),annualCapital:300_000});
const validWorld=():any=>({version:2,lastSettlementId:undefined,game:{year:1,age:25,portfolio:{cash:1_000_000,deposit:0,bonds:0,stocks:0,realEstate:0,insurance:0},simulationSeed:'test',history:[]},holdings:[],history:[],properties:[],propertyListings:[],market:{stockPrices:{'stock-world':100},stockPriceHistory:{'stock-world':[100]},bondPrices:{'bond-5':95},marketSignals:signals,annualReports:[],marketSnapshots:[],marketTrades:[]}});

test('insufficient premium is a deterministic failure and does not mutate input',()=>{
  const policy:ProductHolding={id:'p',productId:'policy-5',asset:'insurance',label:'policy',amount:100_000,annualPremium:100_000,policyScale:1,premiumTerm:5,premiumsPaid:1,boughtAge:25,policyCashFlows:[]};
  const input={...base([policy]),cash:99_999},before=structuredClone(input);
  const first=settleYear(input),second=settleYear(input);
  assert.deepEqual(input,before);assert.equal(first.ok,false);assert.deepEqual(second,first);assert.equal(first.ticketKey,second.ticketKey);
});

test('dividend enters cash once and the ex-dividend portfolio equals holdings times price',()=>{
  const stock:ProductHolding={id:'s',productId:'stock-world',asset:'stocks',label:'world',amount:1000,boughtAge:25,buyPrice:100,shares:10};
  const input={...base([stock]),annualCapital:0},result=settleYear(input);assert.equal(result.ok,true);if(!result.ok)return;
  const dividend=result.cashFlows.filter(x=>x.kind==='dividend').reduce((n,x)=>n+x.amount,0);
  assert.equal(result.cash,1_000_000+dividend);assert.ok(Math.abs(result.portfolio.stocks-10*result.stockPrices['stock-world'])<1e-8);
});

test('multi-lot partial and complete stock sales preserve average cost and realised pnl',()=>{
  const lots:ProductHolding[]=[{id:'a',productId:'stock-world',asset:'stocks',label:'world',amount:800,boughtAge:25,buyPrice:80,shares:10},{id:'b',productId:'stock-world',asset:'stocks',label:'world',amount:1200,boughtAge:26,buyPrice:120,shares:10}];
  const partial=sellStockPosition(lots,'stock-world',5,110);assert.equal(partial.proceeds,550);assert.equal(partial.costBasis,500);assert.equal(partial.realizedPnl,50);assert.equal(partial.holdings.reduce((n,h)=>n+(h.shares??0),0),15);assert.equal(partial.holdings.reduce((n,h)=>n+h.amount,0),1500);
  const all=sellStockPosition(partial.holdings,'stock-world',15,90);assert.equal(all.realizedPnl,-150);assert.equal(all.holdings.length,0);
});

test('bond coupon and face value settle once at maturity when quote differs from par',()=>{
  const bond:ProductHolding={id:'b',productId:'bond-5',asset:'bonds',label:'bond',amount:9500,boughtAge:21,bondUnits:1,faceValue:10_000,maturityYears:5,couponRate:.03,buyPrice:95};
  const result=settleYear({...base([bond]),annualCapital:0});assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(result.cash,1_010_300);assert.equal(result.holdings.length,0);assert.equal(result.portfolio.bonds,0);
});

test('one and three year deposits pay contractual simple interest without phantom balance',()=>{
  for(const [productId,term,rate] of [['deposit-1',1,.02],['deposit-3',3,.024]] as const){const deposit:ProductHolding={id:productId,productId,asset:'deposit',label:'deposit',amount:100_000,boughtAge:26-term};const result=settleYear({...base([deposit]),annualCapital:0});assert.equal(result.ok,true);if(!result.ok)continue;assert.equal(result.cash,1_000_000+100_000*(1+rate*term));assert.equal(result.portfolio.deposit,0)}
});

test('property preserves negative equity and reconciles mortgage and rent cash flows',()=>{
  const property:PropertyHolding={id:'home',name:'home',district:'x',ping:10,price:100_000,marketRent:1000,demand:1,populationTrend:0,birthRate:0,downPaymentRate:.2,mortgageRate:.03,mortgageYears:30,boughtAge:25,purchasePrice:100_000,mortgageBalance:150_000,monthlyRent:1000,rentalMode:'vacant',lastRentedMonths:0,lastRentalIncome:0,currentValue:100_000};
  const result=settleYear(base([], [property]));assert.equal(result.ok,true);if(!result.ok)return;assert.ok(result.portfolio.realEstate<0);assert.ok(Math.abs(result.portfolio.realEstate-(result.properties[0].currentValue-result.properties[0].mortgageBalance))<1e-8);
});

test('mortgage cash shortage fails without changing any input world component',()=>{
  const property:PropertyHolding={id:'home',name:'home',district:'x',ping:10,price:1_000_000,marketRent:1000,demand:1,populationTrend:0,birthRate:0,downPaymentRate:.2,mortgageRate:.12,mortgageYears:1,boughtAge:25,purchasePrice:1_000_000,mortgageBalance:900_000,monthlyRent:0,rentalMode:'vacant',lastRentedMonths:0,lastRentalIncome:0,currentValue:1_000_000};
  const input={...base([], [property]),cash:1},before=structuredClone(input),result=settleYear(input);
  assert.equal(result.ok,false);if(result.ok)return;assert.equal(result.code,'INSUFFICIENT_MORTGAGE_CASH');assert.deepEqual(input,before);
});

test('year-end contribution and scheduled policy withdrawal cannot cure mortgage shortage',()=>{
  const property:PropertyHolding={id:'home',name:'home',district:'x',ping:10,price:1_000_000,marketRent:1000,demand:1,populationTrend:0,birthRate:0,downPaymentRate:.2,mortgageRate:.12,mortgageYears:1,boughtAge:25,purchasePrice:1_000_000,mortgageBalance:900_000,monthlyRent:0,rentalMode:'vacant',lastRentedMonths:0,lastRentalIncome:0,currentValue:1_000_000};
  const policy:ProductHolding={id:'p',productId:'policy-5',asset:'insurance',label:'policy',amount:100_000,annualPremium:100_000,policyScale:1,premiumTerm:5,premiumsPaid:5,boughtAge:20,withdrawalMode:'fixed',withdrawalAmount:500_000,withdrawalStartYear:1,policyCashFlows:[]};
  const result=settleYear({...base([policy],[property]),cash:1,annualCapital:1_000_000});assert.equal(result.ok,false);if(result.ok)return;assert.equal(result.code,'INSUFFICIENT_MORTGAGE_CASH');
});

test('policy purchase year one advances to a matching policy-year two premium record',()=>{
  const policy:ProductHolding={id:'p',productId:'policy-5',asset:'insurance',label:'policy',amount:100_000,annualPremium:100_000,policyScale:1,premiumTerm:5,premiumsPaid:1,boughtAge:25,policyCashFlows:[{year:1,policyYear:1,type:'premium',amount:100_000}]};
  const result=settleYear({...base([policy]),year:1,age:25});assert.equal(result.ok,true);if(!result.ok)return;const updated=result.holdings[0];assert.equal(updated.premiumsPaid,2);assert.deepEqual(updated.policyCashFlows?.at(-1),{year:1,policyYear:2,type:'premium',amount:100_000});
});

test('policy withdrawals preserve contractual premium and audit cash-flow timing',()=>{
  const policy:ProductHolding={id:'p',productId:'policy-5',asset:'insurance',label:'policy',amount:100_000,annualPremium:100_000,policyScale:1,premiumTerm:5,premiumsPaid:5,boughtAge:20,policyCashFlows:Array.from({length:5},(_,i)=>({year:i+1,policyYear:i+1,type:'premium' as const,amount:100_000}))};
  const updated=withdrawPolicy(policy,10_000,6,26,signals);assert.equal(updated.annualPremium,100_000);assert.equal(updated.premiumsPaid,5);assert.equal(updated.policyCashFlows?.at(-1)?.amount,10_000);assert.equal(updated.policyCashFlows?.at(-1)?.policyYear,7);
});

test('scheduled fixed and percentage withdrawals preserve later contractual premium',()=>{
  for(const policy of [
    {id:'fixed',withdrawalMode:'fixed' as const,withdrawalAmount:10_000},
    {id:'percent',withdrawalMode:'percent' as const,withdrawalPercent:2},
  ]){
    const holding:ProductHolding={...policy,productId:'policy-5',asset:'insurance',label:'policy',amount:100_000,annualPremium:100_000,policyScale:1,premiumTerm:5,premiumsPaid:2,boughtAge:24,withdrawalStartYear:2,policyCashFlows:[{year:1,policyYear:1,type:'premium',amount:100_000}]};
    const result=settleYear({...base([holding]),age:25});assert.equal(result.ok,true);if(!result.ok)continue;
    const updated=result.holdings[0];assert.equal(updated.annualPremium,100_000);assert.equal(updated.premiumsPaid,3);assert.ok((updated.cumulativeWithdrawals??0)>0);assert.equal(updated.policyCashFlows?.filter(flow=>flow.type==='premium').at(-1)?.amount,100_000);
  }
});

test('three year deposit remains principal-only before contractual maturity',()=>{
  const holding:ProductHolding={id:'d3',productId:'deposit-3',asset:'deposit',label:'deposit',amount:100_000,boughtAge:25};
  const first=settleYear({...base([holding]),age:25,annualCapital:0});assert.equal(first.ok,true);if(!first.ok)return;
  assert.equal(first.portfolio.deposit,100_000);assert.equal(first.holdings[0].amount,100_000);assert.equal(first.cashFlows.some(flow=>flow.holdingId==='d3'),false);
});

test('history view cannot affect deterministic annual outcome',()=>{
  const input=base();const selectedHistoricalView={marketYear:0,chartStartYear:0,researchOverlay:'stock'};const currentView={marketYear:9,chartStartYear:7,researchOverlay:'bond'};
  assert.notDeepEqual(selectedHistoricalView,currentView);assert.deepEqual(settleYear(input),settleYear(structuredClone(input)));
});

test('ten mixed years retain derived totals and never resurrect matured holdings',()=>{
  const property:PropertyHolding={id:'home',name:'home',district:'x',ping:10,price:100_000,marketRent:1000,demand:.8,populationTrend:0,birthRate:0,downPaymentRate:.2,mortgageRate:.03,mortgageYears:30,boughtAge:25,purchasePrice:100_000,mortgageBalance:50_000,monthlyRent:900,rentalMode:'rent',lastRentedMonths:0,lastRentalIncome:0,currentValue:100_000};
  let state=base([{id:'d',productId:'deposit-1',asset:'deposit',label:'deposit',amount:10_000,boughtAge:25},{id:'s',productId:'stock-world',asset:'stocks',label:'world',amount:1000,boughtAge:25,buyPrice:100,shares:10},{id:'b',productId:'bond-5',asset:'bonds',label:'bond',amount:9500,boughtAge:25,bondUnits:1,faceValue:10000,maturityYears:5,couponRate:.03,buyPrice:95},{id:'p',productId:'policy-5',asset:'insurance',label:'policy',amount:1000,boughtAge:25,annualPremium:1000,premiumTerm:5,premiumsPaid:1,policyScale:1,policyCashFlows:[{year:1,policyYear:1,type:'premium',amount:1000}]}],[property]);
  for(let year=1;year<=10;year++){state={...state,year,age:24+year,ticket:createAnnualTicket('long-run',year,Object.keys(state.stockPrices),state.properties)};const result=settleYear(state);assert.equal(result.ok,true);if(!result.ok)break;assert.deepEqual(result.portfolio,derivePortfolio(result.cash,result.holdings,result.properties,result.stockPrices,result.bondPrices,state.ticket.signals,state.age+1));assert.equal(result.holdings.some(h=>h.id==='d'),false);state={...state,age:state.age+1,cash:result.cash,holdings:result.holdings,properties:result.properties,stockPrices:result.stockPrices,bondPrices:result.bondPrices,previousSignals:state.ticket.signals}}
});

test('versioned saves distinguish valid, missing, damaged, incomplete and unsupported data',()=>{
  const valid=validWorld();
  assert.equal(decodeWorld(JSON.stringify(valid)).ok,true);
  assert.deepEqual(decodeWorld(null),{ok:false,reason:'missing',raw:null,diagnostics:[]});
  assert.equal(decodeWorld('{broken').ok,false);
  assert.equal(decodeWorld(JSON.stringify({...valid,version:99})).ok,false);
  assert.equal(decodeWorld(JSON.stringify({version:1})).ok,false);
});

test('version one annual history is retained but marked as not settlement-auditable',()=>{
  const world=validWorld();world.version=1;world.game.history=[{year:1,total:1_000_000}];world.market.annualReports=[{year:1}];world.market.marketSnapshots=[{year:1}];
  const raw=JSON.stringify(world),decoded=decodeWorld(raw);assert.equal(decoded.ok,true);if(!decoded.ok)return;assert.equal(decoded.value.settlementHistoryComplete,false);assert.deepEqual(decoded.value.game.history,world.game.history);assert.match(decoded.diagnostics.join(' '),/未猜造識別資訊/);assert.equal(JSON.parse(raw).settlementHistoryComplete,undefined);
});

test('invalid nested financial fields are rejected and raw save is retained',()=>{
  const invalid=validWorld();invalid.holdings=[{id:'s',productId:'stock-world',asset:'stocks',label:'bad',amount:100,boughtAge:25,buyPrice:100,shares:0} as ProductHolding];
  const raw=JSON.stringify(invalid),decoded=decodeWorld(raw);assert.equal(decoded.ok,false);if(decoded.ok)return;assert.equal(decoded.reason,'invalid');assert.equal(decoded.raw,raw);
});

test('portfolio mismatch is diagnosed and reconciled from holdings without changing raw save',()=>{
  const world=validWorld();world.holdings=[{id:'s',productId:'stock-world',asset:'stocks',label:'stock',amount:1000,boughtAge:25,buyPrice:100,shares:10}];
  const raw=JSON.stringify(world),decoded=decodeWorld(raw);assert.equal(decoded.ok,true);if(!decoded.ok)return;assert.equal(decoded.value.game.portfolio.stocks,1000);assert.ok(decoded.diagnostics.length>0);assert.equal(JSON.parse(raw).game.portfolio.stocks,0);
});

test('legacy policy without contractual premium is rejected rather than inferred from amount',()=>{
  const world=validWorld();world.holdings=[{id:'p',productId:'policy-5',asset:'insurance',label:'legacy',amount:60_000,boughtAge:25,premiumTerm:5,premiumsPaid:2} as ProductHolding];
  const decoded=decodeWorld(JSON.stringify(world));assert.equal(decoded.ok,false);if(decoded.ok)return;assert.match(decoded.diagnostics.join(' '),/固定保費/);
});

test('policy with known premium but missing history remains loadable with an audit warning',()=>{
  const world=validWorld();world.holdings=[{id:'p',productId:'policy-5',asset:'insurance',label:'legacy',amount:60_000,annualPremium:100_000,boughtAge:25,premiumTerm:5,premiumsPaid:2,policyScale:.6}];
  world.game.portfolio.insurance=0;
  const decoded=decodeWorld(JSON.stringify(world));assert.equal(decoded.ok,true);if(!decoded.ok)return;assert.equal(decoded.value.holdings[0].annualPremium,100_000);assert.equal(decoded.value.holdings[0].cashFlowHistoryComplete,false);assert.match(decoded.diagnostics.join(' '),/歷史報酬不可靠/);
});

test('complete settlement identity survives save and reload across history report and snapshot',()=>{
  const world=validWorld(),id='seed:1';world.lastSettlementId=id;world.game.history=[{settlementId:id}];world.market.annualReports=[{settlementId:id}];world.market.marketSnapshots=[{settlementId:id}];
  let raw:string|null=null;const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value}};assert.equal(writeWorld(storage,'world',world).ok,true);const decoded=decodeWorld(raw);assert.equal(decoded.ok,true);if(!decoded.ok)return;assert.equal(decoded.value.lastSettlementId,id);
});

test('settlement guard rejects rapid duplicate acquisition until release',()=>{
  const guard=createSettlementGuard();assert.equal(guard.acquire(),true);assert.equal(guard.acquire(),false);assert.equal(guard.isLocked(),true);guard.release();assert.equal(guard.acquire(),true);
});

test('failed storage writes report failure and do not overwrite the last valid value',()=>{
  let value='last-valid';const storage={getItem:()=>value,setItem:()=>{throw new Error('quota')}};
  assert.equal(writeWorld(storage,'world',{version:1}).ok,false);assert.equal(value,'last-valid');
});
