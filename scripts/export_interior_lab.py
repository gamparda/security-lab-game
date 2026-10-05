"""Export Interior 05 with 2K runtime textures; the saved master stays untouched.

blender --background MASTER.blend --python scripts/export_interior_lab.py -- runtime-source.glb
Then run runtime-lod.mjs and pack_corporate_lab.py, as for v0.5.1.
"""
import bpy, json, sys
from pathlib import Path

output=Path(sys.argv[sys.argv.index('--')+1]).resolve();output.parent.mkdir(parents=True,exist_ok=True)
scene=bpy.data.scenes['Security_Lab'];bpy.context.window.scene=scene
bpy.ops.object.select_all(action='DESELECT')
selected=[]
for obj in scene.objects:
    if obj.type in {'LIGHT','CAMERA'} or obj.get('superseded_visual_label'):continue
    obj.hide_set(False);obj.select_set(True);selected.append(obj.name)
for mat in bpy.data.materials:
    if not mat.use_nodes:continue
    for bsdf in (n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'):
        normal=bsdf.inputs.get('Normal')
        if normal and normal.is_linked:
            bump=normal.links[0].from_node
            if bump.type=='BUMP' and bump.inputs['Normal'].is_linked:
                mat.node_tree.links.new(bump.inputs['Normal'].links[0].from_socket,normal)
# Resize only this unsaved background process, not the high-quality .blend.
resized=[]
for im in bpy.data.images:
    if not im.size[0] or max(im.size)<=2048:continue
    scale=2048/max(im.size);im.scale(max(1,round(im.size[0]*scale)),max(1,round(im.size[1]*scale)))
    resized.append(im.name)
bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,
    use_active_scene=True,use_visible=False,use_renderable=False,export_extras=True,
    export_apply=True,export_animations=False,export_cameras=False,export_lights=False,
    export_image_format='JPEG',export_jpeg_quality=92,export_image_quality=92,
    export_shared_accessors=True)
print('INTERIOR_EXPORT',json.dumps({'path':str(output),'bytes':output.stat().st_size,'objects':len(selected),'runtimeResizedImages':resized}))
