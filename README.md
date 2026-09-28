# RepoGuardian — GitHub Intelligence Radar

A polished, browser-only GitHub repository analyzer built for GitHub Pages.

## What it does

Paste a public GitHub repository and get:

- Repository metadata and activity signals
- Stars, forks, issues, license and maintenance age
- Top-level codebase map
- README preview
- Manifest discovery
- Basic dependency coordinate extraction
- OSV vulnerability lookups for versioned packages
- Security/maintenance/documentation signals
- Live API trace showing exactly which public endpoints were queried
- One-click JSON report export
- Responsive desktop/mobile UI
- Dark/light presentation mode
- No backend and no secret API key

## Free public data sources

Core scanning uses:

1. GitHub REST API — public repository metadata, contents and README
2. OSV.dev API — open vulnerability database
3. Browser-native JavaScript — all analysis happens locally

No API key is embedded.

## Deploy

### GitHub Pages

1. Create a new repository.
2. Upload everything in this folder.
3. Go to **Settings → Pages**.
4. Select **Deploy from a branch**.
5. Select `main` and `/ (root)`.
6. Open the generated Pages URL.

Because this is a static site, it can also be hosted on Netlify, Cloudflare Pages, Vercel static hosting, or any ordinary web server.

## Important limitations

GitHub's unauthenticated REST API has rate limits. The scanner intentionally uses public endpoints and does not ask users to paste tokens.

OSV results are advisory intelligence, not a complete security audit. A "clean" result does not prove a repository is secure.

The tool does not claim to prove that no similar repository exists anywhere. The GitHub ecosystem changes continuously.

## Branding

Built for **FAIZAN LABS**.

Signature:
`╰─➤ ⚡ BUILT BY FAIZAN™`
