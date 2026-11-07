import type { FireGoal } from './goals';
import { isISODate } from './reporting-coverage';

const round=(value:number)=>Math.round(value*100)/100;
const limit=Number.MAX_SAFE_INTEGER/100;
const supported=(value:number)=>Number.isFinite(value)&&Math.abs(value)<=limit;
const time=(date:string)=>Date.parse(date+'T12:00:00Z');
const validDate=(date:string)=>isISODate(date)&&date>='1900-01-01'&&date<='2199-12-31';
export function validateFireGoal(fire:FireGoal,today?:string):void {
 if(![fire.annualWithdrawalNeed,fire.eligibleAssets].every(value=>Number.isFinite(value)&&value>=0&&value<=1e12)||!Number.isFinite(fire.withdrawalRatePct)||fire.withdrawalRatePct<=0||fire.withdrawalRatePct>100||!supported(fire.annualWithdrawalNeed/(fire.withdrawalRatePct/100)))throw new Error('Enter valid withdrawal, rate and asset amounts.');
 if(!validDate(fire.valuationDate)||today&&fire.valuationDate>today)throw new Error('Current assets need a valid nonfuture valuation date.');
 if(!fire.assetScope.trim()||fire.assetScope.length>500)throw new Error('Describe the assets included in your FIRE plan.');
 if(fire.targetDate!==undefined&&(!validDate(fire.targetDate)||fire.targetDate<=fire.valuationDate))throw new Error('Retirement target date must be after the current-asset valuation date. Future dates are supported.');
 if(fire.annualContribution!==undefined&&(!Number.isFinite(fire.annualContribution)||fire.annualContribution<0||fire.annualContribution>1e12))throw new Error('Enter a nonnegative annual contribution.');
 if(fire.realReturnPct!==undefined&&(!Number.isFinite(fire.realReturnPct)||fire.realReturnPct < -20||fire.realReturnPct>20))throw new Error('Enter an assumed real annual return between -20% and 20%.');
}
export interface FireDashboardSummary {
 target:number|null;annualWithdrawal:number|null;monthlyWithdrawal:number|null;rate:number|null;
 assets:number|null;currentAnnualWithdrawal:number|null;gap:number|null;percent:number|null;
 projection:{assets:number;annualWithdrawal:number;gap:number;years:number}|null;
 projectionStatus:'needs_assets'|'needs_date'|'needs_assumptions'|'ready'|'overflow';
}
/** Today's dollars. Monthly end contributions; exact elapsed-day growth and a
 * prorated contribution for the final partial monthly interval. No feed balances,
 * historical surplus or default market returns are substituted for user inputs.
 */
export function summarizeFire(fire:FireGoal|null):FireDashboardSummary {
 if(!fire)return {target:null,annualWithdrawal:null,monthlyWithdrawal:null,rate:null,assets:null,currentAnnualWithdrawal:null,gap:null,percent:null,projection:null,projectionStatus:'needs_assets'};
 const plan=fire;
 if(fire)validateFireGoal(fire);
 const rate=plan.withdrawalRatePct/100,target=round(plan.annualWithdrawalNeed/rate);
 const result:FireDashboardSummary={target,annualWithdrawal:plan.annualWithdrawalNeed,monthlyWithdrawal:round(plan.annualWithdrawalNeed/12),rate:plan.withdrawalRatePct,assets:fire?.eligibleAssets??null,currentAnnualWithdrawal:fire?round(fire.eligibleAssets*rate):null,gap:fire?round(Math.max(0,target-fire.eligibleAssets)):null,percent:fire?(target>0?fire.eligibleAssets/target*100:null):null,projection:null,projectionStatus:!fire?'needs_assets':!fire.targetDate?'needs_date':'needs_assumptions'};
 if(!fire?.targetDate||fire.annualContribution===undefined||fire.realReturnPct===undefined)return result;
 const start=time(fire.valuationDate),end=time(fire.targetDate),origin=new Date(start),yearDays=365.2425*86_400_000;
 let previous=start,assets=fire.eligibleAssets;
 for(let month=1;previous<end;month++){
  const anchor=new Date(Date.UTC(origin.getUTCFullYear(),origin.getUTCMonth()+month,1,12));
  anchor.setUTCDate(Math.min(origin.getUTCDate(),new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,0)).getUTCDate()));
  const next=anchor.getTime(),stop=Math.min(next,end),fraction=(stop-previous)/(next-previous);
  assets=assets*Math.pow(1+fire.realReturnPct/100,(stop-previous)/yearDays)+fire.annualContribution/12*fraction;
  if(!supported(assets)||!supported(assets*rate)){result.projectionStatus='overflow';return result;}
  previous=stop;
 }
 result.projection={assets:round(assets),annualWithdrawal:round(assets*rate),gap:round(Math.max(0,target-assets)),years:(end-start)/yearDays};
 result.projectionStatus='ready';return result;
}
