import { getAuthToken } from 'deepspace'

export type ActionResponse<T> = { success: true; data: T } | { success: false; error: string; code?: string }

/** POST to a server action in src/actions with the caller's JWT. */
export async function callAction<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<ActionResponse<T>> {
  try {
    const token = await getAuthToken()
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(params),
    })
    const json = (await res.json().catch(() => null)) as ActionResponse<T> | null
    if (!json) return { success: false, error: `Request failed (${res.status})` }
    return json
  } catch {
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
}
