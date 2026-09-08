# Vendored WebAR runtime (do not hand-edit the .js files)

- `mindar-image-three.prod.js` + `controller-mGt1s8dJ.js` + `ui-fBadYuor.js`
  are verbatim copies of **mind-ar@1.2.5** `dist/` (MIT), except the bare
  `three` specifiers were rewritten to relative paths (see below).
- `three.module.js` is a verbatim copy of **three@0.149.0**
  `build/three.module.js` (MIT).
- `CSS3DRenderer.js` is a verbatim copy of three@0.149.0
  `examples/jsm/renderers/CSS3DRenderer.js`, with `from 'three'` rewritten
  to `from './three.module.js'`.

Why vendored: mind-ar's npm `dependencies` include the native `canvas`
package, which cannot build on Vercel (no prebuilt binary for its Node
runtime, no system libs for source compile) and breaks `npm install`.
The browser bundle never needs canvas — its `require("fs")` /
`require("string_decoder")` calls sit behind `IS_NODE` runtime guards.

three is pinned pre-0.152 because mind-ar 1.2.5 imports `sRGBEncoding`
(removed in newer three).

To upgrade: copy the new dist files + three build here, re-apply the two
specifier rewrites, and update `ArExperience.tsx` + this note.
