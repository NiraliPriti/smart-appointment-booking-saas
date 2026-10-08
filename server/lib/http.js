export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const ok = (res, data, status = 200) => res.status(status).json({ data });
export const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

/** Validate input with a zod schema; throws a 400 HttpError with readable messages. */
export function parse(schema, input) {
  const r = schema.safeParse(input);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, 'validation_error', msg);
  }
  return r.data;
}
