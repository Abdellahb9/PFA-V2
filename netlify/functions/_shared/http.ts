// Tiny HTTP helpers for Netlify Functions (v2, standard Request/Response).

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

// FastAPI-style error body so the frontend's apiErrorMessage helper keeps working.
export const fail = (detail: string, status = 400) => json({ detail }, status);

export const noContent = () => new Response(null, { status: 204 });

export const methodNotAllowed = () => fail("Méthode non autorisée", 405);

// Parse a JSON request body (loosely typed; returns {} on empty/invalid).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const readBody = async (req: Request): Promise<any> => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};
