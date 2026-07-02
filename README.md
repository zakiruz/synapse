# Synapse

An Obsidian plugin that makes links first-class citizens. Notes are **atoms**; the connections between them are **bonds** — and a bond is itself a note that carries its own content.

Information that belongs to a *relationship* (credentials for a site, the reason two ideas connect, the history between two people) lives in exactly one place — the bond note — and is rendered automatically at the bottom of **both** endpoint notes. No more copying the same snippet to both ends.

## How it works

A bond is a plain markdown note with frontmatter:

```yaml
---
synapse: bond
atoms:
  - "[[Amazon]]"
  - "[[Password]]"
type: credential
---
login: you@example.com
2FA: authenticator app
```

Open `Amazon.md` or `Password.md` and the bond's content appears in a collapsible **Bonds** section at the bottom of the note. Edit the bond once, both ends update.

Everything is plain markdown — without the plugin, bonds are still ordinary notes that link to both atoms, visible in graph view and search. Nothing is locked in.

## Usage

- **Create bond from current note** (command palette) — fuzzy-pick the other atom(s); the bond note is scaffolded in your bonds folder and opened for editing. **Enter** picks the final atom and creates the bond; **Shift+Enter** adds an atom and keeps picking, so a bond can join any number of atoms.
- Bonds render at the bottom of notes in both reading and editing mode.
- `type` is free-form — let your own taxonomy emerge.
- **Rebuild bond index** — manual refresh if anything looks stale.

## Settings

- **Bonds folder** — where new bond notes are created (default: `Bonds`)
- **Show bonds in notes** — toggle the rendered section
- **Collapse bonds by default** — start bonds folded

## Installation

Until Synapse is in the community plugin browser, install manually: copy `manifest.json`, `main.js`, and `styles.css` into `<your vault>/.obsidian/plugins/synapse/`, then enable it in **Settings → Community plugins**.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # type-check + production build
```

For a live dev loop, symlink this folder into a test vault's `.obsidian/plugins/` and reload the plugin after builds.

## Releasing

```bash
npm version patch   # bumps package.json, manifest.json, versions.json
git push && git push --tags
```

Pushing a tag triggers the GitHub Action, which builds and creates a draft release with `main.js`, `manifest.json`, and `styles.css` attached.

## Roadmap (future brain territory)

- Bond strength — explicit or emergent from traversal
- Custom atom/bond graph view (edges rendered as edges, thick when strong)
- In-place bond editing from the atom's view
