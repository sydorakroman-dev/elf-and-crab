/**
 * Full-screen toggle for the browser: the standard Fullscreen API, with the webkit-prefixed one
 * older iPad Safari uses. iPhones don't allow it for pages (only videos), so `supported` is false
 * there — and when the page already runs full screen from the home screen.
 */
type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = document as WebkitDocument;

/** Launched from the home screen (runs as an app, already full screen). */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * iPhone / iPad — every browser there (Chrome included) runs on Apple's WebKit, whose full screen
 * is a card dismissed by dragging down: joystick drags fold it away. Better: the Home Screen app.
 */
export function isAppleTouch(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function fullscreenSupported(): boolean {
  return !isStandalone() && !isAppleTouch() && !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
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
