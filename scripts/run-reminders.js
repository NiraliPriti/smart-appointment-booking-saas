// Local simulation of the cron job: `npm run job:reminders`
import 'dotenv/config';
import { runReminders } from '../server/jobs/reminders.js';
console.log(await runReminders());
