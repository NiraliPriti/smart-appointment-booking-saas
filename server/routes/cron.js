import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { fail, ok } from '../lib/http.js';
import { runReminders } from '../jobs/reminders.js';

const r = Router();
function authorized(header) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
r.get('/reminders', async (req, res) => {
  if (!authorized(req.headers.authorization)) return fail(res, 401, 'unauthorized', 'Invalid cron credentials');
  ok(res, await runReminders());
});
export default r;
