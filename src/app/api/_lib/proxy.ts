/**
 * Shared utilities for Next.js API route handlers.
 *
 * Next.js is the primary backend. These helpers are used to proxy
 * requests to optional satellite backends (NestJS or Python) when
 * a route needs functionality not handled natively by Next.js.
 */

import { NextResponse } from "next/server";
import {
  API_CONFIG,
  getNestJSEndpointUrl,
  getPythonEndpointUrl,
} from "@/lib/api-config";

type NestJSEndpoint = keyof typeof API_CONFIG.nestjs.endpoints;
type PythonEndpoint = keyof typeof API_CONFIG.python.endpoints;

/**
 * Proxy a request to the NestJS backend.
 *
 * @param endpoint  - Key from API_CONFIG.nestjs.endpoints
 * @param init      - Fetch init (method, body, headers)
 * @returns NextResponse with the backend response or an error
 */
export async function proxyToNestJS(
  endpoint: NestJSEndpoint,
  init?: RequestInit
): Promise<NextResponse> {
  const url = getNestJSEndpointUrl(endpoint);

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail ?? data.message ?? "NestJS backend error", status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "NestJS backend unavailable — is the NestJS server running?", status: 503 },
      { status: 503 }
    );
  }
}

/**
 * Proxy a request to the Python ML backend.
 *
 * @param endpoint  - Key from API_CONFIG.python.endpoints
 * @param init      - Fetch init (method, body, headers)
 * @returns NextResponse with the backend response or an error
 */
export async function proxyToPython(
  endpoint: PythonEndpoint,
  init?: RequestInit
): Promise<NextResponse> {
  const url = getPythonEndpointUrl(endpoint);

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail ?? data.message ?? "Python backend error", status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Python backend unavailable — is the FastAPI/Flask server running?", status: 503 },
      { status: 503 }
    );
  }
}

/**
 * Standard error response helper.
 */
export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
