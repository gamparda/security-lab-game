# Corporate Interior 05 / v0.5.2

The preserved `assets/authoring/Security_Lab_Corporate_04.blend` is the baseline.
`assets/authoring/Security_Lab_Interior_05.blend` is the new high-quality master.
The runtime is `assets/models/security_lab.glb`; it has its own capped textures,
error-bounded geometry and LOD levels. The original master is unchanged.

Build inside Blender 5.2 using `scripts/interior_polish.py` against Corporate 04.
It saves a separate master in the workspace outputs folder. Export that master
in a background process with `scripts/export_interior_lab.py -- output.glb`.
Then use the existing `scripts/runtime-lod.mjs` and
`scripts/pack_corporate_lab.py` pipeline. `verify_corporate_precision.js` checks
the runtime packing. Image resize affects the unsaved export process only.

The office retains 25 staff seats, one SOC position, two network benches and
six server racks. The 101 functional nodes, their transforms and bindings,
and the exact indexed door/collision surfaces match the v0.5.1 baseline.
Room size, aisles, door sweeps, spawn and interaction approaches are retained.

Office lighting uses a lower neutral ambient, three bounded practical fills
and the unchanged exterior sunset. A single 2K furniture shadow map is baked
at install/context recovery, before visibility culling. It does not update
each frame and excludes moving doors. Static floor contact AO has its own
UV set, separate from the repeating carpet material. Full dynamic shadows,
screen-space GI and real-time monitor area lighting are not implemented.
Software rasterizers retain baked floor AO and skip the hardware shadow map.

Single, dual, ultrawide and laptop desk variants reuse assembly meshes.
Existing scanned stationery, ergonomic chairs, under-desk pedestals and
network equipment are retained. Added hubs, cables, documents, printer stock,
change board, cabinet sleeve colours, rack role labels and ceiling panels
are placed inside existing furniture or against walls/ceiling, without
extending collision footprints. Roughness and restrained sheen distinguish
carpet, upholstery, powder-coated metal, plastic, paper and pale oak.

The v0.5.1 city, panorama, glass, temporal reconstruction, render presets,
LOD/culling algorithms, gameplay, save schema and packaging/CI workflows are
unchanged. The release version is 0.5.2, with the existing main-merge release
trigger. The review captures twelve office views and before/after performance;
small documents remain illustrative rather than fully readable game content.
