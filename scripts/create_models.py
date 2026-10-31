"""Build original, game-ready ORBITAL booster and landing barge assets.

Run using Blender --factory-startup --background --python scripts/create_models.py.
All dimensions are metres. Blender +Z is exported as glTF +Y. No external assets.
"""
import bpy
import math
import os
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'models'
SOURCE = ROOT / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.temporary_directory = str(ROOT / 'work' / 'temp')
bpy.context.preferences.filepaths.save_version = 0
ACTIVE_ASSEMBLY = None

def material(name, color, metal=0.0, roughness=0.5, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    return mat

white = material('ceramic_ivory', (.78, .81, .80), .35, .38)
seam = material('panel_seams', (.15, .18, .19), .72, .48)
metal = material('brushed_titanium', (.28, .32, .34), .8, .3)
dark = material('carbon_thermal_shield', (.026, .035, .044), .52, .6)
orange = material('mission_orange', (.95, .24, .045), .25, .43)
paint = material('deck_ivory', (.79, .81, .78), .08, .64)
deck = material('wet_steel_deck', (.075, .10, .115), .68, .36)
edge = material('barge_hull', (.105, .14, .16), .76, .4)
cyan = material('navigation_cyan', (.13, .8, .73), .05, .3, 2.8)
amber = material('navigation_amber', (1.0, .30, .045), .05, .3, 2.2)

def assembly(name, pivot):
    global ACTIVE_ASSEMBLY
    group = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(group)
    group.location = pivot
    group.empty_display_type = 'PLAIN_AXES'
    bpy.context.view_layer.update()
    ACTIVE_ASSEMBLY = group
    return group

def finish(obj, name, mat, smooth=False):
    obj.name = name
    if ACTIVE_ASSEMBLY:
        world = obj.matrix_world.copy()
        obj.parent = ACTIVE_ASSEMBLY
        obj.matrix_world = world
    obj.data.materials.append(mat)
    if smooth:
        for face in obj.data.polygons:
            face.use_smooth = True
    return obj

def box(name, location, dimensions, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('machined_edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj, name, mat)

def cylinder(name, location, radius, depth, mat, vertices=48, radius_top=None):
    if radius_top is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius_top, depth=depth, location=location)
    return finish(bpy.context.object, name, mat, True)

def rod(name, a, b, radius, mat, vertices=12):
    mid = (Vector(a) + Vector(b)) * .5
    delta = Vector(b) - Vector(a)
    obj = cylinder(name, mid, radius, delta.length, mat, vertices)
    obj.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
    return obj

def ring(name, radius, tube, z, mat, segments=64):
    bpy.ops.mesh.primitive_torus_add(major_segments=segments, minor_segments=6, location=(0, 0, z), major_radius=radius, minor_radius=tube)
    return finish(bpy.context.object, name, mat, True)

def annulus(name, radius, width, z, mat, segments=96):
    verts=[]
    faces=[]
    for i in range(segments):
        a = 2 * math.pi * i / segments
        for r in [radius-width/2, radius+width/2]:
            verts.append((r*math.cos(a), r*math.sin(a), z))
    for i in range(segments):
        a=2*i; b=2*((i+1)%segments)
        faces.append((a,b,b+1,a+1))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces)
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj,name,mat)

def text(name, body, location, size, mat, rotation=(0,0,0), align='CENTER'):
    curve=bpy.data.curves.new(name,'FONT')
    curve.body=body
    curve.size=size
    curve.align_x=align
    curve.extrude=.001
    obj=bpy.data.objects.new(name,curve)
    bpy.context.collection.objects.link(obj)
    obj.location=location
    obj.rotation_euler=rotation
    obj.data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object

def begin(name):
    col=bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    layer=bpy.context.view_layer.layer_collection.children.get(name)
    bpy.context.view_layer.active_layer_collection=layer
    return col

