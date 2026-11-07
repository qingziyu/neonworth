"""External, offline CSV adapter. No credentials, network calls or hosted writes."""
import argparse
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import sys

LIMIT = 7_500_000
COLUMNS = {'id', 'date', 'account_id', 'merchant', 'amount', 'currency', 'flow', 'category', 'pending'}

def convert(csv_path, accounts_path, as_of):
    day = dt.date.fromisoformat(as_of)
    if day.isoformat() != as_of or day > dt.date.today():
        raise ValueError('Reporting date must be an ISO calendar date, not in the future.')
    for path in (csv_path, accounts_path):
        if path.stat().st_size > LIMIT:
            raise ValueError('Input exceeds the bounded adapter size.')
    accounts_input = json.loads(accounts_path.read_text(encoding='utf-8'))
    accounts = accounts_input['accounts']
    if not isinstance(accounts, list) or not accounts:
        raise ValueError('Supply observed account metadata and balances explicitly.')
    account_ids = {account['id'] for account in accounts}
    if len(account_ids) != len(accounts):
        raise ValueError('Duplicate account IDs.')
    rows, seen = [], set()
    with csv_path.open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        if set(reader.fieldnames or []) != COLUMNS or len(reader.fieldnames) != len(COLUMNS):
            raise ValueError('Use exactly the documented CSV header; map provider columns explicitly.')
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError('Malformed CSV row.')
            ident = row['id'].strip()
            if not ident or ident in seen:
                raise ValueError('Every source row needs a stable unique ID; do not guess duplicates.')
            seen.add(ident)
            date = dt.date.fromisoformat(row['date'])
            if date.isoformat() != row['date'] or date > day:
                raise ValueError('Transaction date is invalid or exceeds the reporting date.')
            if row['currency'] != 'USD':
                raise ValueError('This adapter accepts USD only; it performs no currency conversion.')
            amount = Decimal(row['amount'])
            if not amount.is_finite() or amount != amount.quantize(Decimal('0.01')) or abs(amount) > Decimal('1000000000'):
                raise ValueError('Use finite, bounded amounts with at most two decimals.')
            if row['account_id'] not in account_ids or row['flow'] not in {'income', 'expense', 'transfer', 'review'}:
                raise ValueError('Unknown account or accounting flow.')
            if row['pending'] not in {'true', 'false'} or not row['category'].strip():
                raise ValueError('Supply an explicit pending state and category.')
            if row['flow'] == 'income' and amount > 0:
                raise ValueError('Income must use the negative inflow sign.')
            rows.append({'id': ident, 'date': row['date'], 'accountId': row['account_id'],
                         'merchant': row['merchant'], 'sourceName': row['merchant'], 'amount': float(amount),
                         'category': row['category'], 'flow': row['flow'], 'pending': row['pending'] == 'true',
                         'review': row['flow'] == 'review', 'confidence': 'UNKNOWN', 'exceptional': False,
                         'note': 'Imported from a user-mapped CSV. Source completeness is unknown.'})
            if len(rows) > 50000:
                raise ValueError('Too many transactions.')
    if not rows:
        raise ValueError('No source transactions; this adapter does not construct empty replacement snapshots.')
    return {'dataset': {'version': 1, 'asOf': as_of,
            'syncedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
            'dateRange': {'start': min(row['date'] for row in rows), 'end': as_of},
            'accounts': accounts, 'transactions': rows, 'netWorthHistory': [], 'recurring': [],
            'coverage': {'transactions': {'is_complete_for_query': False, 'freshness': 'unknown', 'availability': 'ready'}},
            'notes': ['CSV adapter: source coverage is unknown. No historical balances, investment evidence or recurring streams were invented.']}}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transactions', type=Path, required=True)
    parser.add_argument('--accounts', type=Path, required=True)
    parser.add_argument('--as-of', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = convert(args.transactions, args.accounts, args.as_of)
        text = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
        if len(text.encode('utf-8')) > LIMIT:
            raise ValueError('Output exceeds the dataset size bound.')
        # Never overwrite a previous export or the source files.
        with args.output.open('x', encoding='utf-8') as handle:
            handle.write(text)
        args.output.chmod(0o600)
        print('Snapshot written locally. Run npm run import:validate before importing. No data was sent.')
    except (ValueError, KeyError, TypeError, OSError, InvalidOperation, csv.Error):
        print('Conversion failed. Check file access, schema, dates, signs, unique IDs and USD currency. No source values were printed.', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
