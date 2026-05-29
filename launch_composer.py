#!/usr/bin/env python3
"""Launch a PAL Composer in a local HTTP server + browser tab.

Eliminates the file:// CORS problem that blocks Google Sheets CSV fetches
when a composer .html is opened by double-clicking.  Picks the first free
port in 8000-8019, serves this folder, opens the chosen composer in the
default browser, and stays alive until Ctrl+C.

Usage:
    python launch_composer.py                                # Scores Composer (default)
    python launch_composer.py "Scores Composer V1.0.html"
    python launch_composer.py "Schedule Composer V1.4.html"

User-facing wrappers in the Navigation folder root:
    launch_tech_scores.bat        --> Scores Composer
    launch_schedule_composer.bat  --> highest-versioned Schedule Composer
"""

from __future__ import annotations

import glob
import http.server
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser


# Hosts the /proxy endpoint is allowed to fetch from.  Keeps the proxy from
# being abusable as a generic open relay if some other process on the box
# manages to make requests to it.  Composer fetches are Google Sheets only.
_PROXY_ALLOWED_HOSTS = {
    "docs.google.com",
    "doc-00-48-sheets.googleusercontent.com",
    "doc-04-48-sheets.googleusercontent.com",
    "doc-08-48-sheets.googleusercontent.com",
    "doc-0c-48-sheets.googleusercontent.com",
    "doc-10-48-sheets.googleusercontent.com",
    "doc-14-48-sheets.googleusercontent.com",
}


def _host_allowed(host: str) -> bool:
    """Allow the static list above plus any *.googleusercontent.com host —
    Google rotates which doc-XX-YY-sheets.googleusercontent.com it redirects
    to, so a strict list would drop legitimate Sheets traffic."""
    if host in _PROXY_ALLOWED_HOSTS:
        return True
    return host.endswith(".googleusercontent.com")


# Set by the /shutdown endpoint so the main thread can exit cleanly.
_shutdown_event = threading.Event()


# Common install locations for Chromium-based browsers on Windows.
# Used by _find_app_browser() to launch the composer in a standalone
# app window (no browser chrome) where window.close() from JavaScript
# is permitted — needed for the composer's Exit button to also close
# the browser tab, not just the terminal.
_APP_BROWSER_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def _find_app_browser() -> str | None:
    """Locate Chrome or Edge for --app mode, or return None to fall back
    to webbrowser.open().  Checks PATH first, then known install paths."""
    for name in ("chrome", "msedge"):
        path = shutil.which(name)
        if path:
            return path
    for cand in _APP_BROWSER_CANDIDATES:
        if cand and os.path.isfile(cand):
            return cand
    return None


