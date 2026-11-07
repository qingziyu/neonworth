import assert from 'node:assert/strict';
import {netWorthForPeriod} from '../lib/net-worth.ts';

const data={asOf:'2026-10-28',syncedAt:'2026-10-29T00:25:00Z',netWorthHistory:[
 {date:'2025-10-28',value:1,events:[]},{date:'2026-09-30',value:2,events:[]},
 {date:'2026-10-28',value:3,events:[]},{date:'2026-10-29',value:4,events:[]},
 {date:'2026-10-30',value:5,events:[]},
]},before=JSON.stringify(data);
for(const start of ['2026-10-01','2026-01-01','2025-10-29']){
 const period={start,end:'2026-10-28'},view=netWorthForPeriod(data,period);
 assert.equal(view.latest.date,'2026-10-29');assert.equal(view.latest.value,4);assert.equal(view.includesIndependentDate,true);
 assert.ok(view.points.every(point=>point.date>=start&&point.date<='2026-10-29'));
 assert.equal(period.end,'2026-10-28','Showing an independently dated observation does not widen the selected transaction period.');
}
for(const allHistory of [false,true]){const view=netWorthForPeriod(data,{start:'2026-09-01',end:'2026-09-30'},allHistory);assert.equal(view.latest.date,'2026-09-30');assert.equal(view.includesIndependentDate,false);assert.ok(view.points.every(point=>point.date<='2026-09-30'));}
assert.equal(netWorthForPeriod(data,{start:'2026-10-01',end:'2026-10-28'},true).points[0].date,'2025-10-28');
assert.equal(netWorthForPeriod({...data,netWorthHistory:[]},{start:'2026-10-01',end:'2026-10-28'}).latest,null);
assert.equal(JSON.stringify(data),before,'The recorded source dates and values remain unchanged.');
console.log('PASS: current month/YTD/year include independently dated net worth through retrieval; historical periods stay capped; future points stay hidden; source and transaction period remain unchanged.');
