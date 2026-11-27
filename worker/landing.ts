// The marketing site at the edge (superpoolsai.com, 26 November 2026). The Worker serves landing/ as static assets, as
// before, and runs first for one folder only:
//   /media/*   the films (the Super Hockey League's concept film). A film has to be served in byte ranges: Safari on a
//              phone asks for bytes 0-1 before it plays anything and gives up on a 200, and static assets answer a Range
//              request with the whole file. So the Worker reads the file from the assets and sends the bytes asked for
//              as a 206. A request with no Range header gets the file as the assets serve it, marked Accept-Ranges.
// Every other path is the files, untouched: a page, a picture, a redirect or the 404 never reaches this code unless no
// file matches, and then it is handed straight back to the assets.
import { rangeOf } from './range';

interface Env {
  ASSETS: Fetcher;
}

async function media(request: Request, env: Env): Promise<Response> {
  const range = request.headers.get('Range');
  if (!range) {
    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    if (res.status === 200) headers.set('Accept-Ranges', 'bytes');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  // the whole file, asked for plainly: no Range and no validators, so the assets answer 200 with every byte
  const whole = await env.ASSETS.fetch(new Request(request.url, { method: 'GET' }));
  const type = whole.headers.get('Content-Type') || '';
  // a missing film is the assets' own 404: hand it back as it is
  if (whole.status !== 200 || !whole.body || type.startsWith('text/html')) return whole;
  // the assets do not always say how long the file is, so its length is read off the bytes themselves
  const bytes = await whole.arrayBuffer();
  const size = bytes.byteLength;
  const head = request.method === 'HEAD';
  const headers = new Headers(whole.headers);
  headers.set('Accept-Ranges', 'bytes');
  // If-Range: the range only stands while the file is the one the player already has a part of
  const ifRange = request.headers.get('If-Range');
  const want = ifRange && ifRange !== whole.headers.get('ETag') ? null : rangeOf(range, size);
  if (want === null) {
    headers.set('Content-Length', String(size));
    return new Response(head ? null : bytes, { status: 200, headers });
  }
  if (want === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    headers.delete('Content-Length');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${want.start}-${want.end}/${size}`);
  headers.set('Content-Length', String(want.end - want.start + 1));
  return new Response(head ? null : bytes.slice(want.start, want.end + 1), { status: 206, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/media/') && (request.method === 'GET' || request.method === 'HEAD')) return media(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