def open_in_browser(url: str) -> str:
    """Open `url` in the best available window.

    Tries Chrome/Edge `--app=<url>` first — produces a standalone window
    (no tabs, no URL bar) where the composer's Exit button can call
    window.close() successfully.  Falls back to the OS default browser
    via webbrowser.open() if no Chromium browser is found.

    Returns a short label describing which path was used (for the
    startup banner)."""
    app_browser = _find_app_browser()
    if app_browser:
        try:
            # Per-instance --user-data-dir keeps the app window from
            # piggybacking on the user's normal Chrome session and avoids
            # the "use existing profile" prompt.  MUST live outside the
            # Navigation folder — that folder is OneDrive-synced and
            # Chrome writes ~1000 files / ~170 MB of profile state which
            # OneDrive then bloats the cloud copy with.  Use %LOCALAPPDATA%
            # (Windows local-disk app data, not synced) instead.
            base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
            profile_dir = os.path.join(base, "PAL Composer", "browser_profile")
            os.makedirs(profile_dir, exist_ok=True)
            subprocess.Popen(
                [app_browser, f"--app={url}", f"--user-data-dir={profile_dir}"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            label = "Chrome" if "chrome" in os.path.basename(app_browser).lower() else "Edge"
            return f"{label} (--app mode)"
        except Exception as exc:
            print(f"  (warn) app-mode launch failed: {exc} — falling back to default browser")
    webbrowser.open(url)
    return "default browser"


DEFAULT_FILENAME_GLOB = "Scores Composer V*.html"
PORT_RANGE = range(8000, 8020)


def pick_composer(arg: str | None) -> str:
    """Resolve the composer filename.  If arg is given, use it verbatim.
    Otherwise pick the highest-versioned Scores Composer present."""
    folder = os.path.dirname(os.path.abspath(__file__))
    if arg:
        path = arg if os.path.isabs(arg) else os.path.join(folder, arg)
        if not os.path.exists(path):
            print(f"ERROR: {arg!r} not found", file=sys.stderr)
            sys.exit(1)
        return os.path.basename(path)
    matches = sorted(glob.glob(os.path.join(folder, DEFAULT_FILENAME_GLOB)))
    if not matches:
        print(f"ERROR: no Scores Composer .html found in {folder!r}", file=sys.stderr)
        print(f"       (looked for {DEFAULT_FILENAME_GLOB!r})", file=sys.stderr)
        sys.exit(1)
    return os.path.basename(matches[-1])  # alphabetically last == highest version


def find_free_port() -> int:
    for port in PORT_RANGE:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port in {PORT_RANGE.start}-{PORT_RANGE.stop - 1}")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that suppresses per-request console noise
    and adds a /proxy?url=... endpoint that fetches an upstream URL
    server-side, sidestepping browser CORS entirely."""

    def log_message(self, fmt, *args):  # noqa: A003
        return

    def do_GET(self):  # noqa: N802 — required name for stdlib handler
        path_only = self.path.split("?", 1)[0]
        if path_only == "/proxy":
            return self._handle_proxy()
        if path_only == "/shutdown":
            return self._handle_shutdown()
        return super().do_GET()

    def _handle_shutdown(self) -> None:
        self._send_plain(200, "Server shutting down. You can close this tab.")
        # Signal main thread.  Must happen on a separate thread so this
        # request finishes flushing before serve_forever() actually stops.
        threading.Thread(target=_shutdown_event.set, daemon=True).start()

    def _handle_proxy(self) -> None:
        # Parse target URL from the query string
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        target = (params.get("url") or [""])[0]
        if not target:
            self._send_plain(400, "Missing url= parameter")
            return
        parsed = urllib.parse.urlparse(target)
        if parsed.scheme not in ("http", "https"):
            self._send_plain(400, "Only http/https targets are allowed")
            return
        if not _host_allowed(parsed.hostname or ""):
            self._send_plain(403, f"Host not in allow-list: {parsed.hostname}")
            return
        try:
            req = urllib.request.Request(target, headers={"User-Agent": "PAL-Composer-Launcher/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
                ctype = resp.headers.get("Content-Type", "text/plain; charset=utf-8")
        except Exception as exc:
            self._send_plain(502, f"Upstream fetch failed: {exc}")
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_plain(self, status: int, message: str) -> None:
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    folder = os.path.dirname(os.path.abspath(__file__))
    os.chdir(folder)

    filename = pick_composer(sys.argv[1] if len(sys.argv) > 1 else None)
    port = find_free_port()
    url = f"http://localhost:{port}/{urllib.parse.quote(filename)}"

    httpd = socketserver.TCPServer(("127.0.0.1", port), QuietHandler)
    print()
    print("  PAL Composer Launcher")
    print("  =====================")
    print(f"  Composer : {filename}")
    print(f"  Serving  : {folder}")
    print(f"  URL      : {url}")
    print(f"  Stop server: click Exit in the composer  --or--  Ctrl+C here.")
    print()

    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    browser_label = open_in_browser(url)
    print(f"  Opened in {browser_label}.")

    reason = "shutdown request from browser"
    try:
        # Wait for either Ctrl+C (KeyboardInterrupt) or the /shutdown endpoint.
        while not _shutdown_event.wait(timeout=0.5):
            pass
    except KeyboardInterrupt:
        reason = "Ctrl+C"
    print(f"\n  Stopping server ({reason}).")
    httpd.shutdown()
    httpd.server_close()


if __name__ == "__main__":
    main()
