import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerMcpProxyRoute, isProxyableUrl } from './mcpProxy';

describe('isProxyableUrl (SSRF guard)', () => {
  it('accepts public http(s) URLs', () => {
    assert.equal(isProxyableUrl('https://mcp.example.com/rpc'), true);
    assert.equal(isProxyableUrl('http://api.example.org:8080/mcp'), true);
  });

  it('rejects localhost, private ranges, and non-http schemes', () => {
    const blocked = [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://0.0.0.0/x',
      'http://10.0.0.5/x',
      'http://192.168.1.1/x',
      'http://169.254.1.1/x',
      'http://172.16.0.1/x',
      'http://[::1]/x',
      'file:///etc/passwd',
      'ftp://host/x',
      'not a url',
    ];
    for (const u of blocked) assert.equal(isProxyableUrl(u), false, u);
  });
});

describe('POST /api/mcp-proxy', () => {
  it('rejects a missing body or a non-proxyable url with 400', async () => {
    const app = Fastify();
    registerMcpProxyRoute(app);
    try {
      const noUrl = await app.inject({
        method: 'POST',
        url: '/api/mcp-proxy',
        payload: { body: '{}' },
      });
      assert.equal(noUrl.statusCode, 400);

      const privateUrl = await app.inject({
        method: 'POST',
        url: '/api/mcp-proxy',
        payload: { url: 'http://localhost/rpc', body: '{}' },
      });
      assert.equal(privateUrl.statusCode, 400);
    } finally {
      await app.close();
    }
  });
});
