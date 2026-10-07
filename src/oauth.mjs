import crypto from "node:crypto";
import http from "node:http";

/**
 * Client side of T3 Code's MCP OAuth flow (apps/server/src/auth/McpOAuth.ts):
 * stateless dynamic registration with a loopback redirect, PKCE S256,
 * an approval by the owner, and a single authorization-code exchange.
 * T3 issues a 30-day bearer and no refresh token, so renewal repeats this flow.
 */

export const ACCESS_LEVELS = [
  "read-only",
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];

const base64Url = (buffer) => Buffer.from(buffer).toString("base64url");

export function createPkce() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export const randomState = () => base64Url(crypto.randomBytes(24));

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: "manual" });
  const text = await response.text();
  let body;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { response, body, text };
}

function oauthFailure(step, { response, body, text }) {
  const detail = body?.error_description ?? body?.message ?? body?.error ?? text.slice(0, 200);
  return new Error(`${step} failed (HTTP ${response.status}): ${detail}`);
}

/** Reads protected-resource and authorization-server metadata for `<t3Url>/mcp`. */
export async function discover(t3Url) {
  const base = new URL(t3Url);
  const prm = await fetchJson(new URL("/.well-known/oauth-protected-resource/mcp", base));
  if (!prm.response.ok || !prm.body?.resource) {
    throw oauthFailure("Protected resource metadata", prm);
  }
  const issuer = prm.body.authorization_servers?.[0];
  if (!issuer) throw new Error("T3 did not advertise an authorization server.");
  const as = await fetchJson(new URL("/.well-known/oauth-authorization-server", issuer));
  if (!as.response.ok || !as.body?.token_endpoint) {
    throw oauthFailure("Authorization server metadata", as);
  }
  if (!as.body.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("T3 authorization server does not offer PKCE S256.");
  }
  if (!as.body.registration_endpoint) {
    throw new Error("T3 authorization server does not offer client registration.");
  }
  return { resource: prm.body.resource, issuer: as.body.issuer ?? issuer, metadata: as.body };
}

export async function registerClient(metadata, { clientName, redirectUri }) {
  const result = await fetchJson(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  });
  if (!result.response.ok || !result.body?.client_id) {
    throw oauthFailure("Client registration", result);
  }
  return result.body;
}

/** The authorization request parameters, shared by the browser URL and the decision API. */
export function authorizationParams({ clientId, redirectUri, challenge, state, resource }) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource,
  };
}

export function authorizationUrl(metadata, params) {
  const url = new URL(metadata.authorization_endpoint);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * Validates the redirect T3 sent the browser to and returns the code.
 * Checks `state` and, when present, the RFC 9207 `iss` parameter.
 */
export function parseRedirect(redirect, { redirectUri, state, issuer }) {
  const url = new URL(redirect);
  const expected = new URL(redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    throw new Error("The redirect does not match this sign-in's callback address.");
  }
  if (url.searchParams.get("state") !== state) {
    throw new Error("The redirect's state does not match this sign-in. Start again.");
  }
  const iss = url.searchParams.get("iss");
  if (iss !== null && issuer !== undefined && iss !== issuer) {
    throw new Error(`The redirect came from ${iss}, not ${issuer}.`);
  }
  const error = url.searchParams.get("error");
  if (error !== null) {
    const description = url.searchParams.get("error_description");
    throw new Error(`T3 declined the sign-in: ${error}${description ? ` (${description})` : ""}`);
  }
  const code = url.searchParams.get("code");
  if (!code) throw new Error("The redirect carries no authorization code.");
  return code;
}

/**
 * Listens on a loopback port for the browser's redirect. `redirectUri` is
 * known once the port is bound; `result` settles with the full redirect URL.
 */
export async function startCallbackServer({ host = "127.0.0.1", port = 0, path = "/callback" } = {}) {
  let settle;
  const result = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    if (url.pathname !== path) {
      response.writeHead(404).end();
      return;
    }
    const ok = url.searchParams.has("code") && !url.searchParams.has("error");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    response.end(
      `<!doctype html><meta charset="utf-8"><title>T3mcp</title>` +
        `<p>${ok ? "Approved. You can close this tab and return to the terminal." : "Sign-in was not approved. Return to the terminal."}</p>`,
    );
    settle.resolve(`http://${host}:${server.address().port}${url.pathname}${url.search}`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const redirectUri = `http://${host}:${server.address().port}${path}`;
  return {
    redirectUri,
    result,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * Approves the request with a one-time pairing code through the same API the
 * approval page uses (POST /oauth/mcp/decision) and returns the redirect URL.
 */
export async function approveWithPairingCode(issuer, params, { code, access }) {
  if (!ACCESS_LEVELS.includes(access)) {
    throw new Error(`Access must be one of: ${ACCESS_LEVELS.join(", ")}`);
  }
  const result = await fetchJson(new URL("/oauth/mcp/decision", issuer), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      authorization: params,
      decision: { _tag: "pairing-code", access, code },
    }),
  });
  if (!result.response.ok || !result.body?.redirectTo) {
    throw oauthFailure("Pairing-code approval", result);
  }
  return result.body.redirectTo;
}

export async function exchangeCode(metadata, { code, redirectUri, clientId, verifier, resource }) {
  const result = await fetchJson(metadata.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }).toString(),
  });
  if (!result.response.ok || !result.body?.access_token) {
    throw oauthFailure("Token exchange", result);
  }
  return result.body;
}

/**
 * Reads the non-secret claims of a T3 session token (`<payload>.<signature>`),
 * so the session can be identified for revocation without storing the token
 * anywhere else. Returns undefined for any other shape.
 */
export function sessionClaims(token) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null ? claims : undefined;
  } catch {
    return undefined;
  }
}
