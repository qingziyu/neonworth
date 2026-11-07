import { APP_VERSION } from '@/lib/app-version';

export const dynamic = 'force-dynamic';

export async function GET() {
  // The authenticated single-owner Worker also protects this endpoint.
  return Response.json({ version: APP_VERSION }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie' },
  });
}
