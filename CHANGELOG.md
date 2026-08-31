# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Neo Canvas
- Rebranded the application as **Neo Canvas — AI Packaging & Creative OS**.
- Added packaging-design workflow roles on top of the existing node system: Reference, Prompt, Generation, and Output.
- Added Favorites and Jobs workflow panels, curation metadata, Selected Output, and basic generation cost tracking.
- Added batch image generation presets including 1 / 4 / 8 / 16 / 36.
- Added a Windows Electron desktop shell with bundled Creative Director / Canvas Agent runtime.
- Added a token-protected localhost API proxy in the Electron main process so desktop AI requests can use OpenAI-compatible relay APIs without requiring browser CORS support while keeping Chromium `webSecurity` enabled.
- Added channel **Ping API** testing with latency and model-count feedback before saving a provider.
- Expanded model discovery compatibility for common relay response envelopes (`data`, `models`, `items`, nested `result`, and common model id/name fields).
- Improved automatic image capability detection for modern creative image model names including Banana, Qwen Image, Wan Image, Ideogram, Recraft, Firefly, Kolors, HiDream, Jimeng, and Doubao Image.

