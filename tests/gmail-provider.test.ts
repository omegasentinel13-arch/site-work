import test from 'node:test';
import assert from 'node:assert/strict';
import { GmailApiEmailProvider } from '../lib/email/providers/gmail-provider';
import { getTransactionalEmailProvider } from '../lib/email/providers';

test('GMAIL API PROVIDER & MIME ENCODING ARCHITECTURE SUITE', async (suite) => {
  const origEnv = { ...process.env };
  const origFetch = globalThis.fetch;

  suite.afterEach(() => {
    process.env = { ...origEnv };
    globalThis.fetch = origFetch;
  });

  // TEST 1: Missing credentials fail closed safely
  await suite.test('TEST 1: isConfigured() and send() fail closed when credentials missing', async () => {
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;
    delete process.env.GMAIL_REFRESH_TOKEN;

    const provider = new GmailApiEmailProvider();
    assert.equal(provider.isConfigured(), false);

    const result = await provider.send({
      to: 'approver@sitework.test',
      subject: 'Test Missing Creds',
      text: 'Test content',
      html: '<p>Test content</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.equal(result.errorCode, 'MISSING_GMAIL_CREDENTIALS');
    assert.ok(result.errorMessage?.includes('not configured'));
  });

  // TEST 2: Provider Factory resolution when EMAIL_PROVIDER=gmail
  await suite.test('TEST 2: Provider factory resolves GmailApiEmailProvider when EMAIL_PROVIDER=gmail', () => {
    process.env.EMAIL_PROVIDER = 'gmail';
    const provider = getTransactionalEmailProvider();
    assert.equal(provider.name, 'gmail');
    assert.ok(provider instanceof GmailApiEmailProvider);
  });

  // TEST 3: Provider Factory resolution in production when GMAIL_REFRESH_TOKEN is present
  await suite.test('TEST 3: Provider factory defaults to GmailApiEmailProvider in production when GMAIL_REFRESH_TOKEN is present', () => {
    delete process.env.EMAIL_PROVIDER;
    process.env.NODE_ENV = 'production';
    process.env.GMAIL_REFRESH_TOKEN = 'mock-refresh-token';

    const provider = getTransactionalEmailProvider();
    assert.equal(provider.name, 'gmail');
  });

  // TEST 4: MIME structure preservation (CRLF CRLF blank lines, boundaries, text/plain and text/html)
  await suite.test('TEST 4: buildRfc2822Message preserves mandatory CRLF CRLF separators and multipart boundaries', () => {
    const provider = new GmailApiEmailProvider({
      clientId: 'dummy-id',
      clientSecret: 'dummy-secret',
      refreshToken: 'dummy-refresh',
    });

    const email = {
      to: 'recipient@sitework.test',
      from: 'AB CONSTRUCTIONS & INTERIORS <omegasentinel13@gmail.com>',
      replyTo: 'omegasentinel13@gmail.com',
      subject: 'New Access Request: Suresh Kumar (UTF-8: Prüfen & 🏗️)',
      text: 'PLAIN TEXT CONTENT LINE 1\nPLAIN TEXT CONTENT LINE 2',
      html: '<div>HTML CONTENT <strong>BOLD</strong></div>',
    };

    const mime = provider.buildRfc2822Message(email, email.from);

    // 1. Headers must terminate with CRLF CRLF
    assert.ok(mime.includes('MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="'), 'Header must include MIME-Version and boundary');
    assert.ok(mime.includes('\r\n\r\n--'), 'Headers must terminate with blank CRLF CRLF before first boundary');

    // 2. Both text/plain and text/html must be present with proper separators
    assert.ok(mime.includes('Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\nPLAIN TEXT CONTENT'), 'Plain text section must have header, blank line, and content');
    assert.ok(mime.includes('Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n<div>HTML CONTENT'), 'HTML section must have header, blank line, and content');

    // 3. UTF-8 Subject encoding works
    assert.ok(mime.includes('Subject: =?UTF-8?B?'), 'Subject must be UTF-8 base64 encoded');
    const base64SubjectPart = mime.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)?.[1];
    assert.ok(base64SubjectPart, 'Subject base64 part must be found');
    const decodedSubject = Buffer.from(base64SubjectPart, 'base64').toString('utf-8');
    assert.equal(decodedSubject, email.subject, 'Decoded subject must match original unicode subject');

    // 4. Base64URL conversion has no '+' or '/' and no trailing '='
    const base64Url = provider.toBase64Url(mime);
    assert.ok(!base64Url.includes('+'), 'Base64URL must not contain +');
    assert.ok(!base64Url.includes('/'), 'Base64URL must not contain /');
    assert.ok(!base64Url.endsWith('='), 'Base64URL must not have trailing =');
  });

  // TEST 5: Successful OAuth Token Refresh & HTTPS Sending
  await suite.test('TEST 5: Successful OAuth token refresh and Gmail API messages.send dispatch', async () => {
    const mockToken = 'mock-ya29-access-token-987';
    let tokenRequestMade = false;
    let sendRequestMade = false;
    let authHeaderSent = '';

    globalThis.fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr === 'https://oauth2.googleapis.com/token') {
        tokenRequestMade = true;
        const bodyParams = new URLSearchParams(init?.body as string);
        assert.equal(bodyParams.get('client_id'), 'test-client-id');
        assert.equal(bodyParams.get('client_secret'), 'test-client-secret');
        assert.equal(bodyParams.get('refresh_token'), 'test-refresh-token');
        assert.equal(bodyParams.get('grant_type'), 'refresh_token');

        return new Response(JSON.stringify({
          access_token: mockToken,
          expires_in: 3600,
          token_type: 'Bearer',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (urlStr === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        sendRequestMade = true;
        authHeaderSent = ((init?.headers || {}) as Record<string, string>)['Authorization'];
        const payload = JSON.parse(init?.body as string);
        assert.ok(payload.raw, 'Payload must contain raw base64url string');

        return new Response(JSON.stringify({
          id: 'gmail-msg-18f92ab3c4d5e',
          threadId: 'gmail-thread-18f92ab3c4d5e',
          labelIds: ['SENT'],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const provider = new GmailApiEmailProvider({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
    });

    const result = await provider.send({
      to: 'reviewer@gmail.com',
      subject: 'Review Access Request',
      text: 'Plain body',
      html: '<p>HTML body</p>',
    });

    assert.equal(tokenRequestMade, true);
    assert.equal(sendRequestMade, true);
    assert.equal(authHeaderSent, `Bearer ${mockToken}`);
    assert.equal(result.success, true);
    assert.equal(result.provider, 'gmail');
    assert.equal(result.deliveryStatus, 'SENT');
    assert.equal(result.providerMessageId, 'gmail-msg-18f92ab3c4d5e');
  });

  // TEST 6: Google OAuth invalid_grant failure handling
  await suite.test('TEST 6: Google OAuth invalid_grant handled safely with explicit reauthorization requirement', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    };

    const provider = new GmailApiEmailProvider({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'expired-refresh-token',
    });

    const result = await provider.send({
      to: 'reviewer@gmail.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.equal(result.errorCode, 'GMAIL_AUTH_EXPIRED');
    assert.ok(result.errorMessage?.includes('Reauthorization required'));
  });

  // TEST 7: Google OAuth invalid_client failure handling
  await suite.test('TEST 7: Google OAuth invalid_client handled safely', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        error: 'invalid_client',
        error_description: 'Unauthorized client',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    };

    const provider = new GmailApiEmailProvider({
      clientId: 'bad-client-id',
      clientSecret: 'bad-client-secret',
      refreshToken: 'test-refresh-token',
    });

    const result = await provider.send({
      to: 'reviewer@gmail.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.equal(result.errorCode, 'GMAIL_CLIENT_INVALID');
  });

  // TEST 8: Google API HTTP 429 Rate / Quota Limit Handling
  await suite.test('TEST 8: Google API HTTP 429 rateLimitExceeded handled with GMAIL_RATE_LIMITED', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({
          access_token: 'mock-token',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        error: {
          code: 429,
          message: 'Rate Limit Exceeded',
          errors: [{ reason: 'rateLimitExceeded' }],
        },
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    };

    const provider = new GmailApiEmailProvider({
      clientId: 'id',
      clientSecret: 'sec',
      refreshToken: 'ref',
    });

    const result = await provider.send({
      to: 'reviewer@gmail.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.equal(result.errorCode, 'GMAIL_RATE_LIMITED');
    assert.ok(result.errorMessage?.includes('Rate Limit Exceeded'));
  });

  // TEST 9: Google API HTTP 5xx Server Outage Handling
  await suite.test('TEST 9: Google API HTTP 503 backend error handled cleanly', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({
          access_token: 'mock-token',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        error: {
          code: 503,
          message: 'Backend Error',
        },
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    };

    const provider = new GmailApiEmailProvider({
      clientId: 'id',
      clientSecret: 'sec',
      refreshToken: 'ref',
    });

    const result = await provider.send({
      to: 'reviewer@gmail.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.equal(result.errorCode, 'GMAIL_HTTP_503');
  });

  // TEST 10: Secret Redaction (Tokens, secrets, Authorization headers never leak into errorMessage)
  await suite.test('TEST 10: Secret redaction strips client secret, refresh token, access token, and Bearer patterns from error messages', async () => {
    const rawSecret = 'SUPER_SECRET_GMAIL_KEY_XYZ999';
    const rawRefreshToken = '1//0gMOCK_REFRESH_TOKEN_ABC123';
    const rawAccessToken = 'ya29.a0AfH6SMB_SECRET_ACCESS_TOKEN_SAMPLE';

    globalThis.fetch = async (url) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({
          access_token: rawAccessToken,
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // Return upstream error reflecting credentials
      return new Response(JSON.stringify({
        error: {
          message: `Internal error mentioning secret ${rawSecret} and Bearer ${rawAccessToken} and refresh ${rawRefreshToken}`,
        },
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    };

    const provider = new GmailApiEmailProvider({
      clientId: 'id',
      clientSecret: rawSecret,
      refreshToken: rawRefreshToken,
    });

    const result = await provider.send({
      to: 'reviewer@gmail.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.ok(!result.errorMessage?.includes(rawSecret), 'Client secret must be redacted');
    assert.ok(!result.errorMessage?.includes(rawRefreshToken), 'Refresh token must be redacted');
    assert.ok(!result.errorMessage?.includes(rawAccessToken), 'Access token must be redacted');
    assert.ok(result.errorMessage?.includes('***'), 'Sanitizer must have inserted asterisks');
  });

  // TEST 11: Token Caching & Short Lifetime Guard
  await suite.test('TEST 11: Token caching reuses unexpired token and guards against <=60s expires_in', async () => {
    let tokenFetchCount = 0;

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('oauth2.googleapis.com')) {
        tokenFetchCount++;
        return new Response(JSON.stringify({
          access_token: `cached-token-${tokenFetchCount}`,
          expires_in: 50, // Short lifetime under 60 seconds
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const provider = new GmailApiEmailProvider({
      clientId: 'id',
      clientSecret: 'sec',
      refreshToken: 'ref',
    });

    // Call 1: fetches token
    const res1 = await provider.send({ to: 'a@sitework.test', subject: 'S', text: 'T', html: '<p>H</p>' });
    assert.equal(res1.success, true);
    assert.equal(tokenFetchCount, 1);

    // Call 2: should reuse cached token because expiresAtMs is safely buffered in future
    const res2 = await provider.send({ to: 'b@sitework.test', subject: 'S', text: 'T', html: '<p>H</p>' });
    assert.equal(res2.success, true);
    assert.equal(tokenFetchCount, 1, 'Second send within valid lifetime must not re-fetch token');
  });
});
