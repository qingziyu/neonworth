import { resolvePeriod, type PeriodMode } from './periods.ts';
import type { Account, Dataset } from './finance';
export type RetirementTaxTreatment='pretax'|'aftertax'|'roth'|'unknown';
export type RetirementContributor='employee'|'employer'|'unknown';
export type RetirementKind='contribution'|'contribution-adjustment'|'conversion'|'rollover'|'withdrawal'|'transfer'|'dividend'|'realized-gain-loss'|'fee'|'trade'|'unknown';
export interface RetirementRecord {id:string;accountId:string;date:string;description:string;amount:number;type:string;subtype:string;currency:string;transactionDatetime?:string|null;quantity?:number;ticker?:string|null;cancelId?:string|null;counterpartyAccountId?:string|null;counterpartRecordId?:string|null}
export interface RetirementAccountScope {accountId:string;firstRecordDate:string|null;lastRecordDate:string|null;recordCount:number;coverageComplete:boolean|null;freshness:string}
export interface RetirementEvidence {version:1;scope:{start:string;end:string;sourceReadAt:string|null;isCompleteForQuery:boolean|null;freshness:string;description:string};accountScopes:RetirementAccountScope[];records:RetirementRecord[];notes:string[]}
export interface RetirementOverride {taxTreatment?:RetirementTaxTreatment;contributor?:RetirementContributor;note?:string}
export type RetirementOverrideMap=Record<string,RetirementOverride>;
export interface RetirementBuckets {pretax:number;roth:number;afterTax:number;unknown:number}
export interface RetirementClassification {kind:RetirementKind;taxTreatment:RetirementTaxTreatment;contributor:RetirementContributor;reason:string;counterpartyAccountId:string|null}
export interface RetirementEvent {id:string;date:string;accountId:string;accountIds:string[];accountName:string;description:string;amount:number;kind:RetirementKind;taxTreatment:RetirementTaxTreatment;contributor:RetirementContributor;reason:string;sourceIds:string[];legs:Array<{id:string;accountId:string;date:string;description:string;amount:number}>;paired:boolean;manualClassification:boolean;countedInPeriod:boolean;taxYear:number|null;taxYearSource:'explicit description'|'unknown'}
export interface RetirementAccountSummary {accountId:string;name:string;institution:string;planType:string;balance:number;balanceDate:string|null;balanceAgeKnown:boolean;firstRecordDate:string|null;lastRecordDate:string|null;recordCount:number;coverageComplete:boolean|null;contributionRecordCount:number;hasContributionEvidence:boolean;buckets:RetirementBuckets;grossContributions:number;contributionAdjustments:number;netContributions:number;employerContributions:number;employeeContributions:number;unknownContributor:number;conversionsIn:number;conversionsOut:number;withdrawals:number;unclassifiedAmount:number}
export interface RetirementSummary {period:string;start:string;end:string;balance:number;balanceAgeKnown:boolean;accounts:RetirementAccountSummary[];buckets:RetirementBuckets;grossContributions:number;contributionAdjustments:number;netContributions:number;employeeContributions:number;employerContributions:number;unknownContributor:number;rollovers:number;conversions:number;withdrawals:number;unclassifiedAmount:number;events:RetirementEvent[];trend:Array<RetirementBuckets&{month:string;label:string;grossContributions:number;netContributions:number;employerContributions:number;hasRecords:boolean}>;coverageNote:string;notes:string[];sourceRecordCount:number;contributionRecordCount:number;hasContributionEvidence:boolean}
const cent=(n:number)=>Math.round(n*100),plus=(a:number,b:number)=>(cent(a)+cent(b))/100;
const emptyBuckets=():RetirementBuckets=>({pretax:0,roth:0,afterTax:0,unknown:0});
const bucketKey=(t:RetirementTaxTreatment):keyof RetirementBuckets=>t==='aftertax'?'afterTax':t;
export const isRetirementAccount=(a:Account)=>/401\s*\(?k\)?|\bira\b/i.test(a.name)||['ira','roth','401k','403b','457b'].includes(a.subtype.toLowerCase());
const traditional=(a:Account|undefined)=>!!a&&a.subtype.toLowerCase()==='ira'&&!/roth/i.test(a.name);
const roth=(a:Account|undefined)=>!!a&&(a.subtype.toLowerCase()==='roth'||/roth/i.test(a.name));
function counterpart(r:RetirementRecord,accounts:Account[]):Account|undefined {
  if(r.counterpartyAccountId)return accounts.find(a=>a.id===r.counterpartyAccountId);
  const mask=r.description.match(/\b(?:account\s+)?ending(?:\s+in)?\s+(\d{2,8})\b/i)?.[1];
  const matched=mask?accounts.filter(a=>a.id!==r.accountId&&a.mask===mask):[];
  return matched.length===1?matched[0]:undefined;
}
export function classifyRetirementRecord(r:RetirementRecord,accounts:Account[]):RetirementClassification {
  const name=r.description.toLowerCase(),type=r.type.toLowerCase(),sub=r.subtype.toLowerCase();
  const account=accounts.find(a=>a.id===r.accountId),other=counterpart(r,accounts);
  const result:RetirementClassification={kind:'unknown',taxTreatment:'unknown',contributor:'unknown',reason:'Source does not establish a new retirement contribution or its tax treatment.',counterpartyAccountId:other?.id||null};
  if(type==='cancel'||r.cancelId){result.reason='Cancellation or cancelled-source linkage; not counted as a new contribution.';return result;}
  if(/realized\s*gain\s*loss|realizedgainloss/i.test(name)){result.kind='realized-gain-loss';result.reason='Explicit realized-gain/loss bookkeeping. Generic deposit/withdrawal subtypes do not make this a contribution or household withdrawal.';return result;}
  if(type==='fee'||/fee|margin expense/.test(sub)){result.kind='fee';result.reason='Account fee or investment expense; not a retirement contribution.';return result;}
  if(/dividend|interest|capital gain|return of principal/.test(sub)){result.kind='dividend';result.reason='Investment distribution or return; not new retirement funding.';return result;}
  if(['buy','sell'].includes(type)){result.kind='trade';result.reason='Investment trade or reinvestment within the account; not a new contribution.';return result;}
  const explicitMovement=type==='transfer'||sub==='transfer'||/\btransfer\b|\bconversion\b|convert(?:ed|ing)?\b/.test(name);
  const traditionalToRoth=!!other&&((r.amount>0&&traditional(account)&&roth(other))||(r.amount<0&&roth(account)&&traditional(other)));
  if(/\bconversion\b|\broth\s+convert|convert(?:ed|ing)?\s+(?:to\s+)?roth/.test(name)||(explicitMovement&&traditionalToRoth)){
    result.kind='conversion';result.reason=traditionalToRoth?'Source descriptions identify a traditional-to-Roth account movement (conversion indicated). Kept separate from new contributions; taxability is not established.':'Source explicitly labels a conversion. Kept separate from new contributions; taxability is not established.';return result;
  }
  if(/roll[ -]?over|roll[ -]?in/.test(name)){result.kind='rollover';result.reason='Source labels a rollover. Existing retirement assets are moving; this is not a new contribution.';return result;}
  const contribution=sub==='contribution'||/\bcontrib(?:ution|utions)?\b|\bcontr\b|elective deferral|salary deferral/.test(name);
  const retirementSource=!!other&&isRetirementAccount(other)||/\b(?:traditional|roth)\s+ira\b|401\s*\(?k\)?|internal journal|between retirement/.test(name);
  if(explicitMovement&&(!contribution||retirementSource)){result.kind='transfer';result.reason='Account transfer or internal journal. A description containing “contribution” does not establish new funding when another retirement account supplies it.';return result;}
  if(contribution){
    result.kind=r.amount>0||/return|refund|reversal|reversing|correction/.test(name)?'contribution-adjustment':'contribution';
    result.reason=result.kind==='contribution'?'Source explicitly labels a contribution. Tax treatment and employee/employer source remain unknown unless separately identified.':'Source contribution outflow or correction reduces net contributions; it is shown separately from gross funding.';
    const nonRoth=/non[ -]?roth/.test(name),hasRoth=/\broth\b/.test(name)&&!nonRoth,hasPretax=/pre[ -]?tax|before[ -]?tax/.test(name),hasAftertax=/after[ -]?tax|non[ -]?deductible/.test(name);
    if(nonRoth&&hasAftertax)result.taxTreatment='aftertax';
    else if(hasPretax&&!hasRoth)result.taxTreatment='pretax';
    else if(hasRoth&&!hasPretax)result.taxTreatment='roth';
    else if(hasAftertax&&!hasRoth&&!hasPretax)result.taxTreatment='aftertax';
    else if(!hasPretax&&!hasAftertax&&!hasRoth&&!nonRoth&&roth(account)&&sub==='contribution')result.taxTreatment='roth';
    if(/employer|company\s+(?:match|contrib)|\bco contr\b|matching contribution/.test(name))result.contributor='employer';
    else if(/employee|participant|salary deferral|elective deferral|payroll/.test(name))result.contributor='employee';
    return result;
  }
  if(sub==='withdrawal'||sub==='distribution'){result.kind='withdrawal';result.reason='Source withdrawal/distribution. Kept separate from new contributions; no tax or penalty treatment is assumed.';return result;}
  if(/journal|rebalance/.test(name)||type==='transfer'){result.kind='transfer';result.reason='Internal journal or allocation movement; not new retirement funding.';return result;}
  return result;
}
export function isContributionRecord(record:RetirementRecord,accounts:Account[]):boolean {const account=accounts.find(a=>a.id===record.accountId);if(!account||!isRetirementAccount(account))return false;const k=classifyRetirementRecord(record,accounts).kind;return k==='contribution'||k==='contribution-adjustment';}
function groups(records:RetirementRecord[],accounts:Account[]):RetirementRecord[][] {
  const classified=new Map(records.map(r=>[r.id,classifyRetirementRecord(r,accounts)]));
  const edges=new Map<string,Set<string>>();
  for(const a of records){
    const ac=classified.get(a.id)!;if(!['conversion','rollover','transfer'].includes(ac.kind))continue;
    for(const b of records){
      if(a.id===b.id||a.accountId===b.accountId||cent(a.amount)===0||cent(a.amount)!==-cent(b.amount))continue;
      const bc=classified.get(b.id)!;if(ac.kind!==bc.kind)continue;
      const direct=a.counterpartRecordId===b.id||b.counterpartRecordId===a.id;
      const reciprocal=ac.counterpartyAccountId===b.accountId&&bc.counterpartyAccountId===a.accountId&&a.date===b.date&&(!a.transactionDatetime||!b.transactionDatetime||a.transactionDatetime===b.transactionDatetime);
      if(!direct&&!reciprocal)continue;
      if(!edges.has(a.id))edges.set(a.id,new Set());edges.get(a.id)!.add(b.id);
    }
  }
  const lookup=new Map(records.map(r=>[r.id,r])),used=new Set<string>(),result:RetirementRecord[][]=[];
  for(const a of records){if(used.has(a.id))continue;const e=edges.get(a.id),other=e?.size===1?lookup.get([...e][0]):undefined;if(other&&edges.get(other.id)?.size===1&&!used.has(other.id)){result.push([a,other]);used.add(a.id);used.add(other.id);}else{result.push([a]);used.add(a.id);}}
  return result;
}
function event(group:RetirementRecord[],accounts:Account[],overrides:RetirementOverrideMap,start:string,end:string):RetirementEvent {
  const base=group.find(r=>r.amount<0)||group[0],anchor=group.length>1?(group.find(r=>r.amount>0)||base):base;
  const classified=classifyRetirementRecord(base,accounts),o=isContributionRecord(base,accounts)?overrides[base.id]:undefined;
  const explicitTaxYear=base.description.match(/\btax(?:\s+year)?[\s:]+(20\d{2})\b/i)?.[1];
  return {taxYear:explicitTaxYear?Number(explicitTaxYear):null,taxYearSource:explicitTaxYear?'explicit description':'unknown',id:group.length>1?`pair:${group.map(r=>r.id).sort().join(':')}`:base.id,date:anchor.date,accountId:base.accountId,accountIds:group.map(r=>r.accountId),accountName:accounts.find(a=>a.id===base.accountId)?.name||'Unknown account',description:group.map(r=>r.description).join(' / '),amount:Math.abs(cent(base.amount))/100,kind:classified.kind,taxTreatment:o?.taxTreatment||classified.taxTreatment,contributor:o?.contributor||classified.contributor,reason:classified.reason+(o?' User classification'+(o.note?`: ${o.note}`:'.'):''),sourceIds:group.map(r=>r.id),legs:group.map(r=>({id:r.id,accountId:r.accountId,date:r.date,description:r.description,amount:r.amount})),paired:group.length>1,manualClassification:!!o,countedInPeriod:anchor.date>=start&&anchor.date<=end};
}
function funding(events:RetirementEvent[]){
  const buckets=emptyBuckets();let grossContributions=0,contributionAdjustments=0,employerContributions=0,employeeContributions=0,unknownContributor=0;
  for(const e of events){if(!['contribution','contribution-adjustment'].includes(e.kind)||!e.countedInPeriod)continue;const value=-e.legs[0].amount;
    if(e.kind==='contribution')grossContributions=plus(grossContributions,Math.max(value,0));else contributionAdjustments=plus(contributionAdjustments,-value);
    buckets[bucketKey(e.taxTreatment)]=plus(buckets[bucketKey(e.taxTreatment)],value);
    if(e.contributor==='employer')employerContributions=plus(employerContributions,value);else if(e.contributor==='employee')employeeContributions=plus(employeeContributions,value);else unknownContributor=plus(unknownContributor,value);
  }
  return {buckets,grossContributions,contributionAdjustments,netContributions:plus(grossContributions,-contributionAdjustments),employerContributions,employeeContributions,unknownContributor};
}
export function summarizeRetirement(data:Dataset,period:string=data.asOf.slice(0,4),accountId?:string|null,overrides:RetirementOverrideMap={},mode?:PeriodMode):RetirementSummary {
  if(!/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(period))throw new Error('Retirement period must be YYYY or YYYY-MM.');
  const evidence=data.retirementEvidence,resolved=resolvePeriod(data,period.length===4?`${period}-12`:period,mode||(period.length===4?'ytd':'month'));
  const {start,end}=resolved;
  const accounts=data.accounts.filter(a=>isRetirementAccount(a)&&(!accountId||a.id===accountId));
  const retirementIds=new Set(data.accounts.filter(isRetirementAccount).map(a=>a.id));
  const allRecords=(evidence?.records||[]).filter(r=>retirementIds.has(r.accountId));
  const allEvents=groups(allRecords,data.accounts).map(g=>event(g,data.accounts,overrides,start,end));
  const selectedIds=new Set(accounts.map(a=>a.id));
  const events=allEvents.filter(e=>e.accountIds.some(id=>selectedIds.has(id))&&e.legs.some(l=>l.date>=start&&l.date<=end)).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const f=funding(events),sumKind=(kind:RetirementKind)=>events.filter(e=>e.kind===kind&&e.countedInPeriod).reduce((n,e)=>plus(n,e.amount),0);
  const accountSummaries=accounts.map(a=>{
    const scope=evidence?.accountScopes.find(s=>s.accountId===a.id),rows=events.filter(e=>e.accountIds.includes(a.id)),af=funding(rows),records=allRecords.filter(r=>r.accountId===a.id&&r.date>=start&&r.date<=end);
    const planType=/401\s*\(?k\)?/i.test(a.name)?'401(k)':roth(a)?'Roth IRA':a.subtype==='ira'?'Traditional IRA':'Retirement';
    const legSum=(kind:RetirementKind,inflow:boolean)=>rows.filter(e=>e.kind===kind).flatMap(e=>e.legs).filter(l=>l.accountId===a.id&&l.date>=start&&l.date<=end&&(inflow?l.amount<0:l.amount>0)).reduce((n,l)=>plus(n,Math.abs(l.amount)),0);
    return {accountId:a.id,name:a.name,institution:a.institution,planType,balance:a.balance,balanceDate:a.balanceDate,balanceAgeKnown:a.balanceAgeKnown,firstRecordDate:scope?.firstRecordDate||null,lastRecordDate:scope?.lastRecordDate||null,recordCount:records.length,coverageComplete:scope?.coverageComplete??null,contributionRecordCount:records.filter(r=>isContributionRecord(r,data.accounts)).length,hasContributionEvidence:records.some(r=>isContributionRecord(r,data.accounts))||scope?.coverageComplete===true,...af,conversionsIn:legSum('conversion',true),conversionsOut:legSum('conversion',false),withdrawals:legSum('withdrawal',false),unclassifiedAmount:records.filter(r=>classifyRetirementRecord(r,data.accounts).kind==='unknown').reduce((n,r)=>plus(n,Math.abs(r.amount)),0)};
  });
  const trend:RetirementSummary['trend']=[];
  for(const month of resolved.monthKeys){const selected=allEvents.filter(e=>e.date.slice(0,7)===month&&e.date>=start&&e.date<=end&&e.accountIds.some(id=>selectedIds.has(id))),mf=funding(selected.map(e=>({...e,countedInPeriod:true})));trend.push({month,label:new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:resolved.monthKeys[0]?.slice(0,4)!==resolved.monthKeys.at(-1)?.slice(0,4)?'2-digit':undefined,timeZone:'UTC'}),...mf.buckets,grossContributions:mf.grossContributions,netContributions:mf.netContributions,employerContributions:mf.employerContributions,hasRecords:allRecords.some(r=>selectedIds.has(r.accountId)&&r.date>=start&&r.date<=end&&r.date.slice(0,7)===month)});}
  const sourceRecordCount=allRecords.filter(r=>selectedIds.has(r.accountId)&&r.date>=start&&r.date<=end).length;
  return {period,start,end,contributionRecordCount:allRecords.filter(r=>selectedIds.has(r.accountId)&&r.date>=start&&r.date<=end&&isContributionRecord(r,data.accounts)).length,hasContributionEvidence:accountSummaries.some(a=>a.hasContributionEvidence),balance:accounts.reduce((n,a)=>plus(n,a.balance),0),balanceAgeKnown:accounts.length>0&&accounts.every(a=>a.balanceAgeKnown),accounts:accountSummaries,...f,rollovers:sumKind('rollover'),conversions:sumKind('conversion'),withdrawals:sumKind('withdrawal'),unclassifiedAmount:sumKind('unknown'),events,trend,coverageNote:evidence?`Observed available investment records · requested ${evidence.scope.start}–${evidence.scope.end} · historical completeness ${evidence.scope.isCompleteForQuery===true?'confirmed for query scope':evidence.scope.isCompleteForQuery===false?'partial':'unknown'} · source freshness ${evidence.scope.freshness||'unknown'}`:'Retirement contribution history is unavailable. Listed balances do not establish contribution history.',notes:[
    'Contribution amounts use posting dates and observed source records, not confirmed IRS contribution tax years or a complete annual total.',
    'Pretax, after-tax non-Roth and Roth classifications require explicit source evidence or your saved classification. A 401(k) name does not establish pretax treatment; a traditional IRA does not establish deductibility.',
    'Employer contributions remain separate where identified. Unknown contributor amounts must not be assumed employee contributions or employer match.',
    'Gross contributions and contribution corrections are shown separately. Net contributions equal gross funding minus observed contribution adjustments.',
    'Rollovers, traditional-to-Roth movements, internal journals, trades, dividends and realized-gain/loss bookkeeping are excluded from new contributions. Reciprocal explicit account references are paired; equal dates/amounts alone never establish a match.',
    'All tracked retirement accounts remain listed even without contribution evidence. Missing records or months mean unavailable evidence, not verified zero contributions.',
    'Account balances are the latest recorded snapshots. Unknown balance age prevents claims about current balances; account tax-basis breakdown is unavailable.',
    ...(evidence?.notes||[]),
  ],sourceRecordCount};
}
