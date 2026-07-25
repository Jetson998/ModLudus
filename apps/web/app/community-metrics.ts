const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

export async function recordCommunityEvaluation() {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') return false;
  try {
    const response = await fetch(`${apiBase}/api/v1/ladder/community-evaluations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: crypto.randomUUID() }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
