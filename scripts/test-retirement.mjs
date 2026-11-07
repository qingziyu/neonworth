import assert from 'node:assert/strict';
import {classifyRetirementRecord,isContributionRecord,summarizeRetirement} from '../lib/retirement.ts';
const account=(id,name,subtype,mask)=>({id,name,subtype,mask,institution:'Test',type:'investment',balance:100,netBalance:100,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const accounts=[account('plan','Test 401(K) PLAN','401k','1111'),account('old','Prior 401(K) PLAN','401k','2222'),account('ira','Traditional IRA','ira','3333'),account('roth','Roth IRA','roth','4444'),account('empty','Empty Roth IRA','roth','5555')];
const record=(id,amount,description,extra={})=>({id,accountId:'plan',date:'2026-03-05',description,amount,type:'cash',subtype:'contribution',currency:'USD',...extra});
const data=records=>({version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2026-01-01',end:'2026-10-25'},coverage:{},accounts,transactions:[],netWorthHistory:[],recurring:[],notes:[],retirementEvidence:{version:1,scope:{start:'2026-01-01',end:'2026-10-25',sourceReadAt:null,isCompleteForQuery:null,freshness:'unknown',description:'Test source'},accountScopes:accounts.map(a=>({accountId:a.id,firstRecordDate:null,lastRecordDate:null,recordCount:0,coverageComplete:null,freshness:'unknown'})),records,notes:[]}});
assert.equal(classifyRetirementRecord(record('pre',-100,'Employee pre-tax contribution'),accounts).taxTreatment,'pretax');
assert.equal(classifyRetirementRecord(record('r',-100,'Employee Roth after-tax contribution'),accounts).taxTreatment,'roth');
assert.equal(classifyRetirementRecord(record('a',-100,'Employee after-tax NON-ROTH contribution'),accounts).taxTreatment,'aftertax');
assert.equal(classifyRetirementRecord(record('a2',-100,'Non-Roth after-tax contribution'),accounts).taxTreatment,'aftertax');
assert.equal(classifyRetirementRecord(record('unknown',-100,'Index fund contribution'),accounts).taxTreatment,'unknown');
assert.equal(classifyRetirementRecord(record('ira',-100,'IRA contribution',{accountId:'ira'}),accounts).taxTreatment,'unknown');
assert.equal(isContributionRecord(record('buy',100,'Contribution allocation purchase',{type:'buy',subtype:'buy'}),accounts),false);
assert.equal(isContributionRecord(record('buy2',100,'Contribution allocation purchase',{type:'buy',subtype:'contribution'}),accounts),false);
const funded=data([record('pre',-100,'Employee pre-tax contribution'),record('r',-50,'Employee Roth contribution'),record('a',-20,'Employee non-Roth after-tax contribution'),record('unknown',-30,'IRA contribution',{accountId:'ira'}),record('match',-100,'Employer pretax matching contribution'),record('return',20,'Employee pretax contribution refund')]);
let s=summarizeRetirement(funded,'2026');
assert.equal(s.grossContributions,300);assert.equal(s.contributionAdjustments,20);assert.equal(s.netContributions,280);
assert.deepEqual(s.buckets,{pretax:180,roth:50,afterTax:20,unknown:30});assert.equal(s.employerContributions,100);assert.equal(s.employeeContributions,150);assert.equal(s.unknownContributor,30);
assert.equal(s.accounts.length,5);assert.equal(s.balanceAgeKnown,false);assert.equal(s.accounts.find(a=>a.accountId==='empty').netContributions,0);assert.equal(s.accounts.find(a=>a.accountId==='empty').coverageComplete,null);
// A real new IRA contribution and its later conversion are separate events, never two new contributions.
const conversion=data([record('deposit',-800,'IRA contribution',{accountId:'ira'}),record('convert-out',800,'Contribution to Roth IRA account ending in 4444 - TRANSFER',{accountId:'ira',type:'transfer',subtype:'transfer',transactionDatetime:'2026-03-05T12:00:00Z'}),record('convert-in',-800,'Contribution from Traditional IRA account ending in 3333 - TRANSFER',{accountId:'roth',type:'transfer',subtype:'transfer',transactionDatetime:'2026-03-05T12:00:00Z'})]);
s=summarizeRetirement(conversion,'2026');assert.equal(s.grossContributions,800);assert.equal(s.conversions,800);assert.equal(s.events.filter(e=>e.kind==='conversion').length,1);assert.equal(s.events.find(e=>e.kind==='conversion').paired,true);assert.equal(s.buckets.unknown,800);
assert.equal(s.accounts.find(a=>a.accountId==='roth').conversionsIn,800);assert.equal(s.accounts.find(a=>a.accountId==='ira').conversionsOut,800);
// Generic deposits do not establish new contributions; realized-gain/loss withdrawals are bookkeeping.
const generic=data([record('deposit',-700,'Deposit',{subtype:'deposit'}),record('book',50,'Fund - realizedGainLoss',{subtype:'withdrawal'}),record('dividend',-12,'Cash dividend',{subtype:'dividend'}),record('withdrawal',60,'Retirement distribution',{subtype:'withdrawal'})]);
s=summarizeRetirement(generic,'2026');assert.equal(s.grossContributions,0);assert.equal(s.unclassifiedAmount,700);assert.equal(s.withdrawals,60);
// Reciprocal explicit rollover references pair once; amount/date coincidence alone never establishes a pair.
const rollover=data([record('roll-out',1000,'Rollover to IRA account ending in 3333',{type:'transfer',subtype:'transfer'}),record('roll-in',-1000,'Rollover from 401(k) account ending in 1111',{accountId:'ira',type:'transfer',subtype:'transfer'})]);
s=summarizeRetirement(rollover,'2026');assert.equal(s.rollovers,1000);assert.equal(s.netContributions,0);assert.equal(s.events.length,1);
const unpaired=data([record('out',1000,'Rollover',{type:'transfer',subtype:'transfer'}),record('in',-1000,'Rollover',{accountId:'ira',type:'transfer',subtype:'transfer'})]);
assert.equal(summarizeRetirement(unpaired,'2026').events.length,2);
// User classifications affect eligible contributions only and preserve source records.
const before=JSON.stringify(funded.retirementEvidence.records);
s=summarizeRetirement(funded,'2026',undefined,{unknown:{taxTreatment:'aftertax',contributor:'employee',note:'From statement'}});assert.equal(s.buckets.afterTax,50);assert.equal(s.buckets.unknown,0);assert.equal(s.employeeContributions,180);assert.equal(JSON.stringify(funded.retirementEvidence.records),before);
assert.equal(summarizeRetirement(conversion,'2026',undefined,{'convert-in':{taxTreatment:'roth'}}).grossContributions,800);
assert.ok(s.events.every(e=>e.taxYear===null&&e.taxYearSource==='unknown'));
assert.equal(summarizeRetirement(data([]),'2026').accounts.length,5);assert.equal(summarizeRetirement(data([]),'2026').sourceRecordCount,0);assert.equal(summarizeRetirement(data([]),'2026').trend.every(m=>!m.hasRecords),true);
assert.equal(summarizeRetirement(funded,'2026-04').grossContributions,0);
console.log('PASS: explicit pretax/Roth/after-tax non-Roth; unknown traditional IRA deductibility; contributor split; gross/net corrections; rollover and conversion pairing; no funding double-count; trades/dividends/bookkeeping excluded; generic deposits unknown; immutable overrides; unknown history/tax year; all accounts retained.');
