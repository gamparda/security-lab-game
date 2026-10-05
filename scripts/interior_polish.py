"""Non-destructive Corporate Interior 05 master build. Run inside Blender.

The original Corporate 04 file and functional nodes are never changed on disk.
Shared scanned office assets are reused; the exporter produces a separate copy.
"""
import bpy, bmesh, math, json, hashlib
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'outputs'/'SecurityLab_Interior_Polish'
OUT.mkdir(parents=True,exist_ok=True)
SCENE=bpy.data.scenes['Security_Lab'];bpy.context.window.scene=SCENE
if SCENE.get('interior_polish'):
 raise RuntimeError('Build from the preserved Corporate 04 master, not an already polished scene')
COL=bpy.data.collections.new('Interior_05_Office_Polish')
bpy.data.collections['Security_Lab_Export'].children.link(COL)
CREATED=[]
aliases={'Wood':'RL_Maple_Desk_Veneer','Wall':'RL_Ivory_Painted_Plaster','Floor':'RL_Grey_Commercial_Terrazzo',
 'Carpet':'CORP_Office_Carpet_2K','Fabric':'CORP_Woven_Partition_Fabric_2K','White':'CORP_Office_Warm_White',
 'Powder':'CORP_Powder_Coated_Aluminium','Dark':'LAB_Dark','Rubber':'RL_Rubber_Seal',
 'Steel':'RL_Brushed_Stainless','Metal':'LAB_Metal','Cable':'RL_Cable_Jacket','Ink':'LAB_Ink',
 'Paper':'RL_Paper_Labels','Blue':'LAB_Blue','LED':'LAB_LED','RedLED':'CORP_Amber_Status_LED',
 'BlueCable':'CORP_Cat6_Blue','YellowCable':'CORP_Cat6_Safety_Yellow'}
M={k:bpy.data.materials[v] for k,v in aliases.items()}

def snapshot():
 return {o.name:{'matrix':[list(r) for r in o.matrix_world],'mesh':hashlib.sha256(o.data.name.encode()+b''.join(np.array(v.co,dtype=np.float32).tobytes() for v in o.data.vertices)).hexdigest() if o.type=='MESH' else None,
   'props':repr(dict(o.items()))} for o in SCENE.objects if o.name.startswith(('INTERACT_','DOOR_','COLLIDER_','SPAWN_'))}
before=snapshot()
for name in ['CORP_Wall_Poster_Response','CORP_Wall_Poster_Schedule']:
 o=bpy.data.objects[name];o.data=o.data.copy()
 for loop in o.data.uv_layers.active.data:loop.uv.x=1-loop.uv.x

def shader(m):return next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
def enum(o,p,v):
 values=[x.identifier for x in o.bl_rna.properties[p].enum_items]
 assert v in values,(p,v,values);setattr(o,p,v)
def material(n,c,r=.6,metal=0):
 m=bpy.data.materials.new(n);m.use_nodes=True;s=shader(m)
 s.inputs['Base Color'].default_value=(*c,1);s.inputs['Roughness'].default_value=r
 s.inputs['Metallic'].default_value=metal;m.diffuse_color=(*c,1);return m
def tex(m,im,inp,strength=None,uv=None):
 s=shader(m);nodes=m.node_tree.nodes;links=m.node_tree.links
 for l in list(s.inputs[inp].links):links.remove(l)
 n=nodes.new('ShaderNodeTexImage');n.image=im
 if uv:
  u=nodes.new('ShaderNodeUVMap');u.uv_map=uv;links.new(u.outputs['UV'],n.inputs['Vector'])
 if strength is None:links.new(n.outputs['Color'],s.inputs[inp])
 else:
  a=nodes.new('ShaderNodeNormalMap');a.inputs['Strength'].default_value=strength
  links.new(n.outputs['Color'],a.inputs['Color']);links.new(a.outputs['Normal'],s.inputs[inp])
 return n
def image(n,a,data=False):
 a=np.asarray(a,dtype=np.float32);h,w=a.shape[:2]
 rgba=np.ones((h,w,4),dtype=np.float32);rgba[:,:,:3]=a if a.ndim==3 else a[:,:,None]
 im=bpy.data.images.new(n,width=w,height=h,alpha=False)
 if data:enum(im.colorspace_settings,'name','Non-Color') if im.colorspace_settings.bl_rna.properties['name'].type=='ENUM' else setattr(im.colorspace_settings,'name','Non-Color')
 im.pixels.foreach_set(rgba.ravel());folder=OUT/'textures';folder.mkdir(exist_ok=True)
 im.filepath_raw=str(folder/(n+'.png'));enum(im,'file_format','PNG');im.save();im.pack();return im

