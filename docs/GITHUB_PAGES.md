# GitHub Pages Notes

`cl-spikeviz` is a static app, so GitHub Pages can serve the repository root without a build step.

## Recommended Pages Setup

1. Keep the app at the repository root.
2. In GitHub repository settings, enable Pages from the main branch root.
3. Use demo URLs for public review:

   ```text
   https://<user>.github.io/<repo>/?demo=1
   https://<user>.github.io/<repo>/?demo=1&view=split&compact=1
   ```

4. Use **Load sample** on the hosted page to review recording replay without Python or a running simulator. The sample file is served from `assets/sample-recording.json`.

5. Document that live simulator mode is best tested from local static hosting:

   ```bash
   python3 -m http.server 8080
   ```

   ```text
   http://127.0.0.1:8080/?host=127.0.0.1&port=1025
   ```

## Live Mode Caveat

GitHub Pages is served over HTTPS. Browsers commonly block insecure `ws://` connections from an HTTPS page. The `cl-sdk` simulator WebSocket server is configured as plain `ws://` in the current public docs/source, so local hosting is the expected reviewer path for live simulator testing.

Demo mode works on GitHub Pages because it does not open WebSocket connections.

Recording replay mode also works on GitHub Pages because snapshots are loaded locally in the browser and the committed sample is a static JSON asset.

## Embed Path

The app does not hardcode a repository segment when generating the iframe snippet. The Copy iframe action uses the current page URL and adds `compact=1`, so a page served from `https://<host>/cl-spikeviz/` produces an iframe URL under that same single `/cl-spikeviz/` segment.