def add_surface_texture(mat, roughness, strength):
    # Original procedural texture pixels are packed into the GLB and .blend.
    size = 128
    image = bpy.data.images.new(mat.name+'_roughness', width=size, height=size)
    image.colorspace_settings.name = 'Non-Color'
    pixels=[]
    for y in range(size):
        for x in range(size):
            grain=math.sin(x*2.471+y*.937)*math.sin(y*1.927-x*.619)
            v=max(.05,min(.95,roughness+grain*.04+math.sin(y*.6)*.018))
            pixels.extend((v,v,v,1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    nodes=mat.node_tree.nodes
    node=nodes.new('ShaderNodeTexImage'); node.image=image
    mat.node_tree.links.new(node.outputs['Color'],nodes.get('Principled BSDF').inputs['Roughness'])
    normal=bpy.data.images.new(mat.name+'_micro_normal',width=size,height=size)
    normal.colorspace_settings.name='Non-Color'
    pixels=[]
    for y in range(size):
        for x in range(size):
            nx=math.sin(x*.41+y*1.57)*strength
            ny=math.cos(x*1.71+y*.31)*strength
            pixels.extend((.5+nx,.5+ny,1.0,1.0))
    normal.pixels.foreach_set(pixels); normal.pack()
    tex=nodes.new('ShaderNodeTexImage'); tex.image=normal
    mapping=nodes.new('ShaderNodeNormalMap'); mapping.inputs['Strength'].default_value=.3
    mat.node_tree.links.new(tex.outputs['Color'],mapping.inputs['Color'])
    mat.node_tree.links.new(mapping.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])

for surface,roughness,strength in [(white,.38,.018),(metal,.30,.023),(dark,.60,.035)]:
    add_surface_texture(surface,roughness,strength)

def merge_materials(col):
    """A handful of material batches instead of hundreds of draws."""
    groups={}
    for obj in list(col.objects):
        if obj.type=='MESH':
            if not obj.data.uv_layers:
                uv=obj.data.uv_layers.new(name='UVMap')
                for face in obj.data.polygons:
                    normal=face.normal
                    axis=max(range(3),key=lambda k:abs(normal[k]))
                    axes=[k for k in range(3) if k!=axis]
                    for loop_index in face.loop_indices:
                        co=obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
                        uv.data[loop_index].uv=(co[axes[0]]*.25,co[axes[1]]*.25)
            key=(obj.parent.name if obj.parent else col.name,obj.data.materials[0].name if len(obj.data.materials) else 'none')
            groups.setdefault(key,[]).append(obj)
    for key,objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects: obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.join()
        obj=bpy.context.object
        obj.name=key[0]+'_'+key[1]
        bpy.context.scene.cursor.location=obj.parent.matrix_world.translation if obj.parent else (0,0,0)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')

rocket=begin('rocket')
# Main tank shell: longitudinal shell panels, separately drawn seams.
cylinder('lower_engine_skirt',(0,0,3.1),1.32,1.7,dark)
cylinder('tank_shell',(0,0,10.75),1.30,13.6,white,64)
cylinder('upper_interstage',(0,0,18.3),1.30,1.45,dark,64)
cylinder('tapered_crown',(0,0,19.5),1.30,1.0,white,64,.75)
cylinder('crown_cap',(0,0,19.98),.75,.04,metal)
for z in [4.0,4.18,5.2,7.2,9.2,11.2,13.2,15.2,17.55,19.0]:
    ring('circumferential_joint',1.303,.016,z,seam)
for angle in [0,math.pi/2,math.pi,math.pi*1.5]:
    x,y=1.304*math.cos(angle),1.304*math.sin(angle)
    rod('tank_longitudinal_joint',(x,y,4.2),(x,y,17.5),.011,seam,6)
# Plumbing and service raceway.
box('service_raceway',(0,-1.31,10.4),(.19,.13,12.6),white,.025)
rod('fuel_line',(.35,-1.29,3.2),(.35,-1.29,7.2),.045,metal)
for z in [5.0,9.0,13.0,16.8]:
    box('raceway_bracket',(0,-1.41,z),(.27,.06,.12),metal)
# Visible avionics hatches, fasteners, flange lugs and actual RCS outlets.
for a in [0,math.pi/2,math.pi,math.pi*1.5]:
    ca,sa=math.cos(a),math.sin(a)
    for z in [8.2,13.7]:
        hatch=box('avionics_access_panel',(1.305*ca,1.305*sa,z),(.42,.055,.65),seam,.035)
        hatch.rotation_euler.z=a-math.pi/2
        cover=box('hatch_inset',(1.34*ca,1.34*sa,z),(.34,.035,.55),white,.025)
        cover.rotation_euler.z=a-math.pi/2
    for z in [5.0,16.6]:
        mount=box('RCS_mount',(1.34*ca,1.34*sa,z),(.36,.26,.42),metal,.04)
        mount.rotation_euler.z=a-math.pi/2
        rod('RCS_nozzle',(1.34*ca,1.34*sa,z),(1.56*ca,1.56*sa,z),.13,metal,16)
        rod('RCS_dark_orifice',(1.562*ca,1.562*sa,z),(1.57*ca,1.57*sa,z),.085,dark,16)
for i in range(20):
    a=2*math.pi*i/20
    for z in [3.9,17.7]:
        rod('flange_bolt',(1.295*math.cos(a),1.295*math.sin(a),z),(1.36*math.cos(a),1.36*math.sin(a),z),.035,metal,6)
for i in range(12):
    a=2*math.pi*i/12
    lug=box('crown_locking_lug',(1.05*math.cos(a),1.05*math.sin(a),19.92),(.16,.22,.13),metal,.02)
    lug.rotation_euler.z=a

# Named gimbal pivot is retained in glTF for realtime engine articulation.
assembly('engine_gimbal',(0,0,2.65))
# Bell is an open hollow surface, dark exterior with metallic rim.
segments=48
profiles=[(.48,2.52),(.50,2.15),(.60,1.80),(.80,1.40),(.99,1.06)]
verts=[]
faces=[]
for r,z in profiles:
    for i in range(segments):
        a=2*math.pi*i/segments
        verts.append((r*math.cos(a),r*math.sin(a),z))
for j in range(len(profiles)-1):
    for i in range(segments):
        n=(i+1)%segments
        faces.append((j*segments+i,(j+1)*segments+i,(j+1)*segments+n,j*segments+n))
mesh=bpy.data.meshes.new('engine_bell_hollow')
mesh.from_pydata(verts,[],faces)
bell=bpy.data.objects.new('engine_bell_hollow',mesh)
bpy.context.collection.objects.link(bell)
finish(bell,'engine_bell_hollow',dark,True)
ring('nozzle_lip',.99,.055,1.06,metal)
cylinder('thrust_chamber',(0,0,2.67),.52,.6,metal)
for r,z in [(.50,2.12),(.54,1.96),(.61,1.78),(.70,1.59),(.80,1.39),(.90,1.20)]:
    ring('nozzle_cooling_rib',r,.018,z,metal,48)
for i in range(8):
    a=i*math.pi/4
    rod('gimbal_hydraulic_line',(.62*math.cos(a),.62*math.sin(a),2.85),(.62*math.cos(a),.62*math.sin(a),2.25),.026,metal,8)
ACTIVE_ASSEMBLY=None
for a in [0,math.pi/2,math.pi,math.pi*1.5]:
    rod('engine_mount',(.75*math.cos(a),.75*math.sin(a),3.5),(.3*math.cos(a),.3*math.sin(a),2.4),.10,metal)
# Four mechanically legible deployed landing legs.
for i in range(4):
    a=math.pi/4+i*math.pi/2
    assembly('landing_leg_'+str(i),(1.23*math.cos(a),1.23*math.sin(a),6.2))
    def radial(r,z): return (r*math.cos(a),r*math.sin(a),z)
    rod('landing_leg_main',radial(1.23,6.2),radial(4.35,.35),.115,white)
    rod('landing_leg_damper',radial(1.30,3.0),radial(3.58,1.40),.073,metal)
    rod('landing_leg_piston',radial(1.25,2.3),radial(3.35,1.56),.043,metal)
    foot=box('landing_foot',radial(4.35,.13),(.82,.48,.26),dark,.08)
    foot.rotation_euler.z=a
    cylinder('leg_joint',radial(1.31,6.15),.2,.14,metal,16)
ACTIVE_ASSEMBLY=None
# Four open lattice grid fins, each actually modelled as intersecting spars.
for i in range(4):
    a=i*math.pi/2
    ca,sa=math.cos(a),math.sin(a)
    assembly('grid_fin_'+str(i),(1.32*ca,1.32*sa,17.35))
    def gp(r,t,z): return (r*ca-t*sa,r*sa+t*ca,z)
    for r in [1.32,3.4]:
        rod('grid_fin_edge',gp(r,-.65,17.35),gp(r,.65,17.35),.055,dark)
    for t in [-.65,.65]:
        rod('grid_fin_edge',gp(1.32,t,17.35),gp(3.4,t,17.35),.055,dark)
    for j in range(1,7):
        r=1.32+j*2.08/7
        rod('grid_fin_lattice',gp(r,-.65,17.35),gp(r,.65,17.35),.022,metal,6)
    for j in range(1,5):
        t=-.65+j*1.3/5
        rod('grid_fin_lattice',gp(1.32,t,17.35),gp(3.4,t,17.35),.022,metal,6)
    rod('grid_fin_hinge',gp(1.32,0,16.9),gp(1.32,0,17.8),.12,metal)
ACTIVE_ASSEMBLY=None
# Restrained orange identification, plus original typography on two sides.
cylinder('orange_identity_band',(0,0,15.75),1.307,.20,orange,64)
text('orbital_wordmark','O R B I T A L',(0,-1.316,12.1),.36,dark,(math.pi/2,0,0))
text('booster_number','07',(0,-1.319,10.4),.85,dark,(math.pi/2,0,0))
text('booster_serial','L V - 0 7',(0,1.316,8.6),.31,dark,(math.pi/2,0,math.pi))
merge_materials(rocket)

platform=begin('platform')
# Lower hull and reinforced deck; exact top surface at Z=3.0.
box('main_hull',(0,0,1.50),(44,44,2.6),edge,.65)
box('flight_deck',(0,0,2.90),(44,44,.20),deck,.16)
for x in [-13,13]:
    box('buoyancy_pontoon',(x,0,.55),(10,43,1.1),dark,.4)
for x in [-22.05,22.05]:
    box('rubber_side_rail',(x,0,1.6),(.2,40,.65),dark,.04)
for y in [-22.05,22.05]:
    box('rubber_side_rail',(0,y,1.6),(40,.2,.65),dark,.04)
# Large clean landing target and radial marks, flush with deck.
annulus('landing_outer_circle',14.2,.25,3.012,paint)
annulus('landing_inner_circle',12.85,.11,3.016,paint)
annulus('bullseye_ring',4.5,.16,3.019,orange,64)
for i in range(4):
    a=math.pi*i/2
    obj=box('approach_axis',(8.4*math.cos(a),8.4*math.sin(a),3.018),(5.7,.12,.012),paint)
    obj.rotation_euler.z=a
    obj=box('outer_radial',(15.8*math.cos(a),15.8*math.sin(a),3.018),(1.4,.30,.012),orange)
    obj.rotation_euler.z=a
box('bullseye_cross_x',(0,0,3.021),(4.5,.22,.016),paint)
box('bullseye_cross_y',(0,0,3.022),(.22,4.5,.016),paint)
text('deck_brand','O R B I T A L',(0,-18.2,3.018),1.05,paint)
text('deck_zone','L Z  /  0 7',(0,16.4,3.018),.72,orange)
for x in [-20.8,20.8]:
    for y in range(-20,21,2):
        obj=box('hazard_edge',(x,y,3.017),(.48,.80,.016),orange)
        obj.rotation_euler.z=.4 if x>0 else -.4
for y in [-20.8,20.8]:
    for x in range(-18,19,2):
        obj=box('hazard_edge',(x,y,3.017),(.8,.48,.016),orange)
        obj.rotation_euler.z=.4
# Panel seams, deck scuppers, corner equipment outside touchdown area.
for x in [-17,-8,8,17]:
    box('deck_panel_join',(x,0,3.004),(.018,40,.006),metal)
for y in [-17,-8,8,17]:
    box('deck_panel_join',(0,y,3.005),(40,.018,.006),metal)
for x,y in [(-18,-17),(18,17),(-18,17)]:
    box('equipment_container',(x,y,4.0),(3.8,2.5,2.0),edge,.12)
    box('equipment_roof',(x,y,5.05),(4.0,2.65,.12),metal,.04)
    for j in range(7):
        box('container_rib',(x-1.5+j*.5,y-1.27,3.95),(.035,.035,1.7),metal)
    for side in [-1,1]:
        box('container_corner_mark',(x+side*1.8,y-1.29,4.25),(.15,.05,1.3),orange)
for x in [-20,20]:
    for y in [-20,0,20]:
        cylinder('deck_lamp_base',(x,y,3.20),.19,.4,dark,12)
        cylinder('deck_lamp',(x,y,3.43),.14,.13,cyan,12)
for x in [-18,18]:
    for y in [-10,10]:
        cylinder('mooring_bollard',(x,y,3.3),.28,.6,metal,16)
        box('bollard_crossbar',(x,y,3.48),(1.0,.22,.22),metal,.04)
for x,y in [(20,-20),(-20,20)]:
    rod('antenna_mast',(x,y,3),(x,y,10),.075,metal)
    box('mast_cross_arm',(x,y,9),(.9,.06,.06),metal)
    cylinder('warning_beacon',(x,y,10),.15,.18,amber,12)
merge_materials(platform)

metrics={}
for col in [rocket,platform]:
    bpy.ops.object.select_all(action='DESELECT')
    for obj in col.objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=list(col.objects)[0]
    bpy.ops.export_scene.gltf(filepath=str(OUT/(col.name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_cameras=False,export_lights=False,export_animations=False,export_apply=True)
    triangles=sum(sum(len(face.vertices)-2 for face in obj.data.polygons) for obj in col.objects if obj.type=='MESH')
    worldverts=[obj.matrix_world @ Vector(p) for obj in col.objects if obj.type=='MESH' for p in obj.bound_box]
    metrics[col.name]={'triangles':triangles,'meshes':sum(obj.type=='MESH' for obj in col.objects),'animated_nodes':[obj.name for obj in col.objects if obj.type=='EMPTY'],'bounds_blender_z_up':{'min':[min(v[i] for v in worldverts) for i in range(3)],'max':[max(v[i] for v in worldverts) for i in range(3)]},'bytes':(OUT/(col.name+'.glb')).stat().st_size}

bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'orbital_assets.blend'))
(SOURCE/'model_metrics.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
print('MODEL_METRICS '+json.dumps(metrics))