# Shared manufacturing helpers, in metres.
class Mesh:
    def __init__(self): self.v,self.f,self.mi,self.mats=[],[],[],[]
    def slot(self,m):
        if m not in self.mats: self.mats.append(m)
        return self.mats.index(m)
    def box(self,center,size,mat):
        x,y,z=center; a,b,c=(v/2 for v in size); k=len(self.v)
        self.v += [(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),(x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)]
        faces=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
        self.f += [tuple(k+i for i in f) for f in faces]; self.mi += [self.slot(mat)]*6
        return self
    def rod(self,start,end,r,mat,sides=12):
        a,b=Vector(start),Vector(end); axis=(b-a).normalized(); helper=Vector((0,0,1)) if abs(axis.z)<.9 else Vector((1,0,0))
        u=axis.cross(helper).normalized(); v=axis.cross(u).normalized(); k=len(self.v)
        self.v += [tuple(center+r*(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides))) for center in [a,b] for i in range(sides)]
        faces=[tuple(k+i for i in reversed(range(sides))),tuple(k+sides+i for i in range(sides))]
        faces += [(k+i,k+(i+1)%sides,k+(i+1)%sides+sides,k+i+sides) for i in range(sides)]
        self.f+=faces; self.mi += [self.slot(mat)]*len(faces)
        return self
    def cable(self,points,r,mat,sides=8):
        for a,b in zip(points,points[1:]): self.rod(a,b,r,mat,sides)
        return self
    def create(self,name,parent=None,bevel=.002,replace=None):
        data=bpy.data.meshes.new(name+'_Mesh'); data.from_pydata(self.v,[],self.f); data.update()
        for mat in self.mats: data.materials.append(mat)
        for p,i in zip(data.polygons,self.mi): p.material_index=i
        bm=bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(data); bm.free()
        obj=replace or bpy.data.objects.new(name,data)
        if replace: obj.data=data
        else: COL.objects.link(obj); obj.parent=parent; CREATED.append(obj.name)
        metre_uv(obj)
        if bevel: add_bevel(obj,bevel)
        return obj

def add_bevel(obj,width=.003):
    if not any(m.type=='BEVEL' for m in obj.modifiers):
        mod=obj.modifiers.new('Manufactured edge radius','BEVEL'); mod.width=width; mod.segments=2; mod.limit_method='ANGLE'; mod.affect='EDGES'; mod.use_clamp_overlap=True
        norm=obj.modifiers.new('Face weighted normals','WEIGHTED_NORMAL'); norm.keep_sharp=True; norm.weight=40

def metre_uv(obj,default=1):
    data=obj.data
    uv=data.uv_layers.active or data.uv_layers.new(name='UVMap')
    for p in data.polygons:
        mat=data.materials[p.material_index] if len(data.materials)>p.material_index else None
        period=3 if mat==M.get('Wall') else 2 if mat==M.get('Floor') else 1
        axis=max(range(3),key=lambda i:abs(p.normal[i])); axes=[i for i in range(3) if i!=axis]
        for li in p.loop_indices:
            co=data.vertices[data.loops[li].vertex_index].co
            uv.data[li].uv=(co[axes[0]]/period,co[axes[1]]/period)

def label(name,text,loc,size=.1,parent=None,mat=None,rotation=(math.pi/2,0,0),center=False):
    font=bpy.data.curves.new(name+'_Text','FONT'); font.body=text; font.size=size; font.extrude=.0004; font.resolution_u=3
    if center: font.align_x='CENTER'
    obj=bpy.data.objects.new(name,font); COL.objects.link(obj); obj.location=loc; obj.rotation_euler=rotation; obj.parent=parent; font.materials.append(mat or M['Ink'])
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active=obj; bpy.ops.object.convert(target='MESH'); obj.select_set(False)
    CREATED.append(name); return obj

