"""Blender 5.x authoring script. Adds a separate scene; never deletes an existing project.

Run with Blender --background --python this_file.py -- output.glb source.blend.
The same functions are used through the live Blender MCP connection.
All textures are original, deterministic and embedded. Dimensions are metres.
"""
import bpy
import bmesh
import numpy as np
import math
import json
import sys
from pathlib import Path
from mathutils import Vector

SCENE = None
COL = None
M = {}


def material(name, rgb, roughness=.6, metallic=0, emission=0, alpha=1):
    mat = bpy.data.materials.new('LAB_' + name)
    mat.use_nodes = True
    mat.diffuse_color = (*rgb, alpha)
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*rgb, alpha)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Alpha'].default_value = alpha
    if emission:
        shader.inputs['Emission Color'].default_value = (*rgb, 1)
        shader.inputs['Emission Strength'].default_value = emission
    if alpha < 1:
        mat.surface_render_method = 'BLENDED'
    M[name] = mat
    return mat


def texture(mat, name, base, size=1024, mode='noise'):
    rng = np.random.default_rng(81)
    yy, xx = np.mgrid[:size, :size]
    noise = rng.normal(0, .012, (size, size, 1))
    pixels = np.ones((size, size, 4), dtype=np.float32)
    pixels[:, :, :3] = np.clip(np.array(base)[None, None, :] + noise, 0, 1)
    if mode == 'floor':
        seams = (xx < 3) | (yy < 3)
        pixels[seams, :3] *= .66
    if mode == 'screen':
        pixels[:, :, :3] = (.012, .035, .05)
        pixels[440:476, 28:484, :3] = (.035, .23, .3)
        for row in range(15):
            y = 390 - row * 22
            for col in range(7):
                x = 30 + col * 59
                width = int(rng.integers(20, 49))
                pixels[y:y+5, x:x+width, :3] = (.07, .58, .42) if col % 3 else (.06, .29, .36)
        pixels[38:63, 34:190, :3] = (.04, .38, .31)
    image = bpy.data.images.new('LAB_' + name, width=size, height=size, alpha=True)
    image.colorspace_settings.name = 'sRGB'
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    mat.node_tree.links.new(node.outputs['Color'], shader.inputs['Base Color'])
    if mode == 'screen':
        mat.node_tree.links.new(node.outputs['Color'], shader.inputs['Emission Color'])
        shader.inputs['Emission Strength'].default_value = .65


class Mesh:
    def __init__(self):
        self.vertices, self.faces, self.indices, self.materials = [], [], [], []

    def slot(self, mat):
        if mat not in self.materials:
            self.materials.append(mat)
        return self.materials.index(mat)

    def box(self, center, size, mat):
        x, y, z = center
        a, b, c = (v / 2 for v in size)
        start = len(self.vertices)
        self.vertices += [(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),
                          (x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)]
        for face in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
            self.faces.append(tuple(start + i for i in face))
            self.indices.append(self.slot(mat))
        return self

    def rod(self, start, end, radius, mat, sides=8):
        a, b = Vector(start), Vector(end)
        axis = (b-a).normalized()
        helper = Vector((0,0,1)) if abs(axis.z) < .9 else Vector((1,0,0))
        u, v = axis.cross(helper).normalized(), axis.cross(axis.cross(helper)).normalized()
        offset = len(self.vertices)
        for center in [a,b]:
            for i in range(sides):
                p = center + radius * (u * math.cos(i*2*math.pi/sides) + v * math.sin(i*2*math.pi/sides))
                self.vertices.append(tuple(p))
        faces = [tuple(offset+i for i in reversed(range(sides))), tuple(offset+sides+i for i in range(sides))]
        faces += [(offset+i,offset+(i+1)%sides,offset+(i+1)%sides+sides,offset+i+sides) for i in range(sides)]
        self.faces += faces
        self.indices += [self.slot(mat)] * len(faces)
        return self

    def create(self, name, parent=None, location=(0,0,0)):
        data = bpy.data.meshes.new(name + '_Mesh')
        data.from_pydata(self.vertices, [], self.faces)
        for mat in self.materials:
            data.materials.append(mat)
        for p, index in zip(data.polygons, self.indices):
            p.material_index = index
        # Dominant-axis, metre-based UVs, including all sides of actual geometry.
        uv = data.uv_layers.new(name='UVMap')
        for p in data.polygons:
            axis = max(range(3), key=lambda i: abs(p.normal[i]))
            axes = [i for i in range(3) if i != axis]
            for li in p.loop_indices:
                co = data.vertices[data.loops[li].vertex_index].co
                uv.data[li].uv = (co[axes[0]], co[axes[1]])
        data.update()
        obj = bpy.data.objects.new(name, data)
        COL.objects.link(obj)
        obj.parent = parent
        obj.location = location
        return obj


