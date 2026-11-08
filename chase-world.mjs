/* The 3D world of 警察抓小偷. A map is either the built-in lakeside village (drawn here from code) or a Brunstad region
   (modelled in three.js by chase-brunstad.mjs from measured map data, round the region's loop: the Brunstad showcase's
   own world, physically lit, with its own finish pass). The lakeside village is a Norwegian village round a road loop,
   with a lake inside the loop and a fjord beyond it, lit by a low evening sun and drawn like a hand-painted film (flat
   toon light, soft ink outlines, drifting cloud shadows). Runners are the hand-drawn sprites standing in that world (HD-2D). The camera is kind to anyone prone to
   motion sickness: it never turns or zooms, looks north from far above, and drifts only a fraction of the way after my
   runner (the wide view stands further back and shows only the map; it does not move at all when the whole loop fits).
   Everything is built from code. */
import {AdditiveBlending,BackSide,BasicShadowMap,BoxGeometry,BufferAttribute,BufferGeometry,CanvasTexture,CatmullRomCurve3,CircleGeometry,Color,ConeGeometry,
  CylinderGeometry,DataTexture,DirectionalLight,DodecahedronGeometry,Euler,ExtrudeGeometry,Fog,Group,HemisphereLight,IcosahedronGeometry,
  InstancedMesh,Matrix4,Mesh,MeshBasicMaterial,MeshToonMaterial,NearestFilter,NoColorSpace,Object3D,PCFShadowMap,PerspectiveCamera,PlaneGeometry,Quaternion,
  RepeatWrapping,RingGeometry,SRGBColorSpace,Scene,ShaderMaterial,Shape,Sprite,SpriteMaterial,Texture,Vector3,WebGLRenderer} from './vendor/three-chase.58ec3a6f2f.mjs';

const ROAD = 9, SAMPLES = 2048, WATER = -.8, SHORE = 51;
// Where the verge starts, just past the gravel shoulder.
const EDGE = ROAD/2+1.3;
const UP = new Vector3(0,1,0);
// Name tags in the interface language (docs/i18n.md). This module has its own `tx` (a tangent), so the lookup goes by
// `words.tx`; the wording is looked up once here, never per frame.
const L10N = globalThis.NorskI18n || null;
const words = {tx:(text,vars) => L10N ? L10N.t(text,vars) : text};
const TAG = {me:words.tx('我'),away:words.tx(' · 掉线中')};
const tagName = name => L10N?.name ? L10N.name(name) : String(name ?? '');
// Sizes in metres. Every map is at true scale and the people and vehicles on it are drawn about two and a half times
// life size, so they read clearly from the game camera (a convention of top-down games).
const SIZE = {run:{h:4.6},pose:{h:4.6},bike:{h:5},skate:{h:4.9},moto:{w:6},car:{w:8.5},heli:{w:11.5}};
const LANE = 2.4;
// Measured on the Q版 drawings of 2026-11-05 (scripts/generate_chase_art.py --style town), which the painted looks use;
// the pixel look's code-drawn cast brings its own, measured where it draws them (chase-brunstad.mjs pixelKit.drawCast()).
const DRAWN = {
  // Where the rotor mast stands in each helicopter drawing, as a fraction of its width from the tail.
  MAST:{'police-heli':.61,'thief-heli':.6},
  // Where the blue lamp sits in each police drawing, from the middle of the picture (fractions of width and height).
  BEACON:{moto:[-.3,.62],car:[-.13,.95],heli:[.1,.2]},
  // The thieves' own touch: their loot sack (behind the dirt bike's rider, on the sports car's back seat, under the
  // helicopter) catches the evening sun now and then. Where the sack is in each drawing, like BEACON.
  LOOT:{moto:[-.33,.52],car:[-.17,.48],heli:[-.03,.15]},
  // The frame a cycle shows while standing still: both feet on the board for the skater.
  REST:{'thief-skate-cycle':2},
};
let {MAST,BEACON,LOOT,REST} = DRAWN;
// The pixel look: one art pixel is this many CSS pixels (a little less on a narrow phone, whose view is wider).
// In the wide view the cast is drawn finer, a sprite pixel this many CSS pixels: a runner about 34 px tall, as before.
const ART_PX = {wide:3,narrow:2.5,still:1.17};
// In the wide view everyone is drawn at least this many pixels tall, so the runners stay readable.
const STILL_PX = 34;
// One fixed camera: 85 m away, 57° down, always facing north. It does not turn or zoom; it stays still while I am in
// the calm middle of the picture and glides only as far as needed when I near its edge.
const CAMERA = {distance:85,pitch:1,fov:32,calm:{x:.3,z:.26}};
const HEADING = new Vector3(0,0,-1);
// The lake inside the loop and the stream that runs from it under the road to the fjord.
const LAKE = {x:-28,z:21,ax:22,az:11.5};
const streamX = z => -21+Math.sin(z*.16)*1.6;

/* ---------- Small deterministic helpers ---------- */
function random(seed) {
  let value = seed >>> 0;
  return () => { value = (value*1664525+1013904223) >>> 0; return value/4294967296; };
}
const smooth = (a,b,x) => { const t = Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
const mix = (a,b,t) => a+(b-a)*t;
function hash(x,z) { const s = Math.sin(x*127.1+z*311.7)*43758.5453; return s-Math.floor(s); }
function noise(x,z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x-ix, fz = z-iz;
  const u = fx*fx*(3-2*fx), v = fz*fz*(3-2*fz);
  return mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v);
}
const fbm = (x,z) => noise(x,z)*.55+noise(x*2.1+7,z*2.1+3)*.3+noise(x*4.3+1,z*4.3+9)*.15;
const color = hex => new Color(hex);
const lakeShape = (x,z) => ((x-LAKE.x)/LAKE.ax)**2+((z-LAKE.z)/LAKE.az)**2;

/* ---------- Toon look shared by every world material ---------- */
function toonRamp() {
  const tones = [128,186,230,255], data = new Uint8Array(tones.length*4);
  tones.forEach((tone,i) => data.set([tone,tone,tone,255],i*4));
  const texture = new DataTexture(data,tones.length,1);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
// Cloud shadows drift over the land; the light under them turns a little cooler.
const CLOUD_GLSL = `
uniform float uTime;
varying vec2 vCloud;
float cHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float cNoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(cHash(i),cHash(i+vec2(1,0)),u.x),mix(cHash(i+vec2(0,1)),cHash(i+vec2(1,1)),u.x),u.y);}
float cloudShade(vec2 p){p=p*0.009+vec2(uTime*0.006,uTime*0.0025);
  float n=cNoise(p)*0.6+cNoise(p*2.3+5.0)*0.3+cNoise(p*5.1+2.0)*0.1;return smoothstep(0.56,0.74,n);}
`;
function worldMaterial(options,time) {
  const material = new MeshToonMaterial(options);
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vCloud;')
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vec4 cWorld = vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          cWorld = instanceMatrix*cWorld;
        #endif
        vCloud = (modelMatrix*cWorld).xz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>\n${CLOUD_GLSL}`)
      .replace('#include <fog_fragment>',`float cShade = cloudShade(vCloud);
        gl_FragColor.rgb *= mix(vec3(1.0),vec3(0.8,0.85,0.94),cShade*0.5);
        #include <fog_fragment>`);
  };
  material.customProgramCacheKey = () => 'chase-world';
  return material;
}