def tube(self,points,r,material,sides=12,steps=5):
    points=[Vector(p) for p in points];ext=[points[0]]+points+[points[-1]];line=[]
    for i in range(1,len(ext)-2):
        p0,p1,p2,p3=ext[i-1:i+3]
        for j in range(steps):
            t=j/steps;line.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
    line.append(points[-1]);k=len(self.v)
    for i,p in enumerate(line):
        tangent=(line[min(i+1,len(line)-1)]-line[max(0,i-1)]).normalized()
        helper=Vector((0,0,1)) if abs(tangent.z)<.92 else Vector((1,0,0))
        u=tangent.cross(helper).normalized();v=tangent.cross(u).normalized()
        self.v.extend(tuple(p+r*(u*math.cos(j*math.tau/sides)+v*math.sin(j*math.tau/sides))) for j in range(sides))
    self.f.append(tuple(k+j for j in reversed(range(sides))));self.mi.append(self.slot(material))
    for i in range(len(line)-1):
        for j in range(sides):
            self.f.append((k+i*sides+j,k+i*sides+(j+1)%sides,k+(i+1)*sides+(j+1)%sides,k+(i+1)*sides+j));self.mi.append(self.slot(material))
    self.f.append(tuple(k+(len(line)-1)*sides+j for j in range(sides)));self.mi.append(self.slot(material));return self

def ring(self,center,major,minor,material,axis='Z',segments=32,sides=8):
    x,y,z=center;k=len(self.v)
    for i in range(segments):
        a=i*math.tau/segments
        for j in range(sides):
            b=j*math.tau/sides;rr=major+minor*math.cos(b)
            co=(rr*math.cos(a),rr*math.sin(a),minor*math.sin(b))
            if axis=='Y':co=(co[0],co[2],co[1])
            self.v.append((x+co[0],y+co[1],z+co[2]))
    for i in range(segments):
        for j in range(sides):self.f.append((k+i*sides+j,k+((i+1)%segments)*sides+j,k+((i+1)%segments)*sides+(j+1)%sides,k+i*sides+(j+1)%sides));self.mi.append(self.slot(material))
    return self

def monitor_geo(cx=-.22,cy=.18,cz=1.20,w=.61,h=.355,stand=True):
    m=Mesh().box((cx,cy,cz),(w,.034,h),M['Dark'])
    m.box((cx,cy+.021,cz),(.14,.030,.16),M['Powder'])
    if stand:
        m.rod((cx,cy+.022,.838),(cx,cy+.022,cz-.05),.014,M['Powder'],24)
        m.box((cx,cy+.01,.827),(.24,.16,.025),M['Powder'])
    m.rod((cx+w/2-.026,cy-.018,cz-h/2+.013),(cx+w/2-.026,cy-.02,cz-h/2+.013),.0018,M['LED'],12)
    for j in range(18):m.box((cx-.12+j*.014,cy+.039,cz-.05),(.005,.004,.08),M['Rubber'])
    return m

def keyboard(m,cx=-.22,cy=-.22,z=.824):
    m.box((cx,cy,z),(.425,.145,.023),M['Dark'])
    for row in range(5):
        for k in range(14):
            if row==4 and 3<=k<=8:continue
            m.box((cx-.193+k*.029,cy-.058+row*.025,z+.016),(.025,.021,.010),M['Powder'])
    m.box((cx-.02,cy+.042,z+.016),(.167,.021,.010),M['Powder'])
    for x in [cx-.148,cx-.03,cx+.09]:m.box((x,cy-.05,z+.022),(.006,.0015,.0005),M['Ink'])
    m.tube([(cx,cy+.072,z),(cx,0,.814),(cx+.15,.27,.82),(cx+.3,.38,.65)],.0025,M['Cable'],10,4)
    return m

def tower(m,x=.78,y=.22,z=.36):
    m.box((x,y,z),(.195,.37,.45),M['Powder'])
    m.box((x,y-.188,z),(.183,.008,.433),M['Dark'])
    for j in range(18):m.box((x,y-.193,z-.15+j*.013),(.132,.003,.004),M['Metal'])
    m.rod((x+.055,y-.196,z+.16),(x+.055,y-.198,z+.16),.008,M['Steel'],24)
    m.box((x-.037,y-.196,z+.155),(.032,.005,.009),M['Rubber'])
    m.box((x+.055,y-.20,z+.16),(.003,.001,.002),M['LED'])
    m.tube([(x,y+.19,z+.14),(x+.06,y+.22,z+.05),(x+.07,y+.21,.06),(x+.10,y+.21,.045),(x+.14,y+.05,.07)],.005,M['Cable'],12,5)
    return m
