export type AssetKey = 'cash' | 'deposit' | 'bonds' | 'stocks' | 'realEstate' | 'insurance';
export type Portfolio = Record<AssetKey, number>;

export type MarketSignals = {
  growth:number; inflation:number; policyRate:number; riskAppetite:number;
  earnings:number; flows:number; news:number; creditSpread:number;
};

export type PolicyCashFlow = { year:number; policyYear:number; type:'premium'|'withdrawal'; amount:number };
export type ProductHolding = {
  id:string; productId:string; asset:Exclude<AssetKey,'cash'>; label:string; amount:number; boughtAge:number;
  premiumTerm?:number; premiumsPaid?:number; annualPremium?:number; policyScale?:number; policyCashFlows?:PolicyCashFlow[];
  buyPrice?:number; shares?:number; bondUnits?:number; faceValue?:number; maturityYears?:number; couponRate?:number;
  withdrawalMode?:'none'|'fixed'|'percent'; withdrawalAmount?:number; withdrawalPercent?:number; withdrawalStartYear?:number;
  cumulativeWithdrawals?:number;
  cashFlowHistoryComplete?:boolean;
};

export type PropertyHolding = {
  id:string; name:string; district:string; ping:number; price:number; marketRent:number; demand:number; populationTrend:number;
  birthRate:number; downPaymentRate:number; mortgageRate:number; mortgageYears:number; boughtAge:number; purchasePrice:number;
  mortgageBalance:number; monthlyRent:number; rentalMode:'vacant'|'rent'; lastRentedMonths:number; lastRentalIncome:number; currentValue:number;
};

export type AnnualTicket = {
  key:string; signals:MarketSignals; stockMonthlyShocks:Record<string,number[]>; corporateBondShock:number;
  propertyNoise:Record<string,{appreciation:number; occupancy:number}>;
};

export type CashFlow = { kind:'external'|'dividend'|'coupon'|'maturity'|'premium'|'rent'|'mortgage'|'withdrawal'|'interest'; asset:AssetKey; amount:number; holdingId?:string; label:string };
export type TradeRecord = { year:number; age:number; asset:'stocks'|'bonds'; productId:string; label:string; side:'買入'|'賣出'; quantity:number; price:number; amount:number; realizedPnl?:number };

export type SettlementInput = {
  year:number; age:number; cash:number; holdings:ProductHolding[]; properties:PropertyHolding[];
  stockPrices:Record<string,number>; bondPrices:Record<string,number>; previousSignals:MarketSignals;
  ticket:AnnualTicket; annualCapital:number;
};

export type SettlementSuccess = {
  ok:true; year:number; age:number; cash:number; holdings:ProductHolding[]; properties:PropertyHolding[];
  stockPrices:Record<string,number>; stockPaths:Record<string,number[]>; bondPrices:Record<string,number>;
  portfolio:Portfolio; cashFlows:CashFlow[]; ticketKey:string;
};
export type SettlementFailure = { ok:false; code:'INSUFFICIENT_PREMIUM_CASH'|'INSUFFICIENT_MORTGAGE_CASH'|'INVALID_STATE'; message:string; ticketKey:string };
export type SettlementResult = SettlementSuccess | SettlementFailure;

const finite=(n:number)=>Number.isFinite(n);
const round=(n:number)=>Math.round(n*1e8)/1e8;
export const clamp=(n:number,min:number,max:number)=>Math.min(Math.max(n,min),max);
export const createSettlementGuard=()=>{let locked=false;return{acquire:()=>locked?false:(locked=true),release:()=>{locked=false},isLocked:()=>locked}};

const hash=(text:string)=>{let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
const rng=(seed:number)=>()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};

export const createAnnualTicket=(simulationSeed:string,year:number,stockIds:string[],properties:PropertyHolding[]):AnnualTicket=>{
  const random=rng(hash(`${simulationSeed}|${year}`));
  const signals:MarketSignals={growth:-0.01+random()*0.055,inflation:0.012+random()*0.045,policyRate:0.01+random()*0.05,riskAppetite:-1+random()*2,earnings:-0.08+random()*0.24,flows:-1+random()*2,news:-1+random()*2,creditSpread:0.006+random()*0.035};
  const stockMonthlyShocks:Record<string,number[]>={};
  stockIds.forEach(id=>{stockMonthlyShocks[id]=Array.from({length:12},()=>random()+random()+random()+random()-2)});
  const propertyNoise:AnnualTicket['propertyNoise']={};
  properties.forEach(p=>{propertyNoise[p.id]={appreciation:(random()+random()-1)*0.035,occupancy:(random()+random()-1)*0.12}});
  return {key:`${simulationSeed}:${year}`,signals,stockMonthlyShocks,corporateBondShock:(random()-0.5)*0.035,propertyNoise};
};

