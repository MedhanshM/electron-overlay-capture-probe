# electron-overlay-capture-probe

Measures how a transparent, click-through, always-on-top Electron overlay window covering a display behaves on Windows and macOS: its resulting bounds, whether `getDisplayMedia` / `desktopCapturer` capture it (with and without `setContentProtection`), and close-event ordering. Run via the `probe` workflow (workflow_dispatch).
