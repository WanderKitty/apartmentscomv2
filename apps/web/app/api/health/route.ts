import { getPool } from '@aptv2/db'

export async function GET(): Promise<Response> {
  try {
    await getPool().query('SELECT 1')
    return Response.json({ ok: true, db: 'up' })
  } catch {
    return Response.json({ ok: false, db: 'down' }, { status: 503 })
  }
}