def box(name, center, size, mat, parent=None):
    return Mesh().box(center, size, mat).create(name, parent)


def root(name, location, **extras):
    obj = bpy.data.objects.new(name, None)
    COL.objects.link(obj)
    obj.location = location
    for k,v in extras.items():
        obj[k] = v
    return obj


def collider(name, center, size):
    obj = box('COLLIDER_' + name, center, size, M['Collider'])
    obj['collision'] = True
    obj.hide_render = True
    obj.display_type = 'WIRE'
    return obj


def label(name, text, location, size=.22, parent=None, mat='Ink', rotation=(math.pi/2,0,0)):
    font = bpy.data.curves.new(name + '_Text', 'FONT')
    font.body, font.size, font.extrude = text, size, .0008
    obj = bpy.data.objects.new(name, font)
    COL.objects.link(obj)
    obj.location, obj.rotation_euler, obj.parent = location, rotation, parent
    font.materials.append(M[mat])
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return obj


def setup():
    global SCENE, COL
    SCENE = bpy.data.scenes.new('Security_Lab')
    bpy.context.window.scene = SCENE
    SCENE.unit_settings.system, SCENE.unit_settings.scale_length = 'METRIC', 1
    COL = bpy.data.collections.new('Security_Lab_Export')
    SCENE.collection.children.link(COL)
    material('Floor',(.22,.26,.29),.86)
    material('Wall',(.64,.69,.7),.88)
    material('Blue',(.07,.16,.21),.58,.12)
    material('Metal',(.26,.3,.33),.36,.7)
    material('Dark',(.018,.029,.038),.48,.35)
    material('Wood',(.33,.21,.12),.69)
    material('Ink',(.7,.81,.82),.7)
    material('Amber',(.75,.38,.075),.6)
    material('LED',(.05,.66,.39),.32,0,2)
    material('Light',(.82,.91,1),.3,0,2)
    material('Screen',(.025,.07,.09),.45)
    material('Glass',(.22,.46,.55),.18,.05,alpha=.22)
    material('Collider',(.9,.1,.1))
    texture(M['Floor'],'Floor_Concrete_1K',(.30,.34,.37),mode='floor')
    texture(M['Screen'],'Screen_Status_512',(.03,.09,.1),512,'screen')
    SCENE['authoring'] = 'Original Blender metre-scale security lab; no existing scenes modified.'


def wall(name, center, size):
    box('ENV_Wall_' + name, center, size, M['Wall'])
    collider('Wall_' + name, center, size)
    x,y,z = center
    sx,sy,sz = size
    if z - sz/2 < .05:
        box('ENV_Skirting_' + name,(x,y,.12),(sx+.014,sy+.014,.24),M['Blue'])


def door(name, hinge, width=1.24, angle=95):
    obj = root(name,hinge,openAngleDegrees=angle,interaction='door',label='출입문',width=width,height=2.3)
    mesh = Mesh()
    mesh.box((width/2,0,1.15),(width,.065,2.27),M['Blue'])
    mesh.box((width/2,-.037,1.62),(width-.23,.014,.68),M['Glass'])
    for x in [.09,width-.09]:
        mesh.box((x,-.046,1.62),(.035,.02,.78),M['Metal'])
    for z in [1.23,2.01]:
        mesh.box((width/2,-.046,z),(width-.15,.02,.035),M['Metal'])
    for y in [-.095,.095]:
        mesh.rod((width-.18,y,1.02),(width-.18,y,1.19),.014,M['Metal'])
        mesh.rod((width-.18,0,1.15),(width-.18,y,1.15),.02,M['Metal'])
    for z in [.3,1.15,2.05]:
        mesh.rod((.01,0,z-.06),(.01,0,z+.06),.022,M['Metal'])
    mesh.create(name+'_Leaf',obj)
    obj['collisionBounds'] = [0,-.06,0,width,.06,2.29]
    # Frame sits outside the leaf with 15 mm clearance; no threshold obstruction.
    x,y,z = hinge
    frame = Mesh()
    frame.box((x-.052,y,1.18),(.075,.17,2.36),M['Metal'])
    frame.box((x+width+.052,y,1.18),(.075,.17,2.36),M['Metal'])
    frame.box((x+width/2,y,2.34),(width+.18,.17,.08),M['Metal'])
    frame.create('ENV_Frame_'+name)
    return obj