Mesh.tube=tube;Mesh.ring=ring

# Restrained manufactured surfaces; scanned maple stays high-resolution in master.
wood=shader(M['Wood'])
wood.inputs['Roughness'].default_value=.49
for node in M['Wood'].node_tree.nodes:
 if node.type=='TEX_IMAGE' and node.image and ('BaseColor' in node.image.name or 'Diffuse' in node.image.name):
  src=node.image;arr=np.empty(len(src.pixels),dtype=np.float32);src.pixels.foreach_get(arr);arr=arr.reshape(src.size[1],src.size[0],4)
  # Muted pale oak rather than near-white veneer, retaining the scanned grain.
  mean=np.maximum(arr[:,:,:3].mean(axis=(0,1)),.01)
  arr[:,:,:3]=np.clip(arr[:,:,:3]/mean*np.array([.56,.435,.30]),0,1)
  node.image=image('IP05_Pale_Oak_Master',arr[:,:,:3]);break
for k,r,metal in [('Dark',.67,.02),('Powder',.64,.32),('White',.58,.02),('Fabric',.88,0),('Steel',.34,.90),('Paper',.88,0),('Cable',.81,0)]:
 shader(M[k]).inputs['Roughness'].default_value=r;shader(M[k]).inputs['Metallic'].default_value=metal
for m in bpy.data.materials:
 if m.name.startswith('CORP_Display_'):
  shader(m).inputs['Emission Strength'].default_value=.32;shader(m).inputs['Roughness'].default_value=.38
lightmat=bpy.data.materials['LAB_Light'];shader(lightmat).inputs['Emission Strength'].default_value=1.45

# Dense commercial carpet with millimetre fibres and quarter-turn tile variation.
rng=np.random.default_rng(505);N=2048;yy,xx=np.mgrid[:N,:N];u=xx/N;v=yy/N
tilex=(u*2).astype(int);tiley=(v*2).astype(int);turn=(tilex+tiley)%2
fibres=np.sin(np.where(turn==0,xx,yy)*math.tau/3)*.008+rng.normal(0,.007,(N,N))
tones=np.array([[.006,-.004],[-.008,.002]])[tiley.clip(0,1),tilex.clip(0,1)]
carpet=np.clip(np.array([.185,.205,.222])[None,None,:]+(fibres+tones)[:,:,None],0,1)
tex(M['Carpet'],image('IP05_Commercial_Carpet_2K',carpet),'Base Color')
shader(M['Carpet']).inputs['Roughness'].default_value=.92
for n in M['Carpet'].node_tree.nodes:
 if n.type=='NORMAL_MAP':n.inputs['Strength'].default_value=.18
# Carpet throughout office, neutral anti-static floor retained in the server room.
floor=bpy.data.objects['ENV_Floor'];floor.data=floor.data.copy();floor.data.materials.clear();floor.data.materials.append(M['Carpet'])
for p in floor.data.polygons:p.material_index=0
metre_uv(floor)
for n in ['CORP_Commercial_Carpet_Work_Zones']:
 o=bpy.data.objects[n];o['superseded_visual_label']=True;o.hide_render=True

# Bake contact ambient occlusion from unchanged collision footprints, 2K / UV1.
N=2048;yy,xx=np.mgrid[:N,:N];x=-12+24*(xx+.5)/N;y=-10+20*(yy+.5)/N;ao=np.ones((N,N),dtype=np.float32)
for o in SCENE.objects:
 if not o.name.startswith('COLLIDER_'):continue
 pts=[o.matrix_world@Vector(c) for c in o.bound_box];lo=np.min(pts,axis=0);hi=np.max(pts,axis=0)
 if lo[2]>.35 or hi[2]<.12:continue
 dx=np.maximum(np.maximum(lo[0]-x,x-hi[0]),0);dy=np.maximum(np.maximum(lo[1]-y,y-hi[1]),0)
 strength=.34 if 'Desk' in o.name else .28 if 'Chair' in o.name else .26
 ao*=1-strength*np.exp(-(dx*dx+dy*dy)/(.19**2))
