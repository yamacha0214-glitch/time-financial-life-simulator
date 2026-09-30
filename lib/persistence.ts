import {
  derivePortfolio,
  validateHolding,
  validateMarketSignals,
  validateProperty,
  type MarketSignals,
  type Portfolio,
  type ProductHolding,
  type PropertyHolding,
} from './simulation.ts';

export const WORLD_SAVE_VERSION = 2;
const ASSET_KEYS = ['cash', 'deposit', 'bonds', 'stocks', 'realEstate', 'insurance'] as const;

export type StorageLike = { getItem(key:string):string|null; setItem(key:string,value:string):void; removeItem?(key:string):void };
export type WorldEnvelope = {
  version:number;
  savedAt?:string;
  lastSettlementId?:string;
  settlementHistoryComplete?:boolean;
  game:{year:number;age:number;portfolio:Portfolio;simulationSeed:string;history:any[];[key:string]:any};
  holdings:ProductHolding[];
  history:any[];
  properties:PropertyHolding[];
  propertyListings:any[];
  market:{
    stockPrices:Record<string,number>;stockPriceHistory:Record<string,number[]>;bondPrices:Record<string,number>;
    marketSignals:MarketSignals;annualReports:any[];marketSnapshots:any[];marketTrades:any[];[key:string]:any;
  };
};
export type DecodeResult =
  | {ok:true;value:WorldEnvelope;diagnostics:string[]}
  | {ok:false;reason:'missing'|'damaged'|'unsupported'|'incomplete'|'invalid';raw:string|null;diagnostics:string[]};

const finite = (value:unknown):value is number => typeof value === 'number' && Number.isFinite(value);
const validPrices = (value:unknown) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length>0 && Object.values(value).every(price => finite(price) && price > 0);
const validPortfolio = (value:unknown):value is Portfolio => !!value && typeof value === 'object' && ASSET_KEYS.every(key => finite((value as Record<string,unknown>)[key]));
const portfoliosEqual = (a:Portfolio,b:Portfolio) => ASSET_KEYS.every(key => Math.abs(a[key]-b[key]) < 1e-6);