export const insuranceCurveRatio=(policyYear:number)=>{
  const curve:Array<[number,number]>=[[1,0],[2,0],[3,.26551],[4,.409685],[5,.58069],[10,1.255865],[15,1.74045],[20,2.54057],[25,3.53179],[30,4.9976],[43,11.24431],[48,15.92205],[53,22.835625],[58,33.086535],[63,44.14993],[68,59.457],[73,79.3135]];
  const y=Math.max(1,policyYear), exact=curve.find(([x])=>x===y); if(exact)return exact[1];
  const upper=curve.find(([x])=>x>y);if(!upper)return curve[curve.length-1][1];const i=curve.indexOf(upper),lower=curve[Math.max(0,i-1)],t=(y-lower[0])/(upper[0]-lower[0]);return lower[1]+(upper[1]-lower[1])*t;
};
export const insuranceFulfillment=(s:MarketSignals)=>clamp(1+(s.growth-.025)*.65-(s.creditSpread-.018)*.8+s.news*.018,.90,1.05);
export const insuranceValue=(h:ProductHolding,age:number,s:MarketSignals)=>{
  if(h.asset!=='insurance'||!h.premiumTerm)return 0;
  if(!finite(h.annualPremium??NaN))return Number.NaN;
  const premium=h.annualPremium!, scale=h.policyScale??1, py=Math.max(1,age-h.boughtAge+1);
  const base=premium*h.premiumTerm*insuranceCurveRatio(py)*scale, weight=clamp((py-2)/18,0,.88);
  return Math.max(0,base*((1-weight)+weight*insuranceFulfillment(s)));
};

export const derivePortfolio=(cash:number,holdings:ProductHolding[],properties:PropertyHolding[],stockPrices:Record<string,number>,bondPrices:Record<string,number>,signals:MarketSignals,age:number):Portfolio=>{
  const p:Portfolio={cash,deposit:0,bonds:0,stocks:0,realEstate:0,insurance:0};
  holdings.forEach(h=>{
    if(h.asset==='stocks')p.stocks+=(h.shares??0)*(stockPrices[h.productId]??0);
    else if(h.asset==='bonds')p.bonds+=(h.bondUnits??0)*(h.faceValue??0)*(bondPrices[h.productId]??0)/100;
    else if(h.asset==='insurance')p.insurance+=insuranceValue(h,age,signals);
    else if(h.asset==='deposit')p.deposit+=h.amount;
  });
  properties.forEach(x=>{p.realEstate+=x.currentValue-x.mortgageBalance});
  return Object.fromEntries(Object.entries(p).map(([k,v])=>[k,round(v)])) as Portfolio;
};

