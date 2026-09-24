import { Component, type ReactNode } from 'react';

// After a deploy, a phone that still has the old page open asks for code chunks that no longer
// exist. Reload once onto the new version instead of showing a blank screen.
const RELOAD_KEY = 'sak-chunk-reload';
export function isChunkError(e: unknown) {
  const m = String((e as Error)?.message ?? e);
  return /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|error loading dynamically/i.test(m);
}
export function reloadForNewVersion() {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < 30_000) return false; // don't loop
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error(error);
    if (isChunkError(error)) reloadForNewVersion();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-[60dvh] place-items-center p-6 text-center">
        <div className="card max-w-sm p-6">
          <div className="text-4xl">🥅</div>
          <div className="h-display mt-2 text-xl">Something hit the post</div>
          <p className="mt-2 text-sm text-mute">
            {isChunkError(this.state.error) ? 'A new version of the site is out. Reload to get it.' : 'This screen hit an error. Reloading usually fixes it.'}
          </p>
          <p className="mt-2 break-words font-mono text-[11px] text-slate-500">{String(this.state.error.message || this.state.error).slice(0, 200)}</p>
          <button className="btn-primary mt-4 w-full" onClick={() => window.location.reload()}>Reload</button>
          <button className="btn-ghost mt-2 w-full" onClick={() => { this.setState({ error: null }); window.location.hash = '#/'; }}>Go home</button>
        </div>
      </div>
    );
  }
}
