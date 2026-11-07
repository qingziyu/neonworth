import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarizeReview } from '../lib/review.ts';
import { deriveDataset } from '../lib/classification.ts';
import { summarizeIncome } from '../lib/income.ts';
import { resolvePeriod } from '../lib/periods.ts';
import { summarizePeriod } from '../lib/finance.ts';

const account=(id,type='depository')=>({id,name:type==='credit'?'Platinum Card®':id,officialName:type==='credit'?'American Express Platinum Card®':id,institution:'Test',type,subtype:type==='credit'?'credit card':'checking',mask:'1234',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const tx=(id,date,amount,merchant,extra={})=>({id,date,merchant,sourceName:merchant,accountId:'card',amount,category:'Services',flow:'expense',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false,sourceCategoryDetailed:'services_digital_other_services',...extra});
const service=(id,name,ids,extra={})=>({stream_id:id,account_id:'card',description:name,merchant_name:name,flow_type:'outflow',frequency:'MONTHLY',first_date:'2025-10-01',last_date:'2026-10-01',last_amount:4.62,average_amount:4.62,is_active:true,transaction_ids:ids,personal_finance_category:{primary:'services',detailed:'services_digital_other_services'},...extra});
const aws=Array.from({length:10},(_,i)=>tx(`aws-${i+1}`,`2026-${String(i+1).padStart(2,'0')}-01`,4.62,'Amazon Web Services'));
const github=Array.from({length:5},(_,i)=>tx(`github-${i+6}`,`2026-${String(i+6).padStart(2,'0')}-20`,4.42,'GitHub'));
const openai=[tx('openai-jun','2026-06-09',20,'OpenAI'),tx('openai-jul','2026-07-09',20,'OpenAI'),tx('openai-aug','2026-08-09',20,'OpenAI'),tx('openai-usage','2026-08-19',80,'OpenAI'),tx('openai-sep','2026-09-19',20,'OpenAI'),tx('openai-oct','2026-10-09',100,'OpenAI')];
const groceries=[4,5,6,7,8,9].map(n=>tx(`groceries-${n}`,`2026-${String(n).padStart(2,'0')}-15`,n<7?100:250,'Whole Foods',{category:'Groceries',sourceCategoryDetailed:'groceries_groceries'}));
const data={version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2025-10-01',end:'2026-10-25'},coverage:{transactions:{is_complete_for_query:true,availability:'ready',window:{start:'2025-10-01',end:'2026-10-25'}}},accounts:[account('checking'),account('card','credit')],netWorthHistory:[],notes:[],incomeEvidence:{version:1,asOf:'2026-10-25',readAt:'2026-10-25T12:00:00Z',bankCoverage:{},investmentCoverage:{isComplete:false,freshness:'unknown',note:'Completeness unknown'},bankInflowCount:0,bankInflowTotal:0,pendingInflowCount:0,investmentRecords:[],accountHistory:[],notes:[],sources:[],rsuPrices:[]},transactions:[
 ...aws,...github,...openai,...groceries,
 tx('aws-old','2025-10-02',28.1,'Amazon Web Services'),
 tx('person-a','2026-03-10',140.1,'Example Merchant H',{sourceName:'Example Merchant H',category:'Dining & coffee',sourceCategoryDetailed:'dining_drinks_restaurants'}),
 tx('person-b','2026-03-10',140.1,'Example Merchant H',{sourceName:'Example Merchant G Counseling',category:'Health & personal care',sourceCategoryDetailed:'health_wellness_other_medical'}),
 tx('fee','2026-03-13',895,'RENEWAL MEMBERSHIP FEE',{category:'Other',sourceCategoryDetailed:'other_other'}),
 tx('fee-order','2026-08-13',100,'MEMBERSHIP RENEWAL FEE',{category:'Financial & insurance',sourceCategoryDetailed:'financial_other_bank_fees'}),
 tx('benefit','2026-07-15',-219,'AMEX CLEAR PLUS CREDIT',{category:'Travel',sourceCategoryDetailed:'travel_other_travel'}),
 tx('ordinary-refund','2026-07-16',-15,'Target',{category:'Shopping',sourceCategoryDetailed:'shopping_superstores'}),
 tx('repayment','2026-07-16',300,'Credit Card Payment',{flow:'transfer',category:'Transfers',sourceCategoryDetailed:'transfers_credit_card_payment'}),
 tx('oneoff','2026-05-01',1200,'Immigration clinic',{category:'Immigration',exceptional:true,note:'User-confirmed one-off immigration cost',sourceCategoryDetailed:'health_wellness_other_medical'}),
 tx('payroll','2026-01-30',-1000,'Amazon Payroll',{accountId:'checking',category:'Income',flow:'income',sourceCategoryDetailed:'income_salary'}),
 tx('zelle','2026-01-30',-9999,'Zelle payment from FRIEND',{reviewDecision:'zelle',accountId:'checking',category:'Income',flow:'income',sourceCategoryDetailed:'income_salary'}),
 tx('coffee-a','2026-06-08',6.36,'Example Venue Coffee',{category:'Dining & coffee',sourceCategoryDetailed:'dining_drinks_coffee'}),
 tx('coffee-b','2026-09-08',6.91,'Example Venue Coffee',{category:'Dining & coffee',sourceCategoryDetailed:'dining_drinks_coffee'}),
 tx('annual-before','2025-12-19',150,'Annual subscription'),
 tx('pending','2026-10-25',6.62,'Oura',{pending:true,category:'Health & personal care',sourceCategoryDetailed:'health_wellness_fitness'}),
 ],recurring:[service('aws','Amazon Web Services',aws.map(t=>t.id).concat('aws-old')),service('github','GitHub',github.map(t=>t.id)),service('openai','OpenAI',['openai-jun','openai-jul','openai-aug','openai-sep']),service('annual','Annual subscription',['annual-before'],{frequency:'ANNUALLY',last_date:'2025-12-19',predicted_next_date:'2026-12-19',last_amount:150,first_date:'2025-12-19'})]};
const original=JSON.stringify(data);
let review=summarizeReview(data,'2026-10','ytd');
assert.equal(JSON.stringify(data),original,'The review must not mutate source records.');
assert.ok(review.findings.length>8,'The review should surface distinct high-signal work, not only one spending total.');
const similar=review.findings.find(f=>f.kind==='similar-charge');assert.equal(similar.confidence,'candidate');assert.equal(similar.amount,280.2);assert.deepEqual([...similar.transactionIds].sort(),['person-a','person-b']);assert.match(similar.why,/no row has been removed or subtracted/i);
assert.equal(similar.queue,'action');assert.equal(similar.isReviewed,false);assert.match(similar.evidenceKey,/^review-v2-[0-9a-f]{16}$/);
assert.ok(review.contextFindings.every(f=>f.queue==='context'&&!f.isReviewed));assert.ok(review.overviewFindings.every(f=>f.queue==='action'&&!f.isReviewed));
assert.equal(review.openFindings.length+review.contextFindings.length+review.reviewedFindings.length,review.findings.length);
assert.ok(review.openFindings.every(f=>f.kind==='similar-charge'),'Only possible duplicate spending creates an acknowledgment task.');
for(const kind of ['service-discovery','service-status','variable-charge','renewal','category-growth','cash-funding','benefit-candidate'])assert.ok(review.findings.filter(f=>f.kind===kind).every(f=>f.queue==='context'),`${kind} remains optional context`);
const acknowledge=(source,finding)=>({...source,reviewPreferences:{findingResolutions:{...(source.reviewPreferences?.findingResolutions||{}),[finding.id]:{state:'reviewed',evidenceKey:finding.evidenceKey,updatedAt:'2026-10-25T12:00:00Z'}},recurringStatuses:{}}});
const acknowledged=acknowledge(data,similar),resolved=summarizeReview(acknowledged,'2026-10','ytd');
assert.ok(resolved.reviewedFindings.some(f=>f.id===similar.id));assert.ok(!resolved.openFindings.some(f=>f.id===similar.id));assert.ok(!resolved.overviewFindings.some(f=>f.id===similar.id));assert.equal(resolved.totalSpend,review.totalSpend,'Reviewing a check must not change spending.');
const nextDay={...acknowledged,asOf:'2026-10-26',dateRange:{...acknowledged.dateRange,end:'2026-10-26'},incomeEvidence:{...acknowledged.incomeEvidence,asOf:'2026-10-26'}};
assert.equal(summarizeReview(nextDay,'2026-10','ytd').findings.find(f=>f.id===similar.id).isReviewed,true,'Unchanged evidence must stay reviewed as the clock advances.');
const changedDescriptor={...acknowledged,transactions:acknowledged.transactions.map(t=>t.id==='person-a'?{...t,sourceName:'Example Merchant H revised statement descriptor'}:t)};
const reopenedDescriptor=summarizeReview(changedDescriptor,'2026-10','ytd').findings.find(f=>f.id===similar.id);assert.equal(reopenedDescriptor.isReviewed,false);assert.equal(reopenedDescriptor.newEvidenceSinceReview,true,'Changed source descriptors must reopen the acknowledged check.');
const variable=review.findings.find(f=>f.kind==='variable-charge'&&f.merchant==='OpenAI');assert.ok(variable);assert.match(variable.summary,/\$20\.00/);assert.match(variable.summary,/\$100\.00/);assert.match(variable.why,/do not identify which explanation/i);
const reviewedVariable=acknowledge(data,variable),newCharge={...reviewedVariable,transactions:[...reviewedVariable.transactions,tx('openai-new','2026-10-23',100,'OpenAI')]};
const reopened=summarizeReview(newCharge,'2026-10','ytd').findings.find(f=>f.id===variable.id);assert.ok(reopened);assert.equal(reopened.isReviewed,false);assert.equal(reopened.newEvidenceSinceReview,true);assert.notEqual(reopened.evidenceKey,variable.evidenceKey,'New charges must not inherit a stale reviewed resolution.');
assert.equal(variable.queue,'context');assert.equal(reopened.queue,'context','New variable-billing evidence remains optional; it does not reopen a required review.');
assert.ok(summarizeReview(reviewedVariable,'2026-10','ytd').reviewedFindings.some(f=>f.id===variable.id),'Existing acknowledgments of optional insights remain saved.');
assert.equal(review.findings.some(f=>f.kind==='variable-charge'&&/Amazon Web Services/.test(f.title)),false,'Old AWS variability must not become a current-year price-change alert.');
assert.equal(review.findings.some(f=>f.id.startsWith('service:')&&/GitHub/.test(f.title)),false,'Already-linked GitHub charges must not be claimed as provider blind spots.');
const inventory=review.findings.find(f=>f.id==='service-inventory');assert.ok(inventory);assert.match(inventory.summary,/GitHub/);assert.match(inventory.why,/Amazon Web Services/);
assert.equal(review.findings.some(f=>f.kind==='service-discovery'&&/Example Venue/.test(f.title)),false,'Repeated coffee purchases are not recurring service commitments.');
const benefits=review.findings.find(f=>f.kind==='card-benefits');assert.ok(benefits);assert.equal(benefits.stats.find(s=>s.label==='Gross membership fees').value,995);assert.equal(benefits.stats.find(s=>s.label==='Explicit benefit credits').value,219);assert.ok(!benefits.transactionIds.includes('ordinary-refund'));assert.ok(!benefits.transactionIds.includes('repayment'));assert.match(benefits.why,/not deducted.*second time/i);
assert.ok(!review.findings.some(f=>f.kind==='variable-charge'&&/membership fee/i.test(f.title)),'Different fee components on one card must not become a price-increase comparison.');
const feeExplanation=review.findings.find(f=>f.kind==='card-fee-reconciliation');assert.ok(feeExplanation);assert.equal(feeExplanation.queue,'context');assert.equal(feeExplanation.amount,995);assert.match(feeExplanation.why,/latest charge.*does not establish.*annual fee/i);
assert.ok(review.findings.some(f=>f.kind==='renewal'));assert.ok(review.findings.filter(f=>f.kind==='renewal').every(f=>/provider prediction.*out of date/i.test(f.why)));
const renewal=review.findings.find(f=>f.kind==='renewal'),reviewedRenewal=acknowledge(data,renewal),changedForecast={...reviewedRenewal,recurring:reviewedRenewal.recurring.map(r=>r.stream_id==='annual'?{...r,predicted_next_date:'2026-12-20'}:r)};
assert.equal(summarizeReview(changedForecast,'2026-10','ytd').findings.find(f=>f.id===renewal.id).newEvidenceSinceReview,true,'Changed renewal evidence must reopen the check.');
assert.equal(summarizeReview(changedForecast,'2026-10','ytd').findings.find(f=>f.id===renewal.id).queue,'context','A changed provider forecast never becomes required historical review.');
assert.ok(review.findings.some(f=>f.kind==='category-growth'&&f.category==='Groceries'));
// A current query's completeness cannot certify a different comparison span.
// Both the earlier and recent window need scoped, ready, complete source evidence.
{
 const full={is_complete_for_query:true,availability:'ready',window:{start:data.dateRange.start,end:data.dateRange.end}};
 const variants=[
  {transactions:{is_complete_for_query:true}},
  {transactions:{...full,window:{start:'2026-07-01',end:'2026-10-25'}}},
  {transactions:full,refresh:{start:'2026-04-01',end:'2026-06-30',bankPageCoverage:{state:'partial',availability:'ready'}}},
 ];
 for(const coverage of variants){
  const limited=summarizeReview({...data,coverage},'2026-10','ytd');
  assert.ok(!limited.findings.some(f=>f.kind==='category-growth'),'unknown or partial comparison coverage cannot assert complete growth');
  assert.equal(limited.totalSpend,review.totalSpend,'coverage never erases recorded spending');
 }
 const covered=summarizeReview({...data,coverage:{transactions:full}},'2026-10','ytd');
 assert.ok(covered.findings.some(f=>f.kind==='category-growth'&&f.category==='Groceries'),'verified comparable source windows retain measured growth');
}
assert.ok(review.findings.some(f=>f.kind==='one-off'&&f.amount===1200));
assert.ok(review.findings.every(f=>f.transactionIds.every(id=>data.transactions.some(t=>t.id===id&&t.date>=review.period.start&&t.date<=review.period.end&&!t.pending))));
assert.ok(review.findings.every(f=>f.evidence.every(e=>e.date<=review.period.end)));
assert.ok(review.findings.every(f=>!f.transactionIds.includes('pending')));
assert.equal(new Set(review.overviewFindings.map(f=>f.kind)).size,review.overviewFindings.length);
const derived=deriveDataset(data);const income=summarizeIncome(derived,2026,'2026-10','ytd');assert.equal(income.cashIncome,1000);assert.ok(!review.findings.some(f=>/Zelle.*income/i.test(f.title)));
const expected=Math.round(derived.transactions.filter(t=>!t.pending&&t.flow==='expense'&&t.date>='2026-01-01'&&t.date<='2026-10-25').reduce((n,t)=>n+Math.round(t.amount*100),0))/100;
assert.equal(review.totalSpend,expected,'Candidate duplicates must remain in spending.');
review=summarizeReview(data,'2026-09','month');assert.equal(review.findings.some(f=>f.kind==='renewal'),false,'Current provider forecasts must not leak into historical reviews.');assert.ok(review.findings.every(f=>f.evidence.every(e=>e.date<='2026-09-30')));
// Adding a future source row cannot alter an earlier financial review.
const future={...data,asOf:'2026-11-30',dateRange:{...data.dateRange,end:'2026-11-30'},incomeEvidence:{...data.incomeEvidence,asOf:'2026-11-30'},transactions:[...data.transactions,tx('future-openai','2026-11-09',999,'OpenAI')]};
const before=summarizeReview(data,'2026-08','month'),after=summarizeReview(future,'2026-08','month');assert.deepEqual(after,before);
// Public product context strengthens a multi-cycle suggestion; it is not a
// license to convert arbitrary equal-amount retail refunds into benefits.
const memberRows=[8,9,10].flatMap(n=>{const date=`2026-${String(n).padStart(2,'0')}-08`;return [tx(`wm-charge-${n}`,date,14.25,'Walmart+',{sourceName:'Walmart+ Membership',category:'Services'}),tx(`wm-credit-${n}`,date,-14.25,'Walmart',{sourceName:'Walmart Credit',category:'Shopping',sourceCategoryDetailed:'shopping_superstores'})];});
const membershipData={...data,accounts:[{...account('card','credit'),institution:'American Express',name:'Platinum Card®',officialName:'Platinum Card®'},{...account('other-card','credit'),institution:'Robinhood',name:'Robinhood Credit Card',officialName:'Robinhood Credit Card'}],recurring:[],transactions:[...memberRows,tx('retail','2026-10-08',50.26,'Walmart',{category:'Shopping',sourceCategoryDetailed:'shopping_superstores'}),tx('retail-credit','2026-10-08',-50.26,'Walmart',{sourceName:'Walmart Refund',category:'Shopping',sourceCategoryDetailed:'shopping_superstores'}),tx('other-card-credit','2026-10-08',-14.25,'Walmart',{accountId:'other-card',sourceName:'Walmart Credit',category:'Shopping',sourceCategoryDetailed:'shopping_superstores'})]};
const membershipOriginal=JSON.stringify(membershipData),membershipReview=summarizeReview(membershipData,'2026-10','ytd'),membershipCandidate=membershipReview.findings.find(f=>f.kind==='benefit-candidate');assert.ok(membershipCandidate);assert.equal(membershipCandidate.amount,42.75);assert.equal(membershipCandidate.transactionIds.length,6);assert.ok(!membershipCandidate.transactionIds.includes('retail-credit'));assert.ok(!membershipCandidate.transactionIds.includes('other-card-credit'));assert.equal(JSON.stringify(membershipData),membershipOriginal,'A candidate must not rewrite any source category or amount.');
assert.equal(membershipCandidate.queue,'context','supported canonical offsets are explanatory, not repeated confirmation tasks');
assert.ok(membershipReview.contextFindings.some(f=>f.id===membershipCandidate.id));
assert.ok(!membershipReview.openFindings.some(f=>f.id===membershipCandidate.id));
assert.match(membershipCandidate.summary,/Budget and recurring views use this supported service attribution/);
assert.match(membershipCandidate.summary,/inferred, not provider-confirmed/);
assert.doesNotMatch(membershipCandidate.summary,/bill totals have not been changed/);
const acknowledgedMembership=acknowledge(membershipData,membershipCandidate);
assert.equal(summarizeReview(acknowledgedMembership,'2026-10','ytd').findings.find(f=>f.id===membershipCandidate.id).isReviewed,true,'saved acknowledgment of unchanged supported evidence survives');
const unnamedMembership={...membershipData,transactions:membershipData.transactions.map(t=>t.merchant==='Walmart+'?{...t,merchant:'Walmart',sourceName:'Walmart'}:t)};assert.ok(!summarizeReview(unnamedMembership,'2026-10','ytd').findings.some(f=>f.kind==='benefit-candidate'),'Repeated coincident generic retailer charges alone are insufficient.');
const ambiguousOffset={...membershipData,transactions:[...membershipData.transactions,tx('wm-second-credit','2026-10-08',-14.25,'Walmart',{sourceName:'Walmart Credit',category:'Shopping',sourceCategoryDetailed:'shopping_superstores'})]};assert.ok(!summarizeReview(ambiguousOffset,'2026-10','ytd').findings.some(f=>f.kind==='benefit-candidate'),'Ambiguous same-day multiple credit records cannot be uniquely allocated.');
const confirmedRetail=deriveDataset(membershipData,Object.fromEntries(memberRows.filter(t=>t.amount<0).map(t=>[t.id,{category:'Shopping',note:'User-confirmed returned retail items'}])));assert.ok(!summarizeReview(confirmedRetail,'2026-10','ytd').findings.some(f=>f.kind==='benefit-candidate'),'Saved purpose corrections take precedence over a membership-credit suggestion.');
// Accounting flags are separate from advisory acknowledgments and keep exact
// posted/date scope. Known repayments are absent unless explicitly flagged.
const flagSource={...data,recurring:[],transactions:[
 tx('known-payment','2026-10-02',300,'Credit Card Payment',{accountId:'checking',flow:'review',category:'Review',review:true,sourceCategoryDetailed:'transfers_credit_card_payment',note:'Unresolved money movement. Excluded from income and spending until its purpose is confirmed.'}),
 tx('saved-flag','2026-10-03',200,'Credit Card Payment',{accountId:'checking',flow:'review',category:'Review',review:true,sourceCategoryDetailed:'transfers_credit_card_payment'}),
 tx('unknown-credit','2026-10-04',-73,'Unknown credit',{flow:'review',category:'Review',review:true,sourceCategoryDetailed:'other_other',note:'Unidentified credit; not assumed to be income or a purchase refund.'}),
 tx('pending-flag','2026-10-05',10,'Pending item',{review:true,pending:true}),
 tx('earlier-flag','2026-09-04',10,'Earlier item',{review:true}),
 tx('isolated-zelle','2026-10-05',20,'Zelle payment',{review:true,reviewDecision:'zelle'}),
]};
const flagged=deriveDataset(flagSource,{'saved-flag':{review:true}}),flagSnapshot=structuredClone(flagged),preferences=structuredClone(flagged.reviewPreferences),financialBefore=Object.fromEntries(['month','ytd','year'].map(mode=>[mode,summarizePeriod(flagged,'2026-10',mode)]));
const flagReview=summarizeReview(flagged,'2026-10','month');
assert.deepEqual(flagReview.accountingReviewTransactionIds,['saved-flag','unknown-credit'],'Required accounting links include only the actual unresolved posted rows in the selected scope.');
assert.equal(flagged.transactions.find(t=>t.id==='known-payment').review,false);
assert.equal(flagged.transactions.find(t=>t.id==='saved-flag').review,true,'An explicit saved flag remains authoritative.');
assert.deepEqual(flagged,flagSnapshot);assert.deepEqual(flagged.reviewPreferences,preferences);
for(const mode of ['month','ytd','year'])assert.deepEqual(summarizePeriod(flagged,'2026-10',mode),financialBefore[mode],'Review presentation does not change financial arithmetic.');
console.log('Intelligent review tests passed: source immutability, actionable/context queues, durable reviewed state, clock stability, new-evidence reopening, service/provider distinction, variable charges, possible duplicates, explicit card credits, renewal uncertainty, cash/sale evidence bridge, comparable windows, no future leakage and exact source drilldowns.');
