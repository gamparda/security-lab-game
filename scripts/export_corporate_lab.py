"""Export Corporate 04 from the supplied .blend; never save over the authoring file.

blender --background Security_Lab_Corporate_04.blend --python scripts/export_corporate_lab.py -- output.glb
"""
import bpy
import json
import sys
from pathlib import Path

args = sys.argv[sys.argv.index('--') + 1:]
output = Path(args[0]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes['Security_Lab']
bpy.context.window.scene = scene
bpy.ops.object.select_all(action='DESELECT')
selected = []
for obj in scene.objects:
    if obj.type in {'LIGHT', 'CAMERA'} or obj.get('superseded_visual_label'):
        continue
    obj.hide_set(False)
    obj.select_set(True)
    selected.append(obj.name)

# glTF carries a tangent-space normal map, not Blender's chained procedural
# bump. Keep the scanned normal input directly connected in this export copy.
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    for bsdf in (n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'):
        normal = bsdf.inputs.get('Normal')
        if not normal or not normal.is_linked:
            continue
        bump = normal.links[0].from_node
        if bump.type == 'BUMP' and bump.inputs['Normal'].is_linked:
            src = bump.inputs['Normal'].links[0].from_socket
            mat.node_tree.links.new(src, normal)

# Extras carry the simulation bindings and door bounds. Selection explicitly
# includes hidden collision proxies, but excludes authoring cameras/lights.
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format='GLB', use_selection=True,
    use_active_scene=True, use_visible=False, use_renderable=False,
    export_extras=True, export_apply=True, export_animations=False,
    export_cameras=False, export_lights=False,
    export_image_format='JPEG', export_jpeg_quality=92, export_image_quality=92,
    export_shared_accessors=True,
)
print('CORPORATE_EXPORT', json.dumps({'path': str(output), 'bytes': output.stat().st_size,
                                    'objects': len(selected)}, ensure_ascii=False))
