# clinical/tabs — lazy-loaded patient-panel tabs

Files in this folder are bundled into the **`panel-tabs`** Vite chunk
(see `Frontend/vite.config.js`). They're consumed via `React.lazy()`
+ `<Suspense>` from `PatientPanelShell.jsx`, so a user who never opens
a particular tab never pays the network cost for that tab's code.

## Adding a new tab

```jsx
// Frontend/src/Components/clinical/tabs/MyTab.jsx
import React from "react";
export default function MyTab({ patient, admission, ...data }) {
  return (/* tab content */);
}
```

```jsx
// In the panel:
import React, { lazy } from "react";
const MyTab = lazy(() => import("../../Components/clinical/tabs/MyTab"));
// ...
case "mytab": return <MyTab patient={patient} admission={admission} {...data} />;
```

The shell already provides a `<Suspense fallback={spinner}>` boundary
around `renderTab(activeTab)`, so the lazy component "just works".

## Conventions

- **One tab per file**. Keeps chunks granular.
- **Default export** is the tab component. The Vite chunk rule matches
  by path, not by export name.
- **Share helpers** via `Components/clinical/_panel-utils.jsx` (when
  that file lands). Don't reach back into the panel.
- **No back-edges** to the panel's `useState` — pass everything via
  props.
- **Print-mode friendly**. Tabs render the same content whether they
  appear in the interactive panel or the `?mode=print` page.

## Why this matters

Before: `DoctorPatientPanel.js` was a single 50 kB chunk (gzip 12 kB)
that loaded eight tabs the user might never click.

After: each tab is its own ~5–15 kB chunk pulled lazily on first view.
Cumulative page load drops by ~30 kB on a "view Overview only" session.
