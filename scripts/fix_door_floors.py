"""Remove coplanar door trim and refine entry/server floors from Interior 05.

Run inside Blender. Functional meshes, transforms and pivots remain unchanged.
The source is saved separately as Interior 06, never over the previous master.
"""
import bpy, bmesh, json, hashlib
import numpy as np
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'outputs'/'SecurityLab_Movement_06'
OUT.mkdir(parents=True,exist_ok=True)
scene=bpy.data.scenes['Security_Lab'];bpy.context.window.scene=scene
assert not scene.get('door_floor_fix'), 'Start from the preserved Interior 05 master'
def snapshot():
 return {o.name:([list(r) for r in o.matrix_world],repr(dict(o.items())),
  hashlib.sha256(b''.join(np.array(v.co,dtype=np.float32).tobytes() for v in o.data.vertices)).hexdigest() if o.type=='MESH' else None)
  for o in scene.objects if o.name.startswith(('INTERACT_','DOOR_','COLLIDER_','SPAWN_'))}
before=snapshot()
def boxmesh(obj,boxes,material,bevel=0):
 verts=[];faces=[]
 for lo,hi in boxes:
  x,y,z=lo;X,Y,Z=hi;k=len(verts)
  verts += [(x,y,z),(X,y,z),(X,Y,z),(x,Y,z),(x,y,Z),(X,y,Z),(X,Y,Z),(x,Y,Z)]
  faces += [tuple(k+i for i in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]]
 data=bpy.data.meshes.new(obj.name+'_Clean_Mesh');data.from_pydata(verts,[],faces);data.materials.append(material);data.update()
 bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
 uv=data.uv_layers.new(name='UVMap')
 for p in data.polygons:
  axes=[i for i in range(3) if i!=max(range(3),key=lambda j:abs(p.normal[j]))]
  for li in p.loop_indices:
   co=data.vertices[data.loops[li].vertex_index].co;uv.data[li].uv=(co[axes[0]],co[axes[1]])
 obj.data=data;obj.modifiers.clear()
 if bevel:
  mod=obj.modifiers.new('Frame edge radius','BEVEL');mod.width=bevel;mod.segments=2
  valid=[x.identifier for x in mod.bl_rna.properties['limit_method'].enum_items]
  assert 'ANGLE' in valid;mod.limit_method='ANGLE'
  norm=obj.modifiers.new('Face normals','WEIGHTED_NORMAL');norm.keep_sharp=True

for name in ['DOOR_Main','DOOR_ServerRoom','DOOR_RecordsRoom']:
 root=bpy.data.objects[name];hx,hy,_=root.location;w=float(root['width'])
 y=-10 if name=='DOOR_Main' else 2;depth=.24 if name=='DOOR_Main' else .18
 left=hx-.10;right=hx+w+.10;innerL=hx-.015;innerR=hx+w+.015
 # A three-piece U: legs stop where the lintel starts, so no visible face
 # is doubled. Returns project beyond plaster on both sides of the wall.
 ymin=y-depth/2-.020;ymax=hy-.020
 boxes=[((left,ymin,0),(innerL,ymax,2.30)),((innerR,ymin,0),(right,ymax,2.30)),
        ((left,ymin,2.30),(right,ymax,2.388))]
 boxmesh(bpy.data.objects['ENV_Frame_'+name],boxes,bpy.data.materials['CORP_Powder_Coated_Aluminium'],.002)
 outerL=-.8 if name=='DOOR_Main' else -6 if name=='DOOR_ServerRoom' else 4.6
 outerR=.8 if name=='DOOR_Main' else -4.6 if name=='DOOR_ServerRoom' else 6
 jamb=[]
 for a,b in [(outerL,left),(right,outerR)]:
  if b>a:jamb.append(((a,y-depth/2,0),(b,y+depth/2,2.38)))
 boxmesh(bpy.data.objects['RL_JambDepth_'+name],jamb,bpy.data.materials['RL_Ivory_Painted_Plaster'])

def shader(mat):return next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
def floor_material(name,colour,seed,grout=False):
 source=bpy.data.materials['RL_Grey_Commercial_Terrazzo'];mat=source.copy();mat.name=name
 s=shader(mat)
 for socket in ['Base Color','Normal','Roughness','Metallic']:
  for link in list(s.inputs[socket].links):mat.node_tree.links.remove(link)
 s.inputs['Roughness'].default_value=.82 if grout else .76;s.inputs['Metallic'].default_value=0
 rng=np.random.default_rng(seed);N=1024
 a=np.ones((N,N,4),np.float32);grain=rng.normal(0,.003,(N,N))
 a[:,:,:3]=np.clip(np.array(colour)[None,None,:]+grain[:,:,None],0,1)
 if grout:
  a[:3,:,:3]*=.82;a[-3:,:,:3]*=.82;a[:,:3,:3]*=.82;a[:,-3:,:3]*=.82
 im=bpy.data.images.new(name+'_1K',width=N,height=N,alpha=False);im.pixels.foreach_set(a.ravel())
 types=[x.identifier for x in im.bl_rna.properties['file_format'].enum_items];assert 'PNG' in types;im.file_format='PNG'
 im.filepath_raw=str(OUT/(name+'_1K.png'));im.save();im.pack()
 node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
 uv=mat.node_tree.nodes.new('ShaderNodeUVMap');uv.uv_map='UVMap'
 mat.node_tree.links.new(uv.outputs['UV'],node.inputs['Vector']);mat.node_tree.links.new(node.outputs['Color'],s.inputs['Base Color'])
 if grout:
  # The entry is outside the office AO atlas: do not wrap its edge shadows.
  for node in list(mat.node_tree.nodes):
   if node.type=='GROUP' and node.inputs.get('Occlusion'):mat.node_tree.nodes.remove(node)
 return mat
entry=floor_material('IP06_Entry_Porcelain',(.36,.39,.415),606,True)
server=floor_material('IP06_Server_Antistatic',(.34,.385,.41),607)
for name,mat,period in [('ENV_Floor_Entry',entry,.60),('CORP_Server_Antistatic_Tiles',server,.60)]:
 obj=bpy.data.objects[name];obj.data=obj.data.copy();obj.data.materials.clear();obj.data.materials.append(mat)
 uv=obj.data.uv_layers.get('UVMap') or obj.data.uv_layers.new(name='UVMap')
 for p in obj.data.polygons:
  p.material_index=0;axis=max(range(3),key=lambda i:abs(p.normal[i]));axes=[i for i in range(3) if i!=axis]
  for li in p.loop_indices:
   co=obj.matrix_world@obj.data.vertices[obj.data.loops[li].vertex_index].co
   uv.data[li].uv=(co[axes[0]]/period,co[axes[1]]/period)
assert before==snapshot(), 'Functional geometry changed'
scene['door_floor_fix']='v0.5.3 / unique frame surfaces and quiet technical floors'
path=OUT/'Security_Lab_Interior_06.blend';bpy.ops.wm.save_as_mainfile(filepath=str(path))
(OUT/'source-check.json').write_text(json.dumps({'functionalUnchanged':True,'protectedObjects':len(before),'frames':3,'floors':2,'path':str(path)},indent=2))
print('DOOR_FLOOR_FIX',path)
