/** Deployment-level financial conventions. No personal amounts or identities belong here.
 * This version is a USD-only single-owner ledger; multi-currency requires FX evidence.
 * Edit these explicit opt-ins before deployment, never infer them from merchant notes.
 * Empty employer rules preserve source/user-classified income from every employer.
 * An RSU ticker allowlist limits recognized explicit receipts; null permits any ticker.
 * Receipt valuation does not assert gross/net tax basis or infer withheld shares.
 */
export interface FinanceConfig {
 readonly currency:'USD'; readonly locale:string; readonly timeZone:string;
 readonly checkingIncomeNames:readonly string[];
 readonly isolateZelle:boolean; readonly unlinkedAppleCardSpendingProxy:boolean;
 readonly rsuTickers:readonly string[]|null;
 readonly suggestedMonthlyBudget:number;
}
export const FINANCE_CONFIG:FinanceConfig=Object.freeze({
 currency:'USD',locale:'en-US',timeZone:'UTC',checkingIncomeNames:Object.freeze([]),
 isolateZelle:false,unlinkedAppleCardSpendingProxy:false,rsuTickers:null,
 suggestedMonthlyBudget:0,
});
export function allowedRsuTicker(ticker:string|undefined,config:FinanceConfig=FINANCE_CONFIG):boolean {
 return !!ticker&&(!config.rsuTickers||config.rsuTickers.includes(ticker));
}

/** Calendar date in this deployment's reporting zone; never the server's implicit zone. */
export function financialToday(now:Date=new Date()):string {
 return new Intl.DateTimeFormat('en-CA',{timeZone:FINANCE_CONFIG.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
