# v0.5.3 · movement, door frames and floors

Ctrl is hold-to-crouch (1.1m body / 0.95m eye / 1.35m/s movement). Release to
stand when the full 1.8m body has clearance. Shift does not sprint while crouched.
Space starts one grounded jump, with gravity and landing; holding Space does
not auto-repeat. Inputs are accepted only during pointer lock and cleared on
blur/unlock. Pause, tool dialogs and return-to-entry retain their existing roles.

3D entry requests fullscreen and keyboard lock for WASD, so physical Ctrl+W
does not close the Chrome tab while crouch-walking. Esc remains uncaptured;
pause/tool entry releases keyboard lock. Accept Chrome's keyboard permission
when prompted. C is an alternate crouch key in window mode or if permission
is denied. The Chrome test grants this permission explicitly and verifies
fullscreen, capture, and release. Jump count and peak are latched for testing
short jumps on slow CI rendering without depending on a single airborne frame.

Collision uses explicit feet/height for horizontal walls, moving door sweeps,
vertical head impacts and landing on box tops. Physics runs in bounded substeps
with the existing 100ms long-frame cap. No collider or door pivot was moved.

The previous door trim used overlapping boxes and shared coplanar faces with
the plaster returns. Interior 06 replaces the three nonfunctional frames with
nonoverlapping legs/lintels and ends the plaster at their outside edges. The
returns stop 20mm behind each hinge plane. Blender BVH tests at 5-degree steps
through 90 degrees plus the full-open angle found no frame/leaf intersections.
Functional geometry and bindings remain identical to the runtime baseline.

The entry has a quiet 600mm porcelain finish; the server room retains its
raised panel geometry with a muted antistatic finish and contact AO. The old
contrasty terrazzo patterns are removed from these two floors. Office carpet,
city, glass, temporal/presets, LOD and culling remain unchanged.

Authoring: `assets/authoring/Security_Lab_Interior_06.blend`, preserved separately
from Interior 05. Reproduce with `scripts/fix_door_floors.py` in Interior 05,
then the existing interior exporter, runtime LOD, pack and precision verifier.
Runtime: 41,775,284 bytes, 52 embedded images, existing maximum 2K export.
