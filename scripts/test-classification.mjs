import assert from 'node:assert/strict';
import {canonicalMerchant,merchantKey,merchantServiceQualifier,applyMerchantIntelligence,deriveDataset,accountDisplayName,transactionDisplayName,transactionPurpose,transactionDescription} from '../lib/classification.ts';
const account=(id,type='credit',extra={})=>({id,type,name:type==='credit'?'Example credit card':'Example checking',institution:'Example Bank',subtype:type==='depository'?'checking':'credit_card',mask:id,balance:100,netBalance:100,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced',...extra});
const tx=(id,merchant,extra={})=>({id,merchant,sourceName:merchant,date:'2024-08-15',accountId:'card',amount:40,category:'Other',flow:'expense',confidence:'LOW',exceptional:false,note:'',pending:false,review:true,sourceCategoryDetailed:'other_other',...extra});
const data=transactions=>({version:1,syncedAt:'2024-08-31T12:00:00Z',asOf:'2024-08-31',dateRange:{start:'2024-01-01',end:'2024-08-31'},coverage:{},accounts:[account('card','credit'),account('bank','depository')],transactions,netWorthHistory:[],recurring:[],notes:[]});
assert.equal(canonicalMerchant('Open AI ChatGPT'),'OpenAI');
assert.equal(merchantKey('Example Cafe'),merchantKey('  Example   Cafe  '));
assert.equal(canonicalMerchant('Oura Ring Membership'),'Oura');
assert.equal(canonicalMerchant('Walmart Plus Membership'),'Walmart+');
assert.equal(canonicalMerchant('Example Cafe Downtown'),'Example Cafe Downtown','Unknown merchant names are retained, not rewritten into personal aliases.');
assert.notEqual(merchantKey('Example Cafe'),merchantKey('Example Cafe Annex'));
assert.equal(merchantServiceQualifier('Oura Membership'),'membership');assert.equal(merchantServiceQualifier('Oura Hardware'),'hardware');assert.equal(merchantServiceQualifier('Oura'),'unknown');
const original=data([
 tx('restaurant','Example Restaurant',{sourceCategoryDetailed:'dining_drinks_restaurants',confidence:'HIGH'}),
 tx('clinic','Example Clinic',{sourceCategoryDetailed:'health_wellness_medical',confidence:'HIGH'}),
 tx('ambiguous','Example Shop'),
 tx('fee','Annual Membership Fee'),
 tx('not-card-fee','Annual Membership Fee',{accountId:'bank'}),
 tx('retailer-member','Example Store',{sourceName:'Example Store Membership',category:'Shopping',confidence:'HIGH',sourceCategoryDetailed:'shopping_superstores'}),
 tx('credit','Digital Entertainment Credit',{amount:-20,flow:'review'}),
 tx('walmart-plus','Walmart Plus Membership'),
 tx('retail','Walmart',{category:'Shopping',confidence:'HIGH',sourceCategoryDetailed:'shopping_superstores'}),
 tx('unlabeled-credit','Example Shop',{amount:-60,flow:'review',category:'Transfers',confidence:'MEDIUM',sourceCategoryDetailed:'income_other_income'}),
 tx('stored-category','Example Merchant',{category:'Shopping',confidence:'HIGH',sourceCategoryDetailed:null,review:false}),
 tx('override','Example Merchant',{sourceCategoryDetailed:'shopping_books_news',confidence:'HIGH'}),
 tx('income','Example Employer',{accountId:'bank',amount:-600,category:'Other',flow:'review',sourceName:'Example Employer Deposit'}),
]);
const before=JSON.stringify(original),overrides={override:{category:'Education',note:'Synthetic saved correction.',review:false},fee:{amount:999,id:'changed'}};
const d=applyMerchantIntelligence(original,overrides),find=id=>d.transactions.find(t=>t.id===id);
assert.equal(find('restaurant').category,'Dining & coffee');assert.equal(find('restaurant').categoryBasis,'source_semantic');
assert.equal(find('clinic').category,'Health & personal care');assert.equal(find('ambiguous').category,'Other');assert.equal(find('ambiguous').review,true);
assert.equal(find('fee').category,'Financial & insurance');assert.equal(find('fee').categoryBasis,'card_context');assert.equal(find('fee').amount,40);assert.equal(find('fee').id,'fee');
assert.equal(find('not-card-fee').category,'Other');assert.equal(find('retailer-member').category,'Shopping');assert.notEqual(find('retailer-member').canonicalMerchant,'Card membership fee');
assert.equal(find('credit').category,'Entertainment');assert.equal(find('credit').flow,'expense');assert.equal(find('credit').amount,-20);
assert.equal(find('walmart-plus').category,'Services');assert.equal(find('retail').category,'Shopping');assert.equal(find('unlabeled-credit').flow,'review');
assert.equal(find('stored-category').category,'Shopping');assert.equal(find('override').category,'Education');assert.equal(find('override').categoryBasis,'user_override');
assert.equal(find('income').flow,'review');assert.equal(find('income').category,'Other');
assert.equal(JSON.stringify(original),before);assert.deepEqual(applyMerchantIntelligence(d),d);
const final=deriveDataset(original,overrides);assert.equal(final.transactions.find(t=>t.id==='income').flow,'review','An employer name alone is not a configured income policy.');assert.deepEqual(deriveDataset(final),final);
for(let i=0;i<original.transactions.length;i++){const a=original.transactions[i],b=final.transactions[i];for(const key of ['id','date','amount','accountId','merchant','sourceName','sourceCategoryDetailed'])assert.deepEqual(b[key],a[key]);assert.equal(b.sourceCategory,a.category);assert.equal(b.originalCategory,a.category);}
assert.equal(final.transactions.length,original.transactions.length);
// Geography comes only from supplied source location, never remembered travel.
const lodging=data([tx('hotel','Example Hotel',{date:'2024-08-09',amount:240,category:'Travel',sourceCategoryDetailed:'travel_lodging',confidence:'HIGH',sourceLocation:{city:'Example City',country:'US'}}),tx('cafe','Example Cafe',{category:'Dining & coffee',sourceCategoryDetailed:'dining_drinks_restaurants',confidence:'HIGH'})]);
const lodgingDerived=deriveDataset(lodging);assert.equal(lodgingDerived.transactions[0].category,'Travel');assert.equal(lodgingDerived.transactions[0].geographicContext.label,'Example City, US');assert.equal(lodgingDerived.transactions[1].geographicContext,undefined);
assert.equal(deriveDataset(lodging,{hotel:{category:'Education'}}).transactions[0].category,'Education');
// These six synthetic rows exercise all six observed statement-descriptor cases,
// with public card names and invented IDs/amounts rather than private records.
const platinum=account('platinum','credit',{institution:'American Express',name:'Platinum Card®',officialName:'Platinum Card®',mask:'1111'}),delta=account('delta','credit',{institution:'American Express',name:'Delta SkyMiles® Platinum Card',officialName:'Delta SkyMiles® Platinum Card',mask:'2222'}),rewards=account('rewards','credit',{institution:'Chase',officialName:'Ultimate Rewards®',mask:'3333'});
const fees=data([
 tx('annual','ANNUAL MEMBERSHIP FEE',{accountId:'rewards',sourceName:'Annual Membership Fee',amount:90}),
 tx('renewal','RENEWAL MEMBERSHIP FEE',{accountId:'platinum',sourceName:'Renewal Membership Fee',amount:800}),
 tx('adjustment','ADJUST MEMBERSHIP FEE',{accountId:'delta',sourceName:'Membership Fee Adjustment',amount:-40,flow:'review',category:'Income'}),
 tx('renewal-short','RENEWAL MEMBERSHIP FEE',{accountId:'delta',sourceName:'Membership Fee',amount:100}),
 tx('renewal-long','RENEWAL MEMBERSHIP FEE',{accountId:'delta',sourceName:'Membership Renewal Fee',amount:200}),
 tx('membership','MEMBERSHIP FEE',{accountId:'platinum',sourceName:'Membership Fee',amount:150}),
]);fees.accounts=[platinum,delta,rewards];
const feeSource=JSON.stringify(fees),readable=deriveDataset(fees),byId=id=>readable.transactions.find(t=>t.id===id);
assert.equal(accountDisplayName(platinum),'Amex Platinum');assert.equal(accountDisplayName(delta),'Amex Delta SkyMiles Platinum');assert.equal(accountDisplayName(rewards),'Chase card (Ultimate Rewards)');assert.doesNotMatch(accountDisplayName(rewards),/Sapphire|Freedom/i);
assert.equal(byId('renewal').displayName,'Amex Platinum · membership fee');assert.equal(byId('adjustment').displayName,'Amex Delta SkyMiles Platinum · fee refund/adjustment');
assert.equal(byId('adjustment').category,'Financial & insurance');assert.equal(byId('adjustment').flow,'expense');assert.equal(byId('adjustment').amount,-40);
assert.ok(readable.transactions.every(t=>t.canonicalMerchant==='Card membership fee'&&t.merchantKey==='cardmembershipfee'&&t.merchantServiceQualifier==='card_fee'));
assert.equal(readable.transactions.filter(t=>t.accountId==='delta').reduce((n,t)=>n+t.amount,0),260,'fee adjustment offsets the same-account fee ledger without a second sign change');
assert.match(transactionDescription(byId('annual'),rewards).subtitle,/Annual card membership fee/);assert.match(transactionDescription(byId('renewal'),platinum).accountLabel,/Amex Platinum.*1111/);
assert.equal(transactionPurpose(tx('costco','Costco',{sourceName:'Membership Fee',category:'Shopping'})),'Shopping');assert.equal(transactionDisplayName(tx('costco','Costco',{sourceName:'Membership Fee',category:'Shopping'}),platinum),'Costco');
assert.notEqual(canonicalMerchant(tx('costco-source','MEMBERSHIP FEE',{sourceName:'Costco',category:'Shopping'})),'Card membership fee','a conflicting named retailer in source evidence is not erased by a generic merchant field');
assert.equal(transactionDisplayName(tx('benefit','Platinum Resy Credit',{amount:-20,sourceName:'Resy Credit'}),platinum),'Amex Platinum · Resy credit');
assert.equal(transactionPurpose(tx('walmart-credit','Walmart',{amount:-10,sourceName:'Walmart Credit',flow:'review'})),'credit · purpose unconfirmed');
assert.equal(transactionDisplayName(tx('payment','MOBILE PAYMENT - THANK YOU',{amount:-100,sourceName:'Credit Card Payment',flow:'transfer',category:'Transfers'}),platinum),'Amex Platinum · card repayment');
assert.equal(transactionDisplayName(tx('missing-card','RENEWAL MEMBERSHIP FEE')),'Membership fee');assert.equal(transactionDisplayName(tx('bank-member','MEMBERSHIP FEE'),account('bank-member','depository')),'Membership fee');
assert.equal(transactionDisplayName(tx('google-one','ONE',{sourceName:'Google One'})),'Google One','a cryptic merchant alias uses its explicit named source service');
assert.equal(transactionDisplayName(tx('unidentified-one','ONE',{sourceName:'ONE'})),'ONE','a short alias alone does not identify Google One');
assert.equal(JSON.stringify(fees),feeSource);assert.deepEqual(deriveDataset(readable),readable);
assert.equal(deriveDataset(data([tx('policy-title','Amazon',{accountId:'bank',amount:-100,flow:'review'})])).transactions[0].displayPurpose,'credit · purpose unconfirmed');
// Harmless annotations must preserve inferred categories and their confidence.
// A category override is a distinct decision from note/review/treatment fields.
for(const patch of [{note:'I checked this statement charge.'},{note:'User-confirmed statement amount only.'},{review:false},{review:true},{exceptional:true},{flow:'review'}]){
 const annotated=deriveDataset(fees,{'renewal':patch}),row=annotated.transactions.find(t=>t.id==='renewal');
 assert.equal(row.category,'Financial & insurance',`annotation ${JSON.stringify(patch)} preserves card-fee category`);
 assert.equal(row.categoryBasis,'card_context');assert.equal(row.categoryConfidence,'HIGH');
 for(const [key,value] of Object.entries(patch))assert.equal(row[key],value,`${key} decision is independently preserved`);
 assert.deepEqual(deriveDataset(annotated),annotated,'proven field-wise corrections remain idempotent');
}
const annotatedUnknown=deriveDataset(data([tx('ambiguous','Unidentified shop')]),{ambiguous:{note:'Receipt checked.',review:false,exceptional:true}}).transactions[0];
assert.equal(annotatedUnknown.categoryBasis,'provider');assert.equal(annotatedUnknown.categoryConfidence,'LOW','an annotation must not promote uncertain category confidence');assert.equal(annotatedUnknown.review,false);assert.equal(annotatedUnknown.exceptional,true);
const categoryAndFlow=deriveDataset(fees,{renewal:{category:'Travel',flow:'transfer',note:'Explicit category and treatment',review:true}});
assert.equal(categoryAndFlow.transactions.find(t=>t.id==='renewal').category,'Travel');assert.equal(categoryAndFlow.transactions.find(t=>t.id==='renewal').flow,'transfer');assert.equal(categoryAndFlow.transactions.find(t=>t.id==='renewal').categoryBasis,'user_override');assert.deepEqual(deriveDataset(categoryAndFlow),categoryAndFlow);
const staleBadge={...fees,transactions:fees.transactions.map(t=>t.id==='renewal'?{...t,category:'Other',sourceCategory:'Other',originalCategory:'Other',categoryBasis:'user_override',categoryConfidence:'HIGH',classificationVersion:'merchant-v1'}:t)};
assert.equal(deriveDataset(staleBadge).transactions.find(t=>t.id==='renewal').category,'Financial & insurance','an old user_override label alone is not proof that the category was edited');
const malformedMetadata={...fees,transactions:fees.transactions.map(t=>t.id==='renewal'?{...t,sourceFlow:{invalid:true},sourceNote:null,sourceCategory:{invalid:true},originalCategory:[],classificationVersion:'merchant-v2',classificationOverrides:{category:{invalid:true},flow:'invalid',review:'false',note:99,exceptional:[]}}:t)};
const ignoredMetadata=deriveDataset(malformedMetadata).transactions.find(t=>t.id==='renewal');assert.equal(ignoredMetadata.category,'Financial & insurance');assert.equal(ignoredMetadata.flow,'expense');assert.equal(ignoredMetadata.review,false);assert.equal(ignoredMetadata.note,'');assert.equal(ignoredMetadata.exceptional,false);assert.deepEqual(ignoredMetadata.classificationOverrides,{},'malformed passthrough metadata does not become a saved financial decision');
const impossibleIncome={...fees,transactions:fees.transactions.map(t=>t.id==='renewal'?{...t,sourceFlow:'income',classificationVersion:'merchant-v2',classificationOverrides:{flow:'income'}}:t)};assert.equal(deriveDataset(impossibleIncome,{renewal:{flow:'income'}}).transactions.find(t=>t.id==='renewal').flow,'expense','neither derived metadata nor an unsafe external patch can turn a positive outflow into income');

console.log('PASS: safe merchant aliases; ambiguity and overrides; true card fees vs retailer membership; all six fee descriptor cases and account-linked titles; fee adjustments offset without sign changes; explicit benefit credits and repayments; source unchanged; income policy display consistency; full metadata idempotence.');
