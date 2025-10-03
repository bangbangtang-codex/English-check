# English Check Flashcards

This project provides a local-first spaced-repetition trainer for English vocabulary. It stores your data in IndexedDB (via Dexie), lets you import Excel/CSV files, schedules review sessions with an SM-2 algorithm, and surfaces progress analytics.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later (which includes `npm`)
- Recommended editor: [Visual Studio Code](https://code.visualstudio.com/)

## Getting started in VS Code

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Start the development server**
   ```bash
   npm run dev
   ```
3. **Open the app**
   The terminal will print a local URL such as `http://localhost:5173`. Open it in your browser. Vite provides hot-module reloading, so any code changes you save in VS Code will refresh automatically.

If VS Code prompts you to install recommended extensions (for React, TypeScript, Tailwind CSS), accept them to get IntelliSense and linting.

### Useful npm scripts

| Command         | Purpose                                      |
| --------------- | --------------------------------------------- |
| `npm run dev`   | Start Vite's dev server with hot reload       |
| `npm run build` | Type-check and create an optimized production build |
| `npm run preview` | Preview the production build locally        |
| `npm run lint`  | Run the TypeScript compiler for type checking |

## Project structure

```
English-check/
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.node.json
└── src/
    ├── App.tsx
    ├── index.css
    └── main.tsx
```

- `src/App.tsx` contains the main React component with the spaced-repetition workflow.
- `src/index.css` loads Tailwind CSS utilities and a few global resets.
- `src/main.tsx` bootstraps the React application.

## Importing your study sheets

1. Click **导入 Excel/CSV** in the app.
2. Drop your daily spreadsheet (`YYYY-MM-DD_topic.xlsx`).
3. Review the dedupe summary and confirm the import. The app reports how many cards were new, updated, skipped, or flagged as conflicts.

All vocabulary, review states, and practice logs are stored locally in your browser. Use the **导出备份** button to download a JSON backup regularly.

## Building for production

To create an optimized build (for example, to host the app on a static server):

```bash
npm run build
```

The output is generated in `dist/`. You can serve it with any static host or by running:

```bash
npm run preview
```

which spins up a local server to inspect the production bundle.

## Troubleshooting

- If `npm run dev` fails, ensure you are using Node 18+ and that the dependencies finished installing without errors.
- Clear your browser's IndexedDB data from the application tab if you need a fresh start.
- When importing spreadsheets, confirm they follow the column order: English term, Chinese meaning, IPA (optional), tags (optional), notes (optional).

Happy studying!
