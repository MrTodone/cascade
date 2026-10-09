/**
 * cascade-router/http.ts — HTTP-утилиты: JSON-ответы, ошибки, чтение тела.
 * Собственный код.
 */
import type { ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 10 * 1024 * 1024; // >10MB → честный 413 (отличие #3)

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

/** Клиентская ошибка в форме OpenAI: error{code,message,type}. */
export function sendError(res: ServerResponse, status: number, message: string, code: string, type = "invalid_request_error", extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): void {
  sendJson(res, status, { error: { code, message, type, ...extra } }, headers);
}
export async function readJsonBody(req: import("node:http").IncomingMessage): Promise<{ body: any } | { tooLarge: true }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      // Отличие #3: раньше тут был destroy() → у клиента ECONNRESET без кода.
      return { tooLarge: true };
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return { body: {} };
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { body: {} };
  }
}