const positiveInteger=(value:number|undefined)=>Number.isInteger(value)&&value!>0;
const finiteRecord=(record:Record<string,number>,positive=false)=>Object.values(record).every(value=>finite(value)&&(!positive||value>0));
export const validateMarketSignals=(signals:MarketSignals)=>Object.values(signals).every(finite);
export const validateHolding=(h:ProductHolding):string|null=>{
  if(!h||typeof h.id!=='string'||!h.id||typeof h.productId!=='string'||!h.productId||typeof h.label!=='string')return '持倉識別資訊缺失';
  if(!finite(h.amount)||h.amount<0||!Number.isInteger(h.boughtAge)||h.boughtAge<0)return `${h.id} 的成本或購入年齡不合法`;
  if(h.asset==='stocks'&&(!positiveInteger(h.shares)||!finite(h.buyPrice??NaN)||(h.buyPrice??0)<0))return `${h.id} 的股數或成本價格不合法`;
  if(h.asset==='bonds'&&(!positiveInteger(h.bondUnits)||!finite(h.faceValue??NaN)||(h.faceValue??0)<=0||!finite(h.couponRate??NaN)||(h.couponRate??0)<0||!positiveInteger(h.maturityYears)))return `${h.id} 的債券契約欄位不合法`;
  if(h.asset==='deposit'&&!['deposit-1','deposit-3'].includes(h.productId))return `${h.id} 的定存契約無法辨識`;
  if(h.asset==='insurance'){
    if(!positiveInteger(h.premiumTerm)||!positiveInteger(h.premiumsPaid)||!finite(h.annualPremium??NaN)||(h.annualPremium??0)<=0)return `${h.id} 的固定保費或繳費期無法確認`;
    if((h.premiumsPaid??0)>(h.premiumTerm??0)||!finite(h.policyScale??1)||(h.policyScale??1)<0)return `${h.id} 的保單狀態不合法`;
    if(h.policyCashFlows&&!h.policyCashFlows.every(flow=>Number.isInteger(flow.year)&&Number.isInteger(flow.policyYear)&&flow.policyYear>0&&finite(flow.amount)&&flow.amount>0))return `${h.id} 的保單現金流不合法`;
    if(h.withdrawalMode==='fixed'&&(!finite(h.withdrawalAmount??NaN)||(h.withdrawalAmount??0)<=0))return `${h.id} 的固定提取設定不合法`;
    if(h.withdrawalMode==='percent'&&(!finite(h.withdrawalPercent??NaN)||(h.withdrawalPercent??0)<=0||(h.withdrawalPercent??0)>100))return `${h.id} 的比例提取設定不合法`;
  }
  return null;
};
export const validateProperty=(p:PropertyHolding):string|null=>{
  if(!p||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!['vacant','rent'].includes(p.rentalMode))return '房產識別資訊或出租狀態不合法';
  const nonNegative=[p.price,p.marketRent,p.downPaymentRate,p.mortgageRate,p.mortgageYears,p.purchasePrice,p.mortgageBalance,p.monthlyRent,p.currentValue];
  if(!nonNegative.every(value=>finite(value)&&value>=0)||!Number.isInteger(p.boughtAge)||p.mortgageYears<=0)return `${p.id} 的房產或貸款欄位不合法`;
  if(![p.ping,p.demand,p.populationTrend,p.birthRate,p.lastRentedMonths,p.lastRentalIncome].every(finite))return `${p.id} 的房產估值欄位不合法`;
  return null;
};
export const validateSettlementInput=(x:SettlementInput):string|null=>{
  if(!Number.isInteger(x.year)||x.year<0||!Number.isInteger(x.age)||x.age<0||!finite(x.cash)||x.cash<0||!finite(x.annualCapital))return '年度、年齡、現金或外部資金不合法';
  const holdingError=x.holdings.map(validateHolding).find(Boolean);if(holdingError)return holdingError;
  const propertyError=x.properties.map(validateProperty).find(Boolean);if(propertyError)return propertyError;
  if(!finiteRecord(x.stockPrices,true)||!finiteRecord(x.bondPrices,true)||!validateMarketSignals(x.previousSignals)||!validateMarketSignals(x.ticket.signals))return '市場價格或訊號不合法';
  if(typeof x.ticket.key!=='string'||!x.ticket.key||!finite(x.ticket.corporateBondShock)||Object.keys(x.stockPrices).some(id=>!Array.isArray(x.ticket.stockMonthlyShocks[id])||x.ticket.stockMonthlyShocks[id].length!==12||!x.ticket.stockMonthlyShocks[id].every(finite))||x.properties.some(property=>{const noise=x.ticket.propertyNoise[property.id];return!noise||!finite(noise.appreciation)||!finite(noise.occupancy)}))return '年度隨機票券不合法';
  return null;
};

