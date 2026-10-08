// Structured JSON logs. Never pass tokens, secrets or personal data in `meta` (use ids only).
export const log = (level, msg, meta = {}) =>
  (level === 'error' ? console.error : console.log)(
    JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta })
  );
