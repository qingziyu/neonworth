import handler from 'vinext/server/fetch-handler';
import { secureRequest, secureResponse } from '../lib/security-headers';
import { rejectSitesRequest, withoutSitesAuthentication } from './sites-policy';

// Supported only behind a confirmed owner-private Sites Dispatch policy. The
// platform admits the owner or validates/consumes Site-scoped service access.
// Neither identity-header presence nor a caller-supplied bearer grants access.
const worker = {
  async fetch(request: Request, env: Cloudflare.Env & { SITES_LOCAL_DEV?: string }, ctx: ExecutionContext) {
    const secured = secureRequest(withoutSitesAuthentication(request));
    const rejection = rejectSitesRequest(request, env.SITES_LOCAL_DEV === 'true');
    if (rejection) return secureResponse(rejection, secured.policy, request.url);
    if (env.ASSETS && ['GET', 'HEAD'].includes(request.method) && new URL(request.url).pathname.startsWith('/_next/static/')) {
      return secureResponse(await env.ASSETS.fetch(secured.request), secured.policy, request.url);
    }
    // Source Finance access always remains external. Discard every capability,
    // runtime secret and connector grant instead of forwarding the environment.
    const appEnv = { DB: env.DB, ASSETS: env.ASSETS };
    const appContext: ExecutionContext = {
      waitUntil: promise => ctx.waitUntil(promise),
      passThroughOnException: () => ctx.passThroughOnException(),
      abort: reason => ctx.abort(reason), exports: {}, props: {},
      ...(ctx.cache ? { cache: ctx.cache } : {}), tracing: ctx.tracing,
    };
    return secureResponse(await handler.fetch(secured.request, appEnv, appContext), secured.policy, request.url);
  },
};
export default worker;