export const settleYear=(input:SettlementInput):SettlementResult=>{
  const {ticket}=input;
  const inputError=validateSettlementInput(input);
  if(inputError)return{ok:false,code:'INVALID_STATE',message:`期初帳務無效：${inputError}。`,ticketKey:ticket.key};
  const activePolicies=input.holdings.filter(h=>h.asset==='insurance'&&h.premiumTerm&&(h.premiumsPaid??1)<h.premiumTerm);
  const premiumDue=activePolicies.reduce((n,h)=>n+h.annualPremium!,0);
  if(input.cash+1e-8<premiumDue)return{ok:false,code:'INSUFFICIENT_PREMIUM_CASH',message:`續期保費 NT$${Math.round(premiumDue).toLocaleString('en-US')} 須由期初現金支付。`,ticketKey:ticket.key};

  let cash=input.cash-premiumDue; const flows:CashFlow[]=[];
  if(premiumDue)flows.push({kind:'premium',asset:'insurance',amount:-premiumDue,label:'保單續期保費'});
  let holdings:ProductHolding[]=input.holdings.map(h=>activePolicies.some(p=>p.id===h.id)?{...h,premiumsPaid:(h.premiumsPaid??1)+1,policyCashFlows:[...(h.policyCashFlows??[]),{year:input.year,policyYear:Math.max(1,input.age+1-h.boughtAge+1),type:'premium' as const,amount:h.annualPremium!}]}:{...h,policyCashFlows:h.policyCashFlows?[...h.policyCashFlows]:undefined});
  const s=ticket.signals, stockPrices={...input.stockPrices}, stockPaths:Record<string,number[]>={};
  Object.keys(stockPrices).forEach(id=>{const profile=id==='stock-tech'?{drift:.10,vol:.24}:id==='stock-dividend'?{drift:.055,vol:.12}:{drift:.07,vol:.16};let price=stockPrices[id];const path:number[]=[];ticket.stockMonthlyShocks[id].forEach(shock=>{price=Math.max(1,price*(1+profile.drift/12+shock*(profile.vol/Math.sqrt(12))));path.push(price)});stockPrices[id]=price;stockPaths[id]=path});
  const dividendRates:Record<string,number>={'stock-world':.020,'stock-tech':.008,'stock-dividend':.040},growth=clamp(1+s.earnings*.55+s.growth*1.2+s.news*.025,.72,1.18);
  Object.keys(stockPrices).forEach(id=>{const perShare=(input.stockPrices[id]??stockPrices[id])*(dividendRates[id]??0)*growth;const dividend=holdings.filter(h=>h.asset==='stocks'&&h.productId===id).reduce((n,h)=>n+(h.shares??0)*perShare,0);if(dividend){cash+=dividend;flows.push({kind:'dividend',asset:'stocks',amount:dividend,label:`${id} 配息`})}stockPrices[id]=Math.max(1,stockPrices[id]-perShare);if(stockPaths[id]?.length)stockPaths[id][11]=stockPrices[id]});
  const rateShock=(s.policyRate-input.previousSignals.policyRate)+(s.inflation-input.previousSignals.inflation)*.35,bondPrices={...input.bondPrices};
  Object.keys(bondPrices).forEach(id=>{const duration=id==='bond-10'?7.2:id==='bond-corp'?5.2:4.2,credit=id==='bond-corp'?ticket.corporateBondShock:0;bondPrices[id]=clamp(bondPrices[id]*(1-duration*rateShock+credit),65,125)});
  const nextHoldings:ProductHolding[]=[];
  holdings.forEach(h=>{if(h.asset==='bonds'){const coupon=(h.bondUnits??0)*(h.faceValue??0)*(h.couponRate??0);cash+=coupon;if(coupon)flows.push({kind:'coupon',asset:'bonds',amount:coupon,holdingId:h.id,label:`${h.label} 票息`});if(h.maturityYears&&input.age+1>=h.boughtAge+h.maturityYears){const face=(h.bondUnits??0)*(h.faceValue??0);cash+=face;flows.push({kind:'maturity',asset:'bonds',amount:face,holdingId:h.id,label:`${h.label} 到期本金`});return}}
    if(h.asset==='deposit'){const term=h.productId==='deposit-1'?1:h.productId==='deposit-3'?3:0;if(term&&input.age+1>=h.boughtAge+term){const rate=h.productId==='deposit-1'?.02:.024,proceeds=h.amount*(1+rate*term);cash+=proceeds;flows.push({kind:'maturity',asset:'deposit',amount:proceeds,holdingId:h.id,label:`${h.label} 到期本息`});return}}
    nextHoldings.push(h)});holdings=nextHoldings;

  let mortgageNet=0;
  const properties=input.properties.map(p=>{const noise=ticket.propertyNoise[p.id]??{appreciation:0,occupancy:0},appreciation=clamp(.025+s.growth*.9-s.policyRate*.45+p.populationTrend*1.5+noise.appreciation,-.12,.14),currentValue=Math.max(0,p.currentValue*(1+appreciation)),monthlyRate=p.mortgageRate/12,months=p.mortgageYears*12,payment=p.mortgageBalance>0&&monthlyRate>0?p.mortgageBalance*(monthlyRate*Math.pow(1+monthlyRate,months))/(Math.pow(1+monthlyRate,months)-1):p.mortgageBalance/Math.max(1,months);let balance=p.mortgageBalance,paid=0;for(let m=0;m<12&&balance>0;m++){const interest=balance*monthlyRate,principal=Math.min(balance,Math.max(0,payment-interest));balance-=principal;paid+=interest+principal}let rented=0,rent=0;if(p.rentalMode==='rent'){const occupancy=clamp(p.demand-(p.monthlyRent/Math.max(1,p.marketRent)-1)*.85+s.growth*.8+noise.occupancy,.05,1);rented=Math.round(occupancy*12);rent=p.monthlyRent*rented}mortgageNet+=rent-paid;if(rent)flows.push({kind:'rent',asset:'realEstate',amount:rent,holdingId:p.id,label:`${p.name} 租金`});if(paid)flows.push({kind:'mortgage',asset:'realEstate',amount:-paid,holdingId:p.id,label:`${p.name} 房貸本息`});return{...p,currentValue,mortgageBalance:Math.max(0,balance),lastRentedMonths:rented,lastRentalIncome:rent,mortgageRate:Math.max(.018,s.policyRate*.55+.012)}});
  if(cash+mortgageNet<-1e-8)return{ok:false,code:'INSUFFICIENT_MORTGAGE_CASH',message:'期初現金扣除保費後不足支付本年度房貸淨支出；TIME 不允許自動透支。',ticketKey:ticket.key};
  cash+=mortgageNet+input.annualCapital;flows.push({kind:'external',asset:'cash',amount:input.annualCapital,label:'年度新增資金'});

  holdings=holdings.map(h=>{if(h.asset!=='insurance'||!h.premiumTerm||!h.withdrawalMode||h.withdrawalMode==='none'||!h.withdrawalStartYear)return h;const py=Math.max(1,input.age+1-h.boughtAge+1);if(py<h.withdrawalStartYear)return h;const value=insuranceValue(h,input.age+1,s),premium=h.annualPremium!,requested=h.withdrawalMode==='fixed'?(h.withdrawalAmount??0):premium*h.premiumTerm*((h.withdrawalPercent??0)/100),paid=Math.min(value,Math.max(0,requested));if(!paid)return h;cash+=paid;flows.push({kind:'withdrawal',asset:'insurance',amount:paid,holdingId:h.id,label:`${h.label} 年度提取`});const scale=(h.policyScale??1)*Math.max(0,(value-paid)/Math.max(1,value));return{...h,policyScale:scale,cumulativeWithdrawals:(h.cumulativeWithdrawals??0)+paid,policyCashFlows:[...(h.policyCashFlows??[]),{year:input.year,policyYear:py,type:'withdrawal' as const,amount:paid}]}});
  const portfolio=derivePortfolio(cash,holdings,properties,stockPrices,bondPrices,s,input.age+1);
  if(Object.values(portfolio).some(v=>!finite(v))||!finite(cash))return{ok:false,code:'INVALID_STATE',message:'結算結果包含無效數值。',ticketKey:ticket.key};
  return{ok:true,year:input.year,age:input.age,cash,holdings,properties,stockPrices,stockPaths,bondPrices,portfolio,cashFlows:flows,ticketKey:ticket.key};
};

