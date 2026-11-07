import { money, type Account, type Dataset, type Transaction } from './finance.ts';
import { accountDisplayName, canonicalMerchant } from './classification.ts';

/** Dated public facts. They describe the published product, never a personal bill. */
export interface CardReference {
 id:string;productName:string;annualFee:number;additionalAnnualFee:number|null;
 sourceUrl:string;sourceUrls:string[];checkedAt:string;note:string;
}
export interface CardFeeComponent {transaction:Transaction;nature:string;reason:string;inPeriod:boolean}
export interface CardFeeSummary {
 accountId:string;productName:string;reference:CardReference|null;
 paid:number;refunds:number;net:number;components:CardFeeComponent[];ambiguous:boolean;
 hypothesis?:{label:string;reason:string;calculation:string;assumption:string;transactionIds:string[]};
}
const checkedAt='2026-10-26';
const delta:CardReference={
 id:'us-personal-amex-delta-skymiles-platinum',productName:'Amex Delta SkyMiles Platinum',annualFee:350,additionalAnnualFee:0,
 sourceUrl:'https://www.americanexpress.com/us/credit-cards/card/delta-skymiles-platinum-american-express-card/',
 sourceUrls:['https://www.americanexpress.com/us/credit-cards/card/delta-skymiles-platinum-american-express-card/','https://www.americanexpress.com/content/dam/amex/en-us/company/legal/cardmember-agreements/public-site-adhoc-2025-10-08/cps-lending/delta-skymiles-platinum-10-08-2025.pdf'],checkedAt,
 note:'Published U.S. personal-card standard: $350 annually; no annual fee for additional cards. The public agreement dated October 8, 2025 corroborates the standard. Individual adjustments, product changes and account-specific terms are not established by this reference.',
};
const platinum:CardReference={
 id:'us-personal-amex-platinum',productName:'Amex Platinum',annualFee:895,additionalAnnualFee:195,
 sourceUrl:'https://www.americanexpress.com/us/credit-cards/card/platinum/',
 sourceUrls:['https://www.americanexpress.com/us/credit-cards/card/platinum/','https://www.americanexpress.com/en-us/benefits/additional-card/additional-platinum-card/terms-and-conditions/'],checkedAt,
 note:'Published U.S. personal-card standard: $895 basic-card annual fee; $195 per Additional Platinum Card under the current standard. Companion cards and some legacy or branded accounts differ. A $195 statement entry alone does not prove that an additional card is held.',
};
const prime:CardReference={
 id:'us-chase-prime-visa',productName:'Chase Prime Visa',annualFee:0,additionalAnnualFee:null,
 sourceUrl:'https://creditcards.chase.com/no-annual-fee-credit-cards',sourceUrls:['https://creditcards.chase.com/no-annual-fee-credit-cards'],checkedAt,
 note:'Chase publishes no annual credit-card fee for Prime Visa. An eligible Prime membership is separate from the credit-card fee; recorded Amazon Prime charges remain service expenses.',
};
const norm=(value:string)=>value.normalize('NFKC').replace(/[®™]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
/** Resolve only an issuer and an explicitly named product. Loyalty branding is insufficient. */
export function cardReference(account:Account):CardReference|null {
 if(account.type!=='credit')return null;
 const product=norm(account.officialName||account.name).replace(/^(?:american express|amex) /,'');
 if(/^chase$/i.test(account.institution.trim())&&product==='prime visa')return {...prime,sourceUrls:[...prime.sourceUrls]};
 if(!/^american express$|^amex$/i.test(account.institution.trim()))return null;
 if(/^delta skymiles platinum(?: card)?$/.test(product))return {...delta,sourceUrls:[...delta.sourceUrls]};
 if(/^platinum(?: card)?$/.test(product))return {...platinum,sourceUrls:[...platinum.sourceUrls]};
 return null;
}
export const WALMART_PLUS_REFERENCE={
 monthlyFeeBeforeTax:12.95,
 sourceUrl:'https://global.americanexpress.com/card-benefits/detail/walmart-platinum/platinum',
 sourceUrls:['https://www.americanexpress.com/us/credit-cards/card/platinum/','https://www.walmart.com/plus/partnerenroll/?programId=amexplatinum&programName=amexplatinum'],
 checkedAt,
 note:'The issuer advertises a Walmart+ monthly membership statement credit up to $12.95 plus applicable taxes for the U.S. personal Platinum product, subject to eligible monthly billing and current terms. This is context for reviewing repeated offsets, not proof that an individual credit was a membership benefit.',
};
const sum=(rows:Transaction[],value:(row:Transaction)=>number)=>rows.reduce((n,row)=>n+Math.round(value(row)*100),0)/100;
export function summarizeCardFees(data:Dataset,period:{start:string;end:string}):CardFeeSummary[] {
 const end=period.end<data.asOf?period.end:data.asOf;
 return data.accounts.filter(account=>account.type==='credit').flatMap(account=>{
  const rows=data.transactions.filter(row=>row.accountId===account.id&&!row.pending&&row.flow==='expense'&&row.date<=end&&canonicalMerchant(row)==='Card membership fee').sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const reference=cardReference(account);
  if(!rows.length&&!reference)return [];
  const selected=rows.filter(row=>row.date>=period.start),positive=rows.filter(row=>row.amount>0),negative=rows.filter(row=>row.amount<0);
  const components=rows.map(transaction=>{
   let nature='Posted fee component · not annual price',reason='The statement identifies a membership-fee entry. Its amount alone does not identify a standard annual fee, the billing period, proration or a product change.';
   if(transaction.amount<0){nature='Recorded fee adjustment / credit';reason='The signed credit is retained against this card’s recorded fee activity. It is not a separate annual fee or a verified future discount.';}
   else if(reference&&Math.round(transaction.amount*100)===Math.round(reference.annualFee*100)){nature='Posted fee · matches published standard';reason='The recorded amount matches the current published basic annual fee. The original entry remains the evidence of what was charged; the reference does not establish a future invoice.';}
   else if(reference&&reference.additionalAnnualFee!==null&&reference.additionalAnnualFee>0&&Math.round(transaction.amount*100)===Math.round(reference.additionalAnnualFee*100)){reason='This amount matches the published Additional Platinum Card rate, but the generic source description does not confirm that component. It is not compared with the basic-card fee as a price increase.';}
   else if(reference){reason=`This entry differs from the published ${reference.annualFee} USD basic annual rate. The available description does not establish why; it must not be repeated as the annual price.`;}
   return {transaction,nature,reason,inPeriod:transaction.date>=period.start};
  });
  const paid=sum(selected,row=>Math.max(row.amount,0)),refunds=sum(selected,row=>Math.max(-row.amount,0));
  const ambiguous=negative.length>0||new Set(positive.map(row=>Math.round(row.amount*100))).size>1||!!reference&&positive.some(row=>Math.round(row.amount*100)!==Math.round(reference.annualFee*100));
  const possibleReversals=reference?.id==='us-personal-amex-delta-skymiles-platinum'?negative.flatMap(credit=>positive.flatMap(prior=>{
   const days=Math.round((Date.parse(credit.date)-Date.parse(prior.date))/86400000),replacement=positive.filter(row=>row.id!==prior.id&&row.date===credit.date);
   if(days<1||days>45||-credit.amount>=prior.amount||replacement.length!==1||Math.round(prior.amount*(365-days)/365*100)!==Math.round(-credit.amount*100))return [];
   return [{prior,credit,replacement:replacement[0],days}];
  })):[];
  const sequence=possibleReversals.length===1?possibleReversals[0]:undefined;
  const hypothesis=sequence?{
   label:'Possible fee adjustment after a card change · inferred',
   reason:`A ${money(sequence.prior.amount,2)} fee on ${sequence.prior.date} was followed ${sequence.days} days later by a ${money(-sequence.credit.amount,2)} credit and a separate ${money(sequence.replacement.amount,2)} fee on the same account. This supports a partial-fee reversal or product-change hypothesis; neither the earlier card product nor the reason for the new fee is confirmed.`,
   calculation:`Illustration: ${money(sequence.prior.amount,2)} × ${365-sequence.days}/365 = ${money(-sequence.credit.amount,2)}, rounded.`,
   assumption:'This assumes a 365-day annual-fee basis only to explain the matching refund pattern. The issuer’s calculation method is unverified; this does not explain the replacement fee or establish a recurring annual amount.',
   transactionIds:[sequence.prior.id,sequence.credit.id,sequence.replacement.id],
  }:undefined;
  return [{accountId:account.id,productName:reference?.productName||accountDisplayName(account),reference,paid,refunds,net:Math.round((paid-refunds)*100)/100,components,ambiguous,...(hypothesis?{hypothesis}:{})}];
 });
}
