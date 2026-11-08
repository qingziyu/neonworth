import { parseBoundedJSON, checkOrigin, saveDataset, readState, updatePreference, json } from '@/lib/store';
import { assertCredentialFree } from '@/lib/credential-boundary';
import { summarizePeriod } from '@/lib/finance';
import { resolvePeriod, type PeriodMode } from '@/lib/periods';
import { summarizeMovements } from '@/lib/movements';
import { summarizeIncome } from '@/lib/income';
import { summarizeRetirement } from '@/lib/retirement';
import { deriveDataset } from '@/lib/classification';
import { summarizeRecurring } from '@/lib/recurring';
import { summarizeReview } from '@/lib/review';
import { summarizeCardFees } from '@/lib/card-reference';
import { beginRefresh,commitRefresh,failRefresh,getRefreshContract,getWorkflowCheckpoint,verifyFinanceRefresh,configureRefreshSchedule,safeRefreshFailureReason } from '@/lib/refresh';
import { isStorageError, storageErrorMessage, storageFailure } from '@/lib/storage-errors';
import { MAX_REQUEST_BYTES } from '@/lib/store-validation';
export const dynamic = 'force-dynamic';

const monthSchema = {type:'string',pattern:'^\\d{4}-(0[1-9]|1[0-2])$'};
const periodModeSchema = {enum:['month','ytd','year'],description:'month: selected calendar month; ytd: January 1 through selected period end; year: exact past calendar year ending at selected period end. Period end is capped at the saved as-of date.'};
const periodProperties = {month:monthSchema,periodMode:periodModeSchema};
const tools = [
  {name:'get_refresh_contract',description:'Read the supported cloud updater procedure, raw Finances bundle contract and last update status. Use this for routine source refreshes.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_workflow_checkpoint',description:'Read a stable hash-only checkpoint of source data and independent saved records, including budget, planning and recorded schedule. Creates no plans and is not a recovery backup. Retain independentHash before an authorized refresh.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'verify_finance_refresh',description:'Read-only verification of your succeeded refresh run against its committed source hash, counts, unchanged independent records and three canonical period summaries. Returns bounded hashes and counts, never source rows or amounts. A missing legacy proof remains unverified.',inputSchema:{type:'object',properties:{runId:{type:'string'},expectedIndependentHash:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['runId','expectedIndependentHash'],additionalProperties:false}},
  {name:'begin_finance_refresh',description:'Begin a private refresh attempt and return the exact source date window and run ID. Retrieve all source pages before committing. If alreadyRunning true, inspect status rather than starting a second writer.',inputSchema:{type:'object',properties:{fullHistory:{type:'boolean'}},additionalProperties:false}},
  {name:'commit_finance_refresh',description:'Validate and atomically merge raw paginated Finances data, retaining history and all user corrections. Read get_refresh_contract and begin_finance_refresh first. Never submit partial pages or fabricated source fields.',inputSchema:{type:'object',properties:{runId:{type:'string'},bundle:{type:'object'}},required:['runId','bundle'],additionalProperties:false}},
  {name:'fail_finance_refresh',description:'Record a failed source update with a plain-language reason; retain the last good snapshot.',inputSchema:{type:'object',properties:{runId:{type:'string'},error:{type:'string'}},required:['runId','error'],additionalProperties:false}},
  {name:'configure_refresh_schedule',description:'Record the actual verified daily update automation after Sites/Automations confirms its ID and enabled state. This records status only; it does not create or enable a task.',inputSchema:{type:'object',properties:{schedule:{type:'object'}},required:['schedule'],additionalProperties:false}},
  {name:'get_review',description:'Read ranked evidence-backed personal finance review findings for the selected Monthly, YTD or Past year window. Includes merchant/category reasoning, variable-cadence recurring services, actual charge changes and potential duplicate records. Inferences are labeled; records are not silently removed and no service is canceled.',inputSchema:{type:'object',properties:periodProperties,additionalProperties:false}},
  {name:'get_recurring_summary',description:'Review readable merchant/card-specific bills and recurring services with ongoing, likely-stopped, user-confirmed stopped, or uncertain status as of the selected period end. Status reasons distinguish observations, inferences and saved user decisions. Annual cycles, irregular bills and payment-card changes are considered. Actual payments stay separate from planning estimates.',inputSchema:{type:'object',properties:periodProperties,additionalProperties:false}},
  {name:'update_recurring_status',description:'Save an explicitly requested ongoing/stopped status in this personal tracker, or return to detected status. Read get_recurring_summary for the exact group ID first. This does not cancel, renew or change the merchant service or spending history.',inputSchema:{type:'object',properties:{id:{type:'string'},status:{enum:['ongoing','stopped','detected']},effectiveDate:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}},required:['id','status','effectiveDate'],additionalProperties:false}},
  {name:'resolve_review_finding',description:'Mark an explicitly user-reviewed financial finding as reviewed, or reopen it. Read get_review for the exact finding ID and evidenceKey first. The decision only applies to the same supporting evidence; changed evidence returns for review and source amounts remain counted.',inputSchema:{type:'object',properties:{id:{type:'string'},state:{enum:['reviewed','open']},evidenceKey:{type:'string'}},required:['id','state'],additionalProperties:false}},
  {name:'get_retirement_summary',description:'Read combined retirement accounts and observed contribution activity for Monthly, YTD or Past year. Contribution amounts do not establish tax treatment; no unsupported pre-tax, after-tax, Roth or employee/employer split is asserted. Conversions, rollovers and trades remain separate.',inputSchema:{type:'object',properties:{...periodProperties,accountId:{type:'string'}},additionalProperties:false}},
  {name:'get_income_summary',description:'Read explicitly classified cash income and verified RSU receipt valuations for the selected period. Receipts from any employer are supported. Tax basis and source completeness remain explicit unknowns; share sales are not new income.',inputSchema:{type:'object',properties:periodProperties,additionalProperties:false}},
  {name:'get_money_movements',description:'Read source-supported transfers, card repayments, investment movements and unresolved activity. Explicitly excluded Zelle records have a separate view; the payment rail alone does not exclude a record. Gross account legs retain their posting dates.',inputSchema:{type:'object',properties:periodProperties,additionalProperties:false}},
  {name:'get_dashboard_status',description:'Read Neonworth data coverage and last saved snapshot. No bank synchronization occurs.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_month_summary',description:'Read period income, spending and tracking surplus. Classified cash income and verified received equity are separate. Transfers and share sales are not new income. Source amounts, corrections and coverage limits remain authoritative.',inputSchema:{type:'object',properties:{...periodProperties,routineOnly:{type:'boolean'}},additionalProperties:false}},
  {name:'import_finance_dataset',description:'Import a full validated snapshot or explicitly restore a backup. Use initialOnly true for first population of an empty destination, without restore maps. Preserve source records, corrections, retirement annotations and review decisions. Use the atomic refresh protocol for ongoing updates.',inputSchema:{type:'object',properties:{dataset:{type:'object'},initialOnly:{type:'boolean'},transactionOverrides:{type:'object'},retirementOverrides:{type:'object'},reviewPreferences:{type:'object'}},required:['dataset'],additionalProperties:false}},
  {name:'get_import_contract',description:'Get the Neonworth import format, income policy and safe ongoing update procedure.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_saved_dataset',description:'Read saved source data, corrections, settings and retained statement annotations for an authorized update or analysis.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'update_transaction_classification',description:'Save an explicitly requested transaction correction in this application only. Category and accounting treatment choices take priority over inference. Does not mutate providers or infer tax treatment.',inputSchema:{type:'object',properties:{id:{type:'string'},patch:{type:'object',properties:{category:{type:'string'},flow:{enum:['expense','income','transfer','review']},exceptional:{type:'boolean'},note:{type:'string'},review:{type:'boolean'},reviewDecision:{enum:['cash_income','purchase_refund','zelle','interest','transfer','expense',null]}},additionalProperties:false}},required:['id','patch'],additionalProperties:false}},
];

const contract = {
  version:1,endpoint:'/api/import',limits:{requestBytes:MAX_REQUEST_BYTES},capabilities:{initialOnly:true},payload:'{dataset:Dataset, initialOnly?: boolean empty-destination guard (no restore maps allowed), transactionOverrides?: optional authoritative backup corrections, retirementOverrides?: optional backup annotations, reviewPreferences?: optional backup review decisions; omit corrections/annotations for routine source updates}',
  spendingPolicy:{paymentRails:'Classify from source evidence and explicit choices. No blanket Zelle exclusion or card-payment spending proxy is enabled by default.'},
  incomePolicy:{bankIncome:'Posted explicitly classified bank income from any employer or source.',equity:'Explicit RSU receipts × verified receipt-date prices; gross/net tax basis is not inferred.',sales:'Asset conversions, excluded from new income.'},
  retirementEvidence:'Optional version1 source evidence. Retain exact account/transaction IDs, all kinds and descriptions. Observed contribution amounts do not establish pre-tax, after-tax, Roth, deductibility or employee/employer sources. Keep stored statement annotations for preservation without presenting unsupported splits.',
  incomeEvidence:'Retain exact investment records, source coverage, dates and verified ticker/date prices. Unknown valuations remain unavailable; tax basis is not inferred.',
  dataset:{version:1,syncedAt:'ISO UTC retrieval time',asOf:'YYYY-MM-DD source query scope',dateRange:{start:'YYYY-MM-DD',end:'YYYY-MM-DD'},coverage:'Returned dataset coverage/freshness; unknown stays unknown',accounts:[{id:'account_id',name:'name',institution:'institution',type:'depository|credit|investment|loan',subtype:'subtype or empty string',mask:'last digits only',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'}],transactions:[{id:'stable transaction_id',date:'YYYY-MM-DD',merchant:'name',accountId:'account_id',amount:0,category:'stored/confirmed category',flow:'expense|income|transfer|review',confidence:'HIGH|MEDIUM|LOW|UNKNOWN',exceptional:false,note:'classification evidence',pending:false,review:false,sourceCategoryDetailed:'optional original detailed category',sourceName:'optional original transaction description',transferAccountId:'optional returned transfer_to_account_id',transferTransactionId:'optional returned transfer_transaction_id'}],netWorthHistory:[{date:'YYYY-MM-DD',value:0,events:[]}],recurring:[],notes:[]},
  rules:[
    'Read linked accounts and source coverage before transactions. Read broad posted negative-amount inflows including transfers before classification.',
    'Retrieve all pages. When CSV attachments are not locally accessible, use inline pages of 50 and the exact returned cursor. Never reconstruct preview omissions.',
    'Do not infer personal-transfer purpose, a reimbursement category, or an own-account relationship from a name, amount or cadence. Preserve evidence and route unresolved purpose to review.',
    'Count purchases once. Own-account movements, card repayments, investment funding/sales and confirmed asset conversions are excluded from consumption. Genuine expenses remain expenses despite incidental transfer linkage.',
    'Use real dated net-worth observations and retain onboarding events; newly connected account balances are not investment returns.',
    'Import a fully reconciled dataset, retaining income/retirement evidence. Existing dashboard corrections and annotations are stored separately. Read status and a period summary after writing.',
    'Monthly, YTD and Past year use one global period with the same start/end on every page. Past year is an exact date window, not twelve complete month buckets.',
    'Pair money movements only by explicit opposite/equal-value transaction links. Each account leg keeps its own posting date; paired movement volume uses the funding date.',
    'Keep the Site owner-private. No source credentials belong in code, files or task prompts. Reload saved data is not bank synchronization.',
  ],
};

function sourceRetirementView(summary:ReturnType<typeof summarizeRetirement>) {
  // Retain historical statement annotations in storage; this source overview
  // intentionally exposes contribution amounts without unsupported tax splits.
  const omit = (row:object) => Object.fromEntries(Object.entries(row).filter(([key]) => !['buckets','pretax','roth','afterTax','unknown','taxTreatment','contributor','employeeContributions','employerContributions','unknownContributor','manualClassification'].includes(key)));
  return {...omit(summary),accounts:summary.accounts.map(omit),events:summary.events.map(omit),trend:summary.trend.map(omit),taxTreatment:'Not established by the available contribution records; no tax-source split is asserted.'};
}

function periodArgs(args:Record<string,unknown>,asOf:string):{month:string;mode:PeriodMode} {
  // Keep earlier YYYY retirement periods and numeric income years compatible.
  const legacyPeriod = typeof args.period === 'string' ? args.period : undefined;
  const legacyYear = typeof args.year === 'number' ? args.year : legacyPeriod?.length===4 ? Number(legacyPeriod) : undefined;
  if(legacyYear!==undefined&&(!Number.isInteger(legacyYear)||legacyYear<1900||legacyYear>2200))throw new Error('Invalid calendar year.');
  const defaultMonth = legacyYear===undefined ? asOf.slice(0,7) : `${legacyYear}-${legacyYear===Number(asOf.slice(0,4))?asOf.slice(5,7):'12'}`;
  const month = args.month ?? (legacyPeriod?.length===7?legacyPeriod:undefined) ?? defaultMonth;
  const mode = args.periodMode ?? args.scope ?? (legacyYear!==undefined?'ytd':'month');
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1900||Number(month.slice(0,4))>2200||typeof mode!=='string'||!['month','ytd','year'].includes(mode))throw new Error('Invalid selected month or period.');
  return {month,mode:mode as PeriodMode};
}
export async function POST(request:Request) {
  let id:unknown = null;
  let mutation=false;
  try {
    checkOrigin(request);
    const query = await parseBoundedJSON(request);
    if(!query||typeof query!=='object'||Array.isArray(query))throw new Error('Invalid MCP request.');
    // Return a valid scalar correlation ID even when another field is rejected.
    // Never reflect a structured, oversized or recognizable credential ID.
    if(typeof query.id==='number'&&Number.isFinite(query.id)||typeof query.id==='string'&&query.id.length<=200){try{assertCredentialFree(query.id);id=query.id;}catch{/* Keep the response ID null. */}}
    if(query.method==='tools/call'&&query.params?.name==='fail_finance_refresh'&&typeof query.params.arguments?.error==='string')query.params.arguments.error=safeRefreshFailureReason(query.params.arguments.error);
    assertCredentialFree(query);
    if(query.method==='server/discover')return json({jsonrpc:'2.0',id,result:{supportedVersions:['2026-07-28'],capabilities:{tools:{}}}});
    if(query.method==='initialize')return json({jsonrpc:'2.0',id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'Neonworth',version:'1.0.0'}}});
    if(query.method==='notifications/initialized')return new Response(null,{status:204});
    if(query.method==='tools/list')return json({jsonrpc:'2.0',id,result:{tools}});
    if(query.method!=='tools/call')throw new Error('Method not found.');
    const args=query.params?.arguments||{};
    if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Tool arguments must be an object.');
    let result:unknown;
    mutation=['begin_finance_refresh','commit_finance_refresh','fail_finance_refresh','configure_refresh_schedule','import_finance_dataset','update_recurring_status','resolve_review_finding','update_transaction_classification'].includes(query.params?.name);
    switch(query.params?.name) {
      case 'get_refresh_contract':result=await getRefreshContract();break;
      case 'get_workflow_checkpoint':result=await getWorkflowCheckpoint();break;
      case 'verify_finance_refresh':result=await verifyFinanceRefresh(args.runId,args.expectedIndependentHash);break;
      case 'begin_finance_refresh':result=await beginRefresh(args.fullHistory===true);break;
      case 'commit_finance_refresh':result=await commitRefresh(args.runId,args.bundle);break;
      case 'fail_finance_refresh':result=await failRefresh(args.runId,args.error);break;
      case 'configure_refresh_schedule':result=await configureRefreshSchedule(args.schedule);break;
      case 'get_import_contract':{const state=await readState();result={...contract,refresh:state.dataset?await getRefreshContract():null};break;}
      case 'get_saved_dataset':result=await readState();break;
      case 'get_dashboard_status':{
        const state=await readState();result={asOf:state.dataset?.asOf,syncedAt:state.dataset?.syncedAt,accounts:state.dataset?.accounts.length||0,transactions:state.dataset?.transactions.length||0,automaticBankSync:false,updateMode:'snapshot-import',refresh:state.refresh,incomePolicy:'Explicitly classified cash income plus verified RSU receipt valuations; tax basis unknown'};break;
      }
      case 'import_finance_dataset':result=await saveDataset(args.dataset,args.retirementOverrides,args.reviewPreferences,args.transactionOverrides,undefined,args.initialOnly===undefined?false:args.initialOnly);break;
      case 'update_recurring_status':result=await updatePreference({type:'recurring-status',id:args.id,status:args.status,effectiveDate:args.effectiveDate});break;
      case 'resolve_review_finding':result=await updatePreference({type:'review-resolution',id:args.id,state:args.state,evidenceKey:args.evidenceKey});break;
      case 'update_transaction_classification':{
        if(args.patch?.flow==='income'&&args.patch?.reviewDecision===undefined) {
          const state=await readState();if(!state.dataset)throw new Error('No saved dataset.');
          const candidate=deriveDataset(state.dataset,{...state.overrides,[args.id]:{...state.overrides[args.id],...args.patch}}).transactions.find(t=>t.id===args.id);
          if(!candidate||candidate.flow!=='income')throw new Error('This source record cannot be classified as income under the submitted treatment; inspect the record and choose a supported decision.');
        }
        result=await updatePreference({type:'transaction',id:args.id,patch:args.patch});break;
      }
      case 'get_review':case 'get_recurring_summary':case 'get_retirement_summary':case 'get_income_summary':case 'get_money_movements':case 'get_month_summary':{
        const state=await readState();if(!state.dataset)throw new Error('No saved dataset.');
        const data=deriveDataset(state.dataset,state.overrides,state.reviewPreferences);
        const period=periodArgs(args,data.asOf);
        if(args.accountId!==undefined&&typeof args.accountId!=='string')throw new Error('Invalid retirement account.');
        if(args.routineOnly!==undefined&&typeof args.routineOnly!=='boolean')throw new Error('Invalid routine view.');
        if(query.params.name==='get_review')result=summarizeReview(data,period.month,period.mode);
        else if(query.params.name==='get_recurring_summary'){const window=resolvePeriod(data,period.month,period.mode);result={...summarizeRecurring(data,window),cardFees:summarizeCardFees(data,window)};}
        else if(query.params.name==='get_retirement_summary')result=sourceRetirementView(summarizeRetirement(data,period.month,args.accountId,{},period.mode));
        else if(query.params.name==='get_income_summary')result=summarizeIncome(data,Number(period.month.slice(0,4)),period.month,period.mode);
        else if(query.params.name==='get_money_movements')result=summarizeMovements(data,period.month,period.mode);
        else result={...summarizePeriod(data,period.month,period.mode,!!args.routineOnly),period:resolvePeriod(data,period.month,period.mode)};
        break;
      }
      default:throw new Error('Unknown tool.');
    }
    return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}});
  } catch(error) {
    if(isStorageError(error)){
      const failure=storageFailure(error,mutation?'record_write':'storage');
      // Tool errors keep the MCP envelope and HTTP 200. A transport-level retry
      // must never replay an unconfirmed mutation automatically.
      return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify({error:storageErrorMessage(failure,mutation),code:failure.code,reference:failure.reference})}],isError:true}});
    }
    return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:error instanceof Error?error.message:'Request failed.'}],isError:true}});
  }
}
