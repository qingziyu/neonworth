import assert from 'node:assert/strict';
import { inspectPrivateSite, comparePrivateSiteEvidence } from './sites-live-evidence.mjs';
const origin='https://synthetic-neonworth.example.chatgpt.site',token='invented-verification-bearer';
const nonce='A'.repeat(32);
const headers={
  'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; connect-src 'self'`,
  'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'cache-control':'private, no-store','strict-transport-security':'max-age=31536000',
};
const records={'/api/data':{dataset:null,overrides:{},settings:{}},'/api/status':{ready:false},'/api/budget':{plan:null},'/api/planning':{plan:null}};
function transport(change={}){
  let reads=0;const requests=[];
  const request=async(url,init)=>{
    requests.push({url,init});assert.equal(init.redirect,'manual');assert.ok(url.startsWith(origin+'/'));
    const path=new URL(url).pathname, authorized=init.headers['OAI-Sites-Authorization']===`Bearer ${token}`;
    if(!authorized)return new Response('',{status:change.leakAnonymous?200:403});
    const assetPrefix=change.canonical?'/_next/static/':'/__neonworth_assets/_next/static/';
    if(path==='/')return new Response(`<script nonce="${nonce}" src="${assetPrefix}example.js"></script>`,{headers:change.badHeaders?{}:headers});
    if(path.startsWith(assetPrefix))return new Response('/* synthetic */',{headers:change.badAssetHeaders?{}:headers});
    const value=structuredClone(records[path]);
    if(path==='/api/status' && change.running)value.refresh={lastRun:{status:'running'}};
    if(path==='/api/data' && change.race && reads++>0)value.settings={savingsTarget:1};
    return new Response(JSON.stringify(value),{headers});
  };
  return {request,requests};
}
const valid=transport();
const evidence=await inspectPrivateSite({origin,token,privatePublicationConfirmed:true},valid.request);
assert.equal(evidence.consistentReadback,true);assert.equal(evidence.nativeMcpAcceptance,'not_tested');
assert.ok(!JSON.stringify(evidence).includes(token));
assert.ok(valid.requests.every(row=>new URL(row.url).origin===origin),'Service credentials never follow redirects to another origin');
assert.equal(comparePrivateSiteEvidence(evidence,{...evidence,checkedAt:'later'}),true);
assert.throws(()=>comparePrivateSiteEvidence(evidence,{...evidence,hashes:{...evidence.hashes,planning:'different'}}),/saved_records_changed/);
assert.equal((await inspectPrivateSite({origin,token,privatePublicationConfirmed:true},transport({canonical:true}).request)).assetsProtected,true);
for(const [change,error] of [[{leakAnonymous:true},/anonymous_access_not_denied/],[{badHeaders:true},/page_security_policy_failed/],[{badAssetHeaders:true},/asset_security_policy_failed/],[{running:true},/refresh_in_progress/],[{race:true},/records_changed_during_verification/]])
  await assert.rejects(inspectPrivateSite({origin,token,privatePublicationConfirmed:true},transport(change).request),error);
await assert.rejects(inspectPrivateSite({origin,token,privatePublicationConfirmed:false},valid.request),/native_private_publication_required/);
await assert.rejects(inspectPrivateSite({origin:'https://unrelated.example',token,privatePublicationConfirmed:true},valid.request),/invalid_origin/);
await assert.rejects(inspectPrivateSite({origin,token:token+'\n',privatePublicationConfirmed:true},valid.request),/invalid_service_access/);
console.log('Sites live evidence: anonymous/spoofed denial, security/asset checks, stable readback, independent-record comparison and credential-free output passed.');
