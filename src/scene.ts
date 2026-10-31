import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WebGPURenderer } from 'three/webgpu';
import type { FlightSnapshot } from './physics';

type Renderer = THREE.WebGLRenderer | WebGPURenderer;
type Environment = 'day' | 'dusk' | 'night';
type Quality = 'low' | 'medium' | 'high' | 'ultra';
interface ArticulatedPart { node: THREE.Object3D; rest: THREE.Quaternion; axis: THREE.Vector3; angle: number; }
interface RCSPort { position: THREE.Vector3; direction: THREE.Vector3; upper: number; pulse: number; }
interface Smoke { position: THREE.Vector3; velocity: THREE.Vector3; age: number; life: number; size: number; }

const UP = new THREE.Vector3(0, 1, 0);

/** Local-only graphics. Visual effects never feed forces back into flight physics. */
export class FlightScene {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(58, 1, .3, 14_000);
  private renderer!: Renderer;
  private backend = 'WebGL2';
  private controls!: OrbitControls;
  private rocket = new THREE.Group();
  private platform = new THREE.Group();
  private plume = new THREE.Group();
  private flameOuter!: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private flameCore!: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private shockDiamonds!: THREE.InstancedMesh;
  private flameParticles!: THREE.InstancedMesh;
  private rcsJets!: THREE.InstancedMesh;
  private rcsPorts: RCSPort[] = [];
  private nozzleGlow!: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  private engineNode?: THREE.Object3D;
  private engineRest = new THREE.Quaternion();
  private finParts: ArticulatedPart[] = [];
  private legParts: ArticulatedPart[] = [];
  private smokeTexture?: THREE.CanvasTexture;
  private hardwarePitch = 0;
  private hardwareRoll = 0;
  private gimbalX = 0;
  private gimbalZ = 0;
  private legDeployment = 0;
  private previousFlightTime = -1;
  private smokeCapacity = 140;
  private readonly animationRotation = new THREE.Quaternion();
  private readonly animationEuler = new THREE.Euler();
  private engineLight = new THREE.PointLight(0xff823d, 0, 65, 1.8);
  private sun = new THREE.DirectionalLight(0xffefd7, 4);
  private hemisphere = new THREE.HemisphereLight(0xc2e2ff, 0x153441, 2.0);
  private ocean!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  private oceanBase!: Float32Array;
  private sky!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private skyTexture!: THREE.CanvasTexture;
  private environmentTexture!: THREE.CanvasTexture;
  private waterNormal!: THREE.DataTexture;
  private smokeMesh!: THREE.InstancedMesh;
  private smoke: Smoke[] = [];
  private dummy = new THREE.Object3D();
  private desiredCamera = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private lookTarget = new THREE.Vector3(0, 60, 0);
  private rocketCentre = new THREE.Vector3(10, 108, 5);
  private exhaustWorld = new THREE.Vector3();
  private exhaustDirection = new THREE.Vector3(0, -1, 0);
  private cameraIndex = 0;
  private followOffset = new THREE.Vector3(29, 8, 32);
  private portraitFraming = false;
  private followDelta = new THREE.Vector3();
  private frameDirection = new THREE.Vector3(0, 0, -1);
  private controlYaw = Math.PI;
  private controlPitch = 0;
  private controlRoll = 0;
  private readonly controlBasis = { forward: { x: 0, z: -1 }, right: { x: 1, z: 0 } };
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly inverseRocketRotation = new THREE.Quaternion();
  private quality: Quality = 'high';
  private resolutionScale = 1;
  private shadowEnabled = true;
  private loadMs = 0;
  private disposed = false;
  private firstFrame = true;
  private lastWave = -1;
  private smokeCursor = 0;
  private smokeAccumulator = 0;
  private lastStatus = 'flying';
  private readonly resizeListener = () => this.resize();

  private constructor(private container: HTMLElement) {}

  static async create(container: HTMLElement): Promise<FlightScene> {
    const view = new FlightScene(container);
    const start = performance.now();
    try {
      await view.initializeRenderer();
      view.buildWorld();
      await view.loadAssets();
      view.loadMs = performance.now() - start;
      view.resize();
      window.addEventListener('resize', view.resizeListener);
      return view;
    } catch(error) {
      view.dispose();
      throw error;
    }
  }