export const validateAndReconcileWorld = (candidate:unknown):{ok:true;value:WorldEnvelope;diagnostics:string[]}|{ok:false;diagnostics:string[]} => {
  const value=candidate as Partial<WorldEnvelope>;
  const diagnostics:string[]=[];
  if(!value||typeof value!=='object'||!value.game||!value.market||!Array.isArray(value.holdings)||!Array.isArray(value.properties))return{ok:false,diagnostics:['存檔缺少 game、market、holdings 或 properties。']};
  if(!Number.isInteger(value.game.year)||value.game.year<0||!Number.isInteger(value.game.age)||value.game.age<0||typeof value.game.simulationSeed!=='string'||!value.game.simulationSeed)return{ok:false,diagnostics:['遊戲年度、年齡或 simulation seed 不合法。']};
  if(!validPortfolio(value.game.portfolio)||(['cash','deposit','bonds','stocks','insurance'] as const).some(key=>value.game!.portfolio[key]<0))return{ok:false,diagnostics:['存檔總表缺少必要欄位、含非有限值或非房產資產為負。']};
  const holdingError=value.holdings.map(validateHolding).find(Boolean);if(holdingError)return{ok:false,diagnostics:[holdingError]};
  const holdings=value.holdings.map(holding=>{
    if(holding.asset==='insurance'&&!Array.isArray(holding.policyCashFlows)){
      diagnostics.push(`保單 ${holding.id} 缺少歷史現金流；未來可繼續模擬，但歷史報酬不可靠。`);
      return{...holding,cashFlowHistoryComplete:false};
    }
    return holding.asset==='insurance'?{...holding,cashFlowHistoryComplete:holding.cashFlowHistoryComplete!==false}:holding;
  });
  const propertyError=value.properties.map(validateProperty).find(Boolean);if(propertyError)return{ok:false,diagnostics:[propertyError]};
  const market=value.market;
  if(!validPrices(market.stockPrices)||!validPrices(market.bondPrices)||!validateMarketSignals(market.marketSignals))return{ok:false,diagnostics:['市場價格或市場訊號缺失、非有限或不合法。']};
  if(!market.stockPriceHistory||typeof market.stockPriceHistory!=='object'||Object.values(market.stockPriceHistory).some(path=>!Array.isArray(path)||!path.length||!path.every(price=>finite(price)&&price>0)))return{ok:false,diagnostics:['股票價格歷史不合法。']};
  if(!Array.isArray(market.annualReports)||!Array.isArray(market.marketSnapshots)||!Array.isArray(market.marketTrades)||!Array.isArray(value.game.history))return{ok:false,diagnostics:['年度報告、快照、交易或玩家歷史格式不合法。']};
  if(!Array.isArray(value.propertyListings)||value.propertyListings.some(listing=>{
    if(!listing||typeof listing!=='object')return true;
    const item=listing as Record<string,unknown>;
    return typeof item.id!=='string'||typeof item.name!=='string'||typeof item.district!=='string'||!['ping','price','marketRent','demand','populationTrend','birthRate','downPaymentRate','mortgageRate','mortgageYears'].every(key=>finite(item[key]))||Number(item.price)<=0||Number(item.downPaymentRate)<0||Number(item.downPaymentRate)>1||Number(item.mortgageYears)<=0;
  }))return{ok:false,diagnostics:['待售房產包含缺失或不合法的交易／貸款欄位。']};
  if(value.lastSettlementId){
    const historyId=(value.game.history.at(-1) as {settlementId?:unknown}|undefined)?.settlementId;
    const reportId=(market.annualReports.at(-1) as {settlementId?:unknown}|undefined)?.settlementId;
    const snapshotId=(market.marketSnapshots.at(-1) as {settlementId?:unknown}|undefined)?.settlementId;
    if(historyId!==value.lastSettlementId||reportId!==value.lastSettlementId||snapshotId!==value.lastSettlementId)return{ok:false,diagnostics:['最近一次年度 history、market snapshot 與 annual report 的 settlement ID 不一致。']};
  }
  const hasAnnualHistory=value.game.history.length>0||market.annualReports.some((report:{year?:number})=>(report?.year??0)>0)||market.marketSnapshots.some((snapshot:{year?:number})=>(snapshot?.year??0)>0);
  const settlementHistoryComplete=value.settlementHistoryComplete!==false&&(!hasAnnualHistory||Boolean(value.lastSettlementId));
  if(hasAnnualHistory&&!settlementHistoryComplete)diagnostics.push('舊存檔缺少可核對的共同 settlement ID；既有歷史保持原樣但不宣稱可完整稽核，未猜造識別資訊。');
  const derived=derivePortfolio(value.game.portfolio.cash,holdings,value.properties,market.stockPrices,market.bondPrices,market.marketSignals,value.game.age);
  if(!portfoliosEqual(value.game.portfolio,derived))diagnostics.push('儲存總表與持倉推導值不一致；本次載入使用持倉推導值，原始存檔未被覆寫。');
  const reconciled={...value,version:WORLD_SAVE_VERSION,settlementHistoryComplete,holdings,history:Array.isArray(value.history)?value.history:[],propertyListings:Array.isArray(value.propertyListings)?value.propertyListings:[],game:{...value.game,portfolio:derived}} as WorldEnvelope;
  return{ok:true,value:reconciled,diagnostics};
};

export const decodeWorld = (raw:string|null):DecodeResult => {
  if(raw===null)return{ok:false,reason:'missing',raw,diagnostics:[]};
  try{
    const parsed=JSON.parse(raw);
    if(parsed?.version!==1&&parsed?.version!==WORLD_SAVE_VERSION)return{ok:false,reason:'unsupported',raw,diagnostics:['存檔版本不受支援。']};
    const checked=validateAndReconcileWorld(parsed);
    if(!checked.ok)return{ok:false,reason:'invalid',raw,diagnostics:checked.diagnostics};
    return{ok:true,value:checked.value,diagnostics:checked.diagnostics};
  }catch{return{ok:false,reason:'damaged',raw,diagnostics:['存檔不是有效 JSON；原始內容未變更。']}}
};

export const writeWorld = (storage:StorageLike,key:string,envelope:unknown) => {
  const checked=validateAndReconcileWorld(envelope);
  if(!checked.ok)return{ok:false as const,error:new Error(checked.diagnostics.join(' '))};
  try{storage.setItem(key,JSON.stringify(checked.value));return{ok:true as const,value:checked.value}}catch(error){return{ok:false as const,error}}
};
