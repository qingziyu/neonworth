import { lazy } from 'react';

/** Cache public code only. A failed speculative request does not poison the
 * loader's next call; React's mounted lazy error still uses the view boundary. */
export function createCodeModule<Module>(importer:()=>Promise<Module>) {
 let pending:Promise<Module>|undefined;
 return {load:()=>{
  if(!pending)pending=Promise.resolve().then(importer).catch(error=>{pending=undefined;throw error;});
  return pending;
 }};
}

const movements=createCodeModule(()=>import('./money-movements'));
const budget=createCodeModule(()=>import('./budget'));
const goals=createCodeModule(()=>import('./goals'));
const yearReview=createCodeModule(()=>import('./year-in-review-view'));
const spending=createCodeModule(()=>import('./spending-composition'));
const income=createCodeModule(()=>import('./income'));
const apple=createCodeModule(()=>import('./apple-card-spending'));
const retirement=createCodeModule(()=>import('./retirement'));
const recurring=createCodeModule(()=>import('./recurring-review'));
const charts=createCodeModule(()=>import('./dashboard-charts'));

// Stable module-level identities preserve mounted state across parent renders.
export const MoneyMovements=lazy(movements.load);
export const Budget=lazy(budget.load);
export const Goals=lazy(goals.load);
export const YearInReview=lazy(yearReview.load);
export const SpendingComposition=lazy(spending.load);
export const Income=lazy(income.load);
export const AppleCardSpending=lazy(apple.load);
export const Retirement=lazy(retirement.load);
export const RecurringReview=lazy(recurring.load);
export const IncomeSpendingChart=lazy(()=>charts.load().then(module=>({default:module.IncomeSpendingChart})));
export const SpendingTrendChart=lazy(()=>charts.load().then(module=>({default:module.SpendingTrendChart})));
export const NetWorthChart=lazy(()=>charts.load().then(module=>({default:module.NetWorthChart})));

const sectionCode:Record<string,Array<{load:()=>Promise<unknown>}>>={
 Overview:[charts],Spending:[charts,spending],Budget:[budget],Goals:[goals],
 'Year in Review':[yearReview],'Cash flow':[charts,apple],Income:[income],
 'Money movements':[movements],Retirement:[retirement],'Recurring bills':[recurring],'Net worth':[charts],
};

/** Call only for a destination the user points to or focuses. Importing code
 * does not mount its components, run their effects or read financial endpoints. */
export async function preloadReport(section:string):Promise<boolean> {
 const results=await Promise.allSettled((sectionCode[section]??[]).map(module=>module.load()));
 return results.every(result=>result.status==='fulfilled');
}
