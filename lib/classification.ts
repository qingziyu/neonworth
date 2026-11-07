import type { Account, Dataset, Transaction } from './finance';
import { applyIncomePolicy } from './periods.ts';
import { isAppleCardSpendingProxy } from './transaction-policy.ts';
export type CategoryBasis='user_override'|'confirmed_context'|'source_semantic'|'card_context'|'merchant_identity'|'provider'|'unresolved'|'income_policy'|'user_policy'|'movement_evidence';
export type CategoryConfidence='HIGH'|'MEDIUM'|'LOW'|'UNKNOWN';
export type MerchantServiceQualifier='membership'|'hardware'|'retail'|'service'|'card_fee'|'credit'|'unknown';
export interface GeographicContext {label:string;country?:string;city?:string;basis:'source_location'|'merchant_location'|'trip_context';reason:string}
export interface DerivedTransaction extends Transaction {geographicContext?:GeographicContext;sourceCategory:string;originalCategory:string;sourceFlow:Transaction['flow'];sourceNote:string;classificationOverrides:Partial<Pick<Transaction,'category'|'flow'|'exceptional'|'note'|'review'|'reviewDecision'>>;categoryBasis:CategoryBasis;categoryReason:string;categoryConfidence:CategoryConfidence;canonicalMerchant:string;merchantKey:string;cardContext:string|null;merchantServiceQualifier:MerchantServiceQualifier;displayName:string;displayPurpose:string;classificationVersion:'merchant-v2'}
export interface DerivedDataset extends Dataset {transactions:DerivedTransaction[]}
export interface TransactionDescription {title:string;subtitle:string;merchantName:string;accountLabel:string}
export const MERCHANT_SOURCES:Array<{merchant:string;url:string;basis:string}>=[];
const clean=(s:string)=>s.normalize('NFKC').replace(/[’‘`]/g,"'").replace(/\s+/g,' ').trim();
const norm=(s:string)=>clean(s).toLowerCase().replace(/\+/g,' plus ').replace(/['']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
function descriptor(input:string|Transaction){return typeof input==='string'?{merchant:input,sourceName:''}:{merchant:input.merchant,sourceName:input.sourceName||''};}
type MovementEvidence={kind:'card_repayment'|'bank_deposit'|'cash_withdrawal'|'transfer';label:string;reason:string;confidence:'HIGH'|'MEDIUM'};
function movementEvidence(t:Transaction):MovementEvidence|undefined {
 const value=(t as Transaction&{movementClassification?:MovementEvidence}).movementClassification;
 return value&&['card_repayment','bank_deposit','cash_withdrawal','transfer'].includes(value.kind)&&typeof value.label==='string'&&typeof value.reason==='string'&&['HIGH','MEDIUM'].includes(value.confidence)?value:undefined;
}
// A generic statement descriptor is required. A retailer whose source description
// happens to say "Membership Fee" (for example Costco) is still that retailer.
const membershipFeeLabel=/^(?:(?:(?:annual|renewal|adjust|adjusted|adjustment|refund|refunded) )?(?:card )?membership (?:renewal )?fee(?: (?:renewal|adjustment|refund|credit))?|annual (?:card )?fee)$/;
function isMembershipFeeDescriptor(input:string|Transaction):boolean {
 const {merchant,sourceName}=descriptor(input);
 return membershipFeeLabel.test(norm(merchant))&&(!sourceName||membershipFeeLabel.test(norm(sourceName)))||!merchant&&membershipFeeLabel.test(norm(sourceName));
}
export function canonicalMerchant(input:string|Transaction):string {
 const {merchant,sourceName}=descriptor(input),values=[merchant,sourceName].map(norm);
 const has=(re:RegExp)=>values.some(v=>re.test(v));
 if(has(/^(?:openai|open ai)(?: chatgpt)?(?: subscription)?$/)||has(/^chatgpt(?: plus| pro)?(?: subscription)?$/))return 'OpenAI';
 if(has(/^oura(?: ring)?(?: inc)?(?: membership| subscription| hardware| ring purchase)?$/))return 'Oura';
 if(has(/^(?:amazon web services|aws)(?: inc| cloud| billing)?$/))return 'Amazon Web Services';
 if(has(/^google one(?: subscription| membership)?$/))return 'Google One';
 if(has(/^github(?: inc| subscription)?$/))return 'GitHub';
 if(has(/^walmart (?:plus|membership)(?: membership| subscription| credit)?$/))return 'Walmart+';
 if(has(/^(?:the )?new york times(?:(?: annual| monthly)? digital| subscription| subscriptions)?$/)||has(/^nyt(?: digital| subscription)?$/))return 'New York Times';
 if(has(/^uber one(?: membership)?$/))return 'Uber One';
 if(isMembershipFeeDescriptor(input))return 'Card membership fee';
 if(has(/^walmart(?: refund| credit)?$/))return 'Walmart';
 return clean(merchant||sourceName)||'Unknown merchant';
}
export function merchantKey(input:string|Transaction):string{return norm(canonicalMerchant(input)).replace(/\s+/g,'');}
export function merchantServiceQualifier(input:string|Transaction):MerchantServiceQualifier {
 const {merchant,sourceName}=descriptor(input),name=`${merchant} ${sourceName}`.toLowerCase(),canonical=canonicalMerchant(input);
 if(canonical==='Card membership fee')return 'card_fee';
 if(/credit|refund|reimbursement/.test(name))return 'credit';
 if(canonical==='Walmart+'||canonical==='Uber One'||/membership|subscription|monthly credit/.test(name))return 'membership';
 if(canonical==='Oura')return /hardware|ring purchase|device order/.test(name)?'hardware':'unknown';
 if(['OpenAI','Amazon Web Services','New York Times'].includes(canonical))return 'service';
 if(canonical==='Walmart')return 'retail';
 return 'unknown';
}
/** A readable account identity from linked-account fields, never from a fee amount. */
export function accountDisplayName(account:Account):string {
 const institution=clean(account.institution||'').replace(/\bAmerican Express\b/i,'Amex');
 let product=clean(account.officialName||account.name||'').replace(/[®™]/g,'').replace(/\s+(?:\*{2,}|•{2,})\s*\d{4}\s*$/,'').trim();
 if(!product)return institution||'Account';
 if(account.type==='credit'&&institution==='Amex')product=product.replace(/\bAmerican Express\b/ig,'Amex').replace(/\s+Card$/i,'');
 if(account.type==='credit'&&institution==='Chase'&&/^(?:chase )?ultimate rewards(?: credit card)?$/i.test(product))return 'Chase card (Ultimate Rewards)';
 if(/^credit card$/i.test(product))product='credit card';
 if(!institution||norm(product)===norm(institution)||norm(product).startsWith(`${norm(institution)} `))return product;
 return `${institution} ${product}`;
}
function explicitCreditPurpose(t:Transaction):string|null {
 const names=`${t.merchant} ${t.sourceName||''}`;
 if(t.amount>=0)return null;
 if(/digital entertainment (?:statement )?credit/i.test(names))return 'digital entertainment credit';
 if(/\bresy (?:statement )?credit\b/i.test(names))return 'Resy credit';
 if(/\blululemon (?:statement )?credit\b/i.test(names))return 'Lululemon credit';
 if(/\bclear plus (?:statement )?credit\b/i.test(names))return 'CLEAR Plus credit';
 if(/\boura (?:ring )?(?:statement )?credit\b/i.test(names))return 'Oura Ring credit';
 if(/\bsaks (?:statement )?credit\b/i.test(names))return 'Saks credit';
 if(/\bhotel (?:statement )?credit\b/i.test(names))return 'hotel credit';
 if(/\bairline fee reimbursement\b/i.test(names))return 'airline fee reimbursement';
 if(/\b(?:amex )?travel points credit\b/i.test(names))return 'travel points credit';
 if(/\buber one (?:statement )?credit\b/i.test(names))return 'Uber One credit';
 return null;
}
/** Concise purpose supported by the statement descriptor or retained category. */
export function transactionPurpose(t:Transaction):string {
 if(t.refundInference&&t.flow==='expense')return 'inferred purchase credit · not provider-confirmed';
 if(isAppleCardSpendingProxy(t))return 'digital purchases · Apple Card payment proxy';
 const movement=movementEvidence(t);
 if(movement&&t.flow!=='expense'&&t.flow!=='income')return movement.kind==='card_repayment'?'card repayment':movement.kind==='cash_withdrawal'?'cash withdrawal':movement.kind==='bank_deposit'?'bank deposit':movement.label;
 const names=`${t.merchant} ${t.sourceName||''}`,canonical=canonicalMerchant(t);
 if(isMembershipFeeDescriptor(t))return t.amount<0||/\badjust(?:ment|ed)?\b|\brefund\b/i.test(names)?'fee refund/adjustment':'membership fee';
 if(t.sourceCategoryDetailed==='transfers_credit_card_payment'||/\bcredit card payment\b/i.test(names))return 'card repayment';
 const credit=explicitCreditPurpose(t);if(credit)return credit;
 if(t.flow==='income')return t.category||'income';
 if(t.flow==='review')return t.amount<0?'credit · purpose unconfirmed':'purpose unconfirmed';
 if(t.flow==='transfer')return t.incomePolicyExcluded?'non-income credit':'money movement';
 if(t.amount<0)return 'refund/credit';
 if(canonical==='Walmart+'||canonical==='Uber One')return 'membership';
 if(canonical==='Oura'&&/membership|subscription/i.test(names))return 'membership';
 if(canonical==='Oura'&&/hardware|ring purchase|device order/i.test(names))return 'hardware purchase';
 if(canonical==='New York Times')return 'news/media';
 if(canonical==='WSDOT Good To Go')return 'toll payment';
 if(canonical==='OpenAI')return 'software service';
 if(canonical==='Amazon Web Services')return 'cloud service';
 if(weakCategory(t.category))return 'purchase · purpose unconfirmed';
 return t.category;
}
/** Source merchant location is context; it never alone proves a precise item or card-present visit. */
export function transactionGeographicContext(t:Transaction):GeographicContext|undefined {
 const location=(t as Transaction&{sourceLocation?:{city?:string|null;region?:string|null;country?:string|null}}).sourceLocation;
 const value=(v:unknown)=>typeof v==='string'?clean(v).slice(0,120):'';
 const rawCountry=value(location?.country),country=/^(?:JP|JPN|Japan)$/i.test(rawCountry)?'JP':/^(?:US|USA|United States)$/i.test(rawCountry)?'US':rawCountry;
 const city=value(location?.city),region=value(location?.region);
 const bareFragment=!country&&!region&&/^(?:Upper|Beach)$/i.test(city);
 if((country||city||region)&&!bareFragment){
  const countryName=country==='JP'?'Japan':country==='US'?'US':country;
  return {label:[city,region,countryName].filter((item,index,items)=>item&&items.indexOf(item)===index).join(', '),country:country||undefined,city:city||undefined,basis:'source_location',reason:'Merchant location supplied by the financial source. It describes the recorded merchant location, not proof of a specific item or the account holder’s physical location.'};
 }
 return undefined;
}
export function transactionDescription(t:Transaction,account?:Account):TransactionDescription {
 const merchantName=canonicalMerchant(t),purpose=transactionPurpose(t),identity=account?accountDisplayName(account):'',mask=account?.mask?`•••• ${account.mask}`:'';
 const accountLabel=[identity,mask].filter(Boolean).join(' · '),cardOperation=account?.type==='credit'&&(isMembershipFeeDescriptor(t)||purpose==='card repayment'||!!explicitCreditPurpose(t));
 const title=isAppleCardSpendingProxy(t)?'Apple Card · digital spending':cardOperation?`${identity} · ${purpose}`:isMembershipFeeDescriptor(t)?purpose==='fee refund/adjustment'?'Membership fee refund/adjustment':'Membership fee':purpose==='refund/credit'?`${merchantName} · ${purpose}`:merchantName;
 const feeDescription=purpose==='fee refund/adjustment'?'Card fee refund or adjustment':/\bannual\b/i.test(`${t.merchant} ${t.sourceName||''}`)?'Annual card membership fee':/\brenewal\b/i.test(`${t.merchant} ${t.sourceName||''}`)?'Card membership renewal fee':'Card membership fee';
 const attached=(t as Partial<DerivedTransaction>).geographicContext;
 const geographicContext=attached?.basis==='trip_context'&&typeof attached.label==='string'?attached:transactionGeographicContext(t);
 const subtitle=cardOperation?[isMembershipFeeDescriptor(t)?feeDescription:purpose,mask].filter(Boolean).join(' · '):[purpose,geographicContext?.label,accountLabel].filter(Boolean).join(' · ');
 return {title,subtitle,merchantName,accountLabel};
}
export function transactionDisplayName(t:Transaction,account?:Account):string{return transactionDescription(t,account).title;}
function sourceCategory(detailed:string):string|null {
 if(/^dining_drinks_/.test(detailed))return 'Dining & coffee';
 if(/^groceries_/.test(detailed))return 'Groceries';
 if(/^shopping_/.test(detailed))return 'Shopping';
 if(/^health_wellness_/.test(detailed))return 'Health & personal care';
 if(/^transportation_/.test(detailed))return 'Transport';
 if(/^travel_/.test(detailed))return 'Travel';
 if(/^financial_/.test(detailed))return 'Financial & insurance';
 if(/^entertainment_/.test(detailed))return 'Entertainment';
 if(/^services_/.test(detailed))return 'Services';
 if(/^housing_/.test(detailed))return 'Housing';
 if(/^bills_utilities_/.test(detailed))return 'Bills & utilities';
 if(/^gifts_donations_/.test(detailed))return 'Gifts & donations';
 return null;
}
const confidence=(s:string):CategoryConfidence=>s==='VERY_HIGH'||s==='HIGH'?'HIGH':s==='MEDIUM'?'MEDIUM':s==='LOW'?'LOW':'UNKNOWN';
const weakCategory=(s:string)=>!s||/^(other|uncategorized|unknown)$/i.test(s);
const confirmedContext=(_t:Transaction)=>false; // Only explicit saved corrections override source categories.
const patchKeys=['category','flow','exceptional','note','review','reviewDecision'] as const;
const validFlow=(value:unknown):value is Transaction['flow']=>typeof value==='string'&&['expense','income','transfer','review'].includes(value);
function validPatchValue(key:typeof patchKeys[number],value:unknown):boolean {
 if(key==='reviewDecision')return value===null||typeof value==='string'&&['cash_income','purchase_refund','zelle','interest','transfer','expense'].includes(value);
 if(key==='flow')return validFlow(value);
 if(key==='exceptional'||key==='review')return typeof value==='boolean';
 return typeof value==='string'&&(key==='note'||value.length>0);
}
function applyPatch(t:Transaction,patch:Partial<Transaction>|undefined):Transaction {
 const result={...t};if(patch)for(const key of patchKeys)if(patch[key]!==undefined)(result as unknown as Record<string,unknown>)[key]=patch[key];return result;
}
function accountContext(account:Account|undefined):string|null {
 if(account?.type!=='credit')return null;
 const official=(account as Account&{officialName?:string}).officialName;
 return `${account.institution} · ${official||account.name}${account.mask?` · ${account.mask}`:''}`;
}
export function applyMerchantIntelligence(data:Dataset,overrides:Record<string,Partial<Transaction>>={}):DerivedDataset {
 const accounts=new Map(data.accounts.map(a=>[a.id,a]));
 const transactions=data.transactions.map(raw=>{
  const existing=raw as Partial<DerivedTransaction>,baseline=typeof existing.sourceCategory==='string'&&existing.sourceCategory?existing.sourceCategory:typeof existing.originalCategory==='string'&&existing.originalCategory?existing.originalCategory:raw.category;
  // A saved note, review flag or one-off tag is not evidence of a category edit.
  // Carry the actual edited fields so a derived backup can be re-derived without
  // turning an old generic user_override badge into a new category correction.
  const savedPatch:Partial<Pick<Transaction,typeof patchKeys[number]>>={};
  for(const patch of [existing.classificationVersion==='merchant-v2'?existing.classificationOverrides:undefined,overrides[raw.id]])if(patch&&typeof patch==='object'&&!Array.isArray(patch))for(const key of patchKeys)if(validPatchValue(key,patch[key])&&!(key==='flow'&&patch[key]==='income'&&raw.amount>0))(savedPatch as Record<string,unknown>)[key]=patch[key];
  if(overrides[raw.id]?.flow==='review'&&overrides[raw.id]?.review===true&&!overrides[raw.id]?.reviewDecision)savedPatch.reviewDecision=null;
  const sourceFlow=validFlow(existing.sourceFlow)&&!(existing.sourceFlow==='income'&&raw.amount>0)?existing.sourceFlow:raw.flow,sourceNote=typeof existing.sourceNote==='string'?existing.sourceNote:raw.note;
  const protectedContext=confirmedContext({...raw,note:sourceNote});
  const sourceRow={...raw,category:protectedContext?raw.category:baseline,flow:sourceFlow};delete (sourceRow as Partial<DerivedTransaction>).geographicContext;
  const t=applyPatch(sourceRow,savedPatch),account=accounts.get(t.accountId),canonical=canonicalMerchant(t),key=merchantKey(t),card=accountContext(account),providerConfidence=confidence(t.confidence);
  let category=t.category,basis:CategoryBasis='provider',reason='Stored category retained; no stronger safe evidence.',certainty=providerConfidence,review=t.review,flow=t.flow;
  const categoryOverride=savedPatch.category!==undefined;
  const generatedCategoryReview=/Expense counted using the stored category; review its category\./i.test(sourceNote);
  const clearCategoryReview=()=>{if(generatedCategoryReview||!sourceNote.trim())review=false;};
  const set=(next:string,why:string,kind:CategoryBasis='merchant_identity',level:CategoryConfidence='HIGH')=>{category=next;reason=why;basis=kind;certainty=level;if(level==='HIGH'&&(weakCategory(t.category)||generatedCategoryReview))clearCategoryReview();};
  const detailed=t.sourceCategoryDetailed||'',names=`${t.merchant} ${t.sourceName||''}`,n=norm(t.sourceName||t.merchant);
  if(categoryOverride){basis='user_override';certainty='HIGH';reason='Your explicit saved category correction takes precedence over merchant inference and the original provider category.';}
  else if(protectedContext){basis='confirmed_context';certainty='HIGH';reason='Existing confirmed transaction context is retained above merchant-level inference.';}
  else if(account?.type==='depository'&&t.amount<0){reason='Bank credit left to your income rule; merchant identity does not set its purpose.';}
  else if(providerConfidence==='HIGH'&&!detailed&&!weakCategory(category)){reason='A high-confidence stored category without a detailed source semantic is retained; merchant identity alone does not override a prior category correction.';}
  else if(card&&canonical==='Card membership fee'){
   set('Financial & insurance',`An explicit membership-fee statement descriptor on this credit-card account identifies a card fee, not a merchant purchase. ${card}. No specific card product or fee schedule is inferred.`,'card_context');flow='expense';
  }else if(card&&t.amount<0&&/platinum.*digital entertainment credit|digital entertainment credit/i.test(names)){set('Entertainment','Explicit card-statement entertainment credit offsets its expense category; it is not a new income payment.','card_context');flow='expense';}
  else if(card&&t.amount<0&&/\bresy credit\b/i.test(names)){set('Dining & coffee','Explicit card-statement dining credit offsets dining expenses. No current benefit eligibility or amount is assumed.','card_context');flow='expense';}
  else if(card&&t.amount<0&&/lululemon credit/i.test(names)){set('Shopping','Explicit named retail credit offsets shopping; the account label does not turn it into a card fee.','card_context');flow='expense';}
  else if(card&&t.amount<0&&/hotel credit|lodging credit|airline fee reimbursement/i.test(names)){set('Travel','Explicit travel-credit/reimbursement descriptor offsets travel spending, rather than income.','card_context');flow='expense';clearCategoryReview();}
  else if(t.flow==='expense'){
   if(weakCategory(category)&&sourceCategory(detailed)&&providerConfidence!=='LOW'&&providerConfidence!=='UNKNOWN')set(sourceCategory(detailed)!,`The detailed provider semantic ${detailed} supplies the broad category.`,'source_semantic',providerConfidence);
   else if(sourceCategory(detailed)===category){basis='source_semantic';reason=`Original source: ${detailed}; frequency alone does not imply a subscription.`;}
   else if(canonical==='Walmart+'&&weakCategory(category))set('Services','The explicit membership descriptor identifies a service; ordinary store purchases are not inferred.');
   else if(['OpenAI','Amazon Web Services'].includes(canonical)&&weakCategory(category))set('Services','Explicit software/cloud service identity; recurrence or a plan is not inferred.');
  }else if(t.amount<0&&t.flow==='review'&&card){basis='unresolved';reason='The known merchant or card account does not establish whether this unlabeled credit is a refund, benefit or another movement. Existing review treatment is preserved.';certainty='LOW';}
  const geographicContext=transactionGeographicContext(t);
  // Independently preserve treatment/review decisions. Only the income policy
  // applied after this stage can supersede flow under the user's income rule.
  if(savedPatch.flow!==undefined)flow=savedPatch.flow;
  if(savedPatch.review!==undefined)review=savedPatch.review;
  const result={...t,category,flow,review,...(geographicContext?{geographicContext}:{})};
  return {...result,sourceCategory:baseline,originalCategory:existing.originalCategory??baseline,sourceFlow,sourceNote,classificationOverrides:savedPatch,categoryBasis:basis,categoryReason:reason,categoryConfidence:certainty,canonicalMerchant:canonical,merchantKey:key,cardContext:card,merchantServiceQualifier:merchantServiceQualifier(t),...(geographicContext?{geographicContext}:{}),displayName:transactionDisplayName(result,account),displayPurpose:transactionPurpose(result),classificationVersion:'merchant-v2' as const};
 });
 return {...data,transactions};
}
export function deriveDataset(data:Dataset,overrides:Record<string,Partial<Transaction>>={},reviewPreferences?:import('./review-preferences').ReviewPreferences):DerivedDataset {
 const classified=applyMerchantIntelligence(data,overrides),policy=applyIncomePolicy(classified);
 const accountsById=new Map<string,Account>();
 for(const account of data.accounts)if(!accountsById.has(account.id))accountsById.set(account.id,account);
 return {...policy,reviewPreferences:reviewPreferences??policy.reviewPreferences,transactions:policy.transactions.map((t,index)=>{const before=classified.transactions[index],movement=movementEvidence(t),categoryCorrected=before.classificationOverrides.category!==undefined,result=t.refundInference?{...t,categoryBasis:'source_semantic' as const,categoryReason:t.refundInference.reason,categoryConfidence:'MEDIUM' as const}:t.reviewDecision?{...t,categoryBasis:'user_override' as const,categoryReason:t.reviewDecisionReason||'Your saved review decision takes precedence.',categoryConfidence:'HIGH' as const}:t.dashboardPolicyReason?{...t,categoryBasis:'user_policy' as const,categoryReason:t.dashboardPolicyReason,categoryConfidence:'HIGH' as const}:movement&&!categoryCorrected?{...t,categoryBasis:'movement_evidence' as const,categoryReason:movement.reason,categoryConfidence:movement.confidence}:categoryCorrected?{...t,categoryBasis:before.categoryBasis,categoryReason:before.categoryReason,categoryConfidence:before.categoryConfidence}:t.category!==before.category||t.flow!==before.flow?{...t,categoryBasis:'income_policy' as const,categoryReason:t.incomePolicyReason||'The user-defined income policy takes precedence after merchant categorization.',categoryConfidence:'HIGH' as const}:t;return {...result,displayName:transactionDisplayName(result,accountsById.get(t.accountId)),displayPurpose:transactionPurpose(result)};})} as DerivedDataset;
}
