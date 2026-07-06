import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { LSPClient } from '../src/lsp/index.js';

test('LSPClient initializes a stdio server and collects publishDiagnostics', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-lsp-client-'));
  try {
    const serverPath = join(cwd, 'mock-lsp-server.mjs');
    await writeFile(serverPath, MOCK_LSP_SERVER, 'utf8');
    const client = new LSPClient({
      command: process.execPath,
      args: [serverPath],
      cwd,
    });

    const init = await client.start();
    assert.equal(init.serverInfo?.name, 'mock-lsp');

    const uri = pathToFileURL(join(cwd, 'sample.ts')).toString();
    await client.openDocument({ uri, languageId: 'typescript', text: 'const value: string = 1;\n' });
    const diagnostics = await client.waitForDiagnostics(uri, 2000);

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].severity, 1);
    assert.match(diagnostics[0].message, /mock type error/);
    await client.stop();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const MOCK_LSP_SERVER = `
let buffer = Buffer.alloc(0);
let nextServerId = 1;

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString('ascii');
    const match = /content-length:\\s*(\\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const message = JSON.parse(buffer.slice(bodyStart, bodyEnd).toString('utf8'));
    buffer = buffer.slice(bodyEnd);
    handle(message);
  }
});

function handle(message) {
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { textDocumentSync: 1 }, serverInfo: { name: 'mock-lsp', version: '1.0.0' } } });
    return;
  }
  if (message.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: message.id, result: null });
    return;
  }
  if (message.method === 'exit') {
    process.exit(0);
  }
  if (message.method === 'textDocument/didOpen') {
    const uri = message.params.textDocument.uri;
    send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      severity: 1,
      source: 'mock-lsp',
      message: 'mock type error'
    }] } });
  }
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(Buffer.from('Content-Length: ' + body.byteLength + '\\r\\n\\r\\n', 'ascii'));
  process.stdout.write(body);
}
`;
