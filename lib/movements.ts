import { applyIncomePolicy, resolvePeriod, type PeriodMode, type ResolvedPeriod } from './periods.ts';
import type { Account, Dataset, Transaction } from './finance';
import { accountDisplayName } from './classification.ts';
import { isZelleTransaction } from './transaction-policy.ts';
import { createMovementReviewContext, movementReviewReasonWithContext, type MovementReviewContext } from './movement-classification.ts';

export type MovementKind = 'Card repayment' | 'Internal transfer' | 'Investment movement' | 'Asset/debt movement' | 'Other transfer' | 'Bank deposit' | 'Cash withdrawal' | 'Review';
export type MovementMatchStatus = 'paired' | 'linked-only' | 'single-sided' | 'review';
export interface MovementLeg {
  id: string; date: string; accountId: string; accountName: string; institution: string;
  amount: number; pending: boolean; inPeriod: boolean; merchant: string;
}
export interface MovementRow {
  id: string; date: string; anchorDate: string; countedInPeriod: boolean;
  kind: MovementKind; amount: number; source: string; destination: string;
  sourceAccountId: string | null; destinationAccountId: string | null;
  matchStatus: MovementMatchStatus; reason: string; description: string;
  sourceIds: string[]; periodLegIds: string[]; legs: MovementLeg[];
  outsidePeriod: boolean; pending: boolean;
}
export interface MovementTotals {
  outgoing: number; incoming: number; uniqueAmount: number; uniqueCount: number;
  cardRepayments: number; internalTransfers: number; investmentMovements: number;
  assetDebtMovements: number; otherTransfers: number; bankDeposits:number; cashWithdrawals:number;
  reviewAmount: number; reviewCount: number; pendingAmount: number; pendingCount: number;
  pairedCount: number; linkedOnlyCount: number; singleSidedCount: number;
  relatedOutsidePeriodCount: number;
}
export interface MovementSummary {
  rows: MovementRow[]; totals: MovementTotals; period:ResolvedPeriod;
  byKind: Array<{kind: MovementKind; amount: number; count: number}>;
  trend: Array<MovementTotals & {month: string; label: string}>;
  periodLabel: string; notes: string[];
  /** Explicitly excluded Zelle records have a separate ledger. */
  zelle: ZelleSummary;
}
export interface ZelleRow {
  id:string; date:string; accountId:string; accountLabel:string; counterparty:string;
  description:string; direction:'sent'|'received'; amount:number; pending:boolean;
  sourceTransactionId:string;
}
export interface ZelleTotals {
  sent:number; received:number; netReceived:number; postedCount:number;
  pendingCount:number; pendingSent:number; pendingReceived:number;
}
export interface ZelleSummary {
  rows:ZelleRow[]; totals:ZelleTotals;
  trend:Array<ZelleTotals&{month:string;label:string}>;
}
const kinds: MovementKind[] = ['Card repayment','Internal transfer','Investment movement','Asset/debt movement','Other transfer','Bank deposit','Cash withdrawal','Review'];
const cent = (value:number) => Math.round(value*100);
const add = (left:number,right:number) => (cent(left)+cent(right))/100;
const accountLabel = (account:Account|undefined) => account ? `${account.type==='credit'?accountDisplayName(account):`${account.institution} · ${account.name}`}${account.mask ? ` · ${account.mask}` : ''}` : 'Unknown account';
const periodMonths = (data:Dataset) => {
  const result:string[]=[];const cursor=new Date(`${data.dateRange.start.slice(0,7)}-01T12:00:00Z`),last=data.dateRange.end.slice(0,7);
  while(Number.isFinite(cursor.getTime())&&cursor.toISOString().slice(0,7)<=last&&result.length<600){result.push(cursor.toISOString().slice(0,7));cursor.setUTCMonth(cursor.getUTCMonth()+1);}
  return result;
};
function validPair(a:Transaction,b:Transaction|undefined): b is Transaction {
  return !!b && a.id!==b.id && a.accountId!==b.accountId && a.flow==='transfer' && b.flow==='transfer'
    && a.pending===b.pending && cent(a.amount)!==0 && cent(a.amount)===-cent(b.amount)
    && (!b.transferTransactionId || b.transferTransactionId===a.id);
}
function movementKind(legs:Transaction[],accounts:Map<string,Account>,paired:boolean):MovementKind {
  if(legs.some(t=>t.flow==='review'||t.review))return 'Review';
  if(!paired&&legs[0].movementClassification?.kind==='bank_deposit')return 'Bank deposit';
  if(!paired&&legs[0].movementClassification?.kind==='cash_withdrawal')return 'Cash withdrawal';
  const endpointAccounts=legs.map(t=>accounts.get(t.accountId));
  // An explicit saved asset/debt purpose outranks the card used to fund it.
  if(legs.some(t=>/asset|debt|loan|vehicle/i.test(t.category)))return 'Asset/debt movement';
  // Actual ledger endpoints otherwise outrank an ambiguous provider category.
  if(endpointAccounts.some(a=>a?.type==='credit')||legs.some(t=>/credit_card_payment/.test(t.sourceCategoryDetailed||'')))return 'Card repayment';
  if(endpointAccounts.some(a=>a?.type==='investment')||legs.some(t=>/investment_retirement/.test(t.sourceCategoryDetailed||'')))return 'Investment movement';
  if(paired||legs.some(t=>/account_transfer|savings_transfer/.test(t.sourceCategoryDetailed||'')))return 'Internal transfer';
  return 'Other transfer';
}
interface Group { id:string; transactions:Transaction[]; paired:boolean }
function buildGroups(data:Dataset):Group[] {
  // A corrected expense/refund or income stays out even when the provider attaches transfer metadata.
  const candidates=data.transactions.filter(t=>!isZelleTransaction(t)&&((t.flow==='transfer'&&!t.incomePolicyExcluded)||t.flow==='review'));
  const lookup=new Map(candidates.map(t=>[t.id,t]));
  const edges=new Map<string,Set<string>>();
  for(const t of candidates){
    const other=t.transferTransactionId?lookup.get(t.transferTransactionId):undefined;
    if(!validPair(t,other))continue;
    if(!edges.has(t.id))edges.set(t.id,new Set());if(!edges.has(other.id))edges.set(other.id,new Set());
    edges.get(t.id)!.add(other.id);edges.get(other.id)!.add(t.id);
  }
  const visited=new Set<string>(),groups:Group[]=[];
  for(const t of candidates){
    if(visited.has(t.id))continue;
    const links=edges.get(t.id),otherId=links?.size===1?[...links][0]:undefined;
    const other=otherId&&edges.get(otherId)?.size===1?lookup.get(otherId):undefined;
    if(other&&!visited.has(other.id)){
      const pair=[t,other].sort((a,b)=>a.id.localeCompare(b.id));pair.forEach(x=>visited.add(x.id));
      groups.push({id:`pair:${pair.map(x=>x.id).join(':')}`,transactions:pair,paired:true});
    }else{visited.add(t.id);groups.push({id:`record:${t.id}`,transactions:[t],paired:false});}
  }
  return groups;
}
function rowFor(group:Group,month:string,accounts:Map<string,Account>,start:string,end:string,reviewContext:MovementReviewContext):MovementRow {
  const txns=group.transactions;
  const debit=txns.find(t=>t.amount>0),credit=txns.find(t=>t.amount<0),first=txns[0];
  const kind=movementKind(txns,accounts,group.paired);
  const anchor=(group.paired?debit:undefined)||first;
  const inPeriod=txns.filter(t=>t.date>=start&&t.date<=end);
  const pending=txns.some(t=>t.pending),isReview=kind==='Review';
  const linkedOnly=!group.paired&&!!first.transferAccountId;
  const matchStatus:MovementMatchStatus=isReview?'review':group.paired?'paired':linkedOnly?'linked-only':'single-sided';
  const sourceAccountId=debit?.accountId||null,destinationAccountId=credit?.accountId||null;
  const source=sourceAccountId?accountLabel(accounts.get(sourceAccountId)):kind==='Bank deposit'?'Source not provided':'Unknown source';
  const destination=destinationAccountId?accountLabel(accounts.get(destinationAccountId)):kind==='Cash withdrawal'?'Cash (untracked)':'Unknown destination';
  let reason='';
  if(isReview)reason=movementReviewReasonWithContext(first,reviewContext);
  else if(group.paired)reason=kind==='Card repayment'?'Card purchases are recorded as expenses separately. These explicitly linked repayment legs are counted once as a movement.':'Provider explicitly linked these opposite, equal-value account records. Counted once as a movement, excluded from income and consumption spending.';
  else if(!group.paired&&first.movementClassification)reason=first.movementClassification.reason;
  else if(linkedOnly)reason=`Account link only — ${first.amount<0?'source':'destination'} needs review. No matching provider-linked transaction pair is available; the reported link does not verify an own-account transfer.`;
  else if(kind==='Card repayment')reason='Classified as a card repayment. Purchases remain in spending; this source record is excluded to prevent double counting. No matching counterpart record is available.';
  else if(kind==='Asset/debt movement')reason='Classified as an asset conversion or debt movement under the saved accounting treatment; excluded from consumption. This source record is not a matched pair.';
  else reason='Classified as a transfer or investment movement; excluded from income and consumption. A matching counterpart is not present in the available records.';
  if(!group.paired&&first.transferTransactionId)reason+=' The provider referenced a counterpart, but the available rows do not form a valid opposite, equal-value pair.';
  const outsidePeriod=txns.some(t=>t.date<start||t.date>end);
  const countedInPeriod=anchor.date>=start&&anchor.date<=end;
  if(outsidePeriod)reason+=` Cross-period pair: movement value belongs to ${anchor.date.slice(0,7)}, using the debit/funding date. Each account leg keeps its own posting date.`;
  let description=txns.map(t=>t.sourceName||t.merchant).filter((v,i,a)=>a.indexOf(v)===i).join(' / ');
  if(linkedOnly){const reported=accounts.get(first.transferAccountId!);description+=` · Reported account link: ${reported?accountLabel(reported):'unknown endpoint'} (unverified)`;}
  return {
    id:group.id,date:inPeriod.map(t=>t.date).sort().at(-1)||anchor.date,anchorDate:anchor.date,countedInPeriod,kind,
    amount:Math.abs(cent(anchor.amount))/100,source,destination,sourceAccountId,destinationAccountId,
    matchStatus,reason,description,sourceIds:txns.map(t=>t.id),periodLegIds:inPeriod.map(t=>t.id),
    legs:txns.map(t=>({id:t.id,date:t.date,accountId:t.accountId,accountName:accounts.get(t.accountId)?.name||'Unknown account',institution:accounts.get(t.accountId)?.institution||'',amount:t.amount,pending:t.pending,inPeriod:t.date>=start&&t.date<=end,merchant:t.sourceName||t.merchant})),outsidePeriod,pending,
  };
}
function totalsFor(rows:MovementRow[]):MovementTotals {
  const totals:MovementTotals={outgoing:0,incoming:0,uniqueAmount:0,uniqueCount:0,cardRepayments:0,internalTransfers:0,investmentMovements:0,assetDebtMovements:0,otherTransfers:0,bankDeposits:0,cashWithdrawals:0,reviewAmount:0,reviewCount:0,pendingAmount:0,pendingCount:0,pairedCount:0,linkedOnlyCount:0,singleSidedCount:0,relatedOutsidePeriodCount:0};
  const fields:Partial<Record<MovementKind,keyof MovementTotals>>={'Card repayment':'cardRepayments','Internal transfer':'internalTransfers','Investment movement':'investmentMovements','Asset/debt movement':'assetDebtMovements','Other transfer':'otherTransfers','Bank deposit':'bankDeposits','Cash withdrawal':'cashWithdrawals'};
  for(const row of rows){
    if(row.pending){totals.pendingAmount=add(totals.pendingAmount,row.amount);totals.pendingCount++;continue;}
    if(row.kind==='Review'){totals.reviewAmount=add(totals.reviewAmount,row.amount);totals.reviewCount++;continue;}
    for(const leg of row.legs.filter(t=>t.inPeriod)){
      if(leg.amount>0)totals.outgoing=add(totals.outgoing,leg.amount);
      if(leg.amount<0)totals.incoming=add(totals.incoming,-leg.amount);
    }
    if(!row.countedInPeriod){totals.relatedOutsidePeriodCount++;continue;}
    totals.uniqueAmount=add(totals.uniqueAmount,row.amount);totals.uniqueCount++;
    const field=fields[row.kind];if(field)totals[field]=add(totals[field],row.amount);
    if(row.matchStatus==='paired')totals.pairedCount++;
    else if(row.matchStatus==='linked-only')totals.linkedOnlyCount++;
    else totals.singleSidedCount++;
  }
  return totals;
}
function zelleTotalsFor(rows:ZelleRow[]):ZelleTotals {
  const totals:ZelleTotals={sent:0,received:0,netReceived:0,postedCount:0,pendingCount:0,pendingSent:0,pendingReceived:0};
  for(const row of rows){
    if(row.pending){totals.pendingCount++;if(row.direction==='sent')totals.pendingSent=add(totals.pendingSent,row.amount);else totals.pendingReceived=add(totals.pendingReceived,row.amount);continue;}
    totals.postedCount++;if(row.direction==='sent')totals.sent=add(totals.sent,row.amount);else totals.received=add(totals.received,row.amount);
  }
  totals.netReceived=add(totals.received,-totals.sent);
  return totals;
}
function zelleSummary(data:Dataset,period:ResolvedPeriod,accounts:Map<string,Account>):ZelleSummary {
  const rows:ZelleRow[]=data.transactions.filter(t=>isZelleTransaction(t)&&t.date>=period.start&&t.date<=period.end).map(t=>{
    const description=t.sourceName||t.merchant;
    const named=[t.sourceName||'',t.merchant].find(value=>/^zelle(?:®)?\s+(?:(?:payment|transfer)\s+)?(?:to|from)\s+\S/i.test(value.trim()));
    const counterparty=named?.trim().replace(/^zelle(?:®)?\s+(?:(?:payment|transfer)\s+)?(?:to|from)\s+/i,'').trim()||'Counterparty not supplied';
    return {id:t.id,date:t.date,accountId:t.accountId,accountLabel:accountLabel(accounts.get(t.accountId)),counterparty,description,direction:t.amount<0?'received' as const:'sent' as const,amount:Math.abs(cent(t.amount))/100,pending:t.pending,sourceTransactionId:t.id};
  }).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  return {rows,totals:zelleTotalsFor(rows),trend:period.monthKeys.map(month=>({month,label:new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:period.monthKeys[0]?.slice(0,4)!==period.monthKeys.at(-1)?.slice(0,4)?'2-digit':undefined,timeZone:'UTC'}),...zelleTotalsFor(rows.filter(row=>row.date.startsWith(month)))}))};
}
export function summarizeMovements(data:Dataset,month:string,mode:PeriodMode='month'):MovementSummary {
  data=applyIncomePolicy(data);const period=resolvePeriod(data,month,mode);
  const groups=buildGroups(data),accounts=new Map(data.accounts.map(a=>[a.id,a])),reviewContext=createMovementReviewContext(data);
  const rowsFor=(m:string,start:string,end:string)=>groups.filter(g=>g.transactions.some(t=>t.date>=start&&t.date<=end)).map(g=>rowFor(g,m,accounts,start,end,reviewContext)).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const rows=rowsFor(month,period.start,period.end),totals=totalsFor(rows);
  return {
    rows,totals,period,zelle:zelleSummary(data,period,accounts),
    byKind:kinds.map(kind=>{const selected=rows.filter(r=>!r.pending&&r.kind===kind&&r.countedInPeriod);return {kind,amount:selected.reduce((n,r)=>add(n,r.amount),0),count:selected.length};}),
    trend:period.monthKeys.map(m=>{const [y,n]=m.split('-').map(Number),first=`${m}-01`,last=new Date(Date.UTC(y,n,0)).toISOString().slice(0,10);return {month:m,label:new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:period.monthKeys[0]?.slice(0,4)!==period.monthKeys.at(-1)?.slice(0,4)?'2-digit':undefined,timeZone:'UTC'}),...totalsFor(rowsFor(m,first<period.start?period.start:first,last>period.end?period.end:last))};}),
    periodLabel:period.label,
    notes:[
      'Outgoing and incoming are gross posted account legs in the selected exact date window. They are not spending, income or net-worth gains.',
      'Movement value counts an explicit provider-linked, opposite/equal-value pair once. Unmatched source records count separately and are not guaranteed unique economic events.',
      'Paired movement value belongs to the positive/debit funding date. Counterpart records outside the selected window remain visible but do not enter its movement value.',
      'Account-only links do not prove a matched owned-account transfer. A known payment, transfer, deposit or withdrawal can be classified even when its counterpart or economic purpose is not provided. Uncertainty that changes accounting treatment remains in review.',
      'Pending activity, unresolved-purpose records and credits excluded by an explicit income policy are separated from classified posted movement totals.',
      'Only Zelle records excluded by an explicit saved decision or enabled policy appear in the separate Zelle tab. Those records stay outside ordinary movement totals, charts, pending counts and review queues; the payment rail alone does not establish an exclusion, own-account purpose or counterpart pair.',
    ],
  };
}