  private async initializeRenderer() {
    // The unified renderer detects WebGPU at runtime and supports WebGL2 fallback.
    // A conventional WebGL renderer remains a recovery path for driver/init failures.
    try {
      const { WebGPURenderer } = await import('three/webgpu');
      // Explicit diagnostic override makes both shipped backends testable.
      const forceWebGL=new URLSearchParams(window.location.search).get('renderer')==='webgl';
      const candidate = new WebGPURenderer({ antialias: true, alpha: false, forceWebGL });
      try {
        await candidate.init();
        this.renderer = candidate;
        this.backend = (candidate.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
      } catch (error) {
        candidate.dispose();
        throw error;
      }
    } catch (error) {
      console.warn('Unified GPU renderer initialization failed; trying WebGL2.', error);
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.backend = 'WebGL2';
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', '实时三维火箭降落场景');
    canvas.style.width = canvas.style.height = '100%';
    canvas.style.display = 'block';
    this.container.append(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = true;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .07;
    this.controls.minDistance = 22;
    this.controls.maxDistance = 1_300;
    this.controls.maxPolarAngle = Math.PI * .82;
    this.controls.minPolarAngle = .16;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = .65;
    this.controls.zoomSpeed = .8;
    this.controls.target.copy(this.lookTarget);
  }

  private buildWorld() {
    this.scene.fog = new THREE.FogExp2(0x7095ac, .00048);
    this.scene.add(this.hemisphere);
    this.sun.position.set(-150, 220, 100);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -85;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 85;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 600;
    this.sun.shadow.bias = -.00035;
    this.sun.shadow.normalBias = .15;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.rocket, this.platform);
    this.rocket.add(this.plume, this.engineLight);
    this.engineLight.position.set(0, 1, 0);
    this.buildOcean();
    this.skyTexture = this.makeSkyTexture('day');
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(6_000, 32, 16), new THREE.MeshBasicMaterial({ map: this.skyTexture, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.environmentTexture = this.makeSkyTexture('day');
    this.environmentTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = this.environmentTexture;
    this.scene.environmentIntensity = .72;
    this.buildEngine();
    this.buildSmoke();
    this.setQuality('high');
  }

  private makeSkyTexture(environment: Environment) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const colors = environment === 'night' ? ['#020914','#0c2138','#324252','#081624'] : environment === 'dusk' ? ['#182c48','#7b8798','#edba92','#566b7b'] : ['#216b9f','#548eaf','#83a6ba','#315c77'];
    const gradient = ctx.createLinearGradient(0,0,0,512);
    gradient.addColorStop(0,colors[0]); gradient.addColorStop(.32,colors[1]); gradient.addColorStop(.51,colors[2]); gradient.addColorStop(1,colors[3]);
    ctx.fillStyle=gradient; ctx.fillRect(0,0,1024,512);
    // Wispy, low-contrast cloud bands wrap seamlessly around the horizon.
    for(let i=0;i<18;i++) {
      const y=120+i*7;
      const cloud=ctx.createLinearGradient(0,y,0,y+10);
      cloud.addColorStop(0,'rgba(255,255,255,0)');
      cloud.addColorStop(.5,environment==='night'?'rgba(170,195,222,0.022)':'rgba(255,255,255,0.045)');
      cloud.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=cloud; ctx.fillRect(0,y,1024,10);
    }
    const sunGlow=ctx.createRadialGradient(755,184,2,755,184,70);
    sunGlow.addColorStop(0, environment==='night'?'rgba(210,228,255,.5)':'rgba(255,240,205,.7)');
    sunGlow.addColorStop(.09,environment==='night'?'rgba(210,228,255,.12)':'rgba(255,232,190,.35)');
    sunGlow.addColorStop(1,'rgba(255,225,170,0)');
    ctx.fillStyle=sunGlow; ctx.fillRect(680,110,150,150);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    return texture;
  }

  private buildOcean() {
    const data=new Uint8Array(128*128*4);
    for(let y=0;y<128;y++) for(let x=0;x<128;x++) {
      const i=(y*128+x)*4;
      const nx=Math.sin(x*.47+y*.21)*.21+Math.cos(y*.31-x*.19)*.1;
      const ny=Math.cos(y*.39+x*.17)*.20+Math.sin(x*.28-y*.26)*.1;
      const n=new THREE.Vector3(nx,ny,1).normalize();
      data[i]=(n.x*.5+.5)*255; data[i+1]=(n.y*.5+.5)*255; data[i+2]=(n.z*.5+.5)*255; data[i+3]=255;
    }
    this.waterNormal=new THREE.DataTexture(data,128,128);
    this.waterNormal.wrapS=this.waterNormal.wrapT=THREE.RepeatWrapping;
    this.waterNormal.magFilter=THREE.LinearFilter;
    this.waterNormal.minFilter=THREE.LinearMipmapLinearFilter;
    this.waterNormal.generateMipmaps=true;
    this.waterNormal.repeat.set(110,110);
    this.waterNormal.needsUpdate=true;
    const geometry=new THREE.PlaneGeometry(6_000,6_000,160,160);
    geometry.rotateX(-Math.PI/2);
    this.oceanBase=new Float32Array(geometry.attributes.position.array);
    const mat=new THREE.MeshPhysicalMaterial({color:0x173e50,metalness:.35,roughness:.24,normalMap:this.waterNormal,normalScale:new THREE.Vector2(.65,.65),clearcoat:.75,clearcoatRoughness:.16,envMapIntensity:1.15});
    this.ocean=new THREE.Mesh(geometry,mat);
    this.ocean.receiveShadow=true;
    this.ocean.position.y=-.25;
    this.scene.add(this.ocean);
    // Smaller tessellation patches near the deck capture readable, moving swells.
    const patchGeometry=new THREE.PlaneGeometry(1_000,1_000,128,128);
    patchGeometry.rotateX(-Math.PI/2);
    this.ocean.geometry.dispose();
    this.ocean.geometry=patchGeometry;
    this.oceanBase=new Float32Array(patchGeometry.attributes.position.array);
    const horizon=new THREE.Mesh(new THREE.PlaneGeometry(14_000,14_000),mat);
    horizon.rotation.x=-Math.PI/2;
    horizon.position.y=-.8;
    this.scene.add(horizon);
  }

  private buildEngine() {
    // Open, converging shells start at the bell exit. Their dimensions follow
    // actual simulated throttle; bright shock cells and a particle stream share it.
    const outerGeometry=new THREE.CylinderGeometry(.82,.025,1,32,10,true);
    outerGeometry.translate(0,-.5,0);
    const coreGeometry=new THREE.CylinderGeometry(.42,.012,1,24,8,true);
    coreGeometry.translate(0,-.5,0);
    this.flameOuter=new THREE.Mesh(outerGeometry,new THREE.MeshBasicMaterial({color:0x689eff,transparent:true,opacity:.32,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false}));
    this.flameCore=new THREE.Mesh(coreGeometry,new THREE.MeshBasicMaterial({color:0xdcefff,transparent:true,opacity:.82,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false}));
    this.flameOuter.name='engine_expansion_plume';
    this.flameCore.name='engine_hot_core';
    this.plume.name='engine_exhaust_assembly';
    this.plume.position.y=1.08;
    this.plume.add(this.flameOuter,this.flameCore);
    this.shockDiamonds=new THREE.InstancedMesh(new THREE.SphereGeometry(1,12,6),new THREE.MeshBasicMaterial({color:0xe0f4ff,transparent:true,opacity:.64,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),8);
    this.shockDiamonds.name='engine_shock_cells';
    this.shockDiamonds.frustumCulled=false;
    this.plume.add(this.shockDiamonds);
    this.flameParticles=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshBasicMaterial({color:0x9dc8ff,transparent:true,opacity:.48,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),48);
    this.flameParticles.name='engine_turbulence_particles';
    this.flameParticles.frustumCulled=false;
    this.plume.add(this.flameParticles);
    this.shockDiamonds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flameParticles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nozzleGlow=new THREE.Mesh(new THREE.TorusGeometry(.91,.055,8,48),new THREE.MeshStandardMaterial({color:0x342123,metalness:.7,roughness:.36,emissive:0xff4e12,emissiveIntensity:0}));
    this.nozzleGlow.name='nozzle_thermal_lip';
    this.nozzleGlow.rotation.x=Math.PI/2;
    this.nozzleGlow.position.y=.01;
    this.plume.add(this.nozzleGlow);
    this.plume.visible=false;

    const jetGeometry=new THREE.CylinderGeometry(.018,.10,1,10,1,true);
    jetGeometry.translate(0,.5,0);
    this.rcsJets=new THREE.InstancedMesh(jetGeometry,new THREE.MeshBasicMaterial({color:0xbce5ff,transparent:true,opacity:.72,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false}),8);
    this.rcsJets.name='attitude_control_gas_jets';
    this.rcsJets.frustumCulled=false;
    this.rcsJets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rocket.add(this.rcsJets);
    for(let level=0;level<2;level++) for(let i=0;i<4;i++) {
      const angle=i*Math.PI/2;
      this.rcsPorts.push({position:new THREE.Vector3(Math.cos(angle)*1.575,level===0?16.6:5,Math.sin(angle)*1.575),direction:new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)),upper:level===0?1:-1,pulse:0});
    }
  }

  private buildSmoke() {
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=128;
    const ctx=canvas.getContext('2d')!;
    const soft=ctx.createRadialGradient(64,64,0,64,64,64);
    soft.addColorStop(0,'rgba(255,255,255,.65)');
    soft.addColorStop(.32,'rgba(255,255,255,.48)');
    soft.addColorStop(.72,'rgba(255,255,255,.12)');
    soft.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=soft; ctx.fillRect(0,0,128,128);
    this.smokeTexture=new THREE.CanvasTexture(canvas);
    const material=new THREE.MeshBasicMaterial({color:0xa1b3bd,map:this.smokeTexture,transparent:true,opacity:.30,depthWrite:false,side:THREE.DoubleSide});
    this.smokeMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(2,2),material,140);
    this.smokeMesh.name='exhaust_condensation_pool';
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smokeMesh.frustumCulled=false;
    this.scene.add(this.smokeMesh);
    for(let i=0;i<140;i++) {
      this.smoke.push({position:new THREE.Vector3(),velocity:new THREE.Vector3(),age:100,life:2,size:1});
      this.dummy.scale.setScalar(0); this.dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i,this.dummy.matrix);
    }
    this.smokeMesh.instanceMatrix.needsUpdate=true;
  }

