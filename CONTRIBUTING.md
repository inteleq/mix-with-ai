# Contributing

Build something useful for another music developer. Good first contributions include clearer examples, accessible interface improvements, integration recipes, and regression tests for the public client.

1. Fork or use the starter as a template.
2. Use Node 22.16+ and run `npm install` for the development tools.
3. Run `npm start` for the no-key preview.
4. Make a focused change and run `npm run verify`.
5. Open a pull request describing the user benefit and how you checked it.

Use mock HTTP responses for tests. Never commit API keys, account details, private prompts, signed download URLs, generated request receipts, or music you do not have permission to share. Tests and CI must not invoke paid generation.

Keep the public client independent: it should only need the documented public HTTP API and standard platform APIs. Keep examples honest about preview versus live behavior and supported outputs.

For larger features, open a proposal first. For a project built with the starter, use the showcase issue template. Be respectful and constructive with other contributors.