def shell():
    box('ENV_Floor',(0,0,-.12),(24,20,.24),M['Floor'])
    box('ENV_Floor_Entry',(0,-11.5,-.12),(4.4,3,.24),M['Floor'])
    wall('North',(0,10,1.7),(24,.24,3.4))
    wall('East',(12,0,1.7),(.24,20,3.4))
    # West window band is a real opening with transparent glazing and mullions.
    wall('West_Lower',(-12,0,.58),(.24,20,1.16))
    wall('West_Upper',(-12,0,3.02),(.24,20,.76))
    box('ENV_Window_West',(-12,0,1.9),(.035,19.7,1.45),M['Glass'])
    collider('West_Window',(-12,0,1.9),(.24,20,1.45))
    frames = Mesh()
    for y in range(-10,11,2):
        frames.box((-11.98,y,1.9),(.12,.075,1.56),M['Metal'])
    for z in [1.14,2.66]:
        frames.box((-11.98,0,z),(.12,20,.06),M['Metal'])
    frames.create('ENV_Window_Frames')
    wall('South_Left',(-6.4,-10,1.7),(11.2,.24,3.4))
    wall('South_Right',(6.4,-10,1.7),(11.2,.24,3.4))
    wall('South_Header',(0,-10,2.89),(1.6,.24,1.02))
    door('DOOR_Main',(-.64,-9.86,0),1.28,100)
    for x in [-2.2,2.2]:
        wall('Entry_' + str(x),(x,-11.5,1.7),(.18,3,3.4))
    wall('Entry_Back',(0,-13,1.7),(4.4,.18,3.4))
    # Server suite glass partition: clear 1.4 m passage, no full wall across it.
    wall('Partition_Left',(-9,2,.55),(6,.18,1.1))
    wall('Partition_Center',(0,2,.55),(9.2,.18,1.1))
    wall('Partition_RecordRight',(9,2,.55),(6,.18,1.1))
    box('ENV_Glass_Server_Left',(-9,2,2.13),(6,.035,2.06),M['Glass'])
    box('ENV_Glass_Server_Center',(0,2,2.13),(9.2,.035,2.06),M['Glass'])
    box('ENV_Glass_Server_RecordRight',(9,2,2.13),(6,.035,2.06),M['Glass'])
    collider('Partition_Left_Upper',(-9,2,2.13),(6,.18,2.06))
    collider('Partition_Center_Upper',(0,2,2.13),(9.2,.18,2.06))
    collider('Partition_RecordRight_Upper',(9,2,2.13),(6,.18,2.06))
    wall('Partition_Header',(-5.3,2,2.89),(1.4,.18,1.02))
    wall('Server_Divider',(-2,6,1.7),(.18,8,3.4))
    partition = Mesh()
    for x in [-12,-10,-8,-6,-4.6,-2,0,2,4,6,8,10,12]:
        partition.box((x,2,2.14),(.055,.075,2.08),M['Metal'])
    partition.box((0,2,3.2),(24,.12,.13),M['Blue'])
    partition.create('ENV_Partition_Frames')
    door('DOOR_ServerRoom',(-5.94,2.12,0),1.28,95)
    wall('Records_Header',(5.3,2,2.89),(1.4,.18,1.02))
    door('DOOR_RecordsRoom',(4.66,2.12,0),1.28,95)
    ceiling = Mesh()
    for x in range(-11,12,2):
        for y in range(-9,10,2):
            ceiling.box((x,y,3.44),(1.97,1.97,.08),M['Wall'])
    ceiling.create('ENV_Ceiling')
    box('ENV_Ceiling_Entry',(0,-11.5,3.44),(4.4,3,.08),M['Wall'])
    fixtures = Mesh()
    for x in [-8,-3,3,8]:
        for y in [-6,-1,6]:
            fixtures.box((x,y,3.32),(1.7,.32,.09),M['Dark'])
            fixtures.box((x,y,3.265),(1.58,.25,.023),M['Light'])
    fixtures.create('ENV_Lights')
    trim = Mesh()
    for y in [-8.4,1.6,9.3]:
        trim.box((0,y,.004),(22,.045,.008),M['Amber'])
    trim.create('ENV_Floor_Safety_Lines')
    root('SPAWN_Player',(0,-11.7,0),eyeHeight=1.65,bodyHeight=1.8,yaw=0)
    label('ENV_Sign_Entry','SECURITY LAB',(-1.35,-9.82,2.65),.3)
    label('ENV_Sign_Server','01 / SERVER SUITE',(-11,1.88,2.8),.29)
    label('ENV_Sign_Archive','03 / RECORDS',(.4,1.88,2.8),.29)


