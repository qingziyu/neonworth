const motionQuery='(prefers-reduced-motion: no-preference) and (forced-colors: none)';

/** Native capability/visibility only. No storage, financial data or animation. */
export function bindWorkspaceMotionPolicy(view:Pick<Window,'matchMedia'>,document:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>,notify:(allowed:boolean)=>void){
 let policy:MediaQueryList;
 try{
  if(typeof view.matchMedia!=='function'){notify(false);return()=>{};}
  policy=view.matchMedia(motionQuery);
  if(typeof policy.addEventListener!=='function'||typeof policy.removeEventListener!=='function'){notify(false);return()=>{};}
 }catch{notify(false);return()=>{};}
 let active=true,last:boolean|undefined;
 const changed=()=>{
  if(!active)return;
  const allowed=policy.matches&&!document.hidden;
  if(allowed!==last){last=allowed;notify(allowed);}
 };
 policy.addEventListener('change',changed);
 document.addEventListener('visibilitychange',changed);
 changed();
 return()=>{
  active=false;
  policy.removeEventListener('change',changed);
  document.removeEventListener('visibilitychange',changed);
 };
}
