# NVIDIA Build — Models page clone

A standalone **React + TypeScript + Vite + Tailwind CSS** clone of
`build.nvidia.com/models`, built to the tokens in `DESIGN.md`.

## Run

```bash
cd nvidia-models-clone
npm install
npm run dev
```

Open the printed `localhost` URL.

## What's implemented

- **Design tokens** wired into `tailwind.config.js` (`nv-bg`, `nv-panel`,
  `nv-green`, badge colors, radii, fonts).
- **Sticky top nav** (logo, links with active green underline, Ctrl K search,
  Login).
- **Page header** (hexagon icon + "Models" + subtitle).
- **Tabs**: *Optimized by NVIDIA* / *Launch from Hugging Face* (Beta).
- **Filter sidebar** (290px): green toggle filters with counts, Use Case
  checkboxes + "Show more", collapsible Inference Providers, sticky
  Reset / Apply footer. Collapses into a drawer below `lg`.
- **Results area**: live result count, centered search, Sort By dropdown,
  responsive card grid, and pagination with items-per-page.
- **Model card**: provider logo, name, blue/purple badges, 2-line clamp,
  tag pills + "+N", metadata row, hover border + green glow.

All data is mock (`src/data/models.ts`); filtering, search, sort and
pagination run against it client-side.

## Structure

```
src/
├─ App.tsx                 state + filtering/sorting/pagination
├─ data/models.ts          mock catalog + filter dimensions
└─ components/
   ├─ TopNav, PageHeader, Tabs
   ├─ FilterSidebar, FilterToggle
   ├─ ResultsArea, ModelCard, Pagination, Badge
   └─ icons.tsx            inline SVG icons
```