ao=np.clip(ao,.30,1);aoim=image('IP05_Contact_AO_2K',ao,True)
from io_scene_gltf2.blender.com.material_helpers import create_settings_group,get_gltf_node_name
group=create_settings_group(get_gltf_node_name())
for m in [M['Carpet'],M['Floor']]:
 n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=aoim
 uv=m.node_tree.nodes.new('ShaderNodeUVMap');uv.uv_map='ContactAO'
 m.node_tree.links.new(uv.outputs['UV'],n.inputs['Vector'])
 g=m.node_tree.nodes.new('ShaderNodeGroup');g.node_tree=group;m.node_tree.links.new(n.outputs['Color'],g.inputs['Occlusion'])
for name in ['ENV_Floor','CORP_Server_Antistatic_Tiles']:
 o=bpy.data.objects[name];o.data=o.data.copy();uv=o.data.uv_layers.get('ContactAO') or o.data.uv_layers.new(name='ContactAO')
 for loop in o.data.loops:
  co=o.matrix_world@o.data.vertices[loop.vertex_index].co;uv.data[loop.index].uv=((co.x+12)/24,(co.y+10)/20)

# Seat variants share complete assemblies; existing functionality lives in roots.
computers=[('Workstation_'+str(i),i) for i in range(1,5)]+[('TRAIN_Computer_%02d'%i,i+1) for i in range(4,13)]+[('CORP_Staff_Computer_%02d'%i,i) for i in range(13,22)]
screens={k:bpy.data.materials['CORP_Display_'+k] for k in ['logs','traffic','incident','alerts','firewall','servers','overview']}
def surface(name,c,w,h,mat,parent=None):
 x,y,z=c;d=bpy.data.meshes.new(name+'_Mesh');d.from_pydata([(x-w/2,y,z-h/2),(x+w/2,y,z-h/2),(x+w/2,y,z+h/2),(x-w/2,y,z+h/2)],[],[(0,1,2,3)])
 d.materials.append(mat);uv=d.uv_layers.new(name='UVMap')
 for i,co in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=co
 o=bpy.data.objects.new(name,d);COL.objects.link(o);o.parent=parent;CREATED.append(name);return o
templates={};variantinfo=[]
for name,num in computers:
 o=bpy.data.objects.get(name)
 if not o:continue
 variant=0 if num==1 else num%4
 if variant not in templates:
  m=Mesh();configs=[(-.22,.18,1.20,.61,.355)] if variant in [0,3] else [(-.47,.20,1.20,.53,.326),(.12,.22,1.20,.53,.326)] if variant==1 else [(-.20,.18,1.20,.84,.345)]
  for cx,cy,cz,w,h in configs:
   q=monitor_geo(cx,cy,cz,w,h);offset=len(m.v);m.v.extend(q.v);m.f.extend(tuple(i+offset for i in f) for f in q.f);m.mi.extend(m.slot(q.mats[i]) for i in q.mi)
  tower(keyboard(m));template=m.create('IP05_Workstation_Template_'+str(variant),bevel=.0012);templates[variant]=(template.data,configs)
  COL.objects.unlink(template);bpy.data.objects.remove(template)
 o.data=templates[variant][0]
 for old in list(SCENE.objects):
  if old.name.startswith(('CORP_Original_Display_','CORP_Training_Display_','CORP_Staff_Display_')) and (old.parent==o or old.parent==o.parent):
   old['superseded_visual_label']=True;old.hide_render=True
 for j,(cx,cy,cz,w,h) in enumerate(templates[variant][1]):
  surface('IP05_Seat_%02d_Screen_%d'%(num,j),(cx,cy-.0182,cz),w-.024,h-.024,screens[['logs','incident','traffic','firewall'][num%4] if j==0 else 'servers'],o)
 variantinfo.append({'name':name,'variant':['single','dual','ultrawide','laptop'][variant],'seat':num})

# Curated small props stay inside desk footprints and reuse manufacture geometry.
notepad=next(o for o in SCENE.objects if o.name.startswith('CORP_Document_') and o.type=='MESH')
paper=material('IP05_Document_Paper',(.72,.705,.65),.89)
teal=material('IP05_Muted_Teal',(.043,.15,.16),.62)
bindermats=[material('IP05_Binder_'+str(i),c,.75) for i,c in enumerate([(.07,.105,.14),(.13,.17,.18),(.24,.245,.23),(.27,.19,.12)])]

