// Native Node tests consume the same extensionless TypeScript imports as Vite.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    // The report renderer checks server markup, not computed styles. Its
    // temporary JS modules retain CSS side-effect imports that Vite normally
    // consumes; the production build separately validates these stylesheets.
    if (specifier.endsWith('.css')) {
      return { url: 'data:text/javascript,export%20default%20%7B%7D%3B', shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

// Regression tests use in-memory storage and synthetic fixtures. Any accidental
// attempt to refresh the real Site or Finances must fail rather than make a call.
globalThis.fetch = async () => { throw new Error('Network access is disabled in Neonworth regression tests.'); };
