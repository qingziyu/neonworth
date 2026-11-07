import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const records = sqliteTable('finance_records', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const syncLog = sqliteTable('finance_sync_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  importedAt: text('imported_at').notNull(),
  asOf: text('as_of').notNull(),
  transactionCount: integer('transaction_count').notNull(),
  accountCount: integer('account_count').notNull(),
});
