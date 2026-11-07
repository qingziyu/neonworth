export const WORKSPACE_REPORTS = [
 {id:'overview',label:'Overview',section:'Overview',href:'/'},
 {id:'spending',label:'Spending',section:'Spending',href:'/?view=spending'},
 {id:'budget',label:'Budget',section:'Budget',href:'/?view=budget'},
 {id:'goals',label:'Goals',section:'Goals',href:'/goals'},
 {id:'year-in-review',label:'Year in Review',section:'Year in Review',href:'/year-in-review'},
 {id:'review',label:'Review queue',section:'Review',href:'/?view=review'},
 {id:'transactions',label:'Transactions',section:'Transactions',href:'/?view=transactions'},
 {id:'bills',label:'Recurring bills',section:'Recurring bills',href:'/?view=bills'},
 {id:'movements',label:'Money movements',section:'Money movements',href:'/?view=movements'},
 {id:'income',label:'Income',section:'Income',href:'/?view=income'},
 {id:'cash',label:'Cash reconciliation',section:'Cash flow',href:'/?view=cash'},
 {id:'net-worth',label:'Net worth',section:'Net worth',href:'/?view=net-worth'},
 {id:'retirement',label:'Retirement',section:'Retirement',href:'/?view=retirement'},
 {id:'data',label:'Accounts & data',section:'Accounts & data',href:'/?view=data'},
] as const;

export type WorkspaceReportId=typeof WORKSPACE_REPORTS[number]['id'];
export type WorkspaceDensity='comfortable'|'compact';
export type WorkspaceMotion='expressive'|'quiet';
export type WorkspacePreferences={version:2;density:WorkspaceDensity;motion:WorkspaceMotion;pinnedReports:WorkspaceReportId[]};
export const WORKSPACE_PREFERENCES_KEY='neonworth-display-v2';
export const LEGACY_WORKSPACE_PREFERENCES_KEY='neonworth-display-v1';
export const MAX_PINNED_REPORTS=3;
const MAX_STORED_LENGTH=1024;
const reportIds=new Set<string>(WORKSPACE_REPORTS.map(report=>report.id));
export const DEFAULT_WORKSPACE_PREFERENCES:WorkspacePreferences={version:2,density:'comfortable',motion:'expressive',pinnedReports:[]};

export function isWorkspaceReportId(value:unknown):value is WorkspaceReportId {
 return typeof value==='string'&&reportIds.has(value);
}

/** Deliberately excludes financial values, arbitrary labels, URLs and filters. */
export function validateWorkspacePreferences(value:unknown):WorkspacePreferences|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const object=value as Record<string,unknown>;
 if(Object.keys(object).length!==4||!['version','density','motion','pinnedReports'].every(key=>Object.hasOwn(object,key)))return null;
 if(object.version!==2||(object.density!=='comfortable'&&object.density!=='compact')||(object.motion!=='expressive'&&object.motion!=='quiet'))return null;
 if(!Array.isArray(object.pinnedReports)||object.pinnedReports.length>MAX_PINNED_REPORTS||!Array.from(object.pinnedReports).every(isWorkspaceReportId))return null;
 if(new Set(object.pinnedReports).size!==object.pinnedReports.length)return null;
 return {version:2,density:object.density as WorkspaceDensity,motion:object.motion as WorkspaceMotion,pinnedReports:[...object.pinnedReports]};
}

export function parseStoredWorkspacePreferences(text:string|null):WorkspacePreferences|null {
 if(text===null)return {...DEFAULT_WORKSPACE_PREFERENCES,pinnedReports:[]};
 if(text.length>MAX_STORED_LENGTH)return null;
 try{return validateWorkspacePreferences(JSON.parse(text));}catch{return null;}
}

type PreferenceStorage=Pick<Storage,'getItem'|'setItem'>;
/** Read-only migration; the old key is never written, removed or observed. */
function migrateLegacyPreferences(text:string|null):WorkspacePreferences|null {
 if(text===null||text.length>MAX_STORED_LENGTH)return null;
 try{
  const object=JSON.parse(text);
  if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).length!==3||!['version','density','pinnedReports'].every(key=>Object.hasOwn(object,key))||object.version!==1)return null;
  return validateWorkspacePreferences({version:2,density:object.density,motion:'expressive',pinnedReports:object.pinnedReports});
 }catch{return null;}
}
export function readWorkspacePreferences(getStorage:()=>PreferenceStorage):{preferences:WorkspacePreferences;available:boolean} {
 try{
  const storage=getStorage(),current=storage.getItem(WORKSPACE_PREFERENCES_KEY);
  // A present v2 value is authoritative even when invalid: never resurrect v1.
  const preferences=current===null?migrateLegacyPreferences(storage.getItem(LEGACY_WORKSPACE_PREFERENCES_KEY)):parseStoredWorkspacePreferences(current);
  return {preferences:preferences??{...DEFAULT_WORKSPACE_PREFERENCES,pinnedReports:[]},available:true};
 }
 catch{return {preferences:{...DEFAULT_WORKSPACE_PREFERENCES,pinnedReports:[]},available:false};}
}

export function writeWorkspacePreferences(getStorage:()=>PreferenceStorage,value:WorkspacePreferences):boolean {
 const preferences=validateWorkspacePreferences(value);
 if(!preferences)throw new Error('Choose supported display settings and up to three distinct reports.');
 try{getStorage().setItem(WORKSPACE_PREFERENCES_KEY,JSON.stringify(preferences));return true;}catch{return false;}
}
