# Included third-party resources

- Three.js 0.186.1: [official repository](https://github.com/mrdoob/three.js), MIT. The complete license is `vendor/three/LICENSE`. GLTFLoader, PointerLockControls, BufferGeometryUtils and SkeletonUtils are from the same pinned version. Only bare module imports were changed to local relative paths; `npm run vendor` reproduces that change.
- [Painted Concrete 02](https://polyhaven.com/a/painted_concrete_02), Rob Tuytel / Poly Haven, CC0. The 1K diffuse, roughness and OpenGL normal maps are in `assets/authoring`, embedded in the GLB. Downloaded through the connected Poly Haven integration in Blender. Attribution is included for provenance although CC0 does not require it.
- All lab geometry, signage and the 512 px monitor screen were authored specifically for this project in Blender. No remote resource is required while playing.