def duplicate(src,name,parent,loc,angle=0):
 o=src.copy();o.name=name;COL.objects.link(o);o.parent=parent;o.matrix_parent_inverse=Matrix.Identity(4);o.location=loc;o.rotation_euler=(0,0,angle);o.hide_render=False;o.hide_set(False);CREATED.append(name);return o
def laptop(m,cx=.57,cy=-.13,z=.814):
 m.box((cx,cy,z+.012),(.29,.21,.020),M['Powder']);m.box((cx,cy+.09,z+.12),(.29,.018,.205),M['Dark'])
 for row in range(4):
  for col in range(10):m.box((cx-.125+col*.027,cy-.03+row*.025,z+.026),(.022,.020,.003),M['Dark'])
 m.box((cx,cy-.074,z+.024),(.085,.037,.002),M['Steel']);return m
for name,num in computers:
 o=bpy.data.objects.get(name)
 if not o or num==1:continue
 r=o.parent;m=Mesh();variant=num%4
 # Standalone phone, hub and a gently sagging charger, rather than random clutter.
 if variant==0:
  m.box((.54,-.13,.823),(.085,.16,.009),M['Dark']);m.box((.54,-.13,.829),(.073,.142,.0015),teal)
 elif variant==1:
  m.box((.65,-.10,.825),(.16,.11,.020),M['Powder'])
  for j in range(4):m.box((.596+j*.036,-.157,.828),(.022,.003,.008),M['Dark'])
 elif variant==2:
  duplicate(notepad,'IP05_Open_Notebook_%02d'%num,r,(.60,-.18,.813),-.10)
 else:
  laptop(m);surface('IP05_Laptop_Screen_%02d'%num,(.57,-.051,.934),.263,.177,screens['traffic'],r)
 m.tube([(.50,.33,.82),(.54,.38,.78),(.66,.38,.62),(.73,.31,.64)],.0024,M['Cable'],8,4)
 m.box((.45,.34,.69),(.24,.044,.029),M['White'])
 for j in range(3):m.box((.37+j*.08,.317,.69),(.037,.002,.012),M['Dark'])
 m.tube([(-.22,.21,1.03),(-.14,.33,.85),(.30,.40,.70),(.57,.32,.67)],.0032,M['Cable'],8,5)
 m.create('IP05_Seat_%02d_Managed_Accessories'%num,r,bevel=.0008)

# Individual chair orientation stays inside the original fixed collider.
for o in SCENE.objects:
 if o.name.startswith(('CORP_Staff_Chair_','TRAIN_Chair_','ENV_Chair_')):
  num=int(o.name.rsplit('_',1)[1]);o.rotation_euler.z+=math.radians([-1.4,1.3,.5,-.9][num%4])

# SOC stays the five-screen functional workstation; its screens already differ.
for o in SCENE.objects:
 if o.name=='CORP_SOC_Status_Display':o.data.materials[0]=screens['overview']
 if o.name.startswith('CORP_SOC_Upper_Display_'):o.data.materials[0]=screens['alerts' if o.name.endswith('1') else 'servers']
soc=bpy.data.objects['INTERACT_AdminPC'];m=Mesh()
m.box((.62,-.24,.828),(.22,.17,.025),bindermats[0]);m.box((.62,-.24,.844),(.197,.147,.002),paper)
m.box((-.82,.22,.833),(.13,.095,.034),M['Powder']);m.tube([(-.82,.22,.85),(-.8,.31,.88),(-.50,.32,.84),(-.46,.25,.83)],.0025,M['Cable'],8,5)
m.create('IP05_SOC_Shift_Handover_And_Headset_Hub',soc,bevel=.001)
label('IP05_SOC_Document_Heading','SHIFT HANDOVER / CASE 002',(.515,-.28,.846),.012,soc,mat=M['Dark'],rotation=(0,0,0))

# Shared printer: paper stock and sorter fit within the existing cabinet.
printer=bpy.data.objects['SUPPORT_Printer_Cabinet'];m=Mesh()
for j in range(3):
 m.box((-.40,.17,.77+j*.038),(.28,.22,.025),paper)
 m.box((-.40,.17,.787+j*.038),(.22,.15,.002),M['White'])