  private bindArticulatedHardware() {
    this.engineNode=this.rocket.getObjectByName('engine_gimbal');
    if(this.engineNode) {
      this.engineRest.copy(this.engineNode.quaternion);
      this.engineNode.add(this.plume);
      this.plume.position.set(0,1.08-this.engineNode.position.y,0);
    }
    for(let i=0;i<4;i++) {
      const fin=this.rocket.getObjectByName(`grid_fin_${i}`);
      if(fin) this.finParts.push({node:fin,rest:fin.quaternion.clone(),axis:new THREE.Vector3(fin.position.x,0,fin.position.z).normalize(),angle:0});
      const leg=this.rocket.getObjectByName(`landing_leg_${i}`);
      if(leg) {
        const radial=new THREE.Vector3(leg.position.x,0,leg.position.z).normalize();
        this.legParts.push({node:leg,rest:leg.quaternion.clone(),axis:new THREE.Vector3(radial.z,0,-radial.x),angle:0});
      }
    }
  }

  private animateHardware(s: FlightSnapshot,dt: number,time: number) {
    this.inverseRocketRotation.copy(this.rocket.quaternion).invert();
    this.scratchA.set(this.controlPitch,0,this.controlRoll).applyQuaternion(this.inverseRocketRotation);
    this.scratchB.set(s.angularVelocity.x,s.angularVelocity.y,s.angularVelocity.z).applyQuaternion(this.inverseRocketRotation);
    const pitch=THREE.MathUtils.clamp(this.scratchA.x-this.scratchB.x*.6,-1,1);
    const roll=THREE.MathUtils.clamp(this.scratchA.z-this.scratchB.z*.6,-1,1);
    const response=this.firstFrame?1:1-Math.exp(-dt*16);
    this.hardwarePitch=THREE.MathUtils.lerp(this.hardwarePitch,pitch,response);
    this.hardwareRoll=THREE.MathUtils.lerp(this.hardwareRoll,roll,response);
    this.gimbalX=THREE.MathUtils.lerp(this.gimbalX,-this.hardwarePitch*.13,response);
    this.gimbalZ=THREE.MathUtils.lerp(this.gimbalZ,-this.hardwareRoll*.13,response);
    if(this.engineNode) {
      this.animationEuler.set(this.gimbalX,0,this.gimbalZ);
      this.animationRotation.setFromEuler(this.animationEuler);
      this.engineNode.quaternion.copy(this.engineRest).multiply(this.animationRotation);
    }
    const airSpeed=Math.min(1,Math.hypot(s.velocity.x,s.velocity.y,s.velocity.z)/45);
    for(let i=0;i<this.finParts.length;i++) {
      const part=this.finParts[i];
      const demand=(-part.axis.z*this.hardwarePitch+part.axis.x*this.hardwareRoll)*.30;
      part.angle=THREE.MathUtils.lerp(part.angle,demand,response);
      this.animationRotation.setFromAxisAngle(part.axis,part.angle+Math.sin(time*12+i*1.7)*.005*airSpeed);
      part.node.quaternion.copy(part.rest).multiply(this.animationRotation);
    }
    const progress=THREE.MathUtils.clamp((90-s.altitude)/50,0,1);
    const deployment=progress*progress*(3-2*progress);
    if(s.time<this.previousFlightTime-.02||this.previousFlightTime<0) this.legDeployment=deployment;
    else this.legDeployment=Math.max(this.legDeployment,deployment);
    if(s.altitude<=35||s.status==='landed') this.legDeployment=1;
    for(const part of this.legParts) {
      part.angle=-2.67*(1-this.legDeployment);
      this.animationRotation.setFromAxisAngle(part.axis,part.angle);
      part.node.quaternion.copy(part.rest).multiply(this.animationRotation);
    }
    this.previousFlightTime=s.time;
  }

