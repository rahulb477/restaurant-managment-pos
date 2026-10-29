export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers });
}

export function errorResponse(err: unknown) {
  if (err && typeof err === "object" && "issues" in err) {
    return json({ message: "Validation failed", issues: (err as { issues: unknown }).issues }, 400);
  }
  if (err instanceof HttpError) {
    return json({ message: err.message, code: err.code }, err.status);
  }
  if (err instanceof Error && "status" in err && typeof (err as { status: unknown }).status === "number") {
    return json({ message: err.message }, (err as { status: number }).status);
  }
  const message = err instanceof Error ? err.message : "Request failed";
  return json({ message }, 500);
}

export function requireBranchId(url: URL): string {
  const branchId = url.searchParams.get("branchId");
  if (!branchId) throw new HttpError(400, "branchId is required");
  return branchId;
}