m.box((.42,.17,.86),(.22,.28,.10),bindermats[2]);m.box((.42,.024,.86),(.16,.001,.045),paper)
m.create('IP05_Printer_Paper_Stock_And_Recycling_Tray',printer,bevel=.001)
label('IP05_Printer_Stock_Label','A4 / SHARED',(.34,.022,.862),.014,printer,mat=M['Dark'])

# Archive binders retain shared meshes, with restrained sleeve colour variations.
for i,o in enumerate([o for o in SCENE.objects if o.name.startswith(('CORP_Shared_Binder_','RL_Binder_'))]):
 o.data=o.data.copy()
 for j,m in enumerate(o.data.materials):
  if m.name=='LAB_Blue':o.data.materials[j]=bindermats[i%4]

# Purposeful wall information: a response / change-control board on the east wall.
board=Mesh().box((11.855,-2.05,1.97),(.025,1.25,.89),M['Powder'])
board.box((11.833,-2.05,1.97),(.009,1.21,.85),paper)
for j,c in enumerate([-.43,-.05,.33]):
 board.box((11.826,-2.05+c,2.02),(.002,.29,.50),M['White'])
 for k in range(5):board.box((11.824,-2.05+c,2.17-k*.074),(.001,.25,.012),bindermats[j])
board.create('IP05_Change_Control_And_Response_Board',bevel=.002)
for y,t in [(-2.48,'RESPONSE'),(-2.10,'CHANGES'),(-1.72,'ON CALL')]:
 label('IP05_Board_Title_'+t,t,(11.820,y,2.315),.039,mat=M['Dark'],rotation=(math.pi/2,0,-math.pi/2),center=True)

# Ceiling service access, trim housings and exit-side thermostat, all outside aisles.
ceil=Mesh()
for x,y in [(-1.8,-4.9),(5.4,-1.9),(-7.8,6.3)]:
 ceil.box((x,y,3.352),(.54,.54,.028),M['White']);ceil.box((x,y,3.330),(.49,.49,.005),M['Powder'])
 ceil.box((x,y,3.326),(.476,.476,.003),M['White']);ceil.box((x+.18,y-.18,3.321),(.036,.018,.006),M['Steel'])
ceil.create('IP05_Ceiling_Service_Panels',bevel=.001)
wall=Mesh().box((11.86,-8,1.4),(.032,.12,.14),M['White'])
wall.box((11.838,-8,1.425),(.012,.091,.051),teal)
wall.create('IP05_Facility_Thermostat',bevel=.002)

# The racks already have front/rear ports, PDU and six populated 42U assemblies.
# Role labels distinguish them without adding duplicated heavy equipment.
for i in range(6):
 o=bpy.data.objects.get('CORP_Rack_%02d_Service'%i)
 if o:o['superseded_visual_label']=True;o.hide_render=True
 rack=bpy.data.objects['ServerRack_%02d'%(i+1)]
 label('IP05_Rack_%02d_Role'%i,['COMPUTE / A','STORAGE / B','NETWORK / C','BACKUP / D','VIRTUALIZATION / E','MIXED / F'][i],(0,-.484,2.114),.027,rack,M['Ink'],center=True)

# Blender preview lighting follows the neutral office / cool server hierarchy.
for o in SCENE.objects:
 if o.type=='LIGHT' and o.data.type=='AREA':
  o.data.energy*=.66
  if 'Server' in o.name:o.data.color=(.79,.88,1)
  elif 'SOC' in o.name:o.data.energy*=.73
SCENE.view_settings.exposure=-.35
bpy.context.view_layer.update();after=snapshot()
assert before==after,'A functional interface changed'
SCENE['interior_polish']='Corporate Interior 05 / v0.5.2'
SCENE['runtime_lighting']='Neutral office, cool server, restrained SOC; baked static contact AO'
report={'master':str(OUT/'Security_Lab_Interior_05.blend'),'createdObjects':sum(n in SCENE.objects for n in CREATED),'seatVariants':variantinfo,
 'protectedNodes':len(before),'protectedUnchanged':before==after,'textures':['2K commercial carpet','2K baked contact AO','scanned pale oak master'],
 'createdNames':CREATED}
(OUT/'master-build.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Security_Lab_Interior_05.blend'))
print('INTERIOR_MASTER_READY',json.dumps({k:v for k,v in report.items() if k not in ['seatVariants','createdNames']}))
