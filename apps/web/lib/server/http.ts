export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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
  // Unexpected SDK errors can contain server configuration details. Never
  // echo them to a client (including Firebase service-account information).
  console.error("Unexpected API request failure");
  return json({ message: "Request failed. Please try again." }, 500);
}

export function requireBranchId(url: URL): string {
  const branchId = url.searchParams.get("branchId");
  if (!branchId) throw new HttpError(400, "branchId is required");
  return branchId;
}