def rack_mesh():
    mesh = Mesh()
    # Open construction, rack rails, vented modules and individual patch leads.
    for x in [-.32,.32]:
        for y in [-.45,.45]:
            mesh.box((x,y,1.1),(.06,.06,2.2),M['Dark'])
    for z in [.05,2.15]:
        mesh.box((0,0,z),(.72,1,.10),M['Dark'])
    mesh.box((-.35,0,1.1),(.035,.92,2.08),M['Blue'])
    mesh.box((.35,0,1.1),(.035,.92,2.08),M['Blue'])
    for row in range(10):
        z = .24 + row * .175
        mesh.box((0,0,z),(.59,.84,.14),M['Metal'])
        mesh.box((0,-.435,z),(.59,.028,.14),M['Dark'])
        for x in [-.245,.245]:
            mesh.rod((x,-.468,z-.037),(x,-.468,z+.037),.009,M['Metal'])
        for col in range(7):
            x = -.17 + col * .043
            mesh.box((x,-.456,z),(.020,.01,.038),M['Blue'])
        mesh.box((.215,-.458,z),(.023,.01,.014),M['LED'])
        if row % 3 == 0:
            for col in range(3):
                x = -.18 + col * .075
                mesh.rod((x,-.46,z),(x,-.52,z-.06),.007,M['Amber'])
                mesh.rod((x,-.52,z-.06),(.27,-.53,z-.1),.007,M['Amber'])
    mesh.box((0,-.457,2.02),(.56,.035,.11),M['Blue'])
    return mesh


def monitor(mesh, x=0, y=0):
    mesh.box((x,y,1.26),(.63,.067,.41),M['Dark'])
    mesh.box((x,y-.039,1.27),(.565,.009,.335),M['Screen'])
    mesh.box((x,y,.93),(.045,.065,.24),M['Metal'])
    mesh.box((x,y-.02,.805),(.26,.2,.025),M['Dark'])
    mesh.box((x,y-.37,.817),(.42,.17,.035),M['Dark'])
    for row in range(4):
        for col in range(12):
            mesh.box((x-.188+col*.034,y-.423+row*.034,.84),(.025,.024,.008),M['Metal'])
    mesh.box((x+.34,y-.34,.823),(.065,.1,.037),M['Dark'])


def chair_mesh():
    m = Mesh()
    m.box((0,0,.47),(.48,.48,.08),M['Dark'])
    m.box((0,.23,.8),(.48,.075,.5),M['Blue'])
    m.rod((0,0,.12),(0,0,.45),.035,M['Metal'])
    for i in range(5):
        x,y = .29*math.cos(i*2*math.pi/5),.29*math.sin(i*2*math.pi/5)
        m.rod((0,0,.14),(x,y,.10),.018,M['Metal'])
        m.rod((x-.028,y,.064),(x+.028,y,.064),.035,M['Dark'])
    for x in [-.26,.26]:
        m.rod((x,0,.46),(x,0,.69),.012,M['Metal'])
        m.box((x,-.02,.7),(.06,.3,.037),M['Dark'])
    return m


