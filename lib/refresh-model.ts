import { FINANCE_CONFIG } from './finance-config.ts';
import type { Account, Dataset, Transaction } from './finance';
import { labelCategory } from './finance';
import { isZelleTransaction } from './transaction-policy';
import { isRetirementAccount } from './retirement';
import { datasetSchema } from './store-validation';
import { GENERATED_CATEGORY_REVIEW_NOTE } from './history-reconciliation';

export type SourcePage = {cursor:string|null; result:{items:Record<string,any>[]; has_more:boolean; next_cursor?:string|null; coverage?:Record<string,any>}};
export type RefreshBundle = {accounts:Record<string,any>; bank:SourcePage[]; inflows:SourcePage[]; investments:SourcePage[]; recurring:SourcePage[]; netWorth:Record<string,any>; rsuPrices?:NonNullable<Dataset['incomeEvidence']>['rsuPrices']};
export type RefreshRun = {id:string;status:'running'|'succeeded'|'failed';startedAt:string;finishedAt?:string;start:string;end:string;baseSyncedAt:string;error?:string;report?:Record<string,any>};
export type RefreshState = {lastRun?:RefreshRun;lastSuccess?:RefreshRun;schedule?:{id:string;enabled:boolean;timezone:string;hour:number;verifiedAt:string}};
const fail=(message:string):never=>{throw new Error(message)};
const finite=(value:unknown,label:string):number=>typeof value==='number'&&Number.isFinite(value)?value:fail(`Missing or invalid ${label}; the saved snapshot was kept.`);
const usd=(row:Record<string,any>)=>{if(row.iso_currency_code!=='USD'||row.unofficial_currency_code)fail('A source record has an unsupported or unknown currency. The saved snapshot was kept.');};
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value?value:fail('Invalid source date.');
const id=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=200&&!['__proto__','constructor','prototype'].includes(value)?value:fail('Missing source ID.');
const cents=(n:number)=>Math.round(n*100);
export function localToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:FINANCE_CONFIG.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function refreshWindow(data:Dataset,now=new Date()){
 const end=localToday(now),d=new Date(data.asOf+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-60);
 // On the first of the month, re-read all saved history to catch older corrections.
 const start=end.endsWith('-01')?data.dateRange.start:[data.dateRange.start,d.toISOString().slice(0,10)].sort().at(-1)!;
 if(end<data.asOf)fail('The saved reporting date is ahead of today.');return {start,end};
}
export function sourceRows(pages:SourcePage[],family:string,requireCoverage=true){
 if(!Array.isArray(pages)||!pages.length||pages.length>1000)fail(`No complete ${family} pages.`);
 let expected:string|null=null;const seen=new Set<string>(),rows:Record<string,any>[]=[];
 for(let i=0;i<pages.length;i++){
  const page=pages[i],r=page?.result;
  if(page?.cursor!==expected||!r||!Array.isArray(r.items)||typeof r.has_more!=='boolean')fail(`Broken ${family} pagination.`);
  if(requireCoverage&&(r.coverage?.is_complete_for_query!==true||r.coverage?.availability!=='ready'))fail(`${family} coverage is incomplete; the saved snapshot was kept.`);
  if(r.has_more){if(typeof r.next_cursor!=='string'||!r.next_cursor||seen.has(r.next_cursor)||i===pages.length-1)fail(`Incomplete ${family} pagination.`);seen.add(r.next_cursor!);expected=r.next_cursor!;}
  else if(i!==pages.length-1||r.next_cursor!=null)fail(`Invalid ${family} terminal page.`);
  rows.push(...r.items);
 }
 return rows;
}
function unique(rows:Record<string,any>[],key:string,label:string){const map=new Map<string,Record<string,any>>();for(const row of rows){const k=id(row[key]);if(map.has(k))fail(`Duplicate ${label} source IDs. Re-read the pages.`);map.set(k,row);}return map;}
function inWindow(rows:Record<string,any>[],run:RefreshRun,accounts:Set<string>){for(const row of rows){usd(row);const d=date(row.date);if(d<run.start||d>run.end||!accounts.has(id(row.account_id)))fail('Source records fall outside the requested date/account scope.');finite(row.amount,'transaction amount');}}
export function buildRefresh(previous:Dataset,overrides:Record<string,Partial<Transaction>>,run:RefreshRun,bundle:RefreshBundle,now=new Date()){
 if(!bundle||!bundle.accounts?.institutions?.length||bundle.accounts.institutions.some((i:any)=>i.account_coverage?.is_complete_for_query!==true||i.account_coverage?.availability!=='ready'))fail('Linked-account coverage is incomplete.');
 const oldAccounts=new Map(previous.accounts.map(a=>[a.id,a])),accounts:Account[]=[],active=new Set<string>();
 for(const institution of bundle.accounts.institutions){
  if(institution.status!=='linked'||institution.sync_status!=='synced')fail('An institution is not fully synced. Reconnect it in Finances before updating.');
  for(const a of institution.accounts){
   const key=id(a.account_id);if(active.has(key))fail('Duplicate source account.');active.add(key);usd(a.balances);
   const old=oldAccounts.get(key),balanceDate=a.balances.balance_date?date(a.balances.balance_date.slice(0,10)):null;
   accounts.push({...old,id:key,name:old?.name||a.name,institution:institution.institution?.name||old?.institution||'Unknown institution',officialName:a.official_name||old?.officialName||a.name,type:a.type,subtype:a.subtype||'',mask:a.mask||'',balance:finite(a.balances.display_balance??a.balances.current,'account balance'),netBalance:finite(a.balances.net_balance,'signed account balance'),balanceDate,balanceAgeKnown:!!balanceDate,syncStatus:institution.sync_status});
  }
 }
 const missingAccounts=previous.accounts.filter(a=>!active.has(a.id));
 // An absent account is not a zero balance. Keep its last recorded value and history.
 accounts.push(...missingAccounts.map(a=>({...a,syncStatus:'Missing from latest feed'})));
 if(accounts.some(a=>!oldAccounts.has(a.id))&&run.start!==previous.dateRange.start)fail('A new account needs a full historical backfill. Begin again with fullHistory true.');
 const known=new Set(accounts.map(a=>a.id));
 const bank=sourceRows(bundle.bank,'Bank transactions'),inflows=sourceRows(bundle.inflows,'Posted inflows'),investments=sourceRows(bundle.investments,'Investment transactions',false),recurring=sourceRows(bundle.recurring,'Recurring transactions');
 inWindow(bank,run,known);inWindow(inflows,run,known);inWindow(investments,run,known);
 const fresh=unique(bank,'transaction_id','bank'),inflowMap=unique(inflows,'transaction_id','inflow'),investmentMap=unique(investments,'investment_transaction_id','investment');unique(recurring,'stream_id','recurring');
 const actualInflows=bank.filter(r=>r.pending===false&&r.amount<0);
 if(inflows.some(r=>r.pending!==false||r.amount>=0)||actualInflows.length!==inflows.length||actualInflows.some(r=>!inflowMap.has(r.transaction_id)||cents(inflowMap.get(r.transaction_id)!.amount)!==cents(r.amount)))fail('The independent inflow check did not reconcile.');
 const prior=new Map(previous.transactions.map(t=>[t.id,t])),removedPending:string[]=[],updated:string[]=[],added:string[]=[],superseded=new Set<string>();
 for(const r of bank){if(typeof r.pending!=='boolean')fail('A transaction is missing its posting state.');if(!r.pending&&r.pending_transaction_id){const key=id(r.pending_transaction_id),old=prior.get(key);if(old&&!old.pending)fail('A posted source record was linked as pending.');superseded.add(key);}}
 const missingPosted:Transaction[]=[];
 const transactions=previous.transactions.filter(t=>{
  if(superseded.has(t.id)||t.pending&&active.has(t.accountId)&&t.date>=run.start&&t.date<=run.end&&!fresh.has(t.id)){if(overrides[t.id])fail('A pending record with saved corrections changed IDs; reconcile its correction first.');removedPending.push(t.id);return false;}
  if(!t.pending&&active.has(t.accountId)&&t.date>=run.start&&t.date<=run.end&&!fresh.has(t.id))missingPosted.push(t);
  return true;
 });
 const missingIds=new Set(missingPosted.map(t=>t.id));
 const merged=new Map(transactions.map(t=>[t.id,missingIds.has(t.id)?{...t,sourceMissingSince:(t as any).sourceMissingSince||run.end}:t]));
 for(const r of bank){
  const old=prior.get(r.transaction_id),changed=!!old&&(old.accountId!==r.account_id||old.date!==r.date||cents(old.amount)!==cents(r.amount));
  if(changed&&overrides[r.transaction_id])fail('A reviewed source amount, date or account changed. The saved snapshot was kept so your decision is not applied to different evidence.');
  if(changed)updated.push(r.transaction_id);if(!old)added.push(r.transaction_id);
  const category=labelCategory(r.personal_finance_category?.primary||'other'),confidence=r.personal_finance_category?.confidence_level||'UNKNOWN';
  const flow=category==='Transfers'||r.amount<0?'review':'expense';
  const categoryUncertain=category==='Other'||['LOW','UNKNOWN'].includes(confidence);
  // Record why this new flag was generated so category uncertainty can become
  // optional without treating arbitrary blank-note historical flags as advice.
  const generatedNote=flow==='expense'&&r.amount>0&&categoryUncertain?GENERATED_CATEGORY_REVIEW_NOTE:'';
  const base:Transaction=old||{id:r.transaction_id,date:r.date,accountId:r.account_id,amount:r.amount,merchant:r.merchant_name||r.name||'Unknown merchant',category,flow,confidence,exceptional:false,note:generatedNote,pending:r.pending,review:flow==='review'||categoryUncertain};
  const sourceLocation=r.location?Object.fromEntries(['city','region','country'].filter(k=>typeof r.location[k]==='string').map(k=>[k,r.location[k]])):undefined;
  merged.set(r.transaction_id,{...base,date:r.date,accountId:r.account_id,amount:r.amount,merchant:r.merchant_name||r.name||base.merchant,sourceName:r.name||'',pending:r.pending,sourceCategoryDetailed:r.personal_finance_category?.detailed||null,transferAccountId:r.transfer_to_account_id||null,transferTransactionId:r.transfer_transaction_id||null,...(sourceLocation?{sourceLocation}:{}),...(r.payment_channel?{sourcePaymentChannel:r.payment_channel}:{}),sourceMissingSince:null,sourcePendingTransactionId:r.pending_transaction_id||null,sourceCurrency:r.iso_currency_code,sourceProviderCategory:r.personal_finance_category||null} as Transaction);
 }
 const allTransactions=[...merged.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const income=previous.incomeEvidence;if(!income)throw new Error('Existing income evidence is required for a safe refresh.');
 const incomeRecords=new Map(income.investmentRecords.map(r=>[r.id,r])),retirementRecords=new Map((previous.retirementEvidence?.records||[]).map(r=>[r.id,r]));
 const retirementIds=new Set(accounts.filter(isRetirementAccount).map(a=>a.id));
 for(const [key,r]of investmentMap){
  const old=incomeRecords.get(key)||retirementRecords.get(key);
  if(r.type==='cancel'||r.cancel_transaction_id||r.cancel_id)fail('An investment cancellation needs reconciliation before updating.');
  if(old&&(old.accountId!==r.account_id||old.date!==r.date||old.type!==r.type||old.subtype!==r.subtype||cents(old.amount)!==cents(r.amount)||old.quantity!==undefined&&old.quantity!==r.quantity||old.ticker!==undefined&&(old.ticker??'')!==(r.ticker_symbol||'')))fail('A saved investment record changed. The last good snapshot was kept for reconciliation.');
  const record={id:key,date:r.date,accountId:r.account_id,description:r.name||'',type:r.type,subtype:r.subtype,amount:r.amount,quantity:finite(r.quantity,'investment quantity'),price:finite(r.price,'investment price'),fees:finite(r.fees,'investment fees'),ticker:r.ticker_symbol||'',currency:r.iso_currency_code,cancelId:r.cancel_transaction_id||r.cancel_id||null};
  incomeRecords.set(key,record);
  if(retirementIds.has(r.account_id))retirementRecords.set(key,{...record,transactionDatetime:r.transaction_datetime||null,counterpartyAccountId:r.transfer_to_account_id||null,counterpartRecordId:r.transfer_transaction_id||null});
 }
 const stamp=now.toISOString(),prices=new Map((income.rsuPrices||[]).map(p=>[p.date+'|'+p.ticker,p]));
 for(const price of bundle.rsuPrices||[]){if(prices.has(price.date+'|'+price.ticker)&&JSON.stringify(prices.get(price.date+'|'+price.ticker))!==JSON.stringify(price))fail('A verified RSU price cannot be overwritten during a routine refresh.');prices.set(price.date+'|'+price.ticker,price);}
 const net=bundle.netWorth;
 if(!net?.has_net_worth_data||net.currency_code!=='USD'||net.account_coverage?.is_complete_for_query!==true||net.currency_conversion?.omitted_currency_codes?.length)fail('Net-worth source coverage is unavailable.');
 const balanceTotal=accounts.filter(a=>active.has(a.id)).reduce((n,a)=>n+a.netBalance,0);
 if(Math.abs(balanceTotal-finite(net.current_value,'current net worth'))>1)fail('Account balances and net worth disagree. Re-read both sources.');
 const points=net.interval_views?.MAX?.chart_points||net.chart_points;if(!Array.isArray(points)||!points.length)fail('No dated net-worth observations.');
 // Net worth has independent source dates. After UTC midnight its latest
 // observation can be one day ahead of the Los Angeles transaction window.
 const netWorthDateLimit=stamp.slice(0,10);
 const history=new Map(previous.netWorthHistory.map(p=>[p.date,p]));for(const p of points){const d=date(p.date);if(d>netWorthDateLimit)fail('Net-worth observation is after the server retrieval date.');history.set(d,{date:d,value:finite(p.net_worth,'net worth'),events:p.first_balance_events||[]});}
 const rows=[...incomeRecords.values()],retRows=[...retirementRecords.values()];
 const accountHistory=accounts.map(a=>{const rowsForAccount=rows.filter(r=>r.accountId===a.id).sort((a,b)=>a.date.localeCompare(b.date));return rowsForAccount.length?{accountId:a.id,firstDate:rowsForAccount[0].date,lastDate:rowsForAccount.at(-1)!.date,recordCount:rowsForAccount.length}:null;}).filter((x):x is NonNullable<typeof x>=>x!==null);
 const bankInflows=allTransactions.filter(t=>!t.pending&&t.amount<0);
 const retirementStart=[previous.retirementEvidence?.scope.start||previous.dateRange.start,run.start].sort()[0];
 const dataset:Dataset={...previous,asOf:run.end,syncedAt:stamp,dateRange:{start:previous.dateRange.start,end:run.end},accounts,transactions:allTransactions,recurring,netWorthHistory:[...history.values()].sort((a,b)=>a.date.localeCompare(b.date)),coverage:{...previous.coverage,accounts:{is_complete_for_query:missingAccounts.length===0,freshness:'unknown',availability:'ready',state:missingAccounts.length?'partial':'complete'},transactions:{...previous.coverage.transactions as object,...bundle.bank[0].result.coverage,is_complete_for_query:!missingAccounts.length&&!allTransactions.some(t=>(t as any).sourceMissingSince)&&((previous.coverage.transactions as any)?.is_complete_for_query===true||run.start===previous.dateRange.start)},recurring:bundle.recurring[0].result.coverage,refresh:{start:run.start,end:run.end,checkedAt:stamp,missingAccountIds:missingAccounts.map(a=>a.id),investmentCompleteness:'unknown',balanceFreshness:'unknown',bankPageCoverage:bundle.bank[0].result.coverage,sourceDifferences:allTransactions.filter(t=>(t as any).sourceMissingSince).map(t=>({id:t.id,date:t.date,merchant:t.merchant,amount:t.amount,isZelle:isZelleTransaction({...t,...overrides[t.id]}),firstMissing:(t as any).sourceMissingSince}))}},incomeEvidence:{...income,asOf:run.end,readAt:stamp,bankCoverage:bundle.bank[0].result.coverage!,bankInflowCount:bankInflows.length,bankInflowTotal:bankInflows.reduce((n,t)=>n-cents(t.amount),0)/100,pendingInflowCount:allTransactions.filter(t=>t.pending&&t.amount<0).length,investmentRecords:rows,accountHistory,rsuPrices:[...prices.values()]},retirementEvidence:{version:1,scope:{start:retirementStart,end:run.end,sourceReadAt:stamp,isCompleteForQuery:null,freshness:'unknown',description:'Available investment records; pagination was exhausted, but the source does not establish complete brokerage history.'},accountScopes:accounts.filter(isRetirementAccount).map(a=>{const rows=retRows.filter(r=>r.accountId===a.id).sort((a,b)=>a.date.localeCompare(b.date));return {accountId:a.id,firstRecordDate:rows[0]?.date||null,lastRecordDate:rows.at(-1)?.date||null,recordCount:rows.length,coverageComplete:null,freshness:'unknown'};}),records:retRows,notes:previous.retirementEvidence?.notes||[]}};
 const parsed=datasetSchema.parse(dataset);
 return {dataset:parsed,report:{window:{start:run.start,end:run.end},bankRows:bank.length,postedInflows:inflows.length,inflowTotal:inflows.reduce((n,r)=>n-cents(r.amount),0)/100,investmentRows:investments.length,recurringStreams:recurring.length,newTransactions:added.length,changedTransactions:updated.length,removedPending:removedPending.length,missingAccounts:missingAccounts.map(a=>a.name),sourceDifferences:allTransactions.filter(t=>(t as any).sourceMissingSince).map(t=>({id:t.id,date:t.date,merchant:t.merchant,amount:t.amount,isZelle:isZelleTransaction({...t,...overrides[t.id]}),firstMissing:(t as any).sourceMissingSince})),sourceFreshness:'unknown',investmentCompleteness:'unknown',netWorthThrough:[...history.keys()].sort().at(-1)}};
}