export const sellStockPosition=(holdings:ProductHolding[],productId:string,quantity:number,price:number)=>{
  if(!Number.isInteger(quantity)||quantity<=0||!finite(price)||price<0)throw new Error('INVALID_STOCK_SALE');
  const lots=holdings.filter(h=>h.asset==='stocks'&&h.productId===productId),owned=lots.reduce((n,h)=>n+(h.shares??0),0);if(quantity>owned)throw new Error('INSUFFICIENT_SHARES');
  const totalCost=lots.reduce((n,h)=>n+h.amount,0),average=totalCost/owned,cost=average*quantity;let remaining=quantity;
  const next=holdings.flatMap(h=>{if(h.asset!=='stocks'||h.productId!==productId||remaining<=0)return[h];const take=Math.min(h.shares??0,remaining);remaining-=take;if(take===(h.shares??0))return[];return[{...h,shares:(h.shares??0)-take,amount:Math.max(0,h.amount-average*take),buyPrice:average}]});
  return{holdings:next,proceeds:quantity*price,costBasis:cost,realizedPnl:quantity*price-cost};
};

export const withdrawPolicy=(holding:ProductHolding,requested:number,year:number,age:number,signals:MarketSignals)=>{
  if(holding.asset!=='insurance'||!holding.premiumTerm||!finite(requested)||requested<=0)throw new Error('INVALID_WITHDRAWAL');const value=insuranceValue(holding,age,signals);if(requested>value)throw new Error('INSUFFICIENT_POLICY_VALUE');const py=Math.max(1,age-holding.boughtAge+1),scale=(holding.policyScale??1)*(value-requested)/Math.max(1,value);return{...holding,policyScale:scale,cumulativeWithdrawals:(holding.cumulativeWithdrawals??0)+requested,policyCashFlows:[...(holding.policyCashFlows??[]),{year,policyYear:py,type:'withdrawal' as const,amount:requested}]};
};
