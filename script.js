import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { CustomShader } from './custom-shaders.js';
import * as CANNON from 'cannon-es';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

class PortfolioApp {
  constructor() {
    this.initEngine();
    this.setupScene();
    this.createPhysicsWorld();
    this.loadAssets();
    this.setupEventListeners();
    this.setupPostProcessing();
    this.initAnimations();
    this.setupDebug();
  }

  initEngine() {
    this.config = {
      antialias: true,
      alpha: false,
      shadows: true,
      physicsFPS: 60,
      bloom: {
        strength: 1.2,
        radius: 0.6,
        threshold: 0.8
      }
    };

    this.container = document.querySelector('.webgl-container');
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: "high-performance",
      antialias: this.config.antialias,
      alpha: this.config.alpha
    });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = this.config.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    
    this.container.appendChild(this.renderer.domElement);
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    
    this.camera.position.set(0, 5, 15);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 2);
    this.dirLight.position.set(5, 5, 5);
    this.dirLight.castShadow = true;
    
    this.scene.add(this.ambientLight, this.dirLight);
    this.setupEnvironment();
  }

  setupEnvironment() {
    const envMapLoader = new THREE.CubeTextureLoader()
      .setPath('/textures/env/')
      .load(['px.jpg', 'nx.jpg', 'py.jpg', 'ny.jpg', 'pz.jpg', 'nz.jpg']);
    
    this.scene.environment = envMapLoader;
    this.scene.background = envMapLoader;

    this.floorGeometry = new THREE.PlaneGeometry(50, 50);
    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444,
      roughness: 0.8,
      metalness: 0.2
    });
    
    this.floor = new THREE.Mesh(this.floorGeometry, this.floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
  }

  createPhysicsWorld() {
    this.physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0)
    });
    
    this.physicsWorld.solver.iterations = 10;
    this.physicsFrameTime = 1 / this.config.physicsFPS;
    this.physicsLastTime = 0;

    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane()
    });
    
    floorBody.quaternion.setFromAxisAngle(
      new CANNON.Vec3(1, 0, 0),
      -Math.PI / 2
    );
    
    this.physicsWorld.addBody(floorBody);
  }

  async loadAssets() {
    this.assetManager = {
      models: new Map(),
      textures: new Map()
    };

    const loadingManager = new THREE.LoadingManager(
      () => this.onAssetsLoaded(),
      (url, loaded, total) => this.onProgress(url, loaded, total)
    );

    const gltfLoader = new GLTFLoader(loadingManager);
    const textureLoader = new THREE.TextureLoader(loadingManager);

    try {
      const [mainModel, particleTex] = await Promise.all([
        gltfLoader.loadAsync('/models/main_scene.glb'),
        textureLoader.loadAsync('/textures/particle.png')
      ]);
      
      this.assetManager.models.set('main', mainModel);
      this.assetManager.textures.set('particle', particleTex);
      this.setupMainModel(mainModel);
    } catch (error) {
      console.error('Asset loading failed:', error);
      this.showErrorState();
    }
  }

  setupMainModel(gltf) {
    this.mainModel = gltf.scene;
    this.mainModel.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        
        if (child.material.name === 'GlassMaterial') {
          child.material = new THREE.MeshPhysicalMaterial({
            color: 0x00ffff,
            transmission: 0.95,
            roughness: 0.1,
            thickness: 0.5
          });
        }
      }
    });
    
    this.scene.add(this.mainModel);
    this.setupModelPhysics();
  }

  setupModelPhysics() {
    const physicsMeshes = this.mainModel.getObjectByName('PhysicsMeshes');
    if (!physicsMeshes) return;

    physicsMeshes.children.forEach(mesh => {
      const shape = this.createConvexShape(mesh.geometry);
      const body = new CANNON.Body({
        mass: 1,
        position: new CANNON.Vec3(
          mesh.position.x,
          mesh.position.y,
          mesh.position.z
        )
      });
      
      body.addShape(shape);
      this.physicsWorld.addBody(body);
      this.physicsMeshes.set(mesh, body);
    });
  }

  createConvexShape(geometry) {
    const vertices = geometry.attributes.position.array;
    const points = [];
    
    for (let i = 0; i < vertices.length; i += 3) {
      points.push(new CANNON.Vec3(
        vertices[i],
        vertices[i + 1],
        vertices[i + 2]
      ));
    }
    
    return new CANNON.ConvexPolyhedron(points);
  }

  setupPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.config.bloom.strength,
      this.config.bloom.radius,
      this.config.bloom.threshold
    );
    
    this.composer.addPass(this.bloomPass);
    this.setupAA();
  }

  setupAA() {
    const smaaPass = new SMAAPass(
      window.innerWidth * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio
    );
    
    this.composer.addPass(smaaPass);
    
    this.gammaPass = new ShaderPass(GammaCorrectionShader);
    this.composer.addPass(this.gammaPass);
  }

  initAnimations() {
    this.mixer = new THREE.AnimationMixer(this.mainModel);
    this.clock = new THREE.Clock();
    
    this.mainModel.animations.forEach(clip => {
      this.mixer.clipAction(clip).play();
    });

    this.setupScrollAnimations();
    this.setupCursorEffects();
  }

  setupScrollAnimations() {
    gsap.registerPlugin(ScrollTrigger);
    
    const sections = gsap.utils.toArray('.section');
    sections.forEach((section, i) => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top center',
          end: 'bottom center',
          scrub: 1
        }
      });

      tl.to(this.camera.position, {
        x: () => Math.sin(i * 0.5) * 5,
        y: () => Math.cos(i * 0.5) * 5 + 2,
        z: () => Math.cos(i * 0.5) * 5
      }, 0);
      
      tl.to(this.dirLight.position, {
        x: () => Math.random() * 10 - 5,
        y: () => Math.random() * 5 + 5,
        z: () => Math.random() * 10 - 5
      }, 0);
    });
  }

  setupCursorEffects() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    document.addEventListener('mousemove', e => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    document.addEventListener('click', () => {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.interactiveObjects);
      
      if (intersects.length > 0) {
        this.onObjectClick(intersects[0].object);
      }
    });
  }

  onObjectClick(object) {
    if (object.userData.clickEffect) {
      const tl = gsap.timeline();
      tl.to(object.scale, {
        x: 1.2,
        y: 1.2,
        z: 1.2,
        duration: 0.3,
        ease: 'power2.out'
      });
      
      tl.to(object.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: 0.5,
        ease: 'elastic.out(1, 0.3)'
      });
    }
  }

  setupParticles() {
    const particleCount = 10000;
    this.particles = new THREE.BufferGeometry();
    
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 50;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 50;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 50;

      colors[i * 3] = Math.random();
      colors[i * 3 + 1] = Math.random();
      colors[i * 3 + 2] = Math.random();
    }
    
    this.particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    this.particleMaterial = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      map: this.assetManager.textures.get('particle'),
      transparent: true,
      blending: THREE.AdditiveBlending
    });
    
    this.particleSystem = new THREE.Points(this.particles, this.particleMaterial);
    this.scene.add(this.particleSystem);
  }

  updatePhysics() {
    const time = performance.now() / 1000;
    const delta = time - this.physicsLastTime;
    
    if (delta >= this.physicsFrameTime) {
      this.physicsWorld.step(this.physicsFrameTime);
      this.physicsLastTime = time;
      
      this.physicsMeshes.forEach((body, mesh) => {
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
      });
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    const delta = this.clock.getDelta();
    this.mixer.update(delta);
    this.controls.update();
    this.updatePhysics();
    
    this.particleSystem.rotation.y += 0.001;
    this.composer.render();
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  cleanup() {
    this.renderer.dispose();
    this.composer.passes.forEach(pass => pass.dispose());
    this.physicsWorld.bodies.forEach(body => this.physicsWorld.removeBody(body));
    this.scene.traverse(child => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (child.material) {
          Object.values(child.material).forEach(prop => {
            if (prop && typeof prop.dispose === 'function') {
              prop.dispose();
            }
          });
        }
      }
    });
  }

  setupDebug() {
    if (location.hash === '#debug') {
      import('lil-gui').then(({ GUI }) => {
        this.gui = new GUI();
        this.setupDebugControls();
      });
    }
  }

  setupDebugControls() {
    const bloomFolder = this.gui.addFolder('Bloom');
    bloomFolder.add(this.bloomPass, 'strength', 0, 2);
    bloomFolder.add(this.bloomPass, 'radius', 0, 1);
    bloomFolder.add(this.bloomPass, 'threshold', 0, 1);
    
    const cameraFolder = this.gui.addFolder('Camera');
    cameraFolder.add(this.camera.position, 'x', -20, 20);
    cameraFolder.add(this.camera.position, 'y', -20, 20);
    cameraFolder.add(this.camera.position, 'z', -20, 20);
    
    const lightFolder = this.gui.addFolder('Lighting');
    lightFolder.add(this.dirLight, 'intensity', 0, 5);
    lightFolder.add(this.ambientLight, 'intensity', 0, 5);
  }

  showErrorState() {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-state';
    errorDiv.innerHTML = `
      <h2>⚠️ Failed to Load Content</h2>
      <p>Please check your internet connection and try refreshing</p>
      <button onclick="location.reload()">Retry</button>
    `;
    
    this.container.appendChild(errorDiv);
  }
}

// Initialize application
const app = new PortfolioApp();
app.animate();