import type { NextRequest } from "next/server";

export const BROWSER_TOKEN_HEADER = "x-chorus-token";

export function extractBrowserToken(req: NextRequest): string {
  const header = req.headers.get(BROWSER_TOKEN_HEADER);
  return header?.trim() ?? "";
}
