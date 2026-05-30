# GitHub Pages Notes

`cl-spikeviz` is a static app, so GitHub Pages can serve the repository contents without a build step.

## Recommended Pages Setup

1. Keep the app at the repository root.
2. In GitHub repository settings, enable Pages from the main branch root.
3. Use demo URLs for public review:

   ```text
   https://<user>.github.io/<repo>/?demo=1
   https://<user>.github.io/<repo>/?demo=1&view=split&compact=1
   ```

4. Document that live simulator mode is best tested from local static hosting:

   ```bash
   python3 -m http.server 8080
   ```

   ```text
   http://127.0.0.1:8080/?host=127.0.0.1&port=1025
   ```

## Live Mode Caveat

GitHub Pages is served over HTTPS. Browsers commonly block insecure `ws://` connections from an HTTPS page. The `cl-sdk` simulator WebSocket server is configured as plain `ws://` in the current public docs/source, so local hosting is the expected reviewer path for live simulator testing.

Demo mode works on GitHub Pages because it does not open WebSocket connections.
