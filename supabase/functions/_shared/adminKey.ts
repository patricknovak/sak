// The scheduler's runs carry the platform's admin key (migration 243), checked against the database by
// admin_key_ok. A blip on that one call (a dropped connection, a busy pool) used to read as "wrong key": the run
// answered 403 and did nothing, so a minute of scores, a notification or a feed pull was lost with a misleading
// error (nhl-sync's scores run, 23 November 2026). Now a failed check is tried once more, and if the database
// still can't answer, the caller says so with a 503 rather than calling the key wrong.

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

export type AdminCheck = 'yes' | 'no' | 'unsure';

export async function checkAdminKey(db: Rpc, req: Request): Promise<AdminCheck> {
  const key = req.headers.get('x-admin-key');
  if (!key) return 'no';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await db.rpc('admin_key_ok', { p_key: key });
      if (!error) return data === true ? 'yes' : 'no';
    } catch { /* tried again below */ }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return 'unsure';
}

/** The answer a refused run gives: 403 for a missing or wrong key, 503 when the key couldn't be checked. */
export function adminRefusal(check: AdminCheck, body: Record<string, unknown>): Response {
  return check === 'unsure'
    ? Response.json({ ...body, ok: false, error: 'Could not check the platform key; try again' }, { status: 503 })
    : Response.json({ ...body, ok: false, error: 'This task needs the platform key' }, { status: 403 });
}
