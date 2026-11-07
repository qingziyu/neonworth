import assert from 'node:assert/strict';
import { summarizeRecurring, absenceWindowCovered } from '../lib/recurring.ts';
// Likely-stopped inference now requires scoped, ready, complete coverage for the
// last-charge→status window. The shared synthetic fixture declares such a window so
// the existing lifecycle expectations still exercise that path explicitly.
const scopedCompleteCoverage={transactions:{is_complete_for_query:true,availability:'ready',window:{start:'2025-01-01',end:'2027-01-01'}}};
const account=id=>({id,name:id,institution:'Test',type:'depository',subtype:'checking',mask:'',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const tx=(id,date,amount,extra={})=>({id,date,merchant:id,accountId:'checking',amount,category:'Other',flow:'expense',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false,...extra});
const rent=(id,date,amount,extra={})=>tx(id,date,amount,{merchant:'Bilt',category:'Housing',sourceCategoryDetailed:'housing_rent',...extra});
const utility=(id,date,amount,extra={})=>tx(id,date,amount,{merchant:'Astound Broadband',category:'Bills & utilities',sourceCategoryDetailed:'bills_utilities_internet_cable',...extra});
const provider=(id,name,ids,extra={})=>({stream_id:id,account_id:'checking',description:name,merchant_name:name,flow_type:'outflow',frequency:'MONTHLY',first_date:'2026-01-01',last_date:'2026-09-23',last_amount:70,average_amount:70,is_active:true,transaction_ids:ids,personal_finance_category:{primary:'bills_utilities',detailed:'bills_utilities_internet_cable'},...extra});
const data={version:1,syncedAt:'2026-10-25T00:00:00Z',asOf:'2026-10-25',dateRange:{start:'2026-01-01',end:'2026-10-25'},coverage:scopedCompleteCoverage,accounts:[account('checking')],netWorthHistory:[],notes:[],recurring:[provider('internet','Astound Broadband',['net-sep']),provider('repay','Apple Card payment',['repayment'],{personal_finance_category:{primary:'transfers',detailed:'transfers_credit_card_payment'}}),provider('spotify','Spotify',['spotify-sep'],{personal_finance_category:{primary:'entertainment',detailed:'entertainment_music_audio'},last_amount:13,last_date:'2026-09-30'}),provider('annual','Annual subscription',['annual-jan'],{frequency:'ANNUALLY',last_amount:120,last_date:'2026-01-01',personal_finance_category:{primary:'services',detailed:'services_digital_other_services'}})],transactions:[
 rent('r-jul','2026-07-04',3200),rent('r-aug','2026-08-04',3250,{merchant:'Rollin St Flats'}),rent('r-sep','2026-09-04',3300,{merchant:'BILT PAYMENT BILTRENT'}),rent('r-oct','2026-10-05',3350,{merchant:'BILT Incorporated'}),
 utility('net-jul','2026-07-23',70),utility('net-aug','2026-08-23',70),utility('net-sep','2026-09-23',70),utility('net-oct','2026-10-23',75),
 tx('home-supply','2026-10-08',40,{merchant:'Nursery',category:'Housing',sourceCategoryDetailed:'housing_home_improvement_materials'}),
 tx('repayment','2026-10-01',300,{merchant:'Apple Card payment',flow:'transfer',category:'Transfers',sourceCategoryDetailed:'transfers_credit_card_payment'}),
 tx('misclassified-repayment','2026-10-02',300,{merchant:'Chase credit crd autopay',flow:'expense',category:'Other'}),
 tx('spotify-sep','2026-09-30',13,{merchant:'Spotify'}),tx('annual-jan','2026-01-01',120,{merchant:'Annual subscription'}),
 rent('rent-credit','2026-10-10',-50),utility('pending','2026-10-25',75,{pending:true}),
 tx('income','2026-10-23',-3000,{flow:'income',category:'Income'}),utility('transfer','2026-10-24',100,{flow:'transfer'}),
]};
let s=summarizeRecurring(data,{start:'2026-10-01',end:'2026-10-25'});
assert.equal(s.paid,3425);assert.equal(s.refunds,50);assert.equal(s.net,3375);assert.equal(s.transactionCount,3);assert.equal(s.household,3375);
const housing=s.groups.find(g=>g.kind==='housing'),internet=s.groups.find(g=>g.kind==='internet');
assert.equal(housing.transactions.filter(t=>t.amount>0).length,4);assert.equal(housing.lastAmount,3350);assert.equal(housing.amountChange,50);assert.equal(housing.net,3300);
assert.equal(internet.lastAmount,75);assert.equal(internet.lastSeen,'2026-10-23');assert.equal(internet.amountChange,5);assert.equal(internet.transactions.length,4);assert.equal(internet.monthlyEquivalent,75);assert.ok(internet.notes.some(n=>n.includes('Newer canonical-merchant')));
assert.ok(s.groups.every(g=>!g.transactions.some(t=>['repayment','misclassified-repayment','home-supply','pending','income','transfer'].includes(t.id))));
assert.deepEqual(s.averageMonths,['2026-07','2026-08','2026-09']);assert.equal(housing.monthlyAverage,3250);assert.equal(s.monthlyAverage,3324.33);
assert.ok(s.alerts.some(a=>a.groupId===internet.id&&a.id.startsWith('change:')));assert.equal(s.history.reduce((n,h)=>n+h.net,0),s.net);
s=summarizeRecurring(data,{start:'2026-01-01',end:'2026-10-25'});assert.equal(s.net,13468);assert.equal(s.groups.flatMap(g=>g.periodTransactions).length,new Set(s.groups.flatMap(g=>g.periodTransactions).map(t=>t.id)).size);
// Historical windows never consume later posted charges or provider last amounts from future dates.
s=summarizeRecurring(data,{start:'2026-08-01',end:'2026-08-31'});assert.equal(s.net,3320);assert.equal(s.groups.find(g=>g.kind==='internet').lastAmount,70);assert.equal(s.groups.find(g=>g.kind==='internet').lastSeen,'2026-08-23');assert.equal(s.groups.find(g=>g.name==='Spotify').monthlyEquivalent,null);
// A classified rent correction remains visible even when the provider originally called it a transfer.
s=summarizeRecurring({...data,recurring:[],transactions:[tx('zelle-rent','2026-10-02',3000,{merchant:'Zelle outgoing',category:'Housing',sourceCategoryDetailed:'transfers_other_transfer_out',note:'User-confirmed rent'})]},{start:'2026-10-01',end:'2026-10-25'});assert.equal(s.net,3000);assert.equal(s.groups.length,1,'Explicit rent classification is retained regardless of payment rail');
// A historical hole is review evidence, never an overdue assertion.
s=summarizeRecurring({...data,recurring:[],transactions:[rent('r-jul','2026-07-04',3200),rent('r-sep','2026-09-04',3300),rent('r-oct','2026-10-05',3350)]},{start:'2026-07-01',end:'2026-10-25'});assert.deepEqual(s.groups[0].missingMonths,['2026-08']);assert.ok(s.alerts.some(a=>a.detail.includes('not establish an unpaid bill')));
console.log('Recurring tests passed: aliases, posted actuals, refunds, household coverage, repayments, category corrections, stale provider streams, historical cutoffs, monthly baselines and missing-month uncertainty.');
// Inference extends beyond stream detection; a stable schedule is not required.
const smart={...data,recurring:[],accounts:[account('checking'),account('other-card')],transactions:[
 tx('ai-a','2026-06-09',22.11,{merchant:'OpenAI',category:'Services',sourceCategoryDetailed:'services_digital_other_services'}),
 tx('ai-b','2026-08-09',22.11,{merchant:'ChatGPT',category:'Services',sourceName:'OpenAI',sourceCategoryDetailed:'services_digital_other_services'}),
 tx('ai-c','2026-08-19',95.77,{merchant:'OpenAI',category:'Services',sourceCategoryDetailed:'services_digital_other_services'}),
 tx('ai-d','2026-10-09',103.15,{merchant:'OpenAI',category:'Services',sourceCategoryDetailed:'services_digital_other_services'}),
 tx('spa-a','2026-07-01',175,{merchant:'Example Merchant D',category:'Health & personal care',sourceCategoryDetailed:'health_wellness_hair_beauty',note:"Example Merchant D charges of $175 are the user's monthly spa subscription."}),
 tx('spa-b','2026-09-01',175,{merchant:'Example Merchant D',accountId:'other-card',category:'Health & personal care',sourceCategoryDetailed:'health_wellness_hair_beauty',sourceName:'Example Merchant D',note:"Example Merchant D charges of $175 are the user's monthly spa subscription."}),
 tx('fit-a','2026-07-14',96.84,{merchant:'Example Merchant E',sourceCategoryDetailed:'health_wellness_fitness'}),
 tx('fit-b','2026-08-14',96.84,{merchant:'Example Merchant E',sourceCategoryDetailed:'health_wellness_fitness'}),
 tx('fit-c','2026-10-14',96.18,{merchant:'Example Merchant E',sourceName:'Example Merchant E',sourceCategoryDetailed:'health_wellness_fitness'}),
 tx('barber-a','2026-05-23',76.8,{merchant:"Example Merchant F",sourceCategoryDetailed:'health_wellness_hair_beauty'}),
 tx('barber-b','2026-06-10',76.8,{merchant:"Example Barber Barbershop",sourceCategoryDetailed:'health_wellness_hair_beauty'}),
 tx('toll-a','2026-06-10',30,{merchant:'Wsdot-goodtogo',sourceName:'WSDOT Good To Go',sourceCategoryDetailed:'transportation_tolls'}),
 tx('toll-b','2026-07-01',30,{merchant:'Wsdot-goodtogo',sourceName:'Good To Go Toll Payment',sourceCategoryDetailed:'transportation_tolls'}),
 tx('toll-c','2026-08-27',30,{merchant:'Wsdot-goodtogo',sourceName:'Washington Good To Go Toll Payment',sourceCategoryDetailed:'transportation_tolls'}),
 ...['2026-07-01','2026-08-02','2026-09-04'].map((date,i)=>tx(`food-${i}`,date,50+i,{merchant:'Whole Foods',category:'Groceries',sourceCategoryDetailed:'groceries_groceries'})),
 ...['2026-07-02','2026-08-04','2026-09-04'].map((date,i)=>tx(`park-${i}`,date,10+i,{merchant:'LAZ Parking',category:'Transport',sourceCategoryDetailed:'transportation_parking'})),
 tx('oura-member-a','2026-07-25',6.62,{merchant:'Oura Ring Inc',sourceName:'Oura Ring',sourceCategoryDetailed:'health_wellness_fitness'}),
 tx('oura-member-b','2026-08-25',6.62,{merchant:'Oura Ring Inc',sourceName:'Oura',sourceCategoryDetailed:'health_wellness_fitness'}),
 tx('oura-hardware','2026-01-19',374.08,{merchant:'Ouraring',sourceName:'Oura Ring',category:'Shopping',sourceCategoryDetailed:'shopping_electronics'}),
 tx('oura-benefit','2026-01-19',-200,{merchant:'Platinum Oura Ring Credit',sourceName:'Oura Ring Statement Credit',category:'Shopping',sourceCategoryDetailed:'shopping_electronics'}),
 tx('different-service','2026-08-19',95.77,{merchant:'Unrelated Consulting',category:'Services',sourceCategoryDetailed:'services_digital_other_services'}),
]};
const intelligent=summarizeRecurring(smart,{start:'2026-01-01',end:'2026-10-25'}),ai=intelligent.groups.find(g=>g.name==='OpenAI'),spa=intelligent.groups.find(g=>g.name==='Example Merchant D'),fitness=intelligent.groups.find(g=>g.name==='Example Merchant E'),toll=intelligent.groups.find(g=>g.recurrenceType==='replenishment'),oura=intelligent.groups.find(g=>/oura/i.test(g.name));
assert.equal(ai.positiveCount,4);assert.equal(ai.distinctMonths,3);assert.equal(ai.evidence,'inferred');assert.equal(ai.confidence,'high');assert.equal(ai.priceMax,103.15);assert.ok(ai.cadence.includes('Variable'));
assert.equal(spa.positiveCount,2);assert.equal(spa.accountIds.length,2);assert.equal(spa.evidence,'user-confirmed');assert.equal(spa.recurrenceType,'subscription');assert.equal(spa.status,'uncertain');assert.equal(spa.monthlyEquivalent,null);
assert.equal(fitness.positiveCount,3);assert.equal(fitness.evidence,'inferred');assert.equal(fitness.transactions.length,3);
assert.equal(toll.recurrenceType,'replenishment');assert.equal(toll.monthlyEquivalent,null);
assert.equal(intelligent.repeatPurchases.find(g=>g.name==='Whole Foods').recurrenceType,'repeat-purchase');assert.equal(intelligent.repeatPurchases.find(g=>/LAZ Parking/.test(g.name)).monthlyEquivalent,null);
assert.equal(oura.paid,13.24);assert.equal(oura.refunds,0);assert.ok(!oura.transactions.some(t=>t.id==='oura-hardware'||t.id==='oura-benefit'));assert.equal(intelligent.unallocatedBenefitCredits,200);
assert.ok(ai.transactions.every(t=>t.id!=='different-service'));assert.equal(intelligent.groups.flatMap(g=>g.transactions).length,new Set(intelligent.groups.flatMap(g=>g.transactions).map(t=>t.id)).size);
const withoutProvider=summarizeRecurring(smart,{start:'2026-06-01',end:'2026-08-31'});assert.ok(!withoutProvider.groups.find(g=>g.name==='OpenAI').transactions.some(t=>t.date>'2026-08-31'));assert.equal(withoutProvider.groups.find(g=>g.name==='OpenAI').priceMax,95.77);
console.log('Intelligent recurrence tests passed: service identity, variable cadence, cross-card aliases, confirmed prepaid membership, replenishment vs subscription, retail vs commitments, hardware separation and no equal-amount merging.');

// Point-in-time lifecycle, annual tolerance, inactive metadata and effective-dated decisions.
const lifecycleSource={...data,transactions:[
 ...['2026-03-24','2026-04-24','2026-05-24','2026-06-24'].map((date,i)=>tx(`google-life-${i}`,date,21.59,{merchant:'Google One',sourceCategoryDetailed:'services_digital_other_services'})),
 ...['2026-06-17','2026-07-17','2026-08-17'].map((date,i)=>tx(`geico-life-${i}`,date,i===2?416.62:302.79,{merchant:'GEICO',sourceCategoryDetailed:'financial_insurance'})),
 tx('geico-refund','2026-09-09',-82.94,{merchant:'GEICO',sourceCategoryDetailed:'financial_insurance'}),
 ...['2026-08-20','2026-09-20','2026-10-20'].map((date,i)=>tx(`github-life-${i}`,date,4.42,{merchant:'GitHub',sourceCategoryDetailed:'services_digital_other_services'})),
 tx('dropbox-life','2025-12-19',132.29,{merchant:'Dropbox',sourceCategoryDetailed:'services_digital_other_services'}),
],recurring:[
 provider('google-life','Google One',['google-life-0'],{frequency:'ANNUALLY',last_date:'2026-05-24',last_amount:21.59,predicted_next_date:'2027-05-24'}),
 provider('github-life','GitHub',['github-life-0'],{last_date:'2026-08-20',last_amount:4.42,is_active:false,predicted_next_date:'2026-09-20'}),
 provider('dropbox-life','Dropbox',['dropbox-life'],{frequency:'ANNUALLY',first_date:'2025-12-19',last_date:'2025-12-19',last_amount:132.29,predicted_next_date:'2026-12-19'}),
],dateRange:{start:'2025-10-01',end:'2026-10-25'}};
let life=summarizeRecurring(lifecycleSource,{start:'2026-01-01',end:'2026-10-25'});
let googleLife=life.groups.find(g=>g.name==='Google One'),githubLife=life.groups.find(g=>g.name==='GitHub'),dropboxLife=life.groups.find(g=>g.name==='Dropbox');
assert.equal(googleLife.status,'likely-stopped');assert.equal(googleLife.monthlyEquivalent,null);assert.equal(googleLife.expectedNextDate,'2026-07-24');assert.ok(googleLife.statusReason.includes('not a confirmed cancellation'));
assert.equal(life.groups.find(g=>g.name==='GEICO').status,'uncertain');assert.equal(life.groups.find(g=>g.name==='GEICO').monthlyEquivalent,null);
assert.equal(githubLife.providerActive,false);assert.equal(githubLife.status,'ongoing');assert.equal(githubLife.lastSeen,'2026-10-20');assert.equal(githubLife.monthlyEquivalent,4.42);
assert.equal(dropboxLife.status,'ongoing');assert.equal(dropboxLife.expectedNextDate,'2026-12-19');assert.equal(dropboxLife.monthlyEquivalent,11.02);
assert.equal(life.lifecycleCounts.likelyStopped,1);
const actualBefore=life.net,googleId=googleLife.id,githubId=githubLife.id;
let confirmed=summarizeRecurring({...lifecycleSource,reviewPreferences:{findingResolutions:{},recurringStatuses:{[googleId]:{status:'stopped',effectiveDate:'2026-07-01',updatedAt:'2026-10-25T00:00:00Z'}}}},{start:'2026-01-01',end:'2026-10-25'});
assert.equal(confirmed.groups.find(g=>g.id===googleId).status,'stopped');assert.equal(confirmed.groups.find(g=>g.id===googleId).statusLabel,'Stopped · you confirmed');assert.equal(confirmed.groups.find(g=>g.id===googleId).inferredStatus,'likely-stopped');assert.equal(confirmed.net,actualBefore);
confirmed=summarizeRecurring({...lifecycleSource,reviewPreferences:{findingResolutions:{},recurringStatuses:{[githubId]:{status:'stopped',effectiveDate:'2026-09-25',updatedAt:'2026-10-25T00:00:00Z'}}}},{start:'2026-01-01',end:'2026-10-25'});
assert.equal(confirmed.groups.find(g=>g.id===githubId).status,'uncertain');assert.equal(confirmed.groups.find(g=>g.id===githubId).statusSource,'user-conflict');assert.equal(confirmed.groups.find(g=>g.id===githubId).monthlyEquivalent,null);assert.equal(confirmed.net,actualBefore);
confirmed=summarizeRecurring({...lifecycleSource,reviewPreferences:{findingResolutions:{},recurringStatuses:{[googleId]:{status:'ongoing',effectiveDate:'2026-10-01',updatedAt:'2026-10-25T00:00:00Z'}}}},{start:'2026-01-01',end:'2026-10-25'});
assert.equal(confirmed.groups.find(g=>g.id===googleId).status,'ongoing');assert.equal(confirmed.groups.find(g=>g.id===googleId).statusLabel,'Ongoing · you confirmed');
const historical=summarizeRecurring({...lifecycleSource,reviewPreferences:{findingResolutions:{},recurringStatuses:{[googleId]:{status:'stopped',effectiveDate:'2026-07-01',updatedAt:'2026-10-25T00:00:00Z'}}}},{start:'2026-03-01',end:'2026-06-30'});
assert.equal(historical.groups.find(g=>g.id===googleId).status,'ongoing');assert.equal(historical.groups.find(g=>g.id===googleId).statusAsOf,'2026-06-30');assert.equal(historical.groups.find(g=>g.id===googleId).expectedNextDate,null);assert.equal(historical.groups.find(g=>g.id===googleId).providerActive,null);assert.ok(historical.groups.find(g=>g.id===googleId).transactions.every(t=>t.date<='2026-06-30'));

console.log('Lifecycle tests passed: ongoing vs likely stopped, irregular/annual tolerance, inactive-stream revival, historical cutoff, effective-dated user decisions, renewed-charge conflict, unchanged actuals and same-card fee adjustments.');
// Ongoing card use is independent from an ambiguous/prorated fee projection.
const cardLife={...data,dateRange:{start:'2025-09-01',end:'2026-10-25'},transactions:[
 tx('old-fee','2025-09-02',365,{merchant:'RENEWAL MEMBERSHIP FEE',sourceName:'Membership Renewal Fee',category:'Financial & insurance',sourceCategoryDetailed:'financial_other_bank_fees'}),
 tx('new-fee','2025-10-02',180,{merchant:'RENEWAL MEMBERSHIP FEE',sourceName:'Membership Fee',category:'Financial & insurance',sourceCategoryDetailed:'financial_other_bank_fees'}),
 tx('fee-credit','2025-10-02',-335,{merchant:'ADJUST MEMBERSHIP FEE',sourceName:'Membership Fee Adjustment',category:'Financial & insurance',sourceCategoryDetailed:'financial_other_bank_fees'}),
 tx('recent-card-purchase','2026-09-22',33,{merchant:'Airline purchase',category:'Travel',sourceCategoryDetailed:'travel_flights'}),
],recurring:[provider('fee-life','Membership Fee',['new-fee'],{frequency:'ANNUALLY',first_date:'2025-12-02',last_date:'2025-12-19',last_amount:180,personal_finance_category:{primary:'financial',detailed:'financial_other_bank_fees'}})]};
let feeLife=summarizeRecurring(cardLife,{start:'2025-09-01',end:'2026-10-25'}).groups.find(g=>g.name==='Card membership fee');assert.equal(feeLife.status,'ongoing');assert.equal(feeLife.monthlyEquivalent,null);assert.equal(feeLife.expectedNextDate,null);assert.equal(feeLife.net,210);assert.ok(feeLife.statusReason.includes('2026-09-22'));
const onlyOtherCard={...cardLife,transactions:cardLife.transactions.map(t=>t.id==='recent-card-purchase'?{...t,accountId:'different-card'}:t)};feeLife=summarizeRecurring(onlyOtherCard,{start:'2025-09-01',end:'2026-10-25'}).groups.find(g=>g.name==='Card membership fee');assert.equal(feeLife.status,'uncertain');assert.equal(feeLife.monthlyEquivalent,null);
const repaymentOnly={...cardLife,transactions:cardLife.transactions.map(t=>t.id==='recent-card-purchase'?{...t,merchant:'Apple Card payment',sourceCategoryDetailed:'transfers_credit_card_payment'}:t)};feeLife=summarizeRecurring(repaymentOnly,{start:'2025-09-01',end:'2026-10-25'}).groups.find(g=>g.name==='Card membership fee');assert.equal(feeLife.status,'uncertain');

console.log('Card lifecycle tests passed: exact-card recent spending supports ongoing use; fee ambiguity remains unestimated; other-card purchases and repayments do not establish same-card activity.');
// Retain dormant streams in a monthly inventory even when no charge falls in the month.
const inactiveInventory={...data,recurring:[provider('inactive-sp','Spotify',['inactive-a','inactive-b','inactive-c'],{is_active:false,last_date:'2026-03-01',first_date:'2026-01-01',last_amount:13})],transactions:['2026-01-01','2026-02-01','2026-03-01'].map((date,i)=>tx(`inactive-${String.fromCharCode(97+i)}`,date,13,{merchant:'Spotify',sourceCategoryDetailed:'entertainment_music_audio'}))};
const inactiveMonth=summarizeRecurring(inactiveInventory,{start:'2026-10-01',end:'2026-10-25'}),dormant=inactiveMonth.groups.find(g=>g.name==='Spotify');assert.ok(dormant);assert.equal(dormant.count,0);assert.equal(dormant.net,0);assert.equal(dormant.status,'likely-stopped');assert.equal(dormant.monthlyEquivalent,null);assert.equal(inactiveMonth.net,0);
// Slower/faster supported cadences must not use a universal 45-day inactivity threshold.
const cadenceFixture=(frequency,asOf,last,earlier=[])=>({...data,asOf,dateRange:{start:'2025-01-01',end:asOf},recurring:[provider(`cycle-${frequency}`,'Periodic Digital Service',[...earlier.map((_,i)=>`periodic-${i}`),'periodic-last'],{frequency,first_date:'2025-01-01',last_date:last,last_amount:120,is_active:true,personal_finance_category:{primary:'services',detailed:'services_digital_other_services'}})],transactions:[...earlier.map((date,i)=>tx(`periodic-${i}`,date,120,{merchant:'Periodic Digital Service',category:'Services',sourceCategoryDetailed:'services_digital_other_services'})),tx('periodic-last',last,120,{merchant:'Periodic Digital Service',category:'Services',sourceCategoryDetailed:'services_digital_other_services'})]});
for(const [frequency,asOf,last,next] of [
 ['QUARTERLY','2026-12-01','2026-10-15','2027-01-15'],
 ['SEMI_ANNUALLY','2026-08-01','2026-03-15','2026-09-15'],
 ['WEEKLY','2026-10-25','2026-10-20','2026-10-27'],
 ['BIWEEKLY','2026-10-25','2026-10-15','2026-10-29'],
 ['SEMI_MONTHLY','2026-10-25','2026-10-15','2026-10-30'],
]){const d=cadenceFixture(frequency,asOf,last),g=summarizeRecurring(d,{start:'2026-01-01',end:asOf}).groups.find(g=>g.name==='Periodic Digital Service');assert.equal(g.status,'ongoing',`${frequency} inside cycle`);assert.equal(g.expectedNextDate,next);assert.equal(g.expectedNextConfidence,'low');}
const quarterData=cadenceFixture('QUARTERLY','2026-12-01','2026-10-15',['2026-05-22','2026-08-11']),quarter=summarizeRecurring(quarterData,{start:'2026-01-01',end:'2026-12-01'}).groups[0];assert.equal(quarter.status,'ongoing');assert.equal(quarter.expectedNextDate,'2027-01-15');
const historicalQuarter=summarizeRecurring({...quarterData,asOf:'2027-01-01',dateRange:{start:'2025-01-01',end:'2027-01-01'}},{start:'2026-01-01',end:'2026-12-01'}).groups[0];assert.equal(historicalQuarter.expectedNextDate,null);assert.equal(historicalQuarter.providerActive,null);assert.ok(historicalQuarter.statusReason.includes('not used to reconstruct this historical status'));
const quarterlyMislabel=cadenceFixture('QUARTERLY','2026-10-25','2026-06-24',['2026-03-24','2026-04-24','2026-05-24']),ledgerPrecedence=summarizeRecurring(quarterlyMislabel,{start:'2026-01-01',end:'2026-10-25'}).groups[0];assert.equal(ledgerPrecedence.status,'likely-stopped');assert.equal(ledgerPrecedence.frequency,'MONTHLY');
const mixedCadences={...quarterData,recurring:[...quarterData.recurring,provider('other-cycle','Periodic Digital Service',[],{frequency:'SEMI_ANNUALLY',last_date:'2026-10-15',first_date:'2025-01-01',last_amount:60,personal_finance_category:{primary:'services',detailed:'services_digital_other_services'}})]};const mixedCycle=summarizeRecurring(mixedCadences,{start:'2026-01-01',end:'2026-12-01'}).groups[0];assert.equal(mixedCycle.expectedNextDate,null);assert.equal(mixedCycle.monthlyEquivalent,null);
assert.equal(summarizeRecurring(quarterData,{start:'2026-01-01',end:'2026-12-01'}).net,360);
console.log('Cadence/inventory tests passed: dormant rows retained with zero actuals; quarterly, semiannual, weekly and biweekly windows; mixed-cadence safety, observed-monthly precedence and no historical metadata leak.');
// A missing matched fixed-price membership cycle is a gap, not a free month.
const fixedRows=['2026-06-08','2026-08-08','2026-09-08','2026-10-08'].map((date,i)=>tx(`fixed-${i}`,date,14.25,{merchant:'Walmart+',sourceName:'Walmart+ Membership',category:'Services',sourceCategoryDetailed:'services_digital_other_services'}));
const fixedSource={...data,transactions:fixedRows,recurring:[provider('fixed-member','Walmart+',fixedRows.map(t=>t.id),{first_date:'2026-06-08',last_date:'2026-10-08',last_amount:14.25,frequency:'MONTHLY',recurring_transaction_type:'SUBSCRIPTION',personal_finance_category:{primary:'services',detailed:'services_digital_other_services'}})]};
const fixedReport=summarizeRecurring(fixedSource,{start:'2026-01-01',end:'2026-10-25'}),fixed=fixedReport.groups.find(g=>g.name==='Walmart+');
assert.equal(fixed.status,'ongoing');assert.equal(fixed.monthlyEquivalent,14.25);assert.equal(fixed.monthlyAverage,9.5,'actual historical average still reflects only matched payments');assert.equal(fixed.net,57);assert.deepEqual(fixed.missingMonths,['2026-07']);assert.match(fixed.equivalentBasis,/missing matched cycles are not assumed free/);assert.ok(fixed.notes.some(n=>/coverage\/linking gap/.test(n)));
const changedFixed={...fixedSource,transactions:fixedRows.map((t,i)=>({...t,amount:i<2?10:14.25}))};assert.equal(summarizeRecurring(changedFixed,{start:'2026-01-01',end:'2026-10-25'}).groups[0].monthlyEquivalent,14.25,'two repeated latest membership charges support the current planning reference after an older different price');
const variableRows=fixedRows.map((t,i)=>({...t,merchant:'OpenAI',sourceName:'OpenAI',amount:[20,90,20,100][i]})),variableSource={...fixedSource,transactions:variableRows,recurring:[provider('variable-service','OpenAI',variableRows.map(t=>t.id),{first_date:'2026-06-08',last_date:'2026-10-08',last_amount:100,frequency:'MONTHLY',personal_finance_category:{primary:'services',detailed:'services_digital_other_services'}})]};
const variableBill=summarizeRecurring(variableSource,{start:'2026-01-01',end:'2026-10-25'}).groups.find(g=>g.name==='OpenAI');assert.equal(variableBill.monthlyEquivalent,36.67);assert.match(variableBill.equivalentBasis,/averaged across three complete months/);
const repeatedVariable={...variableSource,transactions:variableRows.map((t,i)=>({...t,amount:[20,90,100,100][i]})),recurring:variableSource.recurring.map(r=>({...r,recurring_transaction_type:'SUBSCRIPTION'}))};assert.match(summarizeRecurring(repeatedVariable,{start:'2026-01-01',end:'2026-10-25'}).groups[0].equivalentBasis,/averaged across three complete months/,'two equal usage/software charges do not establish a fixed-price membership');
const sparseSource={...fixedSource,transactions:[fixedRows.at(-1)],recurring:[{...fixedSource.recurring[0],transaction_ids:[fixedRows.at(-1).id]}]};assert.equal(summarizeRecurring(sparseSource,{start:'2026-01-01',end:'2026-10-25'}).groups[0].monthlyEquivalent,null,'one matched charge does not invent a fixed ongoing membership');
assert.ok(summarizeRecurring(cardLife,{start:'2025-10-26',end:'2026-10-25'}).alerts.every(a=>!a.id.startsWith('change:')),'different card-fee components must not generate an automatic price-increase alert');

console.log('Fixed-membership tests passed: supported stable price, missing-cycle gap, unchanged actuals, variable-usage averaging, sparse-evidence exclusion and no card-component price alerts.');
// Source coverage must be scoped to the last-charge→status window before missing cycles can mean "likely stopped".
{
 const window={start:'2026-01-01',end:'2026-10-25'};
 const withCoverage=coverage=>({...lifecycleSource,coverage});
 const statusOf=(coverage,name,source=withCoverage(coverage),period=window)=>summarizeRecurring(source,period).groups.find(g=>g.name===name);
 const baseline=summarizeRecurring(lifecycleSource,window);
 // Scoped, ready, complete coverage of 2026-06-24→2026-10-25 supports likely-stopped (already asserted above).
 assert.equal(statusOf(scopedCompleteCoverage,'Google One').status,'likely-stopped');
 assert.equal(absenceWindowCovered(withCoverage(scopedCompleteCoverage),'2026-06-24','2026-10-25'),true);
 // An unscoped current-query flag cannot prove missing cycles over unrelated history.
 const unscoped={transactions:{is_complete_for_query:true}};
 const unscopedGoogle=statusOf(unscoped,'Google One');
 assert.equal(unscopedGoogle.status,'uncertain','unscoped completeness cannot certify likely-stopped');
 assert.equal(unscopedGoogle.inferredStatus,'uncertain');
 assert.equal(unscopedGoogle.monthlyEquivalent,null,'uncertain services still get no invented ongoing estimate');
 assert.equal(absenceWindowCovered(withCoverage(unscoped),'2026-06-24','2026-10-25'),false);
 // Unknown coverage also cannot certify cancellation.
 assert.equal(statusOf({},'Google One').status,'uncertain');
 // Complete coverage that does not span the whole absence window is not enough.
 const tooShort={transactions:{is_complete_for_query:true,availability:'ready',window:{start:'2026-08-01',end:'2026-10-25'}}};
 assert.equal(statusOf(tooShort,'Google One').status,'uncertain');
 // Ready-but-not-explicitly-complete coverage is not enough.
 assert.equal(statusOf({transactions:{availability:'ready',window:{start:'2025-01-01',end:'2027-01-01'}}},'Google One').status,'uncertain');
 // Overlapping partial evidence stays limiting even when another scope reports complete.
 const overlappingPartial={...scopedCompleteCoverage,refresh:{start:'2026-09-01',end:'2026-10-25',bankPageCoverage:{availability:'ready',state:'partial'}}};
 assert.equal(statusOf(overlappingPartial,'Google One').status,'uncertain','overlapping partial coverage limits inactivity inference');
 assert.equal(absenceWindowCovered(withCoverage(overlappingPartial),'2026-06-24','2026-10-25'),false);
 // A non-overlapping partial scope does not limit an unrelated covered window.
 const unrelatedPartial={...scopedCompleteCoverage,refresh:{start:'2024-01-01',end:'2024-03-01',bankPageCoverage:{availability:'ready',state:'partial'}}};
 assert.equal(statusOf(unrelatedPartial,'Google One').status,'likely-stopped');
 // Positive recent multi-cycle evidence supports ongoing without any coverage or confirmation.
 for(const coverage of [{},unscoped,overlappingPartial]){
  const github=statusOf(coverage,'GitHub');
  assert.equal(github.status,'ongoing','recent supported charges infer ongoing independently of coverage');
  assert.equal(github.statusSource,'inferred','no user confirmation is required for a supported active service');
  assert.equal(github.monthlyEquivalent,4.42);
  assert.equal(statusOf(coverage,'Dropbox').status,'ongoing');
 }
 // Manual stopped + later charge is a conflict regardless of coverage; actuals are unchanged.
 const githubId=baseline.groups.find(g=>g.name==='GitHub').id;
 for(const coverage of [{},scopedCompleteCoverage]){
  const conflicted=summarizeRecurring({...withCoverage(coverage),reviewPreferences:{findingResolutions:{},recurringStatuses:{[githubId]:{status:'stopped',effectiveDate:'2026-09-25',updatedAt:'2026-10-25T00:00:00Z'}}}},window);
  const github=conflicted.groups.find(g=>g.id===githubId);
  assert.equal(github.statusSource,'user-conflict');assert.equal(github.status,'uncertain');assert.match(github.statusReason,/later posted charge/);
  assert.equal(conflicted.net,baseline.net,'status decisions never remove posted costs');
 }
 // Historical status ignores later saved decisions and later evidence.
 const googleId=baseline.groups.find(g=>g.name==='Google One').id;
 const past=summarizeRecurring({...withCoverage({}),reviewPreferences:{findingResolutions:{},recurringStatuses:{[googleId]:{status:'stopped',effectiveDate:'2026-07-01',updatedAt:'2026-10-25T00:00:00Z'}}}},{start:'2026-03-01',end:'2026-06-30'}).groups.find(g=>g.id===googleId);
 assert.equal(past.status,'ongoing');assert.equal(past.statusSource,'inferred');assert.ok(past.transactions.every(t=>t.date<='2026-06-30'));
 // Exact payment/refund totals are independent of coverage.
 for(const coverage of [{},unscoped,overlappingPartial,scopedCompleteCoverage]){
  const report=summarizeRecurring(withCoverage(coverage),window),geico=report.groups.find(g=>g.name==='GEICO');
  assert.equal(geico.paid,1022.2);assert.equal(geico.refunds,82.94);assert.equal(geico.net,939.26);
  assert.equal(report.net,baseline.net);assert.equal(report.paid,baseline.paid);assert.equal(report.refunds,baseline.refunds);
 }
 // The summary-level completeness note is scoped too.
 assert.equal(summarizeRecurring(withCoverage(unscoped),window).sourceComplete,false);
 assert.equal(summarizeRecurring(withCoverage(scopedCompleteCoverage),window).sourceComplete,true);
 // Defensive inputs.
 assert.equal(absenceWindowCovered(withCoverage(scopedCompleteCoverage),null,'2026-10-25'),false);
 assert.equal(absenceWindowCovered(withCoverage(scopedCompleteCoverage),'2026-11-01','2026-10-25'),false);
}
console.log('Scoped coverage tests passed: scoped-complete windows may be likely stopped; unscoped, unknown, short or overlapping-partial coverage cannot prove inactivity; recent evidence infers ongoing; conflicts, historical boundaries and exact totals preserved.');

// Shared service-credit attribution reconciles historical actuals while gross
// charges and future estimates remain unchanged. No broad benefit is assigned
// to a subscription merely because it shares a date or amount.
{
 const card={...account('plat'),name:'Amex Platinum',officialName:'Amex Platinum',institution:'American Express',type:'credit',subtype:'credit card'};
 const service=(id,date,amount,merchant,extra={})=>tx(id,date,amount,{accountId:'plat',merchant,category:'Services',...extra});
 const rows=['07','08','09'].flatMap(m=>[
  service(`wm-charge-${m}`,`2026-${m}-10`,12.95,'Walmart+'),
  service(`wm-credit-${m}`,`2026-${m}-10`,-12.95,'Walmart',{category:'Shopping'}),
  service(`oura-${m}`,`2026-${m}-12`,5.99,'Oura',{sourceCategoryDetailed:'services_digital_other_services'}),
 ]);
 rows.push(service('clear-charge','2026-04-15',200,'CLEAR'),service('clear-credit','2026-04-16',-200,'AMEX CLEAR PLUS CREDIT',{category:'Travel'}),service('digital-credit','2026-09-20',-20,'Platinum Digital Entertainment Credit'),service('oura-hardware','2026-09-20',-66.66,'Platinum Oura Ring Credit',{category:'Shopping',sourceCategoryDetailed:'shopping_electronics'}));
 const source={...data,asOf:'2026-09-30',dateRange:{start:'2026-01-01',end:'2026-09-30'},accounts:[card],transactions:rows,recurring:[provider('clear','CLEAR',['clear-charge'],{account_id:'plat',frequency:'ANNUALLY',first_date:'2026-04-15',last_date:'2026-04-15',last_amount:200,personal_finance_category:{primary:'services',detailed:'services_digital_other_services'}})]};
 const report=summarizeRecurring(source,{start:'2026-01-01',end:'2026-09-30'}),walmart=report.groups.find(g=>g.name==='Walmart+'),clear=report.groups.find(g=>g.name==='CLEAR'),oura=report.groups.find(g=>g.name==='Oura');
 assert.equal(walmart.paid,38.85);assert.equal(walmart.refunds,38.85);assert.equal(walmart.net,0);assert.equal(walmart.benefitCredits,38.85);
 assert.equal(walmart.lastAmount,12.95);assert.equal(walmart.monthlyEquivalent,12.95,'recorded benefits never promise a free future membership');
 assert.ok(walmart.evidenceReasons.some(reason=>/Not provider-confirmed/.test(reason)));
 assert.equal(clear.paid,200);assert.equal(clear.refunds,200);assert.equal(clear.net,0);assert.equal(clear.monthlyEquivalent,16.67,'named credit does not reduce annual gross charge estimate');
 assert.equal(oura.refunds,0,'hardware benefit never offsets Oura membership');
 assert.equal(report.unallocatedBenefitCredits,86.66,'broad digital and hardware benefits stay separate');
 assert.equal(new Set(report.groups.flatMap(g=>g.periodTransactions.map(t=>t.id))).size,report.transactionCount,'each source is assigned once');
 const before=JSON.stringify(source);summarizeRecurring(source,{start:'2026-01-01',end:'2026-09-30'});assert.equal(JSON.stringify(source),before,'service attribution does not mutate source records');
 const historical=summarizeRecurring(source,{start:'2026-01-01',end:'2026-08-31'}).groups.find(g=>g.name==='Walmart+');
 assert.equal(historical.refunds,0,'third future pair cannot support historical inference');
 const manual={...source,transactions:rows.map(t=>t.id.startsWith('wm-credit-')?{...t,classificationOverrides:{category:'Travel'}}:t)};
 assert.equal(summarizeRecurring(manual,{start:'2026-01-01',end:'2026-09-30'}).groups.find(g=>g.name==='Walmart+').refunds,0,'manual category choices prevent service reassignment');
 const otherCard={...source,accounts:[card,{...card,id:'other'}],transactions:rows.map(t=>t.id==='clear-credit'?{...t,accountId:'other'}:t)};
 assert.equal(summarizeRecurring(otherCard,{start:'2026-01-01',end:'2026-09-30'}).groups.find(g=>g.name==='CLEAR').refunds,0,'named service alone cannot borrow a charge from another account');
 const variableRows=[service('v1','2026-07-10',80,'CLEAR'),service('v2','2026-07-20',40,'CLEAR'),service('v3','2026-08-10',90,'CLEAR'),service('v4','2026-09-10',100,'CLEAR'),service('v-credit','2026-09-11',-50,'AMEX CLEAR PLUS CREDIT')];
 const variableSource={...source,transactions:variableRows,recurring:[provider('variable-clear','CLEAR',['v1'],{account_id:'plat',frequency:'MONTHLY',last_date:'2026-09-10',last_amount:100,personal_finance_category:{primary:'services',detailed:'services_digital_other_services'}})]};
 const variableGroup=summarizeRecurring(variableSource,{start:'2026-01-01',end:'2026-09-30'}).groups.find(g=>g.name==='CLEAR');
 assert.equal(variableGroup.net,260);assert.equal(variableGroup.monthlyAverage,86.67,'historical net average includes recorded service credits');
 assert.equal(variableGroup.monthlyEquivalent,103.33,'variable planning average does not project historical statement benefits');
}
console.log('Shared recurring credits passed: supported Walmart+/CLEAR historical offsets, exact single assignment, gross future estimates, manual/account/date boundaries, broad-benefit and hardware separation.');