def props():
    rack_root = root('INTERACT_ServerRack',(-8,5,0),interaction='terminal',label='자료 서버 / 가상 터미널')
    original = rack_mesh().create('ServerRack_01',rack_root)
    for i,(x,y) in enumerate([(0,0),(1.2,0),(2.4,0),(0,3),(1.2,3),(2.4,3)]):
        obj = original if i == 0 else bpy.data.objects.new('ServerRack_'+str(i+1).zfill(2),original.data)
        if i:
            COL.objects.link(obj)
            obj.parent = rack_root
        obj.location = (x,y,0)
        collider('Rack_'+str(i),(-8+x,5+y,1.1),(.74,1,2.2))
    label('ServerRack_Label','CLUB-SERVER',(-.25,-.482,1.98),.055,rack_root)
    chair = None
    for i,(x,y) in enumerate([(-5,-3),(-8.5,-6),(4,-6),(8,-6)]):
        desktop = Mesh()
        desktop.box((0,0,.77),(2.1,.95,.07),M['Wood'])
        for a in [-.9,.9]:
            desktop.box((a,0,.38),(.07,.8,.76),M['Metal'])
        desktop.box((0,.32,.32),(1.82,.025,.37),M['Blue'])
        name = 'INTERACT_AdminPC' if i == 0 else 'ENV_Desk_'+str(i+1).zfill(2)
        group = root(name,(x,y,0),interaction='admin' if i == 0 else '',label='관리 PC / 조사 도구' if i == 0 else '')
        desktop.create('Desk_'+str(i+1),group)
        device = Mesh()
        monitor(device, -.22,.2)
        device.box((.71,.23,.27),(.25,.43,.48),M['Dark'])
        for z in [.15,.2,.25,.3,.35]:
            device.box((.71,-.001,z),(.18,.014,.006),M['Metal'])
        device.box((.76,-.01,.42),(.012,.01,.012),M['LED'])
        device.create('Workstation_'+str(i+1),group)
        collider('Desk_'+str(i),(x,y,.75),(2.13,.98,1.5))
        if chair is None:
            chair = chair_mesh().create('ENV_Chair_01',location=(x,y-1.05,0))
            chair.rotation_euler.z = math.pi
        else:
            copy = bpy.data.objects.new('ENV_Chair_'+str(i+1).zfill(2),chair.data)
            COL.objects.link(copy)
            copy.location,copy.rotation_euler.z = (x,y-1.05,0),math.pi
        collider('Chair_'+str(i),(x,y-1.05,.5),(.55,.58,1.05))
    label('Admin_Label','02 / OPERATIONS',(-5.8,-2.65,1.61),.14)
    router = root('INTERACT_Router',(7,-2,0),interaction='settings',label='네트워크 장비 / 방어 설정')
    network = Mesh()
    network.box((0,0,.77),(2.4,1.1,.08),M['Wood'])
    for x in [-1.05,1.05]:
        network.box((x,0,.38),(.08,1,.76),M['Metal'])
    for row in range(3):
        z = .87+row*.115
        network.box((0,.10,z),(1.35,.60,.09),M['Blue'] if row == 2 else M['Metal'])
        for i in range(16):
            x = -.57+i*.074
            network.box((x,-.212,z),(.05,.02,.036),M['Dark'])
            network.box((x,-.23,z+.026),(.01,.012,.008),M['LED'])
            if i % 4 == 0:
                network.rod((x,-.245,z),(x,-.4,z-.035),.008,M['Amber'])
    for x in [-.53,.53]:
        network.rod((x,.25,1.16),(x,.27,1.53),.012,M['Dark'])
    network.create('Router_Switch_Firewall',router)
    collider('Network_Bench',(7,-2,.75),(2.43,1.13,1.5))
    label('Router_Label','NETWORK / POLICY',(-1,-.565,.58),.11,router)
    cabinet = root('INTERACT_FileCabinet',(7.4,7.8,0),interaction='files',label='자료 보관함 / 파일 비교')
    cabinets = Mesh()
    for x in [0,1.1,2.2]:
        cabinets.box((x,0,.83),(.88,.62,1.66),M['Blue'])
        for row in range(4):
            z = .24 + row * .38
            cabinets.box((x,-.326,z),(.78,.035,.34),M['Metal'])
            cabinets.box((x,-.353,z+.03),(.22,.016,.07),M['Ink'])
            cabinets.rod((x-.1,-.393,z-.055),(x+.1,-.393,z-.055),.012,M['Dark'])
            for a in [-.1,.1]:
                cabinets.rod((x+a,-.393,z-.055),(x+a,-.344,z-.055),.012,M['Dark'])
    cabinets.create('FileCabinet_Drawers',cabinet)
    collider('FileCabinets',(8.5,7.8,.85),(3.2,.68,1.7))
    label('Cabinet_Label','OFFLINE / BASELINE',(-.38,-.359,1.58),.07,cabinet)
    board = root('INTERACT_Whiteboard',(2,.82,0),interaction='brief',label='화이트보드 / 미션과 힌트')
    whiteboard = Mesh()
    whiteboard.box((0,0,1.7),(2.3,.065,1.25),M['Metal'])
    whiteboard.box((0,-.038,1.7),(2.17,.015,1.12),M['Ink'])
    for x in [-.9,.9]:
        whiteboard.rod((x,0,.05),(x,0,1.6),.022,M['Metal'])
        whiteboard.box((x,0,.055),(.08,.68,.08),M['Dark'])
    whiteboard.box((0,-.09,1.03),(2.2,.16,.025),M['Metal'])
    whiteboard.create('Whiteboard_Frame',board)
    label('Board_Title','CASE 001',(-.94,-.052,2.0),.16,board,mat='Blue')
    label('Board_Text','OBSERVE > DEFEND > VERIFY',(-.95,-.052,1.72),.075,board,mat='Blue')
    diagram = Mesh()
    for x in [-.67,0,.67]:
        diagram.box((x,-.05,1.42),(.42,.012,.16),M['Blue'])
    for x in [-.34,.34]:
        diagram.box((x,-.05,1.42),(.26,.012,.012),M['Amber'])
    diagram.create('Whiteboard_Diagram',board)
    collider('Whiteboard',(2,.82,1.05),(2.34,.72,2.35))
    # Network cable trays and conduit: repeated details combined into two meshes.
    tray = Mesh()
    for x in [-9,-4,7]:
        for y in range(-7,10):
            tray.box((x,y,3.08),(.45,.045,.045),M['Metal'])
        for a in [-.22,.22]:
            tray.box((x+a,1,3.12),(.035,17,.12),M['Metal'])
        for a in [-.14,-.07,0,.07,.14]:
            tray.rod((x+a,-7,3.07),(x+a,9,3.07),.012,M['Amber'] if a == 0 else M['Blue'])
    tray.create('ENV_Cable_Trays')
    conduit = Mesh()
    for x,y in [(-8,5),(7,-2),(-5,-3)]:
        conduit.rod((x,y+.48,.1),(x,y+.48,3.06),.018,M['Blue'])
    conduit.create('ENV_Cable_Conduits')
    # A rack-side console, records table, emergency fixture and realistic clutter.
    table = Mesh()
    table.box((2,6,.76),(3.2,1.25,.07),M['Wood'])
    for x in [.55,3.45]:
        for y in [5.5,6.5]:
            table.box((x,y,.37),(.065,.065,.74),M['Metal'])
    for x in [.8,1.3,1.8]:
        table.box((x,6,.82),(.35,.25,.045),M['Ink'])
    table.create('ENV_Desk_Archive')
    collider('Archive_Desk',(2,6,.76),(3.2,1.25,1.52))
    small = Mesh()
    small.box((10.6,-8.5,.37),(.48,.48,.74),M['Dark'])
    small.box((10.6,-8.5,.77),(.5,.5,.07),M['Metal'])
    small.rod((-1.35,-9.74,.25),(-1.35,-9.74,.86),.13,M['Amber'],12)
    small.box((-1.35,-9.72,.97),(.04,.06,.17),M['Dark'])
    small.box((1.15,-9.84,1.32),(.19,.065,.3),M['Dark'])
    small.box((1.15,-9.886,1.4),(.10,.017,.12),M['LED'])
    small.create('ENV_Safety_Equipment')