  private async loadAssets() {
    const loader=new GLTFLoader();
    const base=import.meta.env.BASE_URL;
    const assets=await Promise.allSettled([loader.loadAsync(`${base}models/rocket.glb`),loader.loadAsync(`${base}models/platform.glb`)]);
    if(assets[0].status==='fulfilled') this.rocket.add(assets[0].value.scene);
    else { console.error('Rocket GLB unavailable; procedural fallback in use.',assets[0].reason); this.fallbackRocket(); }
    if(assets[1].status==='fulfilled') this.platform.add(assets[1].value.scene);
    else { console.error('Platform GLB unavailable; procedural fallback in use.',assets[1].reason); this.fallbackPlatform(); }
    for(const root of [this.rocket,this.platform]) root.traverse(obj=>{
      if(obj instanceof THREE.Mesh && obj!==this.flameOuter && obj!==this.flameCore && obj!==this.shockDiamonds && obj!==this.flameParticles && obj!==this.rcsJets && obj!==this.nozzleGlow) {
        obj.castShadow=true; obj.receiveShadow=true;
        const materials=Array.isArray(obj.material)?obj.material:[obj.material];
        materials.forEach(material=>{ if(material instanceof THREE.MeshStandardMaterial) material.envMapIntensity=.7; });
      }
    });
    this.bindArticulatedHardware();
  }

