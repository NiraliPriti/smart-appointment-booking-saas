import app from './app.js';
import { log } from './lib/logger.js';

const port = process.env.PORT || 3001;
app.listen(port, () => log('info', `API listening on http://localhost:${port}`));