def apply_library_material(source_dir):
    """Poly Haven Painted Concrete 02, Rob Tuytel, CC0; packed 1K maps.

    Use direct UVs rather than a Mapping node so glTF retains physical 4 m tiling.
    The source images are shipped for reproducible authoring, not served by the game.
    """
    mat = material('Concrete_PolyHaven',(.3,.3,.3),.8)
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    for kind in ['Diffuse','Rough','nor_gl']:
        path = Path(source_dir) / ('painted_concrete_02_'+kind+'_1k.jpg')
        image = bpy.data.images.load(str(path),check_existing=True)
        if kind != 'Diffuse':
            image.colorspace_settings.name = 'Non-Color'
        image.pack()
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        if kind == 'Diffuse':
            mat.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color'])
        elif kind == 'Rough':
            mat.node_tree.links.new(tex.outputs['Color'],shader.inputs['Roughness'])
        else:
            normal = mat.node_tree.nodes.new('ShaderNodeNormalMap')
            normal.inputs['Strength'].default_value = .32
            mat.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color'])
            mat.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal'])
    for obj in COL.objects:
        if obj.name in ['ENV_Floor','ENV_Floor_Entry']:
            obj.data.materials[0] = mat
            for uv in obj.data.uv_layers.active.data:
                uv.uv *= .25