/* ---------- Geometry assembly ---------- */
// Many small parts become one mesh with vertex colours, so a whole village is a handful of draw calls.
function parts() {
  const list = [];
  const temp = new Object3D();
  // Tilt and roll first, then turn: a roof slab pitches within its house before the house turns.
  temp.rotation.order = 'YXZ';
  return {
    add(geometry,hex,{x=0,y=0,z=0,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1}={}) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      temp.position.set(x,y,z); temp.rotation.set(rx,ry,rz); temp.scale.set(sx,sy,sz); temp.updateMatrix();
      g.applyMatrix4(temp.matrix);
      const tint = color(hex), count = g.attributes.position.count, colors = new Float32Array(count*3);
      for (let i = 0; i < count; i++) colors.set([tint.r,tint.g,tint.b],i*3);
      g.setAttribute('color',new BufferAttribute(colors,3));
      list.push(g);
      geometry.dispose?.();
    },
    get size() { return list.length; },
    build() {
      let total = 0;
      for (const g of list) total += g.attributes.position.count;
      const position = new Float32Array(total*3), normal = new Float32Array(total*3), colors = new Float32Array(total*3);
      let offset = 0;
      for (const g of list) {
        position.set(g.attributes.position.array,offset*3);
        normal.set(g.attributes.normal.array,offset*3);
        colors.set(g.attributes.color.array,offset*3);
        offset += g.attributes.position.count;
        g.dispose();
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position',new BufferAttribute(position,3));
      geometry.setAttribute('normal',new BufferAttribute(normal,3));
      geometry.setAttribute('color',new BufferAttribute(colors,3));
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
}
// Rotate a local offset by a yaw and add a base point.
const place = (base,yaw,dx,dz) => ({x:base.x+Math.cos(yaw)*dx+Math.sin(yaw)*dz,z:base.z-Math.sin(yaw)*dx+Math.cos(yaw)*dz});

/* ---------- Textures drawn once ---------- */
function canvasTexture(width,height,paint,repeat=false) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'),width,height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}
// (`plain`: the pixel look's road, without the dabs, which turned into a grey camouflage at its size)
function roadTexture(plain = false) {
  return canvasTexture(256,512,(c,w,h) => {
    c.fillStyle = '#ab9f8d'; c.fillRect(0,0,w,h);
    const r = random(5);
    // Painted, not photographic: soft dabs of lighter and darker tone.
    for (let i = 0; i < (plain ? 0 : 900); i++) {
      c.fillStyle = r() < .5 ? 'rgba(255,244,222,.08)' : 'rgba(92,74,58,.06)';
      c.beginPath(); c.ellipse(r()*w,r()*h,3+r()*9,1.5+r()*3,r()*.4,0,Math.PI*2); c.fill();
    }
    if (!plain) { c.fillStyle = 'rgba(96,80,62,.06)'; c.fillRect(w*.25,0,w*.1,h); c.fillRect(w*.65,0,w*.1,h); }
    c.fillStyle = '#f0e6cc'; c.fillRect(w*.045,0,w*.03,h); c.fillRect(w*.925,0,w*.03,h);
    c.fillStyle = 'rgba(240,230,204,.7)';
    for (let y = 0; y < h; y += 256) c.fillRect(w*.49,y+60,w*.02,90);
  },true);
}
// Brush strokes of grass, multiplied over the painted ground colours so the meadow never looks flat.
function grassTexture() {
  return canvasTexture(512,512,(c,w,h) => {
    c.fillStyle = '#f6f6f2'; c.fillRect(0,0,w,h);
    const r = random(9);
    c.lineCap = 'round';
    for (let i = 0; i < 3200; i++) {
      const x = r()*w, y = r()*h, length = 4+r()*7, lean = (r()-.5)*.9;
      c.strokeStyle = r() < .55 ? `rgba(100,122,58,${.06+r()*.08})` : `rgba(255,252,226,${.08+r()*.1})`;
      c.lineWidth = .8+r()*1.2;
      for (const [dx,dy] of [[0,0],[-w,0],[w,0],[0,-h],[0,h]]) {
        c.beginPath(); c.moveTo(x+dx,y+dy); c.quadraticCurveTo(x+dx+lean*length*.5,y+dy-length*.6,x+dx+lean*length,y+dy-length); c.stroke();
      }
    }
  },true);
}
function glowTexture() {
  return canvasTexture(64,64,(c,w,h) => {
    const g = c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(.3,'rgba(255,255,255,.5)'); g.addColorStop(1,'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0,0,w,h);
  });
}
// A glint: a soft core with four thin rays, as light catches something for an instant.
function glintTexture() {
  return canvasTexture(64,64,(c,w,h) => {
    const core = c.createRadialGradient(w/2,h/2,0,w/2,h/2,w*.2);
    core.addColorStop(0,'rgba(255,255,255,1)'); core.addColorStop(1,'rgba(255,255,255,0)');
    c.fillStyle = core; c.fillRect(0,0,w,h);
    for (const [dx,dy,length] of [[1,0,.5],[0,1,.5],[.7,.7,.26],[.7,-.7,.26]]) {
      const ray = c.createLinearGradient(w/2-dx*w*length,h/2-dy*h*length,w/2+dx*w*length,h/2+dy*h*length);
      ray.addColorStop(0,'rgba(255,255,255,0)'); ray.addColorStop(.5,'rgba(255,255,255,.95)'); ray.addColorStop(1,'rgba(255,255,255,0)');
      c.strokeStyle = ray; c.lineWidth = length > .3 ? 2.2 : 1.4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(w/2-dx*w*length,h/2-dy*h*length); c.lineTo(w/2+dx*w*length,h/2+dy*h*length); c.stroke();
    }
  });
}
function shadowTexture() {
  return canvasTexture(64,64,(c,w,h) => {
    const g = c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);
    g.addColorStop(0,'rgba(40,28,16,.55)'); g.addColorStop(.6,'rgba(40,28,16,.28)'); g.addColorStop(1,'rgba(40,28,16,0)');
    c.fillStyle = g; c.fillRect(0,0,w,h);
  });
}
// A main rotor seen from the side, as the helicopter drawings are: a thin blurred disc with two blades sweeping round,
// in ROTOR_FRAMES frames stacked top to bottom.
const ROTOR_FRAMES = 6;
function rotorTexture() {
  return canvasTexture(512,96*ROTOR_FRAMES,(c,w) => {
    const R = w*.48, r = 15;
    for (let k = 0; k < ROTOR_FRAMES; k++) {
      const cy = k*96+48;
      c.fillStyle = 'rgba(46,42,36,.16)';
      c.beginPath(); c.ellipse(w/2,cy,R,r,0,0,Math.PI*2); c.fill();
      c.lineCap = 'round';
      // The blade and two fading ghosts behind it give the sweep its blur.
      [[0,.85,6],[-.22,.32,8],[-.44,.14,10]].forEach(([lag,alpha,width]) => {
        const angle = k/ROTOR_FRAMES*Math.PI+lag;
        c.strokeStyle = `rgba(34,31,27,${alpha})`;
        c.lineWidth = width;
        c.beginPath(); c.moveTo(w/2-Math.cos(angle)*R,cy-Math.sin(angle)*r); c.lineTo(w/2+Math.cos(angle)*R,cy+Math.sin(angle)*r); c.stroke();
      });
      c.fillStyle = 'rgba(34,31,27,.9)';
      c.beginPath(); c.ellipse(w/2,cy,9,6,0,0,Math.PI*2); c.fill();
    }
  });
}

/* ---------- The world ---------- */
// `style` is the look the player chose for their picture: 'anime' (the modelled painted scene), 'town' (the Q版 sprite
// town) or 'pixel' (the modelled scene finished as pixel art, with a code-drawn cast); the Brunstad builder's default
// when none is given.
export async function createWorld({canvas,overlay,images,manifest,small=false,touch=false,onLost,map={kind:'lakeside'},style=''}) {
  // The Brunstad builder comes with the same version tag as this file, so a cache never pairs a new world with an old
  // builder. Its pixel kit also finishes the lakeside village in the pixel look and draws the cast for every map.
  const builder = import(new URL(`./chase-brunstad.mjs${new URL(import.meta.url).search}`,import.meta.url).href);
  const module = await builder.catch(error => { if (map.kind === 'brunstad') throw error; return null; });
  const look = module?.STYLES?.includes(style) ? style : module?.defaultStyle || 'town';
  const kit = look === 'pixel' ? module?.pixelKit || null : null;
  const cast = kit ? kit.drawCast() : null;
  ({MAST,BEACON,LOOT,REST} = cast || DRAWN);
  const time = {value:0};
  // A failure of the graphics card (no WebGL, or its context lost while the scene was built) is marked `graphics`, so
  // the game can say so instead of blaming the network.
  const graphics = error => Object.assign(error instanceof Error ? error : new Error(String(error)),{graphics:true});
  let renderer;
  try { renderer = new WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'}); } catch (error) { throw graphics(error); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,small || touch ? 1.6 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  // (the pixel look's shadows are one sample each: a filtered edge, snapped pixel by pixel, came out torn)
  renderer.shadowMap.type = kit ? BasicShadowMap : PCFShadowMap;
  // Nothing that casts a shadow moves, so the shadow map is redrawn only when its box follows the camera somewhere new.
  renderer.shadowMap.autoUpdate = false;
  // A lost context ends the game, but not the one dispose() causes on purpose.
  let disposed = false, gone = false;
  const lost = event => { event.preventDefault(); gone = true; if (!disposed) onLost?.(); };
  canvas.addEventListener('webglcontextlost',lost);
  const scene = new Scene();
  const haze = color('#f0dcc0');
  scene.background = haze;
  scene.fog = new Fog(haze,240,700);
  // The camera is never closer than about 70 m to anything, so a far-off near plane keeps depth precise.
  const camera = new PerspectiveCamera(CAMERA.fov,1,10,2000);
  const ramp = toonRamp();
  const disposables = [ramp];
  const keep = item => { disposables.push(item); return item; };

  // Shared by every map: the loop (sampled evenly by distance), the sun, and the few things that move on their own.
  const glowMap = keep(glowTexture()), glintMap = keep(glintTexture());
  const track = {points:new Float32Array((SAMPLES+1)*3),tangents:new Float32Array((SAMPLES+1)*3),sign:1,roadWidth:ROAD};
  const instanced = [];
  let perimeter = 0, sun = null, sunDir = new Vector3(-.62,.5,.62).normalize(), boat = null, waterFog = null, attribution = '', region = null;
  // The ground built in detail, as game x and z ranges (a few metres in from its edge); the wide view stays inside it.
  let area = null;
  // A point on the loop at fraction t, with the travel direction and the side that faces into the loop.
  function trackAt(t,out={}) {
    const f = ((t % 1)+1) % 1*SAMPLES, i = Math.floor(f), k = f-i, a = i*3, b = (i+1)*3, P = track.points, T = track.tangents;
    out.x = mix(P[a],P[b],k); out.y = mix(P[a+1],P[b+1],k); out.z = mix(P[a+2],P[b+2],k);
    let tx = mix(T[a],T[b],k), tz = mix(T[a+2],T[b+2],k);
    const n = Math.hypot(tx,tz) || 1; tx /= n; tz /= n;
    out.tx = tx; out.tz = tz;
    // up × tangent = (tz,0,-tx); `sign` turns it into the loop for either winding.
    out.nx = tz*track.sign; out.nz = -tx*track.sign;
    return out;
  }

  /* ---------- The lakeside village, built from code ---------- */
  function buildLakeside() {

  // Low evening sun from the west-south-west, warm sky light, a fresh green bounce from the grass.
  // (the pixel look: a higher, less orange sun and a pale bounce, as on the Brunstad maps: the evening light turned the
  // meadow tan and the hills' shadows into dark green slabs)
  sun = new DirectionalLight(color(kit ? '#fff1dc' : '#ffdcaa'),kit ? 2.0 : 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1024 : 2048,small ? 1024 : 2048);
  sun.shadow.bias = -.0006;
  sun.shadow.normalBias = .05;
  sun.shadow.radius = kit ? 1 : 3;
  // (the pixel look: crisp, lighter shadows, as on the Brunstad maps)
  if (kit) sun.shadow.intensity = .6;
  sunDir = (kit ? new Vector3(-.5,.9,.5) : new Vector3(-.62,.5,.62)).normalize();
  scene.add(sun,sun.target,new HemisphereLight(color('#fbf3e2'),color(kit ? '#c4c49a' : '#7f9752'),kit ? 1.3 : 1.35));

  /* The road loop. The traversal direction is chosen so that the camera, looking along up × tangent, sits outside. */
  let control = [[-74,4],[-70,-24],[-50,-42],[-18,-47],[14,-44],[44,-48],[70,-34],[82,-6],[76,22],[54,40],[20,44],[-14,43],[-46,40],[-66,28]].map(([x,z]) => new Vector3(x,0,z));
  const centre = control.reduce((sum,point) => sum.add(point),new Vector3()).multiplyScalar(1/control.length);
  {
    const probe = new CatmullRomCurve3(control,true,'centripetal');
    const look = new Vector3().crossVectors(UP,probe.getTangentAt(0));
    if (look.dot(centre.clone().sub(probe.getPointAt(0))) < 0) control = control.reverse();
  }
  const curve = new CatmullRomCurve3(control,true,'centripetal');
  curve.arcLengthDivisions = 4000;
  perimeter = curve.getLength();
  // Gentle rises and dips, always well above the water.
  const roadHeight = t => 1.3+.8*Math.sin(t*Math.PI*4+.6)+.45*Math.sin(t*Math.PI*6+2);
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i/SAMPLES, p = curve.getPointAt(t % 1), d = curve.getTangentAt(t % 1);
    track.points.set([p.x,roadHeight(t % 1),p.z],i*3);
    track.tangents.set([d.x,0,d.z].map((v,j,a) => v/Math.hypot(a[0],a[2])),i*3);
  }
  // Distance to the road centre line and the road's height there, from a coarse then a fine search.
  function nearestRoad(x,z) {
    const P = track.points;
    let best = Infinity, index = 0;
    for (let i = 0; i < SAMPLES; i += 16) { const d = (P[i*3]-x)**2+(P[i*3+2]-z)**2; if (d < best) { best = d; index = i; } }
    for (let i = index-16; i <= index+16; i++) {
      const j = ((i % SAMPLES)+SAMPLES) % SAMPLES, d = (P[j*3]-x)**2+(P[j*3+2]-z)**2;
      if (d < best) { best = d; index = j; }
    }
    return {distance:Math.sqrt(best),height:P[index*3+1],index};
  }
  function heightAt(x,z,road = nearestRoad(x,z)) {
    let h = (fbm(x/55,z/55)-.5)*2.4+(fbm(x/150+3,z/150+1)-.45)*5;
    h += smooth(-62,-150,z)*16+smooth(98,190,x)*12+smooth(-96,-190,x)*13;
    h -= smooth(SHORE-6,SHORE+8,z)*(4.5+h*.5);
    h = mix(road.height-.12,h,smooth(EDGE,EDGE+11,road.distance));
    // The lake basin, deepest in the middle.
    const e = lakeShape(x,z);
    h = mix(h,WATER-2*(1-Math.min(1,e)),smooth(1.3,.86,e));
    // The stream from the lake's south shore to the fjord, which the road crosses on a bridge.
    if (z > LAKE.z && z < SHORE+12) h = mix(h,WATER-.75,smooth(2.6,1.1,Math.abs(x-streamX(z)))*smooth(LAKE.z+5,LAKE.z+10,z));
    return h;
  }
  const inside = (x,z) => { const road = nearestRoad(x,z), p = trackAt(road.index/SAMPLES); return (x-p.x)*p.nx+(z-p.z)*p.nz > 0; };
  function findT(test) {
    const p = {};
    for (let i = 0; i < SAMPLES; i++) { trackAt(i/SAMPLES,p); if (test(p)) return i/SAMPLES; }
    return 0;
  }

  /* Terrain with painted vertex colours: meadow, gravel by the road, reeds and sand by the water, darker woods on the hills.
     The water uses the same grid, with each vertex's depth baked in for the shoreline foam. */
  const grid = {width:520,depth:430,segments:small ? 160 : 230};
  const heights = [];
  {
    const {width,depth,segments} = grid;
    const geometry = new PlaneGeometry(width,depth,segments,Math.round(segments*depth/width)).rotateX(-Math.PI/2);
    geometry.translate(centre.x,0,centre.z-30);
    area = {x0:centre.x-width/2+12,x1:centre.x+width/2-12,z0:centre.z-30-depth/2+12,z1:centre.z-30+depth/2-12};
    const position = geometry.attributes.position, colors = new Float32Array(position.count*3);
    const meadow = color('#98b55c'), gold = color('#c9c56c'), wood = color('#6f8d48'), gravel = color('#c9b590'), sand = color('#d8c79a'), rock = color('#9d9483'), dark = color('#58753d'), reed = color('#87a35a');
    // (the pixel look: the Brunstad maps' light warm sage and gold, the woods a quiet olive, so green stays an accent)
    if (kit) { meadow.set('#cfd29d'); gold.set('#d3d29f'); wood.set('#adba86'); dark.set('#96a678'); reed.set('#b6c18e'); gravel.set('#d8cba6'); }
    const tint = new Color();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i), road = nearestRoad(x,z), h = heightAt(x,z,road);
      position.setY(i,h);
      heights.push(h);
      const n = fbm(x/18,z/18), wet = smooth(.9,-.1,h-WATER);
      tint.copy(meadow).lerp(gold,smooth(.48,.78,n)*.7);
      tint.lerp(wood,smooth(2,10,h)*.7).lerp(dark,smooth(9,16,h)*.6);
      tint.lerp(gravel,1-smooth(EDGE-.6,EDGE+.6,road.distance));
      tint.lerp(z > SHORE-8 ? sand : reed,wet*.85);
      tint.lerp(rock,smooth(SHORE-1,SHORE+3,z)*.8);
      colors.set([tint.r,tint.g,tint.b],i*3);
    }
    geometry.setAttribute('color',new BufferAttribute(colors,3));
    geometry.computeVertexNormals();
    const grass = keep(grassTexture());
    grass.repeat.set(width/7,depth/7);
    grass.anisotropy = 8;
    // (no brush-stroke grass in the pixel look: at its size the strokes are only noise)
    const land = new Mesh(keep(geometry),keep(worldMaterial({vertexColors:true,map:kit ? null : grass,gradientMap:ramp},time)));
    land.receiveShadow = true;
    scene.add(land);
  }

  /* The road: a gravel shoulder under a worn asphalt ribbon with cream edge lines. */
  function ribbon(half,lift,v) {
    const segments = SAMPLES/2, position = new Float32Array((segments+1)*6), uv = new Float32Array((segments+1)*4), point = {};
    for (let i = 0; i <= segments; i++) {
      trackAt(i/segments,point);
      position.set([point.x-point.nx*half,point.y+lift,point.z-point.nz*half,point.x+point.nx*half,point.y+lift,point.z+point.nz*half],i*6);
      uv.set([0,i/segments*v,1,i/segments*v],i*4);
    }
    const index = [];
    for (let i = 0; i < segments; i++) { const a = i*2; index.push(a,a+2,a+1,a+1,a+2,a+3); }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(position,3));
    geometry.setAttribute('uv',new BufferAttribute(uv,2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    // Faces point up whichever way the loop runs.
    if (geometry.attributes.normal.getY(0) < 0) { geometry.setIndex(index.map((_,j) => index[j-(j % 3)+(2-(j % 3))])); geometry.computeVertexNormals(); }
    return keep(geometry);
  }
  {
    const shoulder = new Mesh(ribbon(EDGE-.2,.03,1),keep(worldMaterial({color:color('#c4ad86'),gradientMap:ramp},time)));
    const map = keep(roadTexture(Boolean(kit)));
    map.anisotropy = 8;
    const road = new Mesh(ribbon(ROAD/2,.07,perimeter/30),keep(worldMaterial({map,gradientMap:ramp},time)));
    shoulder.receiveShadow = road.receiveShadow = true;
    scene.add(shoulder,road);
  }

  /* Buildings: Norwegian wooden houses with white corner boards, a white church, a red barn, a boathouse, a pier, a bridge. */
  const solid = parts(), ink = parts(), glow = parts();
  const occupied = [];
  const INK = '#3a2c22';
  function box(target,w,h,d,hex,at) { target.add(new BoxGeometry(w,h,d),hex,at); }
  function outlineBox(w,h,d,at) { ink.add(new BoxGeometry(w+.16,h+.16,d+.16),INK,at); }
  function gable(d,rise,length,hex,at) {
    const shape = new Shape();
    shape.moveTo(-d/2,0); shape.lineTo(d/2,0); shape.lineTo(0,rise); shape.closePath();
    const geometry = new ExtrudeGeometry(shape,{depth:length,bevelEnabled:false});
    geometry.translate(0,0,-length/2);
    solid.add(geometry,hex,{...at,ry:(at.ry || 0)+Math.PI/2});
  }
  // The pixel look lifts the charcoal roofs to warm greys and browns: under its palette they were the heaviest, navy
  // blocks of the picture.
  const ROOF_TONES = {'#3f3b38':'#857169','#5a4a42':'#8d6c5a','#4a3f3a':'#8a6658','#3e4247':'#77767e','#2f2b29':'#625754'};
  const tone = hex => (kit && ROOF_TONES[hex]) || hex;
  function house(base,yaw,{w=8,d=6,h=4.6,wall='#a8412f',roof='#3f3b38',trim='#f1ebde',door='#2f4a3c',lit=.5,chimney=true,seed=1}={}) {
    roof = tone(roof);
    const r = random(seed), y0 = heightAt(base.x,base.z)+.05;
    occupied.push({x:base.x,z:base.z,r:Math.max(w,d)*.62+1.2});
    const at = (dx,dy,dz,extra={}) => ({...place(base,yaw,dx,dz),y:y0+dy,ry:yaw,...extra});
    box(solid,w+.4,.8,d+.4,'#8a8477',at(0,.2,0)); outlineBox(w+.4,.8,d+.4,at(0,.2,0));
    box(solid,w,h,d,wall,at(0,.6+h/2,0)); outlineBox(w,h,d,at(0,.6+h/2,0));
    for (const [sx,sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) box(solid,.22,h,.22,trim,at(sx*w/2,.6+h/2,sz*d/2));
    // Roof: two slabs over a gable of the wall colour, with an overhang all round.
    const pitch = .66, rise = Math.tan(pitch)*d/2, top = .6+h, slab = (d/2+.55)/Math.cos(pitch);
    gable(d,rise,w,wall,at(0,top,0));
    for (const side of [-1,1]) {
      const a = at(0,top+rise/2+.12,side*d/4,{rx:side*pitch});
      box(solid,w+.9,.26,slab,roof,a);
      ink.add(new BoxGeometry(w+1.04,.4,slab+.14),INK,a);
    }
    box(solid,w+.95,.22,.34,roof === '#7c9147' ? '#6c7f3e' : tone('#2f2b29'),at(0,top+rise+.2,0));
    if (chimney) { box(solid,.7,1.5,.7,'#8b4a3a',at(w*.22,top+rise*.6+.6,-d*.12)); outlineBox(.7,1.5,.7,at(w*.22,top+rise*.6+.6,-d*.12)); }
    // Windows on both long sides; some glow warm in the evening.
    const count = Math.max(1,Math.floor((w-1.5)/2.4));
    for (const side of [-1,1]) for (let i = 0; i < count; i++) {
      const dx = (i-(count-1)/2)*2.4, dz = side*(d/2+.04);
      if (side === 1 && count > 1 && i === Math.floor(count/2)) continue;
      box(solid,1.08,1.3,.14,trim,at(dx,.6+h*.56,dz));
      const warm = r() < lit;
      (warm ? glow : solid).add(new BoxGeometry(.8,1.02,.18),warm ? '#ffcf7a' : '#3f4c52',at(dx,.6+h*.56,dz));
      box(solid,.84,.06,.2,trim,at(dx,.6+h*.56,dz));
    }
    // The front door faces the road, with a step and a flower box.
    box(solid,1.3,2.3,.16,trim,at(0,.6+1.15,d/2+.05));
    box(solid,1.0,2.08,.2,door,at(0,.6+1.06,d/2+.07));
    box(solid,1.8,.16,1.1,'#7b7468',at(0,.68,d/2+.55));
    if (count > 1) box(solid,1.1,.28,.36,'#c45a6a',at(-2.4*Math.floor(count/2)+((count+1) % 2)*1.2,.6+h*.56-.78,d/2+.22));
  }
  // Things that stand beside the road: fraction of the loop, side (+1 inside, -1 outside), set-back from the centre line.
  function roadside(t,side,back) {
    const p = trackAt(t);
    const base = {x:p.x+p.nx*side*back,z:p.z+p.nz*side*back};
    return {base,yaw:Math.atan2(p.x-base.x,p.z-base.z),p};
  }
  // The camera always looks north, so buildings stand on the north side of the road and face south, towards it.
  const northSide = t => trackAt(t).nz < 0 ? 1 : -1;
  const WALLS = ['#a8412f','#efe9dd','#d7a446','#a8412f','#9fb2b6','#efe9dd','#c4583c'];
  const ROOFS = ['#3f3b38','#7c9147','#874a3b','#3f3b38','#5a4a42'];
  // The village lines the north road on its far side, house fronts to the road and to the camera.
  const north = [];
  for (let i = 0; i <= SAMPLES; i += 8) { const p = trackAt(i/SAMPLES); if (p.z < -32) north.push(i/SAMPLES); }
  const villageFrom = Math.min(...north), villageTo = Math.max(...north), churchT = (villageFrom+villageTo)/2;
  const gates = [];
  {
    const r = random(11);
    let n = 0;
    for (let t = villageFrom+.008; t < villageTo-.008; t += .021) {
      if (Math.abs(t-churchT) < .028 || r() < .12) continue;
      const w = 7+r()*3, d = 5.5+r()*1.8, back = EDGE+1.4+d/2+r()*2.2, at = t+(r()-.5)*.004;
      const {base,yaw} = roadside(at,northSide(at),back);
      if (heightAt(base.x,base.z) < WATER+.5) continue;
      house(base,yaw,{w,d,h:3.8+r()*1.4,wall:WALLS[n % WALLS.length],roof:ROOFS[(n*3+1) % ROOFS.length],seed:n+3,lit:.55});
      gates.push(at);
      n++;
    }
    // A few more homes along the other sides, set further back.
    for (const [t,back,seed] of [[.06,13,51],[.13,15,52],[.31,14,53],[.47,13,54],[.53,16,55],[.94,14,56]]) {
      const tt = (villageTo+t) % 1, {base,yaw} = roadside(tt,northSide(tt),back);
      if (lakeShape(base.x,base.z) < 1.6 || heightAt(base.x,base.z) < WATER+.5) continue;
      house(base,yaw,{w:7+seed % 3,d:6,h:4.2,wall:WALLS[seed % WALLS.length],roof:ROOFS[seed % ROOFS.length],seed,lit:.45});
      gates.push(tt);
    }
  }
  // The white church across the road from the middle of the village, with a tall slate spire.
  {
    const {base,yaw} = roadside(churchT,northSide(churchT),EDGE+13), y0 = heightAt(base.x,base.z)+.05;
    occupied.push({x:base.x,z:base.z,r:11});
    const at = (dx,dy,dz,extra={}) => ({...place(base,yaw,dx,dz),y:y0+dy,ry:yaw,...extra});
    box(solid,15.4,.8,8.4,'#8a8477',at(0,.2,0));
    box(solid,15,6,8,'#f3eee2',at(0,3.6,0)); outlineBox(15,6,8,at(0,3.6,0));
    gable(8,3.8,15,'#f3eee2',at(0,6.6,0));
    for (const side of [-1,1]) { const a = at(0,8.6,side*2,{rx:side*.76}); box(solid,15.9,.3,6,tone('#3e4247'),a); ink.add(new BoxGeometry(16.1,.45,6.15),INK,a); }
    box(solid,3.6,10,3.6,'#f3eee2',at(-8.4,5.6,0)); outlineBox(3.6,10,3.6,at(-8.4,5.6,0));
    const spire = at(-8.4,13.6,0,{ry:yaw+Math.PI/4});
    solid.add(new ConeGeometry(2.7,7.5,4),tone('#3e4247'),{...spire,y:spire.y+3.75});
    ink.add(new ConeGeometry(2.85,7.7,4),INK,{...spire,y:spire.y+3.75});
    for (let i = 0; i < 4; i++) for (const side of [-1,1]) {
      box(solid,1,2.6,.16,'#f9f6ee',at(-4+i*2.8,3.9,side*4.05));
      glow.add(new BoxGeometry(.7,2.2,.2),'#ffd58a',at(-4+i*2.8,3.9,side*4.05));
    }
    box(solid,1.9,3.2,.2,'#5b3a2a',at(-8.4,1.6+.6,1.85));
    gates.push(churchT);
  }
  // A red barn on the east side with white X-braced doors.
  {
    const t = findT(p => p.x > 72 && Math.abs(p.z) < 8), {base,yaw} = roadside(t,1,EDGE+9);
    house(base,yaw,{w:13,d:9,h:5.5,wall:'#9c3a2b',roof:'#4a3f3a',chimney:false,lit:0,seed:91});
    const y0 = heightAt(base.x,base.z)+.05;
    const at = (dx,dy,dz,extra={}) => ({...place(base,yaw,dx,dz),y:y0+dy,ry:yaw,...extra});
    for (const rz of [.82,-.82]) box(solid,.22,3.9,.22,'#f1ebde',at(0,2.5,4.62,{rz}));
  }
  // A boathouse on the lake's west shore, a pier from its south shore, and a rowing boat.
  {
    const base = {x:LAKE.x-LAKE.ax+1.5,z:LAKE.z+1};
    house(base,Math.PI/2,{w:5,d:6.5,h:3.2,wall:'#a8412f',roof:'#3f3b38',chimney:false,lit:0,seed:300});
    const y = WATER+.62, px = LAKE.x+6, pz = LAKE.z+LAKE.az-4.5;
    box(solid,2.2,.22,10,'#8a6a4c',{x:px,y,z:pz});
    ink.add(new BoxGeometry(2.34,.36,10.14),INK,{x:px,y,z:pz});
    for (let i = 0; i < 4; i++) for (const s of [-1,1]) solid.add(new CylinderGeometry(.13,.13,2.2,6),'#5d4636',{x:px+s*1,y:y-1,z:pz-4.4+i*2.9});
    occupied.push({x:px,z:pz,r:5});
  }
  // Boathouses and a long pier on the fjord shore beyond the south side.
  {
    for (const [x,wall] of [[-38,'#a8412f'],[-30,'#8f3a2c'],[34,'#a8412f'],[44,'#c4583c']]) house({x,z:SHORE+2},0,{w:4.6,d:7,h:3.2,wall,roof:'#3f3b38',chimney:false,lit:0,seed:x+400});
    const px = 8, y = WATER+1.1;
    box(solid,3,.24,20,'#8a6a4c',{x:px,y,z:SHORE+9});
    ink.add(new BoxGeometry(3.14,.38,20.14),INK,{x:px,y,z:SHORE+9});
    for (let i = 0; i < 7; i++) for (const s of [-1,1]) solid.add(new CylinderGeometry(.16,.16,3,6),'#5d4636',{x:px+s*1.4,y:y-1.4,z:SHORE+.5+i*3.2});
    occupied.push({x:px,z:SHORE+9,r:3});
  }
  // A few homes outside the loop on the east and west sides, facing the road.
  for (const [test,seed] of [[p => p.x < -66 && p.z < -8,61],[p => p.x < -60 && p.z > 18,62],[p => p.x > 76 && p.z > 8,63],[p => p.x > 60 && p.z < -36,64]]) {
    const {base,yaw} = roadside(findT(test),-1,EDGE+9);
    if (base.z < SHORE-8) house(base,yaw,{w:8,d:6,h:4.4,wall:WALLS[seed % WALLS.length],roof:ROOFS[seed % ROOFS.length],seed,lit:.4});
  }
  // The bridge where the road crosses the stream: white rails on both sides over stone ends.
  {
    const t = findT(p => Math.abs(p.x-streamX(p.z)) < .6 && p.z > LAKE.z+8), p = trackAt(t), step = 1.1/perimeter;
    for (const side of [-1,1]) {
      for (let k = -4; k <= 4; k++) {
        const q = trackAt(t+k*step), x = q.x+q.nx*side*(ROAD/2+.35), z = q.z+q.nz*side*(ROAD/2+.35), yaw = Math.atan2(q.tx,q.tz);
        box(solid,.16,1.1,.16,'#f1ebde',{x,y:q.y+.6,z,ry:yaw});
        if (k < 4) { const n = trackAt(t+(k+.5)*step); box(solid,.1,.12,1.2,'#f1ebde',{x:n.x+n.nx*side*(ROAD/2+.35),y:n.y+1.05,z:n.z+n.nz*side*(ROAD/2+.35),ry:Math.atan2(n.tx,n.tz)}); }
      }
      for (const k of [-5.5,5.5]) {
        const q = trackAt(t+k*step);
        box(solid,1.4,1.6,1.4,'#9a9284',{x:q.x+q.nx*side*(ROAD/2+.5),y:q.y-.1,z:q.z+q.nz*side*(ROAD/2+.5),ry:Math.atan2(q.tx,q.tz)});
      }
      // A plank fascia under each edge hides the gap over the water.
      for (let k = -4; k < 4; k++) {
        const q = trackAt(t+(k+.5)*step);
        box(solid,.2,1.4,1.12,'#7b5f45',{x:q.x+q.nx*side*(ROAD/2+1),y:q.y-.62,z:q.z+q.nz*side*(ROAD/2+1),ry:Math.atan2(q.tx,q.tz)});
      }
    }
    occupied.push({x:p.x,z:p.z,r:6});
  }
  // White picket fences along the village gardens, opening at each gate, and lamp posts by the road.
  const lamps = [];
  {
    const step = 1.15/perimeter;
    for (let t = villageFrom; t < villageTo; t += step) {
      if (gates.some(g => Math.abs(g-t) < .0045)) continue;
      const side = northSide(t), q = trackAt(t), x = q.x+q.nx*side*(EDGE+.6), z = q.z+q.nz*side*(EDGE+.6), yaw = Math.atan2(q.tx,q.tz), y = heightAt(x,z)-.05;
      box(solid,.1,.9,.1,'#f4efe4',{x,y:y+.45,z,ry:yaw});
      box(solid,.05,.08,1.15,'#f4efe4',{x,y:y+.62,z,ry:yaw});
      box(solid,.05,.08,1.15,'#f4efe4',{x,y:y+.3,z,ry:yaw});
    }
    for (let t = villageFrom+.01; t < villageTo; t += 24/perimeter) {
      const side = northSide(t), q = trackAt(t), x = q.x+q.nx*side*(EDGE-.1), z = q.z+q.nz*side*(EDGE-.1), y = heightAt(x,z);
      solid.add(new CylinderGeometry(.07,.1,3.8,6),'#2f3330',{x,y:y+1.9,z});
      box(solid,.5,.12,.5,'#2f3330',{x,y:y+3.85,z});
      glow.add(new BoxGeometry(.34,.46,.34),'#ffd88f',{x,y:y+3.55,z});
      lamps.push({x,y:y+3.55,z});
    }
  }
  {
    const material = keep(worldMaterial({vertexColors:true,gradientMap:ramp},time));
    const village = new Mesh(keep(solid.build()),material);
    village.castShadow = village.receiveShadow = true;
    const outline = new Mesh(keep(ink.build()),keep(new MeshBasicMaterial({vertexColors:true,side:BackSide,fog:true})));
    const windows = new Mesh(keep(glow.build()),keep(new MeshBasicMaterial({vertexColors:true,fog:true})));
    scene.add(village,outline,windows);
  }

  /* Trees, rocks, flowers, grass tufts, reeds and hay bales: instanced, the bigger ones with an ink shell for the outline. */
  function plant(kind) {
    const body = parts(), shell = parts();
    const blobs = (list,palette,ink) => list.forEach(([x,y,z,radius],i) => {
      body.add(new IcosahedronGeometry(radius,1),palette[i % palette.length],{x,y,z,sy:.86});
      shell.add(new IcosahedronGeometry(radius+.12,1),ink,{x,y,z,sy:.86});
    });
    if (kind === 'pine') {
      body.add(new CylinderGeometry(.22,.34,2.4,6),'#5b4130',{y:1.2});
      [[2.5,0],[2.05,1.9],[1.55,3.6],[1.0,5.1]].forEach(([radius,y],i) => {
        body.add(new ConeGeometry(radius,2.9,7),['#3f6b3c','#47753f','#4f7e43','#5a8848'][i],{y:2+y+1.45});
        shell.add(new ConeGeometry(radius+.13,3.05,7),'#22301c',{y:2+y+1.45});
      });
    } else if (kind === 'birch') {
      body.add(new CylinderGeometry(.16,.22,5.2,6,5),'#ece6da',{y:2.6});
      for (const y of [1.2,2.3,3.4]) body.add(new CylinderGeometry(.225,.225,.12,6),'#3b3530',{y});
      // (the pixel look's birches a little greener: their yellow tops turned a tan patch in the sun)
      blobs([[0,5.6,0,1.9],[.9,4.7,.4,1.4],[-.8,4.9,-.3,1.5],[.2,6.5,-.2,1.3]],kit ? ['#a8bc68','#b3c270','#9cb262','#b8c476'] : ['#b4c55c','#c6ca68','#a6bb54','#d0c76a'],'#33401f');
    } else if (kind === 'oak') {
      body.add(new CylinderGeometry(.3,.45,3,6),'#5d4636',{y:1.5});
      blobs([[0,4.3,0,2.5],[1.6,3.7,.6,1.8],[-1.5,3.8,-.4,1.9],[.3,5.3,-.8,1.7]],['#7fa24a','#8fae53','#76984a','#9cb75a'],'#2c3a1d');
    } else if (kind === 'bush') {
      blobs([[0,.7,0,1],[.8,.55,.2,.75],[-.7,.6,-.1,.8]],['#7a9e48','#8aaa51','#6f9344'],'#2c3a1d');
    } else if (kind === 'rock') {
      body.add(new DodecahedronGeometry(1,0),'#a39a8b',{sy:.62});
      shell.add(new DodecahedronGeometry(1.08,0),'#3a3229',{sy:.65});
    } else if (kind === 'stone') {
      body.add(new DodecahedronGeometry(.42,0),'#a8a092',{sy:.7});
      body.add(new DodecahedronGeometry(.36,0),'#958d80',{x:.5,y:.05,sy:.75});
      body.add(new DodecahedronGeometry(.3,0),'#b2ab9e',{x:.25,y:.42,sy:.7});
    } else if (kind === 'tuft') {
      for (let i = 0; i < 6; i++) { const a = i/6*Math.PI*2; body.add(new ConeGeometry(.05,.55+(i % 3)*.12,4),i % 2 ? '#7d9e46' : '#9db85a',{x:Math.cos(a)*.12,y:.3,z:Math.sin(a)*.12,rx:Math.sin(a)*.3,rz:-Math.cos(a)*.3}); }
    } else if (kind === 'reed') {
      for (let i = 0; i < 7; i++) { const a = i/7*Math.PI*2; body.add(new ConeGeometry(.04,1.4+(i % 3)*.3,4),i % 2 ? '#6f8f43' : '#8aa654',{x:Math.cos(a)*.18,y:.75,z:Math.sin(a)*.18,rx:Math.sin(a)*.15,rz:-Math.cos(a)*.15}); }
      body.add(new CylinderGeometry(.07,.07,.32,6),'#6b4a30',{y:1.75});
    } else if (kind.startsWith('lupin')) {
      const bloom = {lupin:'#8e6cc4',lupinPink:'#d48aac',lupinWhite:'#efeaf2'}[kind];
      body.add(new ConeGeometry(.15,.85,6),bloom,{y:.78});
      body.add(new CylinderGeometry(.03,.03,.5,4),'#5d7d3c',{y:.25});
    } else if (kind === 'daisy') {
      for (let i = 0; i < 3; i++) body.add(new IcosahedronGeometry(.09,0),i ? '#f7f3e6' : '#f2c94c',{x:(i-1)*.22,y:.18+(i % 2)*.06,z:(i % 2)*.15});
    } else if (kind === 'bale') {
      body.add(new CylinderGeometry(.75,.75,1.2,14),'#f3efe6',{y:.75,rz:Math.PI/2});
      shell.add(new CylinderGeometry(.85,.85,1.32,14),'#4a4237',{y:.75,rz:Math.PI/2});
    }
    return {body:body.build(),shell:shell.size ? shell.build() : null};
  }
  const TALL = new Set(['pine','birch','oak']);
  const forest = {};
  {
    const r = random(29);
    const add = (kind,x,z,s) => {
      (forest[kind] ||= []).push({x,z,s,ry:r()*Math.PI*2,y:heightAt(x,z)});
      if (!['tuft','daisy','reed','lupin','lupinPink','lupinWhite','stone'].includes(kind)) occupied.push({x,z,r:kind === 'bush' || kind === 'rock' ? 1 : 1.6*s});
    };
    const dry = (x,z) => heightAt(x,z) > WATER+.35 && lakeShape(x,z) > 1.08 && Math.abs(x-streamX(z)) > 2.8;
    const clear = (x,z,margin) => !occupied.some(item => (item.x-x)**2+(item.z-z)**2 < (item.r+margin)**2);
    // Beside the road: `bands` are [side, from, to] in metres from the centre line. The camera side (-1) only gets low things.
    const along = (kind,count,bands,scale,margin=1.2) => {
      let tries = 0;
      const have = () => (forest[kind] || []).length;
      const start = have();
      while (have()-start < count && tries++ < count*30) {
        const [side,from,to] = bands[Math.floor(r()*bands.length)];
        const q = trackAt(r()), back = from+r()*(to-from), x = q.x+q.nx*side*back, z = q.z+q.nz*side*back;
        if (!dry(x,z) || (margin && !clear(x,z,margin))) continue;
        add(kind,x,z,scale[0]+r()*(scale[1]-scale[0]));
      }
    };
    // Away from the road, for the view at the start.
    const far = (kind,count,where,scale) => {
      let tries = 0;
      const have = () => (forest[kind] || []).length;
      const start = have();
      while (have()-start < count && tries++ < count*40) {
        const x = centre.x+(r()-.5)*400, z = centre.z-30+(r()-.5)*320;
        if (!where(x,z) || !dry(x,z) || !clear(x,z,1.5)) continue;
        const road = nearestRoad(x,z);
        if (road.distance < (inside(x,z) ? 9 : 16)) continue;
        add(kind,x,z,scale[0]+r()*(scale[1]-scale[0]));
      }
    };
    const tight = small ? .55 : 1;
    // Hay bales on the east meadow, inside.
    for (let i = 0; i < 9; i++) { const {base} = roadside(findT(p => p.x > 60 && p.z > 14)+i*.006,1,EDGE+5+(i % 3)*3); if (dry(base.x,base.z) && clear(base.x,base.z,1)) add('bale',base.x,base.z,1); }
    for (let i = 0; i < 8; i++) { const {base} = roadside(findT(p => p.x > 30 && p.z < -40)+i*.007,-1,EDGE+8+(i % 2)*4); if (dry(base.x,base.z) && clear(base.x,base.z,1)) add('bale',base.x,base.z,1); }
    // Reeds round the lake.
    for (let i = 0; i < 110*tight; i++) { const a = r()*Math.PI*2, k = .96+r()*.16, x = LAKE.x+Math.cos(a)*LAKE.ax*k, z = LAKE.z+Math.sin(a)*LAKE.az*k; if (clear(x,z,.4)) add('reed',x,z,.7+r()*.5); }
    const E = EDGE;
    along('birch',Math.round(80*tight),[[1,E+3,E+26],[-1,E+8,E+26]],[.85,1.2],1.5);
    along('oak',Math.round(36*tight),[[1,E+5,E+28],[-1,E+9,E+28]],[.85,1.15],2);
    along('pine',Math.round(60*tight),[[1,E+5,E+30],[-1,E+9,E+34]],[.8,1.25],1.6);
    along('bush',Math.round(120*tight),[[1,E,E+22],[-1,E+1,E+22]],[.6,1.2],.8);
    if (!kit) along('stone',Math.round(220*tight),[[-1,E+.2,E+.6]],[.8,1.2],0);
    if (!kit) along('rock',Math.round(46*tight),[[1,E,E+20],[-1,E+2,E+20]],[.4,1.1],.8);
    // (the pixel look leaves out the grass tufts, daisies, lupins, roadside stones and rocks: specks of a pixel or two)
    const specks = kit ? 0 : 1;
    if (!kit) along('tuft',Math.round(1500*tight),[[1,E-.6,E+22],[-1,E-.6,E+22]],[.8,1.4],0);
    along('lupin',Math.round(220*tight*specks),[[1,E-.4,E+18],[-1,E-.4,E+16]],[.8,1.3],0);
    along('lupinPink',Math.round(150*tight*specks),[[1,E-.4,E+18],[-1,E-.4,E+16]],[.8,1.3],0);
    along('lupinWhite',Math.round(90*tight*specks),[[1,E-.4,E+18],[-1,E-.4,E+16]],[.8,1.3],0);
    if (!kit) along('daisy',Math.round(340*tight),[[1,E-.6,E+20],[-1,E-.6,E+18]],[.8,1.3],0);
    far('pine',Math.round(170*tight),(x,z) => !inside(x,z) && z < SHORE-6,[.85,1.4]);
    far('birch',Math.round(40*tight),(x,z) => inside(x,z),[.85,1.2]);
  }
  {
    const material = keep(worldMaterial({vertexColors:true,gradientMap:ramp},time));
    const shellMaterial = keep(new MeshBasicMaterial({vertexColors:true,side:BackSide,fog:true}));
    const matrix = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3(), tint = new Color(), r = random(41), euler = new Euler();
    for (const [kind,items] of Object.entries(forest)) {
      if (!items.length) continue;
      const {body,shell} = plant(kind);
      const make = (geometry,mat) => {
        const mesh = new InstancedMesh(keep(geometry),mat,items.length);
        items.forEach((item,i) => {
          q.setFromEuler(euler.set(0,item.ry,0)); s.setScalar(item.s); p.set(item.x,item.y-.06,item.z);
          mesh.setMatrixAt(i,matrix.compose(p,q,s));
          if (mat === material) mesh.setColorAt(i,tint.setHSL(.1+r()*.05,.12,.92+r()*.08));
        });
        mesh.castShadow = mat === material && (TALL.has(kind) || kind === 'bush' || kind === 'bale' || kind === 'rock');
        mesh.receiveShadow = mat === material;
        scene.add(mesh);
        instanced.push(mesh);
      };
      make(body,material);
      if (shell) make(shell,shellMaterial);
    }
  }

  /* Water: lake, stream and fjord share one surface. Depth is baked per vertex: shallow water is lighter, the shore foams. */
  {
    const {width,depth,segments} = grid;
    const geometry = new PlaneGeometry(width,depth,segments,Math.round(segments*depth/width)).rotateX(-Math.PI/2);
    geometry.translate(centre.x,WATER,centre.z-30);
    geometry.setAttribute('depth',new BufferAttribute(new Float32Array(heights.map(h => WATER-h)),1));
    const material = new ShaderMaterial({
      uniforms:{uTime:time,deep:{value:color('#3d6c84')},shallow:{value:color('#86b7b8')},glint:{value:color('#ffd690')},foam:{value:color('#f8f4e6')},hazeColor:{value:haze},near:{value:90},far:{value:320},
        bands:{value:[color('#a6dbd3'),color('#5fb4c8'),color('#3384ab')]}},
      defines:kit ? {PIXEL:''} : {},
      vertexShader:`attribute float depth;varying float vDepth;varying vec3 vWorld;
        void main(){vDepth=depth;vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader:`uniform float uTime;uniform vec3 deep,shallow,glint,foam,hazeColor,bands[3];uniform float near,far;varying float vDepth;varying vec3 vWorld;
        float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
        void main(){
          if(vDepth<-.4)discard;
          float d=max(vDepth,0.0);
          #ifdef PIXEL
          // The pixel look: the Brunstad sea's three clean bands by depth and a crisp line of foam at the shore; no
          // drifting light bands or glints, which read as blots at its size.
          vec3 c=d<.9?bands[0]:d<2.4?bands[1]:bands[2];
          c=mix(c,foam,step(d,.16)*.9);
          #else
          vec3 c=mix(shallow,deep,smoothstep(.2,3.2,d));
          float band=n(vec2(vWorld.x*.08+uTime*.05,vWorld.z*.5-uTime*.12))*n(vec2(vWorld.x*.03-uTime*.03,vWorld.z*.22));
          c=mix(c,shallow*1.1,smoothstep(.42,.6,band)*.5);
          // A few slow gold glints, not a field of flecks.
          float sparkle=n(vWorld.xz*vec2(.32,.55)+vec2(uTime*.25,-uTime*.1))*n(vWorld.xz*vec2(.11,.2)-vec2(uTime*.05,0.0));
          c+=glint*smoothstep(.62,.8,sparkle)*.45;
          float edge=1.0-smoothstep(0.0,.22+.08*sin(uTime*1.4+vWorld.x*.5+vWorld.z*.3),d);
          c=mix(c,foam,edge*.85);
          #endif
          float fog=smoothstep(near,far,distance(cameraPosition,vWorld));
          gl_FragColor=vec4(mix(c,hazeColor,fog),1.0);
          #include <colorspace_fragment>
        }`,
    });
    scene.add(new Mesh(keep(geometry),keep(material)));
    waterFog = material.uniforms;
  }
  // A rowing boat on the lake by the pier, rocking gently.
  boat = new Group();
  {
    const hull = parts();
    hull.add(new BoxGeometry(1.4,.45,3.6),'#f1ebde',{y:.22});
    hull.add(new BoxGeometry(1.46,.15,3.66),'#a8412f',{y:.5});
    hull.add(new BoxGeometry(1.3,.06,.3),'#8a6a4c',{y:.42,z:.4});
    boat.add(new Mesh(keep(hull.build()),keep(worldMaterial({vertexColors:true,gradientMap:ramp},time))));
    boat.position.set(LAKE.x+9.5,WATER+.02,LAKE.z+LAKE.az-6);
    boat.rotation.y = .5;
    scene.add(boat);
  }
  // Far mountains across the fjord, seen when the camera rises over the loop at the start.
  {
    const ridge = parts(), r = random(73);
    for (let i = 0; i < 14; i++) {
      const x = centre.x-420+i*62+r()*30, z = SHORE+300+r()*80, h = 70+r()*90, base = 55+r()*40;
      ridge.add(new ConeGeometry(base,h,6),'#8a9bab',{x,y:h/2-6,z,ry:r()});
      ridge.add(new ConeGeometry(base*.32,h*.3,6),'#eef0f2',{x,y:h-h*.15-6,z,ry:r()});
    }
    scene.add(new Mesh(keep(ridge.build()),keep(new MeshBasicMaterial({vertexColors:true,fog:true}))));
  }
  // Soft halos round the lamps.
  for (const lamp of lamps) {
    const halo = new Sprite(keep(new SpriteMaterial({map:glowMap,color:color('#ffcf7a'),transparent:true,opacity:.55,blending:AdditiveBlending,depthWrite:false})));
    halo.position.set(lamp.x,lamp.y,lamp.z);
    halo.scale.setScalar(2.6);
    scene.add(halo);
  }
  }

  /* ---------- A Brunstad region, modelled in three.js from measured data (chase-brunstad.mjs) ---------- */
  let brunstad = null;
  async function loadRegion() {
    const data = await fetch(map.manifest).then(response => { if (!response.ok) throw new Error(`map: HTTP ${response.status}`); return response.json(); });
    brunstad = await module.buildBrunstad({url:name => map.files[name],extent:data.extent,loop:data.loop.points.map(point => [point[0],point[2]]),small,time,renderer,style:look,
      anisotropy:Math.min(8,renderer.capabilities.getMaxAnisotropy())});
    region = brunstad.group;
    scene.add(region);
    const L = brunstad.lighting;
    scene.add(new HemisphereLight(color(L.hemiSky),color(L.hemiGround),L.hemiIntensity));
    sun = new DirectionalLight(color(L.sunColor),L.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(small ? 1024 : 2048,small ? 1024 : 2048);
    sun.shadow.bias = -.0004;
    sun.shadow.normalBias = .12;
    // (the pixel look's shadows have a clean edge: a soft one only turns into a dithered smear)
    sun.shadow.radius = kit ? 1 : 3;
    // Shade, not black: tall buildings' shadows fall across whole squares.
    sun.shadow.intensity = L.shadow;
    sunDir = new Vector3(...L.sunDir).normalize();
    scene.add(sun,sun.target);
    scene.background = color(L.fog); scene.fog.color = color(L.fog);
    // The region's sky, prefiltered: the ambient light and the reflections in glass and water.
    if (brunstad.environment) { scene.environment = brunstad.environment; scene.environmentIntensity = L.environmentIntensity ?? 1; }
    if (Array.isArray(data.extent) && data.extent.length === 4) { const [x0,z0,x1,z1] = data.extent; area = {x0:x0+12,z0:z0+12,x1:x1-12,z1:z1-12}; }
    // The loop, resampled evenly by distance and set on the modelled road; tangents from the neighbours on either side.
    const points = data.loop.points, n = points.length, lengths = [0];
    for (let i = 1; i <= n; i++) { const a = points[i-1], b = points[i % n]; lengths.push(lengths[i-1]+Math.hypot(b[0]-a[0],b[2]-a[2])); }
    perimeter = lengths[n];
    for (let i = 0, j = 0; i <= SAMPLES; i++) {
      const s = i/SAMPLES*perimeter;
      while (j < n-1 && lengths[j+1] < s) j++;
      const a = points[j], b = points[(j+1) % n], k = Math.min(1,(s-lengths[j])/Math.max(1e-6,lengths[j+1]-lengths[j]));
      const x = mix(a[0],b[0],k), z = mix(a[2],b[2],k);
      track.points.set([x,brunstad.roadHeight(x,z),z],i*3);
    }
    for (let i = 0; i <= SAMPLES; i++) {
      const before = ((i-2) % SAMPLES+SAMPLES) % SAMPLES, after = (i+2) % SAMPLES, P = track.points;
      const dx = P[after*3]-P[before*3], dz = P[after*3+2]-P[before*3+2], length = Math.hypot(dx,dz) || 1;
      track.tangents.set([dx/length,0,dz/length],i*3);
    }
    const widths = [...data.loop.road_width_m].sort((a,b) => a-b);
    track.roadWidth = widths[widths.length >> 1] || 5;
    const probe = trackAt(0), outward = data.loop.outward_xz || [0,0,0];
    if (probe.nx*outward[0]+probe.nz*outward[2] > 0) track.sign = -1;
    attribution = data.attribution || brunstad.attribution || '';
  }
  function release() {
    disposed = true;
    canvas.removeEventListener('webglcontextlost',lost);
    for (const item of disposables) item.dispose?.();
    for (const mesh of instanced) mesh.dispose?.();
    // glTF textures arrive as ImageBitmaps, which dispose() does not close.
    region?.traverse(object => {
      const map = object.material?.map;
      if (map) { map.source?.data?.close?.(); map.dispose(); }
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    brunstad?.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
  const isLost = () => gone || renderer.getContext()?.isContextLost?.() === true;
  try {
    if (map.kind === 'brunstad') await loadRegion(); else buildLakeside();
  } catch (error) {
    const card = isLost();
    release();
    throw card ? graphics(error) : error;
  }
  // (a context lost while building, before anyone listens for it, would otherwise leave a blank picture)
  if (isLost()) { release(); throw graphics(new Error('WebGL context lost while building the scene')); }
  // The pixel look's finish: the region's own, or the kit's for the lakeside village (its bright evening light a little
  // lower, so it sits on the same palette; its ink shells give way to the finish's one-pixel outlines).
  let pixel = null;
  if (kit) {
    if (brunstad?.finish?.pixel) pixel = brunstad.finish;
    else if (!brunstad && renderer.capabilities.isWebGL2) {
      const own = keep(kit.createFinish(renderer,{grade:'painted',saturation:1.04,exposure:.95}));
      pixel = {pixel:true,setSize:own.setSize,snap:own.snap,align:own.align,setFine:own.setFine,render:(s,c) => own.render(s,c),dispose:own.dispose};
      scene.traverse(object => { if (object.material?.side === BackSide) object.visible = false; });
    }
  }
  // Every map is at true scale, so sizes need no adjusting (unit stays 1; it is kept for the few places that scale).
  const unit = 1;
  const laneWidth = Math.min(LANE*unit,track.roadWidth*.45);

  /* ---------- Runners ---------- */
  // The pixel look's cast is drawn in code (cast.sprites, in art pixels): sampled pixel for pixel, in the palette's
  // own sRGB bytes (the finish draws runners straight onto its finished picture).
  const pixelTexture = entry => {
    const texture = new CanvasTexture(entry.canvas);
    texture.colorSpace = NoColorSpace;
    texture.magFilter = texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    return keep(texture);
  };
  if (cast) manifest = {...manifest,sprites:Object.fromEntries(Object.entries(cast.sprites).map(([name,s]) => [name,{frames:s.frames,w:s.w,h:s.h}]))};
  const shadowMap = cast ? pixelTexture(cast.effects.shadow) : keep(shadowTexture()), rotorMap = cast ? pixelTexture(cast.effects.rotor) : keep(rotorTexture());
  const dustImage = cast ? {ok:true} : images.get('dust');
  const dustMap = cast ? pixelTexture(cast.sprites.dust) : keep(new Texture(dustImage?.image));
  if (!cast) { dustMap.colorSpace = SRGBColorSpace; dustMap.needsUpdate = Boolean(dustImage?.ok); }
  const flashMaps = cast ? [pixelTexture(cast.effects.flashRed),pixelTexture(cast.effects.flashBlue)] : null;
  const glintPixel = cast ? pixelTexture(cast.effects.glint) : null;
  const ringMaps = new Map();
  const sheets = new Map();
  function sheet(name) {
    if (sheets.has(name)) return sheets.get(name);
    if (cast) {
      const drawn = cast.sprites[name];
      if (!drawn) return null;
      const texture = pixelTexture(drawn);
      sheets.set(name,texture);
      return texture;
    }
    const entry = images.get(name);
    if (!entry?.ok) return null;
    const texture = new Texture(entry.image);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    sheets.set(name,texture);
    keep(texture);
    return texture;
  }
  // Effects in the pixel look fade in the finish's 4×4 ordered pattern, never by blending (no colours off the palette).
  const dissolve = material => {
    if (!cast) return material;
    material.fog = false;
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
        float bayer4(vec2 p){p=mod(floor(p),4.0);float a=mod(p.x,2.0),b=mod(p.y,2.0),c=floor(p.x*.5),d=floor(p.y*.5);
          return (8.0*mod(a+b,2.0)+4.0*b+2.0*mod(c+d,2.0)+d+.5)/16.0;}`)
        .replace('#include <alphatest_fragment>','if (diffuseColor.a < bayer4(gl_FragCoord.xy)) discard;\ndiffuseColor.a = 1.0;');
    };
    material.customProgramCacheKey = () => 'chase-pixel-dissolve';
    return material;
  };
  // runners and their effects are drawn by the pixel finish over its picture: layer 1
  const overlayLayer = object => { if (cast) object.layers.set(1); return object; };
  const quad = keep(new PlaneGeometry(1,1).translate(0,.5,0));
  const disc = keep(new CircleGeometry(.5,24).rotateX(-Math.PI/2));
  const rotorPlane = keep(new PlaneGeometry(1,1));
  const meRing = keep(new RingGeometry(.9,1,48).rotateX(-Math.PI/2));
  const runners = new Map();
  function runner(player) {
    if (runners.has(player.id)) return runners.get(player.id);
    const material = dissolve(new MeshBasicMaterial({transparent:true,depthWrite:false,alphaTest:.02,fog:true,color:color(cast ? '#ffffff' : '#fff6ea')}));
    const body = overlayLayer(new Mesh(quad,material));
    body.renderOrder = 3;
    const shadow = new Mesh(disc,new MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false}));
    shadow.renderOrder = 1;
    // (the pixel look's ring is a drawn ellipse on the pixel grid, under the runner: cast.ring())
    const ring = cast
      ? overlayLayer(new Sprite(dissolve(new SpriteMaterial({transparent:true,depthWrite:false,alphaTest:.02}))))
      : new Mesh(meRing,new MeshBasicMaterial({color:color('#e8bd62'),transparent:true,opacity:.6,depthWrite:false}));
    ring.renderOrder = 2;
    ring.visible = Boolean(player.me);
    const rotorTexture = rotorMap.clone();
    rotorTexture.needsUpdate = true;
    if (cast) rotorTexture.repeat.set(1/cast.ROTOR_FRAMES,1); else rotorTexture.repeat.set(1,1/ROTOR_FRAMES);
    const rotor = overlayLayer(new Mesh(rotorPlane,dissolve(new MeshBasicMaterial({map:rotorTexture,transparent:true,depthWrite:false,fog:true,alphaTest:cast ? .02 : 0}))));
    rotor.renderOrder = 4;
    const lights = cast
      ? flashMaps.map(map => { const sprite = overlayLayer(new Sprite(dissolve(new SpriteMaterial({map,transparent:true,depthWrite:false,alphaTest:.02})))); sprite.renderOrder = 5; return sprite; })
      : [color('#ff4a3a'),color('#3f7cff')].map(tint => { const sprite = new Sprite(new SpriteMaterial({map:glowMap,color:tint,transparent:true,blending:AdditiveBlending,depthWrite:false})); sprite.renderOrder = 5; return sprite; });
    const glint = overlayLayer(new Sprite(cast
      ? dissolve(new SpriteMaterial({map:glintPixel,transparent:true,depthWrite:false,alphaTest:.02}))
      : new SpriteMaterial({map:glintMap,color:color('#ffdf9a'),transparent:true,blending:AdditiveBlending,depthWrite:false})));
    glint.renderOrder = 5;
    const group = new Group();
    body.add(rotor);
    group.add(shadow,ring,body,...lights,glint);
    scene.add(group);
    const tag = document.createElement('div');
    tag.textContent = player.me ? TAG.me : tagName(player.name);
    // Hidden until it has a place under the runner's feet (it would otherwise flash in the corner).
    tag.style.opacity = '0';
    overlay.append(tag);
    const item = {group,body,material,shadow,ring,rotor,lights,glint,tag,side:'',textures:new Map(),phase:Math.random()*10,seed:Math.random(),lean:0,grow:1,alt:0,boost:1,lastTier:player.tier,
      flip:1,turnSince:0,u:NaN,spot:{x:0,y:0,z:0,unit:0},ringSpot:{x:0,y:0,z:0,unit:0},screen:{x:0,y:0,ok:false},feet:{x:0,y:0,ok:false}};
    runners.set(player.id,item);
    return item;
  }
  function dropRunner(item) {
    scene.remove(item.group);
    item.tag.remove();
    for (const material of [item.material,item.shadow.material,item.ring.material,item.rotor.material,item.glint.material,...item.lights.map(sprite => sprite.material)]) material.dispose();
    item.rotor.material.map.dispose();
    for (const texture of item.textures.values()) texture.dispose();
  }
  function frameTexture(item,name) {
    if (item.textures.has(name)) return item.textures.get(name);
    const base = sheet(name);
    if (!base) return null;
    // A clone shares the image with the sheet but keeps its own frame offset.
    const texture = base.clone();
    texture.needsUpdate = true;
    item.textures.set(name,texture);
    return texture;
  }

  /* ---------- Dust, bursts and rings ---------- */
  const dust = [], spareDust = [];
  const dustMaterial = keep(new SpriteMaterial({map:dustMap,transparent:true,depthWrite:false,fog:true}));
  // `burst`: a respawn's puffs, which still come when the trails behind a crowd have used up the usual number.
  function puff(x,y,z,size,{vx=0,vy=.8,vz=0,life=.9,tint='#f4e7cf'}={},burst=false) {
    if (dust.length > (small ? 70 : 140)+(burst ? 40 : 0) || !dustImage?.ok) return;
    size *= unit; vx *= unit; vy *= unit; vz *= unit;
    let sprite = spareDust.pop();
    if (!sprite) { sprite = overlayLayer(new Sprite(dissolve(dustMaterial.clone()))); sprite.renderOrder = 2; scene.add(sprite); }
    sprite.visible = true;
    if (!cast) sprite.material.color.set(tint);
    sprite.position.set(x,y,z);
    dust.push({sprite,vx,vy,vz,life,age:0,size});
  }
  const rings = [];
  const ringGeometry = keep(new RingGeometry(.9,1.05,48).rotateX(-Math.PI/2));
  // A gold ring spreads over the ground where someone is caught or taunted; it is drawn over slopes and kerbs.
  function ringAt(x,y,z,scale=1) {
    const mesh = new Mesh(ringGeometry,new MeshBasicMaterial({color:color('#e8be6a'),transparent:true,depthWrite:false,depthTest:false}));
    mesh.position.set(x,y+.08,z);
    mesh.renderOrder = 2;
    scene.add(mesh);
    rings.push({mesh,age:0,scale});
  }

  /* ---------- Camera ---------- */
  const view = {pos:new Vector3(),look:new Vector3(),goal:new Vector3(),ready:false,still:false,snap:false,u:NaN};
  // The loop's middle and half extents, which the camera centres on and frames.
  const loop = (() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0;
    for (let i = 0; i < SAMPLES; i += 8) { const p = trackAt(i/SAMPLES); x0 = Math.min(x0,p.x); x1 = Math.max(x1,p.x); z0 = Math.min(z0,p.z); z1 = Math.max(z1,p.z); y += p.y; }
    return {x:(x0+x1)/2,z:(z0+z1)/2,y:y/(SAMPLES/8),rx:(x1-x0)/2+8*unit,rz:(z1-z0)/2+8*unit};
  })();
  // Which way my runner moves on screen, for the speed lines.
  const heading = {x:1,y:0};
  const temp = {a:new Vector3(),b:new Vector3(),c:new Vector3(),d:new Vector3(),e:new Vector3(),up:new Vector3(),point:{},p0:{},p1:{}};
  // `full` is the height the stage has without the on-screen keyboard. The picture keeps its scale when the keyboard or
  // a longer sentence takes part of the stage: the view is cropped, never zoomed.
  function resize(width,height,full=height) {
    renderer.setSize(width,height,false);
    const reference = Math.max(height,full,1), ratio = renderer.getPixelRatio();
    // (the pixel look's art pixel is a whole number of device pixels, the same size with or without the keyboard)
    if (pixel) pixel.setSize(Math.floor(width*ratio),Math.floor(height*ratio),Math.max(1,Math.round((width/reference < 1.1 ? ART_PX.narrow : ART_PX.wide)*ratio)),Math.max(1,Math.round(ART_PX.still*ratio)));
    else brunstad?.finish?.setSize(Math.floor(width*ratio),Math.floor(height*ratio));
    camera.aspect = width/Math.max(1,height);
    // A narrow phone screen widens the view a little so the road ahead stays in sight.
    const base = CAMERA.fov*(width/reference < 1.1 ? 1.25 : 1);
    camera.fov = Math.atan(Math.tan(base*Math.PI/360)*Math.max(1,height)/reference)*360/Math.PI;
    camera.updateProjectionMatrix();
    // The picture as it is without the keyboard: the still view is framed on it, so the keyboard crops it there too.
    view.fullTan = Math.tan(base*Math.PI/360);
    view.fullAspect = width/reference;
    view.snap = true;
  }
  function project(x,y,z,out) {
    temp.d.set(x,y,z).project(camera);
    out.ok = temp.d.z < 1 && Math.abs(temp.d.x) < 1.2 && Math.abs(temp.d.y) < 1.2;
    out.x = (temp.d.x*.5+.5)*canvas.clientWidth;
    out.y = (-temp.d.y*.5+.5)*canvas.clientHeight;
    return out;
  }
  const sizeOf = (look,meta) => {
    const size = SIZE[look.kind] || SIZE.pose, aspect = meta.w/meta.h;
    return size.w ? {w:size.w*unit,h:size.w*unit/aspect} : {w:size.h*unit*aspect,h:size.h*unit};
  };
  const perimeterPerLetter = lap => perimeter/lap;
  /* The wide view (the header's 全景 button) shows only the map built in detail (`area`), never what lies beyond it: as
     far back as the whole loop needs if that still fits on the map, otherwise as far back as the map allows, following
     me the way the near view does. On flat ground the picture is a trapezoid from `south` × distance south of its centre
     to `north` × distance north of it, `half` × distance wide on either side at its far (widest) edge. It is measured
     without the on-screen keyboard, which only crops it. */
  function wideView() {
    const fullTan = view.fullTan || Math.tan(camera.fov*Math.PI/360), fullAspect = view.fullAspect || camera.aspect;
    const p = CAMERA.pitch, a = Math.atan(fullTan), sin = Math.sin(p);
    const whole = Math.max(loop.rx*1.14/(fullTan*fullAspect),loop.rz*1.2*sin/fullTan);
    const north = sin/Math.tan(p-a)-Math.cos(p), south = Math.cos(p)-sin/Math.tan(p+a), half = sin*Math.cos(a)*fullTan*fullAspect/Math.sin(p-a);
    if (!area) return {distance:whole,whole:true,north,south,half,bounds:null};
    const fit = Math.min((area.x1-area.x0)/(2*half),(area.z1-area.z0)/(north+south));
    const distance = Math.max(CAMERA.distance,Math.min(whole,fit));
    // Where the picture's centre may be, so that all of it stays on the map.
    const span = (low,high) => low <= high ? [low,high] : [(low+high)/2,(low+high)/2];
    const [x0,x1] = span(area.x0+half*distance,area.x1-half*distance), [z0,z1] = span(area.z0+north*distance,area.z1-south*distance);
    return {distance,whole:whole <= fit,north,south,half,bounds:{x0,x1,z0,z1}};
  }
  const shadowBox = {reach:0,x:NaN,y:NaN,z:NaN};
  function placeSun(wide,distance) {
    // The shadows cover the picture: the near view's 200 m, or the whole wide picture.
    const reach = wide ? Math.ceil((Math.max(wide.half,(wide.north+wide.south)/2)*distance+20)/10)*10 : 100;
    const middle = wide ? (wide.south-wide.north)/2*distance : 0;
    // The box moves in 8 m steps, so the shadow map is redrawn now and then rather than every frame.
    const x = Math.round(view.look.x/8)*8, z = Math.round((view.look.z+middle)/8)*8, y = Math.round(view.look.y/4)*4;
    if (reach === shadowBox.reach && x === shadowBox.x && y === shadowBox.y && z === shadowBox.z) return;
    Object.assign(shadowBox,{reach,x,y,z});
    Object.assign(sun.shadow.camera,{left:-reach,right:reach,top:reach,bottom:-reach,near:1,far:reach*2+240});
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.set(x,y,z);
    sun.position.set(x,y,z).addScaledVector(sunDir,reach+120);
    sun.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }

  /* ---------- One frame ---------- */
  // Each player's `u` is its place on the loop in letters; `lap` letters make one round.
  // `stamp` is the game's own clock in milliseconds: it stops while the game is paused, so nothing moves behind a dialog.
  function render({players,lap,dt,stamp,still=false,calm=false,events=[]}) {
    time.value = stamp/1000;
    const me = players.find(player => player.me) || players[0];
    // Nobody left on the track (everyone in a room has gone): the scene simply stays as it is.
    if (!me) {
      for (const [id,item] of runners) { dropRunner(item); runners.delete(id); }
      if (pixel) pixel.render(scene,camera); else renderer.render(scene,camera);
      return {cut:false};
    }
    const point = temp.point, a = temp.a, metres = perimeterPerLetter(lap);
    const ease = tau => 1-Math.exp(-dt/tau);

    /* Camera: always facing north. It holds still while I am in the calm middle of the picture and glides only as far as
       needed to keep me there. The wide view (`still`) stands further back and shows only the map (see wideView): it
       does not move at all when the whole loop fits, and otherwise follows me in the same calm way. When I reappear
       somewhere else (a respawn) a moving camera cuts there instead of sweeping across the map. */
    trackAt(me.u/lap,point);
    const tan = Math.tan(camera.fov*Math.PI/360), sin = Math.sin(CAMERA.pitch);
    const jumped = (Number.isFinite(view.u) && Math.abs(me.u-view.u)*metres > 15) || (me.me && me.warp === 'respawn');
    view.u = me.u;
    const wide = still ? wideView() : null, fixed = Boolean(wide?.whole);
    const distance = wide ? wide.distance : CAMERA.distance;
    // Runners share the road: the more there are, the closer together, never off its edges.
    let widest = 1;
    for (const player of players) widest = Math.max(widest,Math.abs(player.lane));
    const spacing = Math.min(laneWidth,track.roadWidth*.42/widest);
    const mx = point.x+point.nx*me.lane*spacing, mz = point.z+point.nz*me.lane*spacing;
    if (fixed) view.goal.set(loop.x,loop.y,loop.z);
    else {
      if (!view.ready || view.still !== still || jumped) view.goal.set(mx,point.y,mz);
      const calmX = distance*tan*camera.aspect*CAMERA.calm.x, calmZ = distance*tan/sin*CAMERA.calm.z;
      const dx = mx-view.goal.x, dz = mz-view.goal.z;
      if (Math.abs(dx) > calmX) view.goal.x += dx-Math.sign(dx)*calmX;
      if (Math.abs(dz) > calmZ) view.goal.z += dz-Math.sign(dz)*calmZ;
      view.goal.y += (point.y-view.goal.y)*ease(1.5);
    }
    if (wide?.bounds) { const b = wide.bounds; view.goal.x = Math.min(b.x1,Math.max(b.x0,view.goal.x)); view.goal.z = Math.min(b.z1,Math.max(b.z0,view.goal.z)); }
    if (wide) {
      // However far back the wide view stands, the far plane stays behind what it shows.
      const far = Math.max(2000,Math.ceil((distance+700*unit)/100)*100);
      if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    }
    const target = temp.b.copy(view.goal);
    const want = temp.c.copy(target).addScaledVector(HEADING,-distance*Math.cos(CAMERA.pitch)).addScaledVector(UP,distance*Math.sin(CAMERA.pitch));
    const cut = !view.ready || view.still !== still || (!fixed && jumped);
    // (The wide view's distance follows the window's shape, so a resize puts it in place at once rather than zooming.)
    if (cut || (still && view.snap)) { view.pos.copy(want); view.look.copy(target); view.ready = true; view.still = still; }
    view.snap = false;
    view.pos.lerp(want,ease(.7));
    view.look.lerp(target,ease(.7));
    camera.position.copy(view.pos);
    camera.lookAt(view.look);
    camera.updateMatrixWorld();
    // The pixel finish draws from a copy of the camera on the art-pixel grid at the distance it looks at; runners are
    // placed on that grid below.
    if (pixel) { camera.userData.focal = distance; pixel.setFine(still); pixel.snap(camera); }
    // Haze starts beyond what the camera looks at, however far back the wide view sits.
    scene.fog.near = distance+100*unit; scene.fog.far = distance+460*unit;
    if (waterFog) { waterFog.near.value = scene.fog.near; waterFog.far.value = scene.fog.far; }
    placeSun(wide,distance);

    const order = [];
    for (const player of players) {
      const item = runner(player);
      // The name tag takes the colour of the side the player is on now (losers change sides in a team game).
      if (item.side !== player.side) { item.side = player.side; item.tag.className = `pc-tag is-${player.side}${player.me ? ' is-me' : ''}${player.away ? ' is-away' : ''}`; }
      // Someone whose connection dropped in a room stands faded with 掉线中 under their name until they are back. A long
      // name is cut short (the style sheet does it), never the 掉线中.
      const label = player.me ? TAG.me : player.away ? `${player.name}${TAG.away}` : player.name;
      if (item.label !== label) {
        item.label = label;
        const name = document.createElement('span');
        name.textContent = player.me ? TAG.me : tagName(player.name);
        item.tag.replaceChildren(name,...(player.away && !player.me ? [Object.assign(document.createElement('small'),{textContent:TAG.away})] : []));
        item.tag.classList.toggle('is-away',Boolean(player.away));
      }
      trackAt(player.u/lap,point);
      const lane = player.lane*spacing;
      const x = point.x+point.nx*lane, z = point.z+point.nz*lane, ground = point.y+.07;
      const look = player.look, meta = manifest.sprites[look.name];
      const texture = meta && frameTexture(item,look.name);
      item.group.visible = Boolean(texture);
      if (!texture) continue;
      const size = sizeOf(look,meta);
      // In the wide view a runner is drawn at least STILL_PX tall on screen and stands in front of the houses.
      // (In the pixel look a sprite pixel is one art pixel, half of one in the wide view: further back it covers more ground.)
      let boost = 1;
      if (pixel) boost = Math.max(1,distance/CAMERA.distance/(still ? 2 : 1));
      else if (still) {
        const pixelsPerMetre = canvas.clientHeight/(2*tan*Math.max(1,camera.position.distanceTo(a.set(x,ground,z))));
        boost = Math.min(12,Math.max(1,STILL_PX/(size.h*pixelsPerMetre)));
      }
      item.boost = boost;
      item.material.depthTest = item.rotor.material.depthTest = !still;
      // Someone who reappears elsewhere (a respawn, however short the move) leaves a puff of dust behind and arrives in
      // another; one simply put where they are (`warp` 'quiet': watching a game in play) arrives without any.
      const moved = Number.isFinite(item.u) && Math.abs(player.u-item.u)*metres > 15;
      const respawned = player.warp === 'respawn' || (moved && player.warp !== 'quiet');
      item.u = player.u;
      if (respawned && item.world) {
        for (const spot of [item.world,{x,y:ground,z}]) {
          for (let i = 0; i < 10; i++) { const angle = i/10*Math.PI*2; puff(spot.x+Math.cos(angle)*1.4*boost,spot.y+.8,spot.z+Math.sin(angle)*1.4*boost,2.8*boost,{vx:Math.cos(angle)*4*boost,vy:1.6,vz:Math.sin(angle)*4*boost,life:.8},true); }
        }
      }
      if (player.warp === 'quiet') item.lastTier = player.tier;
      // Gear changes grow the new vehicle out of a puff of dust.
      if (item.lastTier !== player.tier) {
        item.grow = .8;
        for (let i = 0; i < 12; i++) { const angle = i/12*Math.PI*2; puff(x+Math.cos(angle)*1.5*boost,ground+1,z+Math.sin(angle)*1.5*boost,3*boost,{vx:Math.cos(angle)*5*boost,vy:2,vz:Math.sin(angle)*5*boost,life:.7}); }
        item.lastTier = player.tier;
      }
      item.grow += (1-item.grow)*ease(.09);
      // (pixel look: one sprite pixel per art pixel, so the size follows from the drawing and is set further down)
      let w = size.w*item.grow*boost, h = size.h*item.grow*boost;
      const flying = look.kind === 'heli', moving = player.vel > .15 && !player.frozen;
      const speed = player.vel*metres;
      // Which way the runner faces: east is always to the right (the camera never turns), judged over a few metres of
      // road and only after the new direction has held for a moment, so a wiggle in the road never mirrors the drawing.
      const ahead = trackAt((player.u+6/metres)/lap,temp.p0), behind = trackAt((player.u-6/metres)/lap,temp.p1);
      const east = ahead.x-behind.x, want = Math.abs(east) > 1 ? Math.sign(east) : item.flip;
      // (Arriving somewhere new, the drawing faces the right way at once.)
      if (want === item.flip) item.turnSince = 0;
      else if (respawned || moved) { item.flip = want; item.turnSince = 0; }
      else if (!item.turnSince) item.turnSince = stamp;
      else if (stamp-item.turnSince > 300) { item.flip = want; item.turnSince = 0; }
      if (player.me) {
        const p0 = project(x,ground,z,temp.p0), p1 = project(x+point.tx,ground,z+point.tz,temp.p1);
        const dx = p1.x-p0.x, dy = p1.y-p0.y, n = Math.hypot(dx,dy) || 1;
        heading.x = dx/n; heading.y = dy/n;
      }
      // Animation: frames step with the speed, runners bob once a stride, riders and engines sway.
      const frames = meta.frames || 1;
      if (moving) item.phase += dt*Math.min(14,(look.kind === 'run' ? 3.5 : 2.6)+speed*(look.kind === 'run' ? .85 : .5));
      const frame = frames > 1 ? (moving ? Math.floor(item.phase) % frames : REST[look.name] ?? 1) : 0;
      texture.repeat.set(item.flip/frames,1);
      texture.offset.set(item.flip > 0 ? frame/frames : (frame+1)/frames,0);
      if (item.material.map !== texture) { item.material.map = texture; item.material.needsUpdate = true; }
      let lift = 0, tilt = 0;
      if (look.kind === 'run' && moving) { lift = calm ? 0 : Math.abs(Math.sin((item.phase-.5)*Math.PI/2))*.05*h; tilt = -Math.min(.14,speed*.012); }
      else if ((look.kind === 'bike' || look.kind === 'skate') && moving) { lift = calm ? 0 : Math.abs(Math.sin(item.phase*Math.PI))*.02*h; tilt = -Math.min(.07,speed*.005); }
      else if ((look.kind === 'moto' || look.kind === 'car') && moving && !calm) lift = Math.sin(stamp/45+item.phase)*.012*h;
      // A helicopter lifts off gently; anything else is on the ground at once.
      item.alt = flying && !player.frozen ? item.alt+(6-item.alt)*ease(.6) : 0;
      if (flying) lift = (item.alt+(calm ? 0 : Math.sin(stamp/520)*.4))*boost;
      item.lean += ((tilt+(flying && moving ? -.08 : 0))-item.lean)*ease(.15);
      item.body.quaternion.copy(camera.quaternion);
      if (pixel) {
        // on whole art pixels, never turned (a leaning sprite would break its pixels)
        const spot = pixel.align(temp.e.set(x,ground+lift,z),meta.w,meta.h,.5,0,item.spot);
        w = meta.w*spot.unit; h = meta.h*spot.unit;
        item.body.position.set(spot.x,spot.y,spot.z);
      } else {
        item.body.position.set(x,ground+lift,z);
        item.body.rotateZ(item.lean*item.flip);
      }
      item.body.scale.set(w,h,1);
      // After a catch or a taunt the loser is see-through for a moment and slowly becomes solid again.
      // Someone whose connection dropped is faded as a whole: body, shadow and rotor (and the lights are off).
      const fade = player.away ? .45 : 1;
      item.material.opacity = player.away ? fade : player.immune && !player.frozen ? 1-.42*Math.min(1,player.immune*1.6) : 1;
      item.rotor.material.opacity = fade;
      item.shadow.position.set(x,ground+.03,z);
      item.shadow.scale.set(w*(flying ? .9 : .8),1,Math.max(.9,w*(flying ? .5 : .32)));
      item.shadow.material.opacity = (cast ? (flying ? .42 : .66) : flying ? .6 : .95)*fade;
      if (cast) {
        const drawn = cast.ring(meta.w*.85);
        const map = ringMaps.get(drawn) || ringMaps.set(drawn,pixelTexture(drawn)).get(drawn);
        if (item.ring.material.map !== map) { item.ring.material.map = map; item.ring.material.needsUpdate = true; }
        const spot = pixel.align(temp.e.set(x,ground,z),drawn.w,drawn.h,.5,.5,item.ringSpot);
        item.ring.position.set(spot.x,spot.y,spot.z);
        item.ring.scale.set(drawn.w*spot.unit,drawn.h*spot.unit,1);
      } else {
        item.ring.position.set(x,ground+.05,z);
        item.ring.scale.set(Math.max(.75,w*.42),1,Math.max(.6,w*.24));
      }
      // Helicopter rotor: drawn into the standee at the mast, sweeping round.
      item.rotor.visible = flying && !player.frozen;
      if (item.rotor.visible && cast) {
        // the drawn rotor, its middle pixel on the mast and its blade row just over the cabin roof
        const R = cast.effects.rotor, mast = Math.round((MAST[look.name] ?? .6)*meta.w-.5);
        item.rotor.position.set(item.flip*((mast+.5)/meta.w-.5),1-(R.h/2)/meta.h,.01);
        item.rotor.scale.set(R.w/meta.w,R.h/meta.h,1);
        item.rotor.material.map.offset.x = Math.floor(stamp/1000*24) % cast.ROTOR_FRAMES/cast.ROTOR_FRAMES;
      } else if (item.rotor.visible) {
        const span = 1.12, tall = span*w*(96/512)/h;
        item.rotor.position.set(item.flip*((MAST[look.name] ?? .6)-.5),1+tall*.02,.01);
        item.rotor.scale.set(span,tall,1);
        const frame = Math.floor(stamp/1000*30) % ROTOR_FRAMES;
        item.rotor.material.map.offset.y = 1-(frame+1)/ROTOR_FRAMES;
      }
      // Police lights on the motorbike, car and helicopter: red and blue glowing up and fading in turn.
      const lit = player.side === 'police' && player.tier >= 3 && !player.frozen && !player.away && BEACON[look.kind];
      item.lights.forEach((sprite,i) => {
        const glow = calm ? .5 : .5+.5*Math.cos(stamp/900*Math.PI*2+i*Math.PI);
        sprite.visible = Boolean(lit) && glow > .03;
        if (!sprite.visible) return;
        const [bx,by] = BEACON[look.kind];
        a.set(item.flip*w*bx,h*by,0).applyQuaternion(camera.quaternion);
        if (pixel) {
          // the drawn flash, its middle on the lamp's pixel; it comes and goes in the ordered pattern
          const F = cast.effects.flashRed;
          sprite.position.copy(item.body.position).add(a);
          sprite.scale.set(F.w*item.spot.unit,F.h*item.spot.unit,1);
          sprite.material.opacity = Math.min(1,glow*1.25);
          return;
        }
        sprite.position.set(x+a.x,ground+lift+a.y,z+a.z);
        sprite.scale.setScalar(Math.max(2,h*.42));
        sprite.material.opacity = .72*glow*glow;
      });
      // The thief's loot glints: a brief twinkle every few seconds (none with reduced motion), each runner in its own time.
      const loot = player.side === 'thief' && player.tier >= 3 && !player.frozen && !player.away && !calm && LOOT[look.kind];
      const beat = (stamp/2800+item.seed) % 1, twinkle = beat < .22 ? Math.sin(beat/.22*Math.PI)**2 : 0;
      item.glint.visible = Boolean(loot) && twinkle > .02;
      if (item.glint.visible) {
        const [gx,gy] = LOOT[look.kind];
        a.set(item.flip*w*gx,h*gy,0).applyQuaternion(camera.quaternion);
        if (pixel) {
          const G = cast.effects.glint;
          item.glint.position.copy(item.body.position).add(a);
          item.glint.scale.set(G.w*item.spot.unit,G.h*item.spot.unit,1);
          item.glint.material.opacity = Math.min(1,twinkle*1.3);
        } else {
          item.glint.position.set(x+a.x,ground+lift+a.y,z+a.z);
          item.glint.scale.setScalar(Math.max(1.6,h*.3)*(.75+.25*twinkle));
          item.glint.material.opacity = .85*twinkle;
        }
      }
      // Dust behind ground runners, exhaust behind engines, downwash under the helicopter (only for runners in the
      // picture, so a crowd out of sight does not use up the dust).
      const seen = item.feet.ok;
      if (seen && moving && !flying && Math.random() < Math.min(1,speed*dt*(look.kind === 'car' || look.kind === 'moto' ? 1.1 : .7))) {
        const back = -.42*w;
        puff(x+point.tx*back,ground+.5,z+point.tz*back,(look.kind === 'run' ? 1.8 : 2.8)*boost,{vx:-point.tx*3,vy:1.2,vz:-point.tz*3,life:.8});
      }
      if (seen && flying && !player.away && Math.random() < dt*7) { const angle = Math.random()*Math.PI*2; puff(x+Math.cos(angle)*3*boost,ground+.4,z+Math.sin(angle)*3*boost,3.6*boost,{vx:Math.cos(angle)*6*boost,vy:.6,vz:Math.sin(angle)*6*boost,life:.9}); }
      // Where the head and the feet are on screen, for the bubbles and the name tag.
      temp.up.set(0,h+.2,0).applyQuaternion(camera.quaternion);
      project(x+temp.up.x,ground+lift+temp.up.y,z+temp.up.z,item.screen);
      project(x,ground,z,item.feet);
      item.world = {x,y:ground,z};
      order.push(item);
    }
    // Nearer runners are drawn over farther ones, each with its own rotor and lights.
    for (const item of order) item.depth = camera.position.distanceToSquared(a.set(item.world.x,item.world.y,item.world.z));
    order.sort((p,q) => q.depth-p.depth).forEach((item,k) => {
      item.body.renderOrder = 10+k*3;
      item.rotor.renderOrder = 11+k*3;
      for (const sprite of [...item.lights,item.glint]) sprite.renderOrder = 12+k*3;
    });
    for (const [id,item] of runners) if (!players.some(player => player.id === id)) { dropRunner(item); runners.delete(id); }
    // Whatever stands between the camera and a runner is thinned away (the wide view draws runners over everything).
    brunstad?.focus(camera.position,still ? [] : order.filter(item => item.feet.ok).slice(-8).map(item => ({...item.world,r:Math.max(3.4,item.body.scale.x*.62+1.4)})));
    for (const event of events) { const item = runners.get(event.loser); if (item?.world) ringAt(item.world.x,item.world.y,item.world.z,item.boost); }

    // Effects age.
    const drag = Math.pow(.96,dt*60);
    for (let i = dust.length-1; i >= 0; i--) {
      const d = dust[i];
      d.age += dt;
      const k = d.age/d.life;
      if (k >= 1) { d.sprite.visible = false; spareDust.push(d.sprite); dust.splice(i,1); continue; }
      d.sprite.position.x += d.vx*dt; d.sprite.position.y += d.vy*dt; d.sprite.position.z += d.vz*dt;
      d.vx *= drag; d.vz *= drag;
      d.sprite.scale.set(d.size*(1+k*1.4),d.size*.62*(1+k*1.4),1);
      d.sprite.material.opacity = .62*(1-k);
    }
    for (let i = rings.length-1; i >= 0; i--) {
      const ring = rings[i];
      ring.age += dt;
      const k = ring.age/1.4;
      if (k >= 1) { scene.remove(ring.mesh); ring.mesh.material.dispose(); rings.splice(i,1); continue; }
      ring.mesh.scale.setScalar((2+(1-(1-k)**3)*15)*ring.scale);
      ring.mesh.material.opacity = .85*(1-k)**1.5;
    }
    if (boat) {
      boat.position.y = WATER+.02+Math.sin(stamp/900)*.05;
      boat.rotation.z = Math.sin(stamp/1100)*.04;
    }
    if (pixel) pixel.render(scene,camera); else if (brunstad?.finish) brunstad.finish.render(scene,camera); else renderer.render(scene,camera);
    for (const [,item] of runners) placeTag(item);
    return {cut:!fixed && jumped};
  }
  // Name tags sit under the feet; mine says 我.
  function placeTag(item) {
    const s = item.feet;
    if (!s?.ok) { item.tag.style.opacity = '0'; return; }
    item.tag.style.opacity = '';
    item.tag.style.transform = `translate(${s.x.toFixed(1)}px,${(s.y+5).toFixed(1)}px) translateX(-50%)`;
  }
  // The loop as a flat outline for the minimap.
  const outline = [];
  for (let i = 0; i < 160; i++) { const p = trackAt(i/160); outline.push([p.x,p.z]); }
  const headOf = id => runners.get(id)?.screen || null;
  // Where a runner stands on the ground and where the camera looks, for markers pointing at runners out of the picture.
  const groundOf = id => runners.get(id)?.world || null;
  const focus = () => ({x:view.look.x,z:view.look.z,pitch:CAMERA.pitch});
  function dispose() {
    if (disposed) return;
    for (const [,item] of runners) dropRunner(item);
    runners.clear();
    for (const d of dust) d.sprite.material.dispose();
    for (const sprite of spareDust) sprite.material.dispose();
    for (const ring of rings) ring.mesh.material.dispose();
    release();
  }
  // What the last frame cost and what the map holds (for checking performance).
  const stats = () => ({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,...brunstad?.counts});
  return {render,resize,dispose,headOf,groundOf,focus,outline,perimeter,attribution,stats,heading:() => heading};
}
