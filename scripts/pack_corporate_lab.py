"""Deduplicate and meshopt-pack a Blender GLB (stdlib only).

python scripts/pack_corporate_lab.py input.glb output.glb --blender-dir PATH
The encoder ships with Blender 5.2. Triangle counts, node hierarchy, collision
geometry and image bytes are retained. Visual float attributes use an 18-bit
exponential mantissa; collision/door geometry and indices remain lossless.
"""
import argparse
import ctypes
import hashlib
import json
import os
import struct
from pathlib import Path


def pack(source, destination, blender_dir):
    raw = source.read_bytes()
    assert struct.unpack_from('<III', raw) == (0x46546c67, 2, len(raw))
    json_len = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + json_len])
    binary = raw[20 + json_len + 8:]
    assert not doc.get('animations') and not doc.get('skins')
    assert len(doc['buffers']) == 1
    lib_path = next(blender_dir.glob('*/scripts/addons_core/io_scene_gltf2/bf_intern_meshopt_bridge.dll'))
    handles = [os.add_dll_directory(str(blender_dir)), os.add_dll_directory(str(blender_dir / 'blender.shared'))]
    lib = ctypes.CDLL(str(lib_path))
    for name in ['encodeVertexVersion', 'encodeIndexVersion']:
        getattr(lib, name).argtypes = [ctypes.c_int]
        getattr(lib, name).restype = None
    lib.encodeVertexVersion(0)
    lib.encodeIndexVersion(1)
    for name in ['encodeVertexBufferBound', 'encodeIndexSequenceBound']:
        getattr(lib, name).argtypes = [ctypes.c_size_t, ctypes.c_size_t]
        getattr(lib, name).restype = ctypes.c_size_t
    lib.encodeVertexBuffer.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t]
    lib.encodeIndexSequence.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t]
    lib.encodeVertexBuffer.restype = lib.encodeIndexSequence.restype = ctypes.c_size_t
    lib.encodeFilterExp.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t,
                                   ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
    lib.encodeFilterExp.restype = None
    protected_views = set()
    for node in doc['nodes']:
        if 'mesh' in node and node.get('name', '').startswith(('COLLIDER_', 'DOOR_')):
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                for a in list(primitive['attributes'].values()) + [primitive['indices']]:
                    protected_views.add(doc['accessors'][a]['bufferView'])

    output = bytearray()
    views, view_map, seen, hashes = [], {}, {}, []
    referenced = {}
    for a in doc['accessors']:
        assert 'sparse' not in a
        referenced.setdefault(a['bufferView'], []).append(a)
    fallback_length = 0
    compressed_count = 0
    quantized_views = []
    def append(data):
        output.extend(b'\0' * (-len(output) % 4))
        offset = len(output)
        output.extend(data)
        return offset

    for index, view in enumerate(doc['bufferViews']):
        data = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        params = {k:v for k,v in view.items() if k not in {'byteOffset', 'name'}}
        exact = index in protected_views
        key = (json.dumps(params, sort_keys=True), hashlib.sha256(data).hexdigest(), exact)
        if key in seen:
            view_map[index] = seen[key]
            continue
        new = dict(view)
        filter_name = 'NONE'
        if view.get('target') in [34962, 34963]:
            accessors = referenced[index]
            component_bytes = {5121:1, 5123:2, 5125:4, 5126:4}
            type_width = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}
            a = accessors[0]
            stride = view.get('byteStride', component_bytes[a['componentType']] * type_width[a['type']])
            assert all(x.get('byteOffset', 0) == 0 for x in accessors)
            count = len(data) // stride
            assert len(data) == count * stride
            if view['target'] == 34963:
                assert stride in [2, 4]
                values = struct.unpack('<' + ('H' if stride == 2 else 'I') * count, data)
                src = (ctypes.c_uint32 * count)(*values)
                bound = lib.encodeIndexSequenceBound(count, max(values) + 1)
                target = (ctypes.c_ubyte * bound)()
                written = lib.encodeIndexSequence(target, bound, src, count)
                mode = 'INDICES'  # Preserve exact index order, including provoking vertices.
            else:
                assert stride % 4 == 0 and stride <= 256
                src = ctypes.create_string_buffer(data)
                if not exact and a['componentType'] == 5126:
                    filtered = ctypes.create_string_buffer(len(data))
                    lib.encodeFilterExp(filtered, count, stride, 18, src, 1)
                    src = filtered
                    filter_name = 'EXPONENTIAL'
                    quantized_views.append(len(views))
                bound = lib.encodeVertexBufferBound(count, stride)
                target = (ctypes.c_ubyte * bound)()
                written = lib.encodeVertexBuffer(target, bound, src, count, stride)
                mode = 'ATTRIBUTES'
            assert written > 0
            offset = append(bytes(target[:written]))
            new['buffer'] = 1
            new['byteOffset'] = 0
            fallback_length = max(fallback_length, len(data))
            new['extensions'] = {'EXT_meshopt_compression': {
                'buffer':0, 'byteOffset':offset, 'byteLength':written,
                'byteStride':stride, 'count':count, 'mode':mode, 'filter':filter_name,
            }}
            compressed_count += 1
        else:
            new['byteOffset'] = append(data)
            new['buffer'] = 0
        seen[key] = view_map[index] = len(views)
        views.append(new)
        hashes.append(hashlib.sha256(data).hexdigest())

    for a in doc['accessors']:
        a['bufferView'] = view_map[a['bufferView']]
    for image in doc.get('images', []):
        image['bufferView'] = view_map[image['bufferView']]
    doc['bufferViews'] = views
    accessors, accessor_map, seen = [], {}, {}
    for i, a in enumerate(doc['accessors']):
        key = json.dumps(a, sort_keys=True)
        if key not in seen:
            seen[key] = len(accessors)
            accessors.append(a)
        accessor_map[i] = seen[key]
    doc['accessors'] = accessors
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            primitive['attributes'] = {k:accessor_map[v] for k,v in primitive['attributes'].items()}
            if 'indices' in primitive:
                primitive['indices'] = accessor_map[primitive['indices']]
    meshes, mesh_map, seen = [], {}, {}
    for i, mesh in enumerate(doc['meshes']):
        key = json.dumps({k:v for k,v in mesh.items() if k != 'name'}, sort_keys=True)
        if key not in seen:
            seen[key] = len(meshes)
            meshes.append(mesh)
        mesh_map[i] = seen[key]
    doc['meshes'] = meshes
    for node in doc['nodes']:
        if 'mesh' in node:
            node['mesh'] = mesh_map[node['mesh']]
    doc['buffers'] = [{'byteLength':len(output)}, {'byteLength':fallback_length,
                      'extensions':{'EXT_meshopt_compression':{'fallback':True}}}]
    for key in ['extensionsUsed', 'extensionsRequired']:
        doc.setdefault(key, []).append('EXT_meshopt_compression')
    js = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    output.extend(b'\0' * (-len(output) % 4))
    result = struct.pack('<III', 0x46546c67, 2, 28 + len(js) + len(output))
    result += struct.pack('<II', len(js), 0x4e4f534a) + js
    result += struct.pack('<II', len(output), 0x004e4942) + output
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(result)
    report = {'glbBytes':len(result), 'nodes':len(doc['nodes']), 'meshes':len(meshes),
              'materials':len(doc['materials']), 'embeddedImages':len(doc['images']),
              'compressedViews':compressed_count, 'visualMantissaBits':18,
              'losslessProtectedGeometry':True, 'losslessIndices':True,
              'quantizedViews':quantized_views,
              'uncompressedViewSHA256':hashes,
              'triangles':sum(sum(accessors[p['indices']]['count']//3 for p in meshes[n['mesh']]['primitives'])
                              for n in doc['nodes'] if 'mesh' in n and not n.get('name', '').startswith('COLLIDER_'))}
    destination.with_suffix('.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ['uncompressedViewSHA256', 'quantizedViews']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--blender-dir', required=True, type=Path)
    args = parser.parse_args()
    pack(args.source, args.destination, args.blender_dir)
