// The MyInvois endpoints (server/handler.ts) as one Vercel Function. vercel.json rewrites every
// /api/myinvois/* path here, and the function still sees the path that was asked for. On the
// internet it answers only browsers that hold MYINVOIS_ACCESS_KEY.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readConfig } from '../server/config.js';
import { createHandler } from '../server/handler.js';

// Made on the first call and kept while the instance stays warm, with its cached MyInvois logins.
let handle: ReturnType<typeof createHandler> | undefined;

export default function myinvois(req: IncomingMessage, res: ServerResponse) {
  handle ??= createHandler(readConfig(process.env), { hosted: true });
  return handle(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
}
