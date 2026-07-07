# bake-ao.py — bake d'ambient occlusion Cycles vers VERTEX COLORS (headless Blender).
#
# Multiplie l'AO cuite dans l'attribut COLOR_0 (cree si absent) : three.js multiplie
# automatiquement les vertex colors -> zero changement cote app, aucune texture ajoutee,
# pas d'unwrap UV. Ignore le noeud occluder_shell (backdrop, jamais eclaire).
#
# Usage : blender --background --python scripts/bake-ao.py -- <in.glb> <out.glb> [samples]

import bpy, sys, math

argv = sys.argv[sys.argv.index("--") + 1:]
IN, OUT = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 16

# reset scene
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.device = "CPU"
scene.render.bake.use_selected_to_active = False

meshes = [o for o in bpy.data.objects if o.type == "MESH" and "occluder" not in (o.name or "").lower()]
print(f"[bake-ao] {len(meshes)} meshes a baker ({SAMPLES} samples)")

# attribut AO par mesh (bake -> attribut actif de type couleur)
for o in meshes:
    me = o.data
    if "AO_BAKE" not in me.color_attributes:
        me.color_attributes.new(name="AO_BAKE", type="BYTE_COLOR", domain="CORNER")
    me.color_attributes.active_color = me.color_attributes["AO_BAKE"]

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
if meshes:
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    print("[bake-ao] bake termine")

# multiplier AO dans COLOR_0 (nom glTF importe : "Color" ou "COLOR_0" selon version)
for o in meshes:
    me = o.data
    ao = me.color_attributes.get("AO_BAKE")
    if ao is None:
        continue
    base = None
    for cand in ("Color", "COLOR_0", "Col"):
        if cand in me.color_attributes:
            base = me.color_attributes[cand]
            break
    if base is None:
        # pas de COLOR_0 d'origine : l'AO devient la couleur (RGB=AO, alpha=1)
        ao.name = "Color"
        for d in ao.data:
            c = d.color
            d.color = (c[0], c[1], c[2], 1.0)
    else:
        if base.domain != ao.domain or len(base.data) != len(ao.data):
            # domaines differents : on remplace par l'AO seule (cas rare)
            me.color_attributes.remove(base)
            ao.name = "Color"
            continue
        for i, d in enumerate(base.data):
            a = ao.data[i].color[0]
            c = d.color
            d.color = (c[0] * a, c[1] * a, c[2] * a, c[3])
        me.color_attributes.remove(ao)
        me.color_attributes.active_color = base

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True)
print("[bake-ao] exporte :", OUT)
