import handler from "vinext/server/fetch-handler";
import { secureRequest, secureResponse } from "../lib/security-headers";
import { authorizeRequest, withoutAuthentication } from "./access";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    // Authorize before pages, assets, APIs or MCP can reach the snapshot store.
    const secured = secureRequest(withoutAuthentication(request));
    const rejection = await authorizeRequest(request, env);
    if (rejection) return secureResponse(rejection, secured.policy, request.url);
    // Vinext expects these build files to be served asset-first. We deliberately
    // run the Worker first so they receive the same authentication as the app.
    if (env.ASSETS && ['GET', 'HEAD'].includes(request.method)
      && new URL(request.url).pathname.startsWith('/_next/static/')) {
      return secureResponse(await env.ASSETS.fetch(secured.request), secured.policy, request.url);
    }
    // Only storage and bundled static assets reach the application. Collection of source records stays
    // external; no provider credentials or source capabilities belong here.
    const appEnv = { DB: env.DB, BUCKET: env.BUCKET, ASSETS: env.ASSETS };
    const appContext: ExecutionContext = {
      waitUntil: (promise) => ctx.waitUntil(promise),
      passThroughOnException: () => ctx.passThroughOnException(),
      abort: (reason) => ctx.abort(reason),
      exports: {},
      props: {},
      ...(ctx.cache ? { cache: ctx.cache } : {}),
      tracing: ctx.tracing,
    };
    const response = await handler.fetch(secured.request, appEnv, appContext);
    return secureResponse(response, secured.policy, request.url);
  },
};

export default worker;
