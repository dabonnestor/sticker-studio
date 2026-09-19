# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## License

Sticker Studio's source code is released under the [MIT License](LICENSE).

**What you make is yours.** Designs you create with Sticker Studio — stickers,
labels, exports — belong to you, and you may use them for any purpose, including
commercially. The MIT License covers the code; it claims nothing over your output.

**Third-party assets are not covered by it.** The bundled fonts are licensed
under the SIL Open Font License, and their license texts ship in
`public/licenses/`. Artwork you find through the built-in catalog (illustrations
from Pixabay, photographs from Unsplash) stays under those providers' terms — the
MIT License does not extend to it, so if you sell a design containing such
artwork, their terms are the ones that apply.
