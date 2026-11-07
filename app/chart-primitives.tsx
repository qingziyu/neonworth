import { useId } from 'react';

/** Static SVG legend and texture stay available without loading the chart engine. */
export function SpendingHatch({id}:{id:string}) {
 return <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse"><rect width={6} height={6} fill="var(--chart-spending)"/><path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="var(--surface)" strokeWidth={1.5}/></pattern>;
}

export function SpendingLegendSwatch() {
 const patternId=`spending-legend-${useId()}`;
 return <svg width={14} height={10} viewBox="0 0 14 10" aria-hidden="true" focusable="false" style={{flexShrink:0}}><defs><SpendingHatch id={patternId}/></defs><rect width={14} height={10} rx={2} fill={`url(#${patternId})`}/></svg>;
}
