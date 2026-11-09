# Hallmark Design Skill

This workspace has the Hallmark design skill configured at `~/.gemini/config/skills/hallmark` and `.agents/skills/hallmark`.

## Principles & Usage

Hallmark is an anti-AI-slop design system that prevents generic AI styling (repetitive glows, purple gradients, cookie-cutter cards) and enforces bespoke, high-craft web UI design.

### Core Rules (The Floor):
1. **Tokens**: Every color and font must use a token declared at `:root` or in the theme block.
2. **Motion**: Never use `transition: all`. Never animate `width`, `height`, `top`, or `left`. All animations must respect `prefers-reduced-motion: reduce`.
3. **Typography**: Clean hierarchy. No italic single-word accents in roman headings. Labels and badges use untracked sentence-case body font, never all-caps tracking.
4. **Layout**: `overflow-x: clip` on `html` and `body`. Container is capped and centered.
5. **No Slop**: No decorative status dots, no emoji icons, no purple-to-blue gradients, no nested card-in-card containers.

### Commands:
- `/hallmark <prompt>`: Design and build a new bespoke page or UI component.
- `/hallmark redesign <path>`: Reskin or redesign existing UI while preserving functional logic.
- `/hallmark audit <path>`: Audit an existing UI against anti-patterns and the Floor.

