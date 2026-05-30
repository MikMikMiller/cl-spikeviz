# cl-spikeviz

Этот репозиторий содержит проект [`cl-spikeviz`](./cl-spikeviz), standalone визуализатор
потоков `cl-sdk` для браузера.

- запускать приложение можно из папки [`cl-spikeviz`](./cl-spikeviz) как static site;
- поддерживаются 2D и experimental 3D MEA view;
- есть режимы demo/live и iframe-friendly compact.

## Быстрый старт

```bash
cd cl-spikeviz
python3 -m http.server 8080
```

Открыть:

- демо: `http://127.0.0.1:8080/?demo=1`
- 3D: `http://127.0.0.1:8080/?demo=1&view=3d`
- split: `http://127.0.0.1:8080/?demo=1&view=split&compact=1`

Подробное описание проекта и всех параметров находится в
`cl-spikeviz/README.md`.

## Архитектурные компоненты

Смотри внутри `cl-spikeviz/`:

- `index.html`, `css/style.css`, `js/main.mjs` — интерфейс и состояние;
- `js/ws.mjs`, `js/state.mjs`, `js/protocol.mjs` — источники и парсер;
- `js/raster.mjs`, `js/heatmap.mjs`, `js/waveforms.mjs` — 2D view;
- `js/three-view.mjs` — 3D MEA view (Three.js);
- `tools/run_simulator.py`, `tools/capture_protocol.py` — запуск и диагностика.

## Лицензия

MIT
