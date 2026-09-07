# Changelog

## 0.2.0 — 2026-09-07

- Create local workspaces with an optional name and directory from the remote.
- Add terminal tabs beside the selected terminal using explicit pane UUIDs.
- Initialize background terminals without focus or input and verify their text is readable.
- Open confirmed creations in the remote while preserving previous drafts and Mac focus.
- Keep uncertain creation results visible without replaying requests automatically.

## 0.1.0 — 2026-09-07

This release develops the viewer from upstream commit
`f7640fb61e966dc7d30b9dca6b33e92ccf399aa8` into a private terminal companion.

- English interface, accessible labels, diagnostics, and documentation.
- Compact Tabler controls, workspace search, and local terminal selection.
- Text and original-layout views, 6–20 px font settings, and frozen history while reading.
- One-request command submission, strict versioned messages, and explicit recovery
  after uncertain input delivery.
- Portable startup, diagnostics, and optional background-operation guidance.
- Frozen workspace dependencies, automated checks, CI, and source release packaging.