  private fallbackRocket() {
    const material=new THREE.MeshStandardMaterial({color:0xdce0df,roughness:.45,metalness:.4});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(1.3,1.3,16,32),material);
    body.position.y=11; this.rocket.add(body);
    const dark=new THREE.MeshStandardMaterial({color:0x232c32,metalness:.5,roughness:.5});
    const bell=new THREE.Mesh(new THREE.CylinderGeometry(.4,1,1.8,24,1,true),dark);
    bell.position.y=1.9; this.rocket.add(bell);
    for(let i=0;i<4;i++) {
      const a=Math.PI/4+i*Math.PI/2;
      const end=new THREE.Vector3(Math.cos(a)*4.35,.15,Math.sin(a)*4.35);
      const start=new THREE.Vector3(Math.cos(a)*1.2,6,Math.sin(a)*1.2);
      const leg=new THREE.Mesh(new THREE.CylinderGeometry(.1,.14,start.distanceTo(end),8),material);
      leg.position.copy(start).add(end).multiplyScalar(.5);
      leg.quaternion.setFromUnitVectors(UP,start.clone().sub(end).normalize());
      this.rocket.add(leg);
    }
  }

  private fallbackPlatform() {
    const deck=new THREE.Mesh(new THREE.BoxGeometry(44,3,44),new THREE.MeshStandardMaterial({color:0x233641,metalness:.65,roughness:.4}));
    deck.position.y=1.5; this.platform.add(deck);
    const ring=new THREE.Mesh(new THREE.RingGeometry(13.8,14.2,64),new THREE.MeshBasicMaterial({color:0xd9d8c9,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2; ring.position.y=3.02; this.platform.add(ring);
  }

  update(snapshot: FlightSnapshot, dt: number, visualTime: number): void {
    if(this.disposed) return;
    dt=Math.min(.1,Math.max(0,dt));
    this.rocket.position.set(snapshot.position.x,snapshot.position.y,snapshot.position.z);
    this.rocket.quaternion.set(snapshot.quaternion.x,snapshot.quaternion.y,snapshot.quaternion.z,snapshot.quaternion.w);
    this.rocketCentre.set(0,10,0).applyQuaternion(this.rocket.quaternion).add(this.rocket.position);
    this.updateWater(visualTime);
    this.updateEngine(snapshot,dt,visualTime);
    this.updateCamera(snapshot,dt,visualTime);
    this.sun.target.position.set(this.rocket.position.x*.3,Math.min(40,this.rocket.position.y*.4),this.rocket.position.z*.3);
    this.renderer.render(this.scene,this.camera);
    this.lastStatus=snapshot.status;
  }

  private updateWater(time: number) {
    const waveRate=this.quality==='low'?1/15:1/30;
    if(time-this.lastWave<waveRate && time>=this.lastWave) return;
    this.lastWave=time;
    const positions=this.ocean.geometry.attributes.position as THREE.BufferAttribute;
    for(let i=0;i<positions.count;i++) {
      const x=this.oceanBase[i*3],z=this.oceanBase[i*3+2];
      const a=x*.052+z*.026+time*.72;
      const b=x*.093-z*.071+time*.96;
      const c=x*.022+z*.039-time*.46;
      const height=Math.sin(a)*.23+Math.sin(b)*.10+Math.sin(c)*.25;
      positions.setY(i,height);
    }
    positions.needsUpdate=true;
    this.ocean.geometry.computeVertexNormals();
    this.waterNormal.offset.set(time*.0026,time*.0014);
  }

  private emitSmoke(position: THREE.Vector3, velocity: THREE.Vector3, size: number, life: number) {
    const particle=this.smoke[this.smokeCursor++%this.smokeCapacity];
    particle.position.copy(position); particle.velocity.copy(velocity);
    particle.age=0; particle.life=life; particle.size=size;
  }

  private updateEngine(s: FlightSnapshot,dt: number,time: number) {
    this.animateHardware(s,dt,time);
    const throttle=s.status==='flying'?s.throttle:0;
    const flicker=1+Math.sin(time*79)*.035+Math.sin(time*137)*.018;
    const flameLength=(2.5+throttle*18)*flicker;
    this.plume.visible=throttle>.008;
    this.flameOuter.scale.set(.74+throttle*.35,flameLength,.74+throttle*.35);
    this.flameCore.scale.set(.72+throttle*.22,flameLength*.75,.72+throttle*.22);
    this.flameOuter.material.opacity=.21+throttle*.19;
    this.flameOuter.material.color.setRGB(.24+throttle*.20,.48+throttle*.20,1);
    this.nozzleGlow.material.emissiveIntensity=throttle*3.2;
    this.engineLight.intensity=throttle*320*flicker;
    this.dummy.quaternion.identity();
    for(let i=0;i<8;i++) {
      const fraction=(i+.35)/8;
      const radius=(.28+throttle*.28)*(1-fraction*.62);
      this.dummy.position.set(Math.sin(time*22+i)*.025,-flameLength*fraction,Math.cos(time*19+i)*.025);
      this.dummy.scale.set(radius,flameLength*.024*flicker,radius);
      this.dummy.updateMatrix(); this.shockDiamonds.setMatrixAt(i,this.dummy.matrix);
    }
    this.shockDiamonds.instanceMatrix.needsUpdate=true;
    for(let i=0;i<48;i++) {
      const fraction=(i/48+time*(1.3+throttle*.6))%1;
      const angle=i*2.39996+time*5;
      const spread=.14+fraction*.65;
      this.dummy.position.set(Math.cos(angle)*spread,-flameLength*fraction,Math.sin(angle)*spread);
      const size=(.025+.10*throttle)*(1-fraction)*(.65+.35*Math.sin(i*9.1));
      this.dummy.scale.set(size,size*3.2,size);
      this.dummy.updateMatrix(); this.flameParticles.setMatrixAt(i,this.dummy.matrix);
    }
    this.flameParticles.instanceMatrix.needsUpdate=true;
    for(let i=0;i<this.rcsPorts.length;i++) {
      const port=this.rcsPorts[i];
      const demand=Math.max(0,(-port.direction.z*this.hardwarePitch+port.direction.x*this.hardwareRoll)*port.upper);
      const cycle=(Math.sin(s.time*38+i*.7)>.0?1:.12);
      const target=s.status==='flying'?Math.min(1,demand*2.0)*cycle:0;
      port.pulse=THREE.MathUtils.lerp(port.pulse,target,1-Math.exp(-dt*35));
      this.dummy.position.copy(port.position);
      this.dummy.quaternion.setFromUnitVectors(UP,port.direction);
      this.dummy.scale.set(.55+port.pulse*.45,port.pulse>.025?.3+port.pulse*2.5:0,.55+port.pulse*.45);
      this.dummy.updateMatrix(); this.rcsJets.setMatrixAt(i,this.dummy.matrix);
    }
    this.rcsJets.instanceMatrix.needsUpdate=true;
    this.exhaustWorld.set(0,1,0).applyQuaternion(this.rocket.quaternion).add(this.rocket.position);
    this.animationEuler.set(this.gimbalX,0,this.gimbalZ);
    this.animationRotation.setFromEuler(this.animationEuler);
    this.exhaustDirection.set(0,-1,0).applyQuaternion(this.animationRotation).applyQuaternion(this.rocket.quaternion);
    const emissionRate=this.quality==='low'?9:this.quality==='medium'?18:30;
    this.smokeAccumulator+=dt*throttle*emissionRate;
    while(this.smokeAccumulator>=1) {
      this.smokeAccumulator--;
      this.scratchA.copy(this.exhaustWorld).addScaledVector(this.exhaustDirection,5+throttle*8);
      this.scratchB.copy(this.exhaustDirection).multiplyScalar(9+throttle*12);
      this.scratchB.x+=Math.sin(this.smokeCursor*17.73)*2;
      this.scratchB.z+=Math.cos(this.smokeCursor*8.31)*2;
      this.emitSmoke(this.scratchA,this.scratchB,.65+throttle*.7,2.6);
      if(s.altitude<25) {
        const angle=this.smokeCursor*2.39996;
        this.scratchA.set(s.position.x,3.55,s.position.z);
        this.scratchB.set(Math.cos(angle)*11,1.8,Math.sin(angle)*11);
        this.emitSmoke(this.scratchA,this.scratchB,1.5,3.2);
      }
    }
    if(s.status==='crashed'&&this.lastStatus!=='crashed') {
      for(let i=0;i<65;i++) {
        const angle=i*2.39996;
        this.scratchA.set(Math.cos(angle)*(4+i%9),3+(i%7),Math.sin(angle)*(4+i%9));
        this.emitSmoke(this.exhaustWorld,this.scratchA,1.4,4.5);
      }
    }
    if(s.time<.02&&this.lastStatus!=='flying') for(const p of this.smoke) p.age=p.life+1;
    this.smokeMesh.count=this.smokeCapacity;
    for(let i=0;i<this.smoke.length;i++) {
      const p=this.smoke[i]; p.age+=dt;
      if(p.age<p.life) {
        p.position.addScaledVector(p.velocity,dt);
        p.velocity.multiplyScalar(Math.exp(-dt*.45)); p.velocity.y+=dt*.9;
        if(p.position.y<3.3&&Math.abs(p.position.x)<22&&Math.abs(p.position.z)<22) {p.position.y=3.3;p.velocity.y=Math.abs(p.velocity.y)*.12;}
        const fraction=p.age/p.life;
        const size=p.size*(1+fraction*3.5)*Math.min(1,(1-fraction)*3);
        this.dummy.position.copy(p.position);
        this.dummy.scale.set(size,size*.75,size);
        this.dummy.quaternion.copy(this.camera.quaternion);
        this.dummy.rotateZ(i*1.71+p.age*.12);
      } else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix(); this.smokeMesh.setMatrixAt(i,this.dummy.matrix);
    }
    this.smokeMesh.instanceMatrix.needsUpdate=true;
  }

  private updateCamera(s: FlightSnapshot,dt: number,time: number) {
    const c=this.rocketCentre;
    const distance=Math.max(42,c.y*.86+23);
    if(this.cameraIndex===0) {
      this.controls.enabled=true;
      this.controls.enablePan=false;
      this.controls.maxDistance=240;
      this.desiredTarget.copy(c).addScaledVector(this.scratchA.set(s.velocity.x,s.velocity.y,s.velocity.z),.06);
      if(this.firstFrame) {
        this.controls.target.copy(this.desiredTarget);
        this.camera.position.copy(this.desiredTarget).add(this.followOffset);
        this.firstFrame=false;
      } else {
        this.followDelta.copy(this.desiredTarget).sub(this.controls.target).multiplyScalar(1-Math.exp(-dt*8));
        this.controls.target.add(this.followDelta);
        this.camera.position.add(this.followDelta);
      }
      this.controls.update();
      this.camera.position.y=Math.max(4.2,this.camera.position.y);
      this.lookTarget.copy(this.controls.target);
      this.followOffset.copy(this.camera.position).sub(this.controls.target);
      return;
    }
    if(this.cameraIndex===4) {
      this.controls.enabled=true;
      this.controls.enablePan=true;
      this.controls.maxDistance=1_300;
      if(this.firstFrame) {
        this.controls.target.copy(c);
        this.camera.position.copy(c).add(this.followOffset);
        this.firstFrame=false;
      }
      this.controls.update();
      this.camera.position.y=Math.max(4.5,this.camera.position.y);
      return;
    }
    this.controls.enabled=false;
    switch(this.cameraIndex) {
      case 1:
        this.desiredTarget.copy(c).lerp(this.scratchA.set(0,3,0),.24);
        this.desiredCamera.set(c.x+Math.max(65,c.y*.94),c.y*.65+16,c.z+28);
        break;
      case 2:
        this.desiredTarget.set(0,Math.max(18,c.y*.45),0);
        this.desiredCamera.set(180,110,210);
        break;
      case 3:
        this.desiredCamera.set(-29,8,31);
        this.desiredTarget.copy(c);
        break;
      case 5: {
        const angle=time*.055;
        this.desiredTarget.copy(c).lerp(this.scratchA.set(0,4,0),.20);
        this.desiredCamera.set(c.x+Math.cos(angle)*Math.min(70,distance),c.y+20,c.z+Math.sin(angle)*Math.min(70,distance));
        break;
      }
    }
    const smoothing=this.firstFrame?1:1-Math.exp(-dt*3.6);
    this.camera.position.lerp(this.desiredCamera,smoothing);
    this.lookTarget.lerp(this.desiredTarget,smoothing);
    this.camera.lookAt(this.lookTarget);
    this.controls.target.copy(this.lookTarget);
    this.firstFrame=false;
  }

  /** World-heading yaw: 0 points +Z, pi/2 points +X. Stable near vertical views. */
  getControlYaw(): number {
    this.camera.getWorldDirection(this.frameDirection);
    const horizontal=Math.hypot(this.frameDirection.x,this.frameDirection.z);
    if(horizontal>.05) this.controlYaw=Math.atan2(this.frameDirection.x,this.frameDirection.z);
    return this.controlYaw;
  }

  /** Reused object; forward is projected camera sight, right = forward cross world-up. */
  getControlBasis() {
    const yaw=this.getControlYaw();
    this.controlBasis.forward.x=Math.sin(yaw); this.controlBasis.forward.z=Math.cos(yaw);
    this.controlBasis.right.x=-Math.cos(yaw); this.controlBasis.right.z=Math.sin(yaw);
    return this.controlBasis;
  }

  setControlInput(pitch: number,roll: number): void {
    this.controlPitch=Math.max(-1,Math.min(1,Number.isFinite(pitch)?pitch:0));
    this.controlRoll=Math.max(-1,Math.min(1,Number.isFinite(roll)?roll:0));
  }

  setCamera(index: number): void {
    if(this.cameraIndex===0) this.followOffset.copy(this.camera.position).sub(this.controls.target);
    this.cameraIndex=((Math.floor(index)%6)+6)%6;
    this.controls.enabled=this.cameraIndex===0||this.cameraIndex===4;
    this.firstFrame=true;
    this.resize();
  }

  setEnvironment(environment: Environment): void {
    const sky=this.makeSkyTexture(environment),env=this.makeSkyTexture(environment);
    this.sky.material.map=sky; this.sky.material.needsUpdate=true;
    this.skyTexture.dispose(); this.skyTexture=sky;
    env.mapping=THREE.EquirectangularReflectionMapping;
    this.scene.environment=env; this.environmentTexture.dispose(); this.environmentTexture=env;
    const night=environment==='night',dusk=environment==='dusk';
    this.sun.color.set(night?0xa5c7f0:dusk?0xffb279:0xffefd7);
    this.sun.intensity=night?.75:dusk?2.5:4;
    this.sun.position.set(-150,night?90:dusk?85:220,100);
    this.hemisphere.color.set(night?0x7394bf:dusk?0xb7c7e2:0xc2e2ff);
    this.hemisphere.intensity=night?.65:dusk?1.3:2;
    this.scene.environmentIntensity=night?.3:.72;
    (this.scene.fog as THREE.FogExp2).color.set(night?0x1c2f42:dusk?0x9b9190:0x7095ac);
    this.ocean.material.color.set(night?0x102b3c:dusk?0x294452:0x173e50);
    this.renderer.toneMappingExposure=night?1.25:dusk?1.1:1.1;
  }

  setQuality(quality: Quality): void {
    this.quality=quality;
    this.smokeCapacity=quality==='low'?40:quality==='medium'?80:140;
    if(this.flameParticles) this.flameParticles.count=quality==='low'?16:quality==='medium'?28:48;
    const shadowSize=quality==='low'?512:quality==='medium'?1024:quality==='ultra'?4096:2048;
    if(this.sun.shadow.mapSize.x!==shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize,shadowSize);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map=null;
      this.sun.shadow.mapPass?.dispose(); this.sun.shadow.mapPass=null;
    }
    this.renderer.shadowMap.enabled=this.shadowEnabled&&quality!=='low';
    this.ocean.material.normalScale.setScalar(quality==='low'?.4:.65);
    this.resize();
  }

  setResolution(scale: number): void { this.resolutionScale=Math.max(.5,Math.min(1.5,scale)); this.resize(); }
  setShadows(enabled: boolean): void { this.shadowEnabled=enabled; this.renderer.shadowMap.enabled=enabled&&this.quality!=='low'; }

  resize(): void {
    if(!this.renderer||this.disposed) return;
    const width=Math.max(1,this.container.clientWidth),height=Math.max(1,this.container.clientHeight);
    this.camera.aspect=width/height;
    this.camera.fov=this.cameraIndex===0?(width<700?48:44):58;
    const narrow=width<700;
    const portrait=narrow&&height>width;
    if(this.cameraIndex===0&&portrait!==this.portraitFraming) {
      this.followOffset.multiplyScalar(portrait?1.20:1/1.20);
      this.portraitFraming=portrait;
      if(!this.firstFrame) this.camera.position.copy(this.controls.target).add(this.followOffset);
    }
    this.controls.minDistance=Math.max(22,6/(Math.tan(THREE.MathUtils.degToRad(this.camera.fov*.5))*this.camera.aspect));
    if(this.cameraIndex===0 && this.followOffset.length()<this.controls.minDistance*1.15) this.followOffset.setLength(this.controls.minDistance*1.15);
    if(this.cameraIndex===0&&portrait) this.camera.setViewOffset(width,height,0,-height*.08,width,height);
    else if(this.cameraIndex===0&&!narrow) this.camera.setViewOffset(width,height,-width*.035,0,width,height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    const cap=this.quality==='low'?1:this.quality==='medium'?1.25:this.quality==='ultra'?2:1.6;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,cap)*this.resolutionScale);
    this.renderer.setSize(width,height,false);
  }

  stats() {
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const info=this.renderer.info;
    const render=info.render as typeof info.render & { drawCalls?: number };
    return {backend:this.backend,drawCalls:render.drawCalls??render.calls,triangles:render.triangles,textures:info.memory.textures,width:size.x,height:size.y,loadMs:this.loadMs};
  }

  dispose(): void {
    if(this.disposed) return;
    this.disposed=true;
    window.removeEventListener('resize',this.resizeListener);
    this.controls?.dispose();
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
    this.scene.traverse(object=>{
      if(object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for(const material of Array.isArray(object.material)?object.material:[object.material]) {
          materials.add(material);
          Object.values(material).forEach(value=>{if(value instanceof THREE.Texture) textures.add(value);});
        }
      }
    });
    if(this.environmentTexture) textures.add(this.environmentTexture);
    if(this.skyTexture) textures.add(this.skyTexture);
    if(this.waterNormal) textures.add(this.waterNormal);
    if(this.smokeTexture) textures.add(this.smokeTexture);
    geometries.forEach(geometry=>geometry.dispose());
    materials.forEach(material=>material.dispose());
    textures.forEach(texture=>texture.dispose());
    this.sun.shadow.dispose();
    this.smokeMesh?.dispose();
    this.shockDiamonds?.dispose();
    this.flameParticles?.dispose();
    this.rcsJets?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.scene.clear();
  }
}
