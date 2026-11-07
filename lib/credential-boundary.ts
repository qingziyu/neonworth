/** Additive protection for new writes. This does not reinterpret saved source
 * records or claim to identify arbitrary opaque secrets inside ordinary text. */
export const CREDENTIAL_INPUT_MESSAGE='This update contains unsupported data or credential material and was not accepted.';
export const CREDENTIAL_INPUT_LIMITS={depth:64,nodes:1_000_000,characters:8_000_000} as const;
export class CredentialInputError extends Error {
 readonly code='UNSAFE_CREDENTIAL_INPUT';
 constructor(){super(CREDENTIAL_INPUT_MESSAGE);this.name='CredentialInputError';}
}
const normalize=(key:string)=>key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
const credentialKeys=new Set([
 'accesstoken','refreshtoken','idtoken','authtoken','bearertoken','oauthtoken','token',
 'apikey','apisecret','clientsecret','consumersecret','secretkey','privatekey','signingkey',
 'password','passwd','passphrase','secret','credential','credentials',
 'authorization','proxyauthorization','cookie','setcookie','sessiontoken','sessionsecret',
 'siwcbypassbearertoken','oaisitesauthorization','xapikey','apitoken','githubtoken','gitlabtoken',
]);
const urlCredentialKeys=new Set([...credentialKeys,'auth','sessionid','signature','sig','xamzcredential','xamzsignature','xgoogcredential','xgoogsignature']);
// Provider names often prefix standard credential names. Keep this bounded to
// explicit credential suffixes; account IDs, cursors and ordinary hashes are not
// credentials merely because their values look opaque.
const isCredentialKey=(key:string)=>credentialKeys.has(key)||/^[a-z0-9]{1,48}(?:accesstoken|refreshtoken|bearertoken|authtoken|oauthtoken|idtoken|sessiontoken|apikey|apisecret|clientsecret|consumersecret|privatekey|signingkey|secretkey|secretaccesskey|sessionsecret|password|passwd|passphrase|secret)$/.test(key);
function reject():never {throw new CredentialInputError();}
const labelChar=(character:string)=>/[a-z0-9_.\- \t]/i.test(character);
const schemeChar=(character:string)=>/[a-z0-9+.-]/i.test(character);
const urlEnd=(character:string)=>/[\s<>"'`]/.test(character);
function checkAssignments(text:string){
 // Inspect each delimiter once. The bounded backwards label check also covers
 // JSON-quoted keys, env assignments and labels with spaces, without retrying a
 // variable-length regex at every character in a long free-form field.
 for(let separator=0;separator<text.length;separator++){
  if(text[separator]!==':'&&text[separator]!=='=')continue;
  let end=separator;while(end>0&&/[ \t]/.test(text[end-1]))end--;
  if(text[end-1]==='"'||text[end-1]==="'"){
   end--;
   // Error/MCP text may contain a serialized JSON string. Skip a bounded run
   // of escapes before its closing quote without decoding arbitrary payloads.
   for(let escapes=0;escapes<16&&end>0&&text[end-1]==='\\';escapes++)end--;
  }
  let start=end;while(start>0&&end-start<128&&labelChar(text[start-1]))start--;
  const words=text.slice(start,end).trim().split(/[ \t]+/);
  let labeled=false;
  for(let count=1;count<=Math.min(4,words.length);count++)if(isCredentialKey(normalize(words.slice(-count).join('')))){labeled=true;break;}
  if(!labeled)continue;
  let value=separator+1;while(value<text.length&&/[\s"']/.test(text[value]))value++;
  if(value<text.length&&!/[},\]]/.test(text[value]))reject();
 }
}
function checkURLs(text:string){
 // Inspect every URI authority before scheme/URL parsing, including nested or
 // malformed links. Authority spans stop at '/', so they cannot overlap a
 // later :// authority. Do not parse each nested URL's entire suffix.
 let authoritySearch=0;
 while(authoritySearch<text.length){
  const separator=text.indexOf('://',authoritySearch);if(separator<0)break;
  authoritySearch=separator+3;
  for(let cursor=authoritySearch;cursor<text.length&&!/[/?#]/.test(text[cursor])&&!urlEnd(text[cursor]);cursor++)if(text[cursor]==='@')reject();
 }
 // indexOf and non-overlapping URL spans keep work linear. Scheme recognition
 // examines at most 32 characters; repeated "a." without :// is one search,
 // rather than the quadratic backtracking of an unbounded scheme regex.
 let search=0;
 while(search<text.length){
  const separator=text.indexOf('://',search);if(separator<0)return;
  let start=separator;while(start>0&&separator-start<32&&schemeChar(text[start-1]))start--;
  let end=separator+3;while(end<text.length&&!urlEnd(text[end]))end++;
  search=end;
  if(start===separator||!/^[a-z]$/i.test(text[start])||start>0&&schemeChar(text[start-1]))continue;
  let url:URL;try{url=new URL(text.slice(start,end));}catch{continue;}
  if(url.username||url.password)reject();
  const fragment=url.hash.slice(1),queryInFragment=fragment.includes('?')?fragment.slice(fragment.indexOf('?')+1):fragment;
  const parameters=[url.searchParams];
  // A plain help anchor such as #password is not a credential parameter.
  if(queryInFragment.includes('='))parameters.push(new URLSearchParams(queryInFragment));
  for(const params of parameters)for(const key of params.keys()){const normalized=normalize(key);if(urlCredentialKeys.has(normalized)||isCredentialKey(normalized))reject();}
 }
}
function checkText(text:string) {
 if(/-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----/.test(text)||
    /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+/i.test(text)||
    /\bbearer\s+[a-z0-9._~+/-]{24,}={0,2}/i.test(text)||
    /\b(?:access|refresh)-(?:production|development|sandbox)-[a-z0-9-]{16,}\b/i.test(text))reject();
 checkAssignments(text);checkURLs(text);
}

/** Validate only the proposed JSON value, without cloning, redacting, logging,
 * invoking accessors or including rejected values/paths in an error. Undefined
 * object properties follow JSON.stringify's omission rule; array holes and
 * unsupported values do not. Repeated references are allowed, cycles are not. */
export function assertCredentialFree(input:unknown):void {
 try {validate(input);}catch{reject();}
}
function validate(input:unknown):void {
 const stack:Array<{value:unknown;depth:number;exit?:boolean}>=[{value:input,depth:0}];
 const active=new WeakSet<object>();let nodes=0,characters=0;
 while(stack.length){
  const {value,depth,exit}=stack.pop()!;
  if(exit){active.delete(value as object);continue;}
  if(++nodes>CREDENTIAL_INPUT_LIMITS.nodes||depth>CREDENTIAL_INPUT_LIMITS.depth)reject();
  if(value===null||typeof value==='boolean')continue;
  if(typeof value==='number'){if(!Number.isFinite(value))reject();continue;}
  if(typeof value==='string'){characters+=value.length;if(characters>CREDENTIAL_INPUT_LIMITS.characters)reject();checkText(value);continue;}
  if(typeof value!=='object'||active.has(value))reject();
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(!array&&prototype!==Object.prototype&&prototype!==null||Object.getOwnPropertySymbols(value).length)reject();
  const toJSON=Object.getOwnPropertyDescriptor(value,'toJSON');
  if(toJSON&&(!('value' in toJSON)||typeof toJSON.value==='function'))reject();
  active.add(value);stack.push({value,depth,exit:true});
  const keys=Object.keys(value);
  if(nodes+stack.length+keys.length>CREDENTIAL_INPUT_LIMITS.nodes)reject();
  if(array&&(keys.length!==(value as unknown[]).length||keys.some((key,index)=>key!==String(index))))reject();
  for(const key of keys){
   characters+=key.length;if(characters>CREDENTIAL_INPUT_LIMITS.characters)reject();
   checkText(key);
   if(isCredentialKey(normalize(key)))reject();
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(!descriptor||!('value' in descriptor))reject();
   if(descriptor.value===undefined&&!array)continue;
   stack.push({value:descriptor.value,depth:depth+1});
  }
 }
}
