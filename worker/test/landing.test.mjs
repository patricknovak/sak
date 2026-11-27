// The marketing site's Worker (worker/landing.ts) under wrangler dev: the film comes back in byte ranges, and every
// other path is the files as before. Run by worker/test/run.sh with the address as its argument.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:8788';
const film = readFileSync(new URL('../../landing/media/shl-film.mp4', import.meta.url));
const get = (path, headers = {}, method = 'GET') => fetch(base + path, { method, headers, redirect: 'manual' });

{ // the pages, a redirect and the 404 never change
  const page = await get('/shl');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  assert.match(await page.text(), /Super Hockey League/);
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/privacy')).status, 302);
  assert.equal((await get('/no-such-page')).status, 404);
}

{ // the whole film, marked as rangeable
  const res = await get('/media/shl-film.mp4');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(film), 'every byte of the film');
}

{ // what a phone's player asks first
  const res = await get('/media/shl-film.mp4', { Range: 'bytes=0-1' });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 0-1/${film.length}`);
  assert.equal(res.headers.get('content-length'), '2');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(film.subarray(0, 2)));
}

{ // a seek into the middle, the tail, and an open end
  const mid = await get('/media/shl-film.mp4', { Range: 'bytes=4096-8191' });
  assert.equal(mid.status, 206);
  assert.ok(Buffer.from(await mid.arrayBuffer()).equals(film.subarray(4096, 8192)));
  const tail = await get('/media/shl-film.mp4', { Range: 'bytes=-512' });
  assert.equal(tail.headers.get('content-range'), `bytes ${film.length - 512}-${film.length - 1}/${film.length}`);
  assert.ok(Buffer.from(await tail.arrayBuffer()).equals(film.subarray(film.length - 512)));
  const open = await get('/media/shl-film.mp4', { Range: `bytes=${film.length - 100}-` });
  assert.equal(open.status, 206);
  assert.equal((await open.arrayBuffer()).byteLength, 100);
}

{ // past the end is refused; a HEAD carries the same answer with no body; a film that is not there is a 404
  const past = await get('/media/shl-film.mp4', { Range: `bytes=${film.length}-` });
  assert.equal(past.status, 416);
  assert.equal(past.headers.get('content-range'), `bytes */${film.length}`);
  const head = await get('/media/shl-film.mp4', { Range: 'bytes=0-1' }, 'HEAD');
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-range'), `bytes 0-1/${film.length}`);
  assert.equal((await get('/media/no-such-film.mp4', { Range: 'bytes=0-1' })).status, 404);
}

console.log('landing worker tests passed');
