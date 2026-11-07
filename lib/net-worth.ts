import type { Dataset } from './finance';
import type { ResolvedPeriod } from './periods';

/** Net-worth observations have their own dates; transaction coverage stays fixed. */
export function netWorthForPeriod(data:Pick<Dataset,'asOf'|'syncedAt'|'netWorthHistory'>,period:Pick<ResolvedPeriod,'start'|'end'>,allHistory=false){
 const end=period.end===data.asOf?[data.asOf,data.syncedAt.slice(0,10)].sort().at(-1)!:period.end;
 const history=data.netWorthHistory.filter(point=>point.date<=end),latest=history.at(-1)||null;
 return {end,points:history.filter(point=>allHistory||point.date>=period.start),latest,includesIndependentDate:!!latest&&latest.date>period.end};
}
