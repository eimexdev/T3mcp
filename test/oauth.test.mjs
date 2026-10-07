import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  authorizationParams,
  authorizationUrl,
  createPkce,
  parseRedirect,
  sessionClaims,
  startCallbackServer,
} from "../src/oauth.mjs";

test("PKCE verifier and S256 challenge match T3's accepted patterns", () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, crypto.createHash("sha256").update(verifier).digest("base64url"));
});

test("authorization URL carries every parameter T3 validates", () => {
  const params = authorizationParams({
    clientId: "client.sig",
    redirectUri: "http://127.0.0.1:5555/callback",
    challenge: "c".repeat(43),
    state: "s1",
    resource: "http://127.0.0.1:3773/mcp",
  });
  const url = new URL(authorizationUrl({ authorization_endpoint: "http://127.0.0.1:3773/oauth/mcp/authorize" }, params));
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("resource"), "http://127.0.0.1:3773/mcp");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:5555/callback");
});

test("parseRedirect checks callback, state, issuer, and errors", () => {
  const expected = { redirectUri: "http://127.0.0.1:5555/callback", state: "abc", issuer: "http://127.0.0.1:3773" };
  assert.equal(
    parseRedirect("http://127.0.0.1:5555/callback?code=xyz&state=abc&iss=http%3A%2F%2F127.0.0.1%3A3773", expected),
    "xyz",
  );
  assert.throws(() => parseRedirect("http://127.0.0.1:5555/callback?code=xyz&state=nope", expected), /state/);
  assert.throws(() => parseRedirect("http://127.0.0.1:6666/callback?code=xyz&state=abc", expected), /callback/);
  assert.throws(
    () => parseRedirect("http://127.0.0.1:5555/callback?code=xyz&state=abc&iss=https%3A%2F%2Fevil.example", expected),
    /evil/,
  );
  assert.throws(
    () => parseRedirect("http://127.0.0.1:5555/callback?error=access_denied&state=abc", expected),
    /access_denied/,
  );
});

test("sessionClaims reads T3 session payloads and ignores other tokens", () => {
  const payload = Buffer.from(JSON.stringify({ sid: "session-1", sub: "mcp-client" })).toString("base64url");
  assert.equal(sessionClaims(`${payload}.signature`).sid, "session-1");
  assert.equal(sessionClaims("bare-provider-token"), undefined);
  assert.equal(sessionClaims("a.b.c"), undefined);
});

test("callback server resolves with the browser's redirect", async () => {
  const callback = await startCallbackServer();
  try {
    const response = await fetch(`${callback.redirectUri}?code=abc&state=s`);
    assert.equal(response.status, 200);
    const redirect = await callback.result;
    assert.equal(new URL(redirect).searchParams.get("code"), "abc");
    assert.equal((await fetch(callback.redirectUri.replace("/callback", "/other"))).status, 404);
  } finally {
    await callback.close();
  }
});
