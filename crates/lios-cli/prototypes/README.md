# CLI help prototype (throwaway)

This is a deliberately throwaway terminal prototype for [issue #3](https://github.com/AllenReder/Lios/issues/3).

## Question

Does the proposed command hierarchy make the first Lios Space, explicit Space Paths, rsync-style transfers, and automation controls understandable without hiding the composable commands an experienced shell user needs?

It has no persistence and does not call ModelScope or the real CLI. It shows one proposed help topic at a time and keeps the relevant command contract visible after every selection.

Run it from the repository root:

```sh
npm run prototype:cli-help
```

Use `1` through `5` to switch views and `q` to quit. The source stays on the `codex/prototype-cli-help` branch after the decision is captured; it is not production code.
