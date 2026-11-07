import { z } from 'zod';

// Zod 4 discards __proto__ keys while parsing records. User preference maps
// must reject these inputs explicitly, rather than silently accept an empty map.
export function safeRecord<Key extends z.ZodString, Value extends z.ZodType>(key: Key, value: Value) {
  return z.preprocess((input, ctx) => {
    if (input && typeof input === 'object' && !Array.isArray(input) &&
      Object.keys(input).some(name => ['__proto__', 'constructor', 'prototype'].includes(name))) {
      ctx.addIssue({ code: 'custom', message: 'Invalid record identifier.' });
      return z.NEVER;
    }
    return input;
  }, z.record(key, value));
}
