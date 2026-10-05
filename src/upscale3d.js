import * as T from '../vendor/three/build/three.module.js';
export const RENDER_PRESETS={native:1,ultra:.85,quality:.75,balanced:.6,performance:.5};
const vertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
// WebGL equivalent: static jittered accumulation + native-resolution spatial
// reconstruction while moving. No history crosses camera/door/LOD changes.
// This is intentionally not motion-vector TAAU or the WebGPU-only TAAUNode.
export class Upscaler {
 constructor(renderer){
  this.renderer=renderer;this.scale=.75;this.temporal=true;this.samples=0;this.pose='';this.pending=true;
  const target=()=>new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false});
  this.sceneTarget=target();this.sceneTarget.depthBuffer=true;this.history=[target(),target()];this.read=0;
  this.scene=new T.Scene();this.camera=new T.Camera();this.quad=new T.Mesh(new T.PlaneGeometry(2,2));this.quad.frustumCulled=false;this.scene.add(this.quad);
  this.blend=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{current:{value:null},history:{value:null},weight:{value:1}},vertexShader:vertex,fragmentShader:`varying vec2 vUv;uniform sampler2D current,history;uniform float weight;void main(){gl_FragColor=mix(texture2D(history,vUv),texture2D(current,vUv),weight);}`});
  this.resolve=new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{image:{value:null},texel:{value:new T.Vector2()},sharpness:{value:.16}},vertexShader:vertex,fragmentShader:`
   varying vec2 vUv;uniform sampler2D image;uniform vec2 texel;uniform float sharpness;
   void main(){vec3 c=texture2D(image,vUv).rgb;
    vec3 n=texture2D(image,vUv+vec2(0.0,texel.y)).rgb,s=texture2D(image,vUv-vec2(0.0,texel.y)).rgb;
    vec3 e=texture2D(image,vUv+vec2(texel.x,0.0)).rgb,w=texture2D(image,vUv-vec2(texel.x,0.0)).rgb;
    vec3 lo=min(c,min(min(n,s),min(e,w))),hi=max(c,max(max(n,s),max(e,w)));
    vec3 color=clamp(c+(4.0*c-n-s-e-w)*sharpness,lo,hi);
    gl_FragColor=vec4(color,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 }
 resize(w,h,scale=this.scale){
  this.scale=scale;this.width=Math.max(1,Math.round(w*scale));this.height=Math.max(1,Math.round(h*scale));
  for(const target of [this.sceneTarget,...this.history])target.setSize(this.width,this.height);
  this.resolve.uniforms.texel.value.set(1/this.width,1/this.height);this.reset();
 }
 reset(){this.samples=0;this.pose='';this.pending=true;}
 render(scene,camera,moving=false){
  const r=this.renderer,pose=[...camera.position.toArray(),...camera.quaternion.toArray()].map(v=>v.toFixed(6)).join(',');
  if(moving||pose!==this.pose){this.samples=0;this.pose=pose;}
  const jitter=[[0,0],[-.25,.1667],[.25,-.3889],[-.375,-.0556],[.125,.2778],[-.125,-.2778],[.375,.0556],[-.4375,.3889]];
  const stable=this.temporal&&!moving,sample=stable?jitter[this.samples%8]:[0,0];
  if(stable)camera.setViewOffset(this.width,this.height,sample[0],sample[1],this.width,this.height);
  r.info.reset();r.info.autoReset=false;
  r.setRenderTarget(this.sceneTarget);r.render(scene,camera);if(stable)camera.clearViewOffset();
  let image=this.sceneTarget.texture;
  if(stable){
   this.blend.uniforms.current.value=image;this.blend.uniforms.history.value=this.history[this.read].texture;this.blend.uniforms.weight.value=1/(Math.min(7,this.samples)+1);
   const write=1-this.read;this.quad.material=this.blend;r.setRenderTarget(this.history[write]);r.render(this.scene,this.camera);this.read=write;image=this.history[this.read].texture;this.samples++;
  }
  this.pending=stable&&this.samples<8;
  this.resolve.uniforms.image.value=image;this.quad.material=this.resolve;r.setRenderTarget(null);r.render(this.scene,this.camera);
  r.info.autoReset=true;
 }
 dispose(){for(const target of [this.sceneTarget,...this.history])target.dispose();this.blend.dispose();this.resolve.dispose();this.quad.geometry.dispose();}
}
