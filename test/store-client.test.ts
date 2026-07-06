import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packCharacterPackage } from '../src/aesthetic/character/custom/CharacterPackagePacker.js';
import { CharacterPackageManager } from '../src/aesthetic/character/custom/CharacterPackageManager.js';
import { StoreClient } from '../src/aesthetic/character/marketplace/StoreClient.js';
import { writeCharacterPackageFixture } from './helpers/character-package-fixture.js';

/** 用真实 .roxychar 文件构造 mock fetch，验证 StoreClient 下载 + SHA-256 链路。 */
test('StoreClient.downloadToCache verifies sha256 and returns local path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-storeclient-'));
  try {
    // 打包一个真实 .roxychar
    const pkgDir = join(root, 'roxy-sensei-src');
    await writeCharacterPackageFixture(pkgDir);
    const packed = await packCharacterPackage(pkgDir, {
      outDir: join(root, 'dist'),
      force: true,
    });

    const fileBytes = await import('node:fs/promises').then(fs => fs.readFile(packed.packagePath));
    const expectedSha256 = createHash('sha256').update(fileBytes).digest('hex');

    // mock fetch
    let downloadUrlCalled = '';
    const mockFetch = async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes('/packages?')) {
        return jsonResp([{
          name: 'roxy-sensei',
          displayName: 'Roxy Sensei',
          description: 'Test package',
          latestVersion: '1.0.0',
          official: false,
          downloads: 42,
          riskLevel: 'LOW',
          tags: ['test'],
        }]);
      }
      if (urlStr.includes('/packages/roxy-sensei/download')) {
        return jsonResp({
          version: '1.0.0',
          downloadUrl: 'https://example.com/roxy-sensei-1.0.0.roxychar',
          sha256: expectedSha256,
          risk: { level: 'LOW', summary: 'No extensions detected.' },
        });
      }
      if (urlStr.includes('roxy-sensei-1.0.0.roxychar')) {
        downloadUrlCalled = urlStr;
        return binaryResp(fileBytes);
      }
      return new Response('Not Found', { status: 404 });
    };

    const cacheDir = join(root, 'cache');
    await mkdir(cacheDir, { recursive: true });
    const client = new StoreClient({
      baseUrl: 'https://example.com',
      cacheDir,
      fetchImpl: mockFetch as typeof fetch,
    });

    // 搜索
    const results = await client.searchPackages({ q: 'roxy' });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'roxy-sensei');
    assert.equal(results[0].riskLevel, 'LOW');

    // 下载到缓存
    const downloaded = await client.downloadToCache('roxy-sensei');
    assert.equal(downloaded.name, 'roxy-sensei');
    assert.equal(downloaded.version, '1.0.0');
    assert.equal(downloaded.verified, true);
    assert.equal(downloaded.sha256.toLowerCase(), expectedSha256.toLowerCase());
    assert.match(downloaded.filePath, /roxy-sensei-1\.0\.0\.roxychar$/);
    assert.equal(downloadUrlCalled, 'https://example.com/roxy-sensei-1.0.0.roxychar');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StoreClient.downloadToCache rejects sha256 mismatch and deletes cached file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-storeclient-mismatch-'));
  try {
    const fakeBytes = Buffer.from('fake-content');
    const wrongSha = 'a'.repeat(64);

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes('/packages/bad-pkg/download')) {
        return jsonResp({
          version: '1.0.0',
          downloadUrl: 'https://example.com/bad-pkg-1.0.0.roxychar',
          sha256: wrongSha,
        });
      }
      if (urlStr.includes('bad-pkg-1.0.0.roxychar')) return binaryResp(fakeBytes);
      return new Response('Not Found', { status: 404 });
    };

    const cacheDir = join(root, 'cache');
    await mkdir(cacheDir, { recursive: true });
    const client = new StoreClient({
      baseUrl: 'https://example.com',
      cacheDir,
      fetchImpl: mockFetch as typeof fetch,
    });

    await assert.rejects(
      () => client.downloadToCache('bad-pkg'),
      (err: Error) => {
        assert.match(err.message, /SHA-256 校验失败/);
        return true;
      },
    );
    // 文件应已被删除
    const cached = join(cacheDir, 'bad-pkg-1.0.0.roxychar');
    assert.equal(await import('node:fs').then(fs => fs.existsSync(cached)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StoreClient constructor rejects invalid baseUrl', () => {
  assert.throws(
    () => new StoreClient({ baseUrl: 'not-a-url', fetchImpl: fetch }),
    /baseUrl.*合法/,
  );
  assert.throws(
    () => new StoreClient({ baseUrl: '', fetchImpl: fetch }),
    /baseUrl.*合法/,
  );
});

test('StoreClient download-to-cache then CharacterPackageManager install roundtrip', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-storeclient-roundtrip-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    const pkgDir = join(root, 'roxy-sensei-src');
    await writeCharacterPackageFixture(pkgDir);
    const packed = await packCharacterPackage(pkgDir, { outDir: join(root, 'dist'), force: true });
    const fileBytes = await import('node:fs/promises').then(fs => fs.readFile(packed.packagePath));
    const sha256 = createHash('sha256').update(fileBytes).digest('hex');

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes('/download')) {
        return jsonResp({ version: '1.0.0', downloadUrl: 'https://cdn.example/pkg.roxychar', sha256 });
      }
      return binaryResp(fileBytes);
    };

    const cacheDir = join(root, 'cache');
    await mkdir(cacheDir, { recursive: true });

    const { CharacterPackageManager: Mgr } = await import('../src/aesthetic/character/custom/CharacterPackageManager.js');
    const mgr = new Mgr(root);
    const result = await mgr.installFromStore('roxy-sensei', {
      storeOptions: { baseUrl: 'https://example.com', cacheDir, fetchImpl: mockFetch as typeof fetch },
      version: '1.0.0',
    });

    assert.equal(result.manifest.name, 'roxy-sensei');
    assert.equal(result.manifest.version, '1.0.0');
    assert.equal(result.download.verified, true);
    assert.equal(result.download.sha256.toLowerCase(), sha256.toLowerCase());
    assert.equal(result.scope, 'project');
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function jsonResp(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function binaryResp(data: Buffer): Response {
  return new Response(data, {
    status: 200,
    headers: { 'content-type': 'application/zip', 'content-length': String(data.byteLength) },
  });
}
