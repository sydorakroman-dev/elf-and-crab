/**
 * Full-screen toggle for the browser: the standard Fullscreen API, with the webkit-prefixed one
 * older iPad Safari uses. iPhones don't allow it for pages (only videos), so `supported` is false
 * there — and when the page already runs full screen from the home screen.
 */
type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = document as WebkitDocument;

export function fullscreenSupported(): boolean {
  const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  return !standalone && !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    else {
      const el = document.documentElement as WebkitElement;
      await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
    }
  } catch {
    // Refused (e.g. not from a tap): nothing to do, the button stays as it was.
  }
}

/** Calls `fn` whenever the page enters or leaves full screen. */
export function onFullscreenChange(fn: (on: boolean) => void): void {
  const handler = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
}