def finish(glb_path, source_path):
    # Blender's library writer interprets relative names against the .blend path,
    # which can be unset. Resolve against the launch directory before exporting.
    glb_path, source_path = Path(glb_path).resolve(), Path(source_path).resolve()
    # Convert labels' rotation into geometry: all exported scales positive unit scale.
    for obj in list(COL.objects):
        if obj.type == 'MESH':
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(obj.data)
            bm.free()
            if obj.name.startswith('COLLIDER_'):
                obj.hide_render = True
    SCENE.world = bpy.data.worlds.new('Security_Lab_World')
    SCENE.world.use_nodes = True
    background = next(n for n in SCENE.world.node_tree.nodes if n.type == 'BACKGROUND')
    background.inputs['Color'].default_value = (.18,.24,.3,1)
    background.inputs['Strength'].default_value = .7
    bpy.ops.object.select_all(action='DESELECT')
    for obj in COL.objects:
        obj.select_set(True)
    Path(glb_path).parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(glb_path),export_format='GLB',use_selection=True,use_active_scene=True,
                              export_extras=True,export_apply=True,export_lights=False,export_cameras=False)
    # Save only the new scene and its dependencies, preserving unrelated open scenes.
    Path(source_path).parent.mkdir(parents=True,exist_ok=True)
    bpy.data.libraries.write(str(source_path),{SCENE},fake_user=True,compress=True)
    triangles = sum(sum(len(p.vertices)-2 for p in obj.data.polygons) for obj in COL.objects if obj.type == 'MESH' and not obj.name.startswith('COLLIDER_'))
    used_mats={mat for obj in COL.objects if obj.type=='MESH' and not obj.name.startswith('COLLIDER_') for mat in obj.data.materials}
    used_images={n.image for mat in used_mats if mat.use_nodes for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image}
    stats = {'objects':len(COL.objects),'triangles':triangles,'materials':len(used_mats),'materialNames':sorted(mat.name for mat in used_mats),'textures':[{'name':i.name,'size':list(i.size)} for i in used_images],
             'dimensionsMetres':[24,23,3.5],'doors':['DOOR_Main','DOOR_ServerRoom','DOOR_RecordsRoom'], 'interactive':['INTERACT_ServerRack','INTERACT_AdminPC','INTERACT_Router','INTERACT_FileCabinet','INTERACT_Whiteboard'],
             'glbBytes':Path(glb_path).stat().st_size,'authoring':'Blender '+bpy.app.version_string}
    Path(glb_path).with_suffix('.json').write_text(json.dumps(stats,indent=2),encoding='utf-8')
    print(json.dumps(stats))
    # Inspectable cutaway in the authoring viewport. Runtime GLB retains the ceiling.
    for obj in COL.objects:
        if obj.name.startswith('COLLIDER_') or obj.name.startswith('ENV_Ceiling'):
            obj.hide_set(True)
    bpy.ops.object.select_all(action='DESELECT')
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_location = (0,0,0)
            area.spaces.active.region_3d.view_distance = 31
            area.spaces.active.clip_end = 200


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if len(args) != 2:
        raise SystemExit('Usage: Blender --background --python build_security_lab.py -- output.glb source.blend')
    setup()
    shell()
    props()
    authoring = Path(__file__).resolve().parents[1] / 'assets' / 'authoring'
    if authoring.is_dir():
        apply_library_material(authoring)
    finish(*args)
