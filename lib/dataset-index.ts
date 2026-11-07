import type { Account, Dataset, Transaction } from './finance';

type IndexedTransaction = {order:number;transaction:Transaction};

/**
 * A request-scoped index for one immutable dataset snapshot.
 *
 * Callers own the lifetime. There is deliberately no module/global identity cache:
 * tests and import validation can mutate objects, while production replaces the
 * complete saved snapshot after a successful read.
 */
export interface DatasetLookup {
  accountsById: ReadonlyMap<string,Account>;
  transactionsById: ReadonlyMap<string,Transaction>;
}
export interface DatasetIndex extends DatasetLookup {
  transactionsByMonth: ReadonlyMap<string,readonly Transaction[]>;
  categoryNames: readonly string[];
  transactionsInRange(start:string,end:string):Transaction[];
}

/** ID-only lookup for policy passes that do not need date/category indexes. */
export function createDatasetLookup(data:Pick<Dataset,'accounts'|'transactions'>):DatasetLookup {
  const accountsById=new Map<string,Account>(),transactionsById=new Map<string,Transaction>();
  for(const account of data.accounts)if(!accountsById.has(account.id))accountsById.set(account.id,account);
  for(const transaction of data.transactions)if(!transactionsById.has(transaction.id))transactionsById.set(transaction.id,transaction);
  return {accountsById,transactionsById};
}

export function createDatasetIndex(data:Pick<Dataset,'accounts'|'transactions'>):DatasetIndex {
  const accountsById=new Map<string,Account>();
  for(const account of data.accounts)if(!accountsById.has(account.id))accountsById.set(account.id,account);

  const transactionsById=new Map<string,Transaction>(),indexedByMonth=new Map<string,IndexedTransaction[]>(),categoryNames=new Set<string>();
  for(let order=0;order<data.transactions.length;order++){
    const transaction=data.transactions[order];
    if(!transactionsById.has(transaction.id))transactionsById.set(transaction.id,transaction);
    const month=transaction.date.slice(0,7),rows=indexedByMonth.get(month)||[];
    rows.push({order,transaction});indexedByMonth.set(month,rows);categoryNames.add(transaction.category);
  }
  const transactionsByMonth=new Map<string,readonly Transaction[]>();
  for(const [month,rows] of indexedByMonth)transactionsByMonth.set(month,rows.map(row=>row.transaction));

  const transactionsInRange=(start:string,end:string)=>{
    if(start>end)return [];
    const first=start.slice(0,7),last=end.slice(0,7),matches:IndexedTransaction[]=[];
    for(const [month,rows] of indexedByMonth){
      if(month<first||month>last)continue;
      for(const row of rows)if(row.transaction.date>=start&&row.transaction.date<=end)matches.push(row);
    }
    // Preserve the source array's order exactly. Consumers that need date order
    // continue to apply their existing explicit sort.
    matches.sort((left,right)=>left.order-right.order);
    return matches.map(row=>row.transaction);
  };

  return {accountsById,transactionsById,transactionsByMonth,categoryNames:[...categoryNames].sort(),transactionsInRange};
}
