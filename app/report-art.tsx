import type { ReactNode } from "react";

type ArtKind = "savings" | "netWorth" | "fire" | "year" | "records";

/**
 * Decorative, static drawings: never encode a balance, trend, or goal status.
 * Circuit traces and nodes are fixed geometry shared by every instance; the only
 * motion (a one-shot trace draw, see globals.css) is CSS-gated by prefers-reduced-motion.
 */
export function ReportArt({kind,compact=false}:{kind:ArtKind;compact?:boolean}) {
  return <svg className={`report-art${compact?" compact":""} art-${kind}`} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <circle cx="32" cy="32" r="29" className="art-wash"/>
    <circle cx="32" cy="32" r="29" className="art-ring" strokeWidth="1" strokeDasharray="3 4"/>
    <g className="art-circuit" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 40h7l4-4h3" pathLength={1}/>
      <path d="M60 22h-6l-4 4h-2" pathLength={1}/>
    </g>
    <g className="art-node">
      <circle cx="4" cy="40" r="1.6"/>
      <circle cx="60" cy="22" r="1.6"/>
    </g>
    <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {kind==="savings"?<><path d="M17 47h30M23 46V17m0 2c8-7 13 8 23 1v16c-10 7-15-8-23-1"/><path d="m39 13 2-3m6 5 3-1" className="art-accent"/></>:kind==="netWorth"?<><ellipse cx="32" cy="22" rx="15" ry="6"/><path d="M17 22v10c0 8 30 8 30 0V22M17 32v10c0 8 30 8 30 0V32"/><path d="M24 25v6m0 7v6" className="art-accent"/></>:kind==="fire"?<><path d="M13 40h38M17 47h30M23 40a9 9 0 0 1 18 0M32 15v7M15 25l5 5m29-5-5 5"/><path d="m44 15-3 5m-21-5 3 5" className="art-accent"/></>:kind==="year"?<><path d="M17 17h30v32H17zM17 25h30M25 13v8m14-8v8M24 33h5m6 0h5m-16 8h5"/><path d="m35 40 3 3 6-7" className="art-accent"/></>:<><path d="M19 13h21l7 7v31H19zM40 13v9h7M25 30h16m-16 7h12m-12 7h8"/><path d="m12 28-4 4 4 4" className="art-accent"/></>}
    </g>
  </svg>;
}

export function ReportEmpty({kind="records",title,children}:{kind?:ArtKind;title:string;children:ReactNode}) {
  return <div className="report-empty"><ReportArt kind={kind}/><div><h3>{title}</h3><p>{children}</p></div></div>;
}
