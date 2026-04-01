---
name: game-builder
description: Build 2D and 3D games as UsefulCRM apps using p5.js, Three.js, Matter.js, and other game libraries. Covers game architecture, sprites, physics, particles, audio, tilemaps, and complete game examples.
metadata: { "hermes": { "inject": true, "always": true, "emoji": "🎮" } }
---

# App Game Builder

This skill covers building 2D and 3D games as UsefulCRM apps. For core app structure, manifest reference, and bridge API basics, see the parent **app-builder** skill (`app-builder/SKILL.md`).

---

## 2D Games with p5.js

**Always use p5.js for 2D games, simulations, generative art, and interactive 2D experiences.** p5.js is the default choice for anything 2D unless the user specifically requests something else.

### When to Use p5.js

- 2D games (platformer, puzzle, arcade, card games, board games)
- Generative art and creative coding
- Physics simulations and particle systems
- Interactive data visualizations with animation
- Educational simulations and demonstrations
- Drawing and painting tools
- Any 2D canvas-based interactive experience

### p5.js App Template

```
apps/my-game.useful.app/
  .useful.yaml
  index.html
  sketch.js
  assets/           # sprites, sounds, fonts
```

**`.useful.yaml`:**
```yaml
name: "My Game"
description: "A fun 2D game built with p5.js"
icon: "gamepad-2"
version: "1.0.0"
entry: "index.html"
runtime: "static"
```

No permissions needed unless the game reads/writes workspace data.

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Game</title>
  <script src="https://unpkg.com/p5@1/lib/p5.min.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { display: flex; align-items: center; justify-content: center; background: #0f0f1a; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script src="sketch.js"></script>
</body>
</html>
```

**`sketch.js` (game loop skeleton):**
```javascript
let isDark = true;

function setup() {
  createCanvas(windowWidth, windowHeight);

  // Detect theme from UsefulCRM
  if (window.useful) {
    window.useful.app.getTheme().then(theme => {
      isDark = theme === 'dark';
    }).catch(() => {});
  }
}

function draw() {
  background(isDark ? 15 : 245);

  // Game rendering goes here
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
```

### p5.js Instance Mode (Recommended for Complex Apps)

Use instance mode to avoid global namespace pollution. This is especially important for multi-file apps:

```javascript
const sketch = (p) => {
  let isDark = true;
  let player;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    player = { x: p.width / 2, y: p.height / 2, size: 30, speed: 4 };

    if (window.useful) {
      window.useful.app.getTheme().then(theme => { isDark = theme === 'dark'; }).catch(() => {});
    }
  };

  p.draw = () => {
    p.background(isDark ? 15 : 245);

    // Input handling
    if (p.keyIsDown(p.LEFT_ARROW) || p.keyIsDown(65))  player.x -= player.speed;
    if (p.keyIsDown(p.RIGHT_ARROW) || p.keyIsDown(68)) player.x += player.speed;
    if (p.keyIsDown(p.UP_ARROW) || p.keyIsDown(87))    player.y -= player.speed;
    if (p.keyIsDown(p.DOWN_ARROW) || p.keyIsDown(83))   player.y += player.speed;

    // Keep in bounds
    player.x = p.constrain(player.x, 0, p.width);
    player.y = p.constrain(player.y, 0, p.height);

    // Draw player
    p.fill(isDark ? '#6366f1' : '#4f46e5');
    p.noStroke();
    p.ellipse(player.x, player.y, player.size);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
};

new p5(sketch);
```

### p5.js Game Architecture Patterns

#### Game State Machine

```javascript
const GameState = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', GAME_OVER: 'gameover' };
let state = GameState.MENU;
let score = 0;
let highScore = 0;

function draw() {
  switch (state) {
    case GameState.MENU:     drawMenu(); break;
    case GameState.PLAYING:  drawGame(); break;
    case GameState.PAUSED:   drawPause(); break;
    case GameState.GAME_OVER: drawGameOver(); break;
  }
}

function keyPressed() {
  if (state === GameState.MENU && (key === ' ' || key === 'Enter')) {
    state = GameState.PLAYING;
    resetGame();
  } else if (state === GameState.PLAYING && key === 'Escape') {
    state = GameState.PAUSED;
  } else if (state === GameState.PAUSED && key === 'Escape') {
    state = GameState.PLAYING;
  } else if (state === GameState.GAME_OVER && (key === ' ' || key === 'Enter')) {
    state = GameState.PLAYING;
    resetGame();
  }
}

function drawMenu() {
  background(15);
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(48);
  text('MY GAME', width / 2, height / 2 - 60);
  textSize(18);
  fill(150);
  text('Press SPACE or ENTER to start', width / 2, height / 2 + 20);
  if (highScore > 0) {
    textSize(14);
    text('High Score: ' + highScore, width / 2, height / 2 + 60);
  }
}

function drawGameOver() {
  background(15);
  fill('#ef4444');
  textAlign(CENTER, CENTER);
  textSize(48);
  text('GAME OVER', width / 2, height / 2 - 60);
  fill(255);
  textSize(24);
  text('Score: ' + score, width / 2, height / 2);
  textSize(16);
  fill(150);
  text('Press SPACE to play again', width / 2, height / 2 + 50);
}
```

#### Sprite Management

```javascript
class Sprite {
  constructor(x, y, w, h) {
    this.pos = createVector(x, y);
    this.vel = createVector(0, 0);
    this.w = w;
    this.h = h;
    this.alive = true;
  }

  update() {
    this.pos.add(this.vel);
  }

  draw() {
    rectMode(CENTER);
    rect(this.pos.x, this.pos.y, this.w, this.h);
  }

  collidesWith(other) {
    return (
      this.pos.x - this.w / 2 < other.pos.x + other.w / 2 &&
      this.pos.x + this.w / 2 > other.pos.x - other.w / 2 &&
      this.pos.y - this.h / 2 < other.pos.y + other.h / 2 &&
      this.pos.y + this.h / 2 > other.pos.y - other.h / 2
    );
  }

  isOffscreen() {
    return (
      this.pos.x < -this.w || this.pos.x > width + this.w ||
      this.pos.y < -this.h || this.pos.y > height + this.h
    );
  }
}
```

#### Particle System

```javascript
class Particle {
  constructor(x, y, color) {
    this.pos = createVector(x, y);
    this.vel = p5.Vector.random2D().mult(random(1, 5));
    this.acc = createVector(0, 0.1);
    this.color = color;
    this.alpha = 255;
    this.size = random(3, 8);
    this.life = 1.0;
    this.decay = random(0.01, 0.04);
  }

  update() {
    this.vel.add(this.acc);
    this.pos.add(this.vel);
    this.life -= this.decay;
    this.alpha = this.life * 255;
  }

  draw() {
    noStroke();
    fill(red(this.color), green(this.color), blue(this.color), this.alpha);
    ellipse(this.pos.x, this.pos.y, this.size);
  }

  isDead() {
    return this.life <= 0;
  }
}

let particles = [];

function spawnExplosion(x, y, col, count = 30) {
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(x, y, col));
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw();
    if (particles[i].isDead()) particles.splice(i, 1);
  }
}
```

#### Camera / Scrolling

```javascript
let camera = { x: 0, y: 0 };

function draw() {
  background(15);

  // Follow player
  camera.x = lerp(camera.x, player.x - width / 2, 0.1);
  camera.y = lerp(camera.y, player.y - height / 2, 0.1);

  push();
  translate(-camera.x, -camera.y);

  // Draw world (in world coordinates)
  drawWorld();
  drawPlayer();
  drawEnemies();

  pop();

  // Draw HUD (in screen coordinates)
  drawHUD();
}
```

#### Tilemap Rendering

```javascript
const TILE_SIZE = 32;
const tilemap = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 2, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 3, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
];

const TILE_COLORS = {
  0: null,       // empty
  1: '#4a4a6a',  // wall
  2: '#22c55e',  // item
  3: '#ef4444',  // enemy
};

function drawTilemap() {
  for (let row = 0; row < tilemap.length; row++) {
    for (let col = 0; col < tilemap[row].length; col++) {
      const tile = tilemap[row][col];
      if (TILE_COLORS[tile]) {
        fill(TILE_COLORS[tile]);
        noStroke();
        rect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}
```

#### Sound Effects (using p5.sound or Howler.js)

For sound, prefer Howler.js since p5.sound adds significant bundle size:

```html
<script src="https://unpkg.com/howler@2/dist/howler.min.js"></script>
```

```javascript
const sounds = {
  jump: new Howl({ src: ['assets/jump.wav'], volume: 0.5 }),
  hit: new Howl({ src: ['assets/hit.wav'], volume: 0.7 }),
  coin: new Howl({ src: ['assets/coin.wav'], volume: 0.4 }),
  music: new Howl({ src: ['assets/music.mp3'], loop: true, volume: 0.3 }),
};
```

If no sound assets are available, generate simple audio with Tone.js or the Web Audio API:

```javascript
function playBeep(freq = 440, duration = 0.1) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}
```

### p5.js with Physics (Matter.js)

For games needing realistic 2D physics (platformers, ragdoll, pinball):

```html
<script src="https://unpkg.com/p5@1/lib/p5.min.js"></script>
<script src="https://unpkg.com/matter-js@0.20/build/matter.min.js"></script>
```

```javascript
const { Engine, World, Bodies, Body, Events } = Matter;

let engine, world;
let ground, player;

function setup() {
  createCanvas(windowWidth, windowHeight);
  engine = Engine.create();
  world = engine.world;

  ground = Bodies.rectangle(width / 2, height - 20, width, 40, { isStatic: true });
  player = Bodies.circle(width / 2, height / 2, 20, { restitution: 0.5 });

  World.add(world, [ground, player]);
}

function draw() {
  Engine.update(engine);
  background(15);

  // Draw ground
  fill('#4a4a6a');
  rectMode(CENTER);
  rect(ground.position.x, ground.position.y, width, 40);

  // Draw player
  fill('#6366f1');
  ellipse(player.position.x, player.position.y, 40);
}

function keyPressed() {
  if (key === ' ') {
    Body.applyForce(player, player.position, { x: 0, y: -0.05 });
  }
}
```

### p5.js Responsive Canvas

Always handle window resizing and use the full viewport:

```javascript
function setup() {
  createCanvas(windowWidth, windowHeight);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
```

For fixed-aspect-ratio games (e.g., retro pixel games), scale the canvas:

```javascript
const GAME_W = 320;
const GAME_H = 240;
let scaleFactor;

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  noSmooth();
  calcScale();
}

function calcScale() {
  scaleFactor = min(windowWidth / GAME_W, windowHeight / GAME_H);
}

function draw() {
  background(0);
  push();
  translate((width - GAME_W * scaleFactor) / 2, (height - GAME_H * scaleFactor) / 2);
  scale(scaleFactor);

  // All game drawing at GAME_W x GAME_H logical resolution
  drawGameWorld();

  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  calcScale();
}
```

### Touch / Mobile Input for p5.js Games

```javascript
let touchActive = false;
let touchX = 0, touchY = 0;

function touchStarted() {
  touchActive = true;
  touchX = mouseX;
  touchY = mouseY;
  return false; // prevent default
}

function touchMoved() {
  touchX = mouseX;
  touchY = mouseY;
  return false;
}

function touchEnded() {
  touchActive = false;
  return false;
}

// Unified input: works for both mouse and touch
function getInputX() { return mouseX; }
function getInputY() { return mouseY; }
function isInputActive() { return mouseIsPressed || touchActive; }
```

### p5.js High Score Persistence with DuckDB

If the game has a `database` permission, persist high scores:

```javascript
async function loadHighScore() {
  try {
    await window.useful.db.execute(`
      CREATE TABLE IF NOT EXISTS game_scores (
        game TEXT, score INTEGER, played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const result = await window.useful.db.query(
      `SELECT MAX(score) as high_score FROM game_scores WHERE game = 'my-game'`
    );
    return result.rows?.[0]?.high_score || 0;
  } catch { return 0; }
}

async function saveScore(score) {
  try {
    await window.useful.db.execute(
      `INSERT INTO game_scores (game, score) VALUES ('my-game', ${score})`
    );
  } catch {}
}
```

---

## 3D Games & Experiences with Three.js

**Always use Three.js for 3D games, visualizations, and interactive 3D experiences.** Three.js is the default choice for anything 3D.

### When to Use Three.js

- 3D games (first-person, third-person, flying, racing)
- 3D product viewers and configurators
- Terrain and world visualization
- 3D data visualization (3D scatter plots, network graphs)
- Architectural walkthroughs
- Generative 3D art
- Physics-based 3D simulations

### Three.js App Template

```
apps/my-3d-app.useful.app/
  .useful.yaml
  index.html
  app.js            # Main Three.js module
  assets/
    model.glb       # 3D models (optional)
    texture.jpg     # Textures (optional)
```

**`.useful.yaml`:**
```yaml
name: "3D World"
description: "An interactive 3D experience"
icon: "box"
version: "1.0.0"
entry: "index.html"
runtime: "static"
```

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D World</title>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.170/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.170/examples/jsm/"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    canvas { display: block; }
    #loading {
      position: fixed; inset: 0; display: flex;
      align-items: center; justify-content: center;
      background: #0f0f1a; color: #e8e8f0;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 18px; z-index: 10;
      transition: opacity 0.5s;
    }
    #loading.hidden { opacity: 0; pointer-events: none; }
  </style>
</head>
<body>
  <div id="loading">Loading...</div>
  <script type="module" src="app.js"></script>
</body>
</html>
```

**`app.js` (Three.js module skeleton):**
```javascript
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Scene setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0f1a);
scene.fog = new THREE.Fog(0x0f0f1a, 50, 200);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2;

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.set(2048, 2048);
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 100;
directionalLight.shadow.camera.left = -30;
directionalLight.shadow.camera.right = 30;
directionalLight.shadow.camera.top = 30;
directionalLight.shadow.camera.bottom = -30;
scene.add(directionalLight);

// --- Ground ---
const groundGeo = new THREE.PlaneGeometry(200, 200);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Objects ---
const geometry = new THREE.BoxGeometry(2, 2, 2);
const material = new THREE.MeshStandardMaterial({
  color: 0x6366f1,
  roughness: 0.3,
  metalness: 0.5,
});
const cube = new THREE.Mesh(geometry, material);
cube.position.y = 1;
cube.castShadow = true;
scene.add(cube);

// --- Theme ---
if (window.useful) {
  window.useful.app.getTheme().then(theme => {
    if (theme === 'light') {
      scene.background = new THREE.Color(0xf0f0f5);
      scene.fog = new THREE.Fog(0xf0f0f5, 50, 200);
      groundMat.color.set(0xe8e8f0);
    }
  }).catch(() => {});
}

// --- Hide loading screen ---
document.getElementById('loading')?.classList.add('hidden');

// --- Animation loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  cube.rotation.y = elapsed * 0.5;
  cube.position.y = 1 + Math.sin(elapsed) * 0.5;

  controls.update();
  renderer.render(scene, camera);
}

animate();

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
```

### Three.js Common Addons

Load additional Three.js modules as needed via the import map:

```javascript
// First-person controls
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// GLTF model loading
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Post-processing
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Environment maps
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// Text
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// Sky
import { Sky } from 'three/addons/objects/Sky.js';

// Water
import { Water } from 'three/addons/objects/Water.js';

// Physics integration (use cannon-es via CDN)
// Add to importmap: "cannon-es": "https://unpkg.com/cannon-es@0.20/dist/cannon-es.js"
import * as CANNON from 'cannon-es';
```

### Three.js First-Person Game Pattern

```javascript
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, document.body);

// Click to enter pointer lock
document.addEventListener('click', () => {
  if (!controls.isLocked) controls.lock();
});

// Movement state
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const keys = { forward: false, backward: false, left: false, right: false, jump: false };

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = true; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = true; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'Space':                   keys.jump = true; break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = false; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = false; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
    case 'Space':                   keys.jump = false; break;
  }
});

let onGround = true;
const MOVE_SPEED = 50;
const JUMP_FORCE = 12;
const GRAVITY = 30;

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (controls.isLocked) {
    // Apply friction
    velocity.x -= velocity.x * 10.0 * dt;
    velocity.z -= velocity.z * 10.0 * dt;
    velocity.y -= GRAVITY * dt;

    direction.z = Number(keys.forward) - Number(keys.backward);
    direction.x = Number(keys.right) - Number(keys.left);
    direction.normalize();

    if (keys.forward || keys.backward) velocity.z -= direction.z * MOVE_SPEED * dt;
    if (keys.left || keys.right) velocity.x -= direction.x * MOVE_SPEED * dt;
    if (keys.jump && onGround) { velocity.y = JUMP_FORCE; onGround = false; }

    controls.moveRight(-velocity.x * dt);
    controls.moveForward(-velocity.z * dt);
    camera.position.y += velocity.y * dt;

    if (camera.position.y < 1.7) {
      velocity.y = 0;
      camera.position.y = 1.7;
      onGround = true;
    }
  }

  renderer.render(scene, camera);
}

animate();
```

### Three.js GLTF Model Loading

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.170/examples/jsm/libs/draco/');
loader.setDRACOLoader(dracoLoader);

// Load a model from the app's assets folder
loader.load('assets/model.glb', (gltf) => {
  const model = gltf.scene;
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  model.scale.setScalar(1);
  scene.add(model);

  // If the model has animations
  if (gltf.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
    // In animate loop: mixer.update(dt);
  }
}, undefined, (error) => {
  console.error('Model load error:', error);
});
```

### Three.js Post-Processing (Bloom, etc.)

```javascript
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5,  // strength
  0.4,  // radius
  0.85  // threshold
);
composer.addPass(bloomPass);

// In animate loop, replace renderer.render(scene, camera) with:
// composer.render();

// On resize, also update:
// composer.setSize(window.innerWidth, window.innerHeight);
```

### Three.js Procedural Terrain

```javascript
function createTerrain(width, depth, resolution) {
  const geometry = new THREE.PlaneGeometry(width, depth, resolution, resolution);
  const vertices = geometry.attributes.position.array;

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const z = vertices[i + 1];
    vertices[i + 2] = noise(x * 0.02, z * 0.02) * 15;
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x3a7d44,
    roughness: 0.9,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

// Simple noise function (for procedural generation without dependencies)
function noise(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
```

### Three.js HUD / UI Overlay

Since Three.js renders to a canvas, use HTML overlays for UI:

```html
<div id="hud" style="
  position: fixed; top: 0; left: 0; right: 0;
  padding: 16px; pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  color: white; z-index: 5;
">
  <div id="score" style="font-size: 24px; font-weight: 700;"></div>
  <div id="health-bar" style="
    width: 200px; height: 8px; border-radius: 4px;
    background: rgba(255,255,255,0.2); margin-top: 8px;
  ">
    <div id="health-fill" style="
      width: 100%; height: 100%; border-radius: 4px;
      background: #22c55e; transition: width 0.3s;
    "></div>
  </div>
</div>
```

```javascript
function updateHUD(score, health) {
  document.getElementById('score').textContent = `Score: ${score}`;
  document.getElementById('health-fill').style.width = `${health}%`;
  document.getElementById('health-fill').style.background =
    health > 50 ? '#22c55e' : health > 25 ? '#f59e0b' : '#ef4444';
}
```

---

## Full Game Examples

### Example 1: Arcade Game (p5.js)

A complete asteroid-dodge game with scoring, particles, and game states.

**`.useful.yaml`:**
```yaml
name: "Asteroid Dodge"
description: "Dodge the falling asteroids! Arrow keys or WASD to move."
icon: "rocket"
version: "1.0.0"
entry: "index.html"
runtime: "static"
```

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Asteroid Dodge</title>
  <script src="https://unpkg.com/p5@1/lib/p5.min.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0a1a; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script src="game.js"></script>
</body>
</html>
```

**`game.js`:**
```javascript
const State = { MENU: 0, PLAY: 1, OVER: 2 };
let state = State.MENU;
let player, asteroids, particles, stars;
let score, highScore = 0, spawnTimer, difficulty;

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('system-ui');

  stars = Array.from({ length: 100 }, () => ({
    x: random(width), y: random(height), s: random(1, 3), b: random(100, 255)
  }));

  if (window.useful) {
    window.useful.app.getTheme().catch(() => {});
  }
}

function resetGame() {
  player = { x: width / 2, y: height - 80, size: 24, speed: 5, lives: 3, invincible: 0 };
  asteroids = [];
  particles = [];
  score = 0;
  spawnTimer = 0;
  difficulty = 1;
}

function draw() {
  background(10, 10, 26);
  drawStars();

  switch (state) {
    case State.MENU: drawMenu(); break;
    case State.PLAY: updateGame(); drawGame(); drawHUD(); break;
    case State.OVER: drawGame(); drawHUD(); drawGameOver(); break;
  }
}

function drawStars() {
  noStroke();
  for (const s of stars) {
    fill(255, s.b);
    ellipse(s.x, s.y, s.s);
    s.y += s.s * 0.3;
    if (s.y > height) { s.y = 0; s.x = random(width); }
  }
}

function drawMenu() {
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(min(width * 0.08, 56));
  textStyle(BOLD);
  text('ASTEROID DODGE', width / 2, height / 2 - 60);
  textSize(min(width * 0.03, 18));
  textStyle(NORMAL);
  fill(180);
  text('Arrow keys or WASD to move', width / 2, height / 2 + 10);
  fill(99, 102, 241);
  text('Press SPACE or ENTER to start', width / 2, height / 2 + 50);
  if (highScore > 0) {
    fill(120);
    textSize(14);
    text('High Score: ' + highScore, width / 2, height / 2 + 90);
  }
}

function updateGame() {
  // Player movement
  if (keyIsDown(LEFT_ARROW) || keyIsDown(65)) player.x -= player.speed;
  if (keyIsDown(RIGHT_ARROW) || keyIsDown(68)) player.x += player.speed;
  if (keyIsDown(UP_ARROW) || keyIsDown(87)) player.y -= player.speed;
  if (keyIsDown(DOWN_ARROW) || keyIsDown(83)) player.y += player.speed;
  player.x = constrain(player.x, player.size, width - player.size);
  player.y = constrain(player.y, player.size, height - player.size);
  if (player.invincible > 0) player.invincible--;

  // Spawn asteroids
  difficulty = 1 + score / 500;
  spawnTimer++;
  if (spawnTimer > max(15, 45 - difficulty * 3)) {
    asteroids.push({
      x: random(width), y: -30,
      size: random(15, 35),
      vy: random(2, 4) * difficulty,
      vx: random(-1, 1),
      rot: random(TWO_PI),
      rotSpeed: random(-0.05, 0.05),
    });
    spawnTimer = 0;
  }

  // Update asteroids
  for (let i = asteroids.length - 1; i >= 0; i--) {
    const a = asteroids[i];
    a.y += a.vy;
    a.x += a.vx;
    a.rot += a.rotSpeed;

    if (a.y > height + 50) {
      asteroids.splice(i, 1);
      score += 10;
      continue;
    }

    // Collision
    if (player.invincible <= 0 && dist(player.x, player.y, a.x, a.y) < player.size + a.size / 2) {
      spawnParticles(a.x, a.y, color(239, 68, 68), 20);
      asteroids.splice(i, 1);
      player.lives--;
      player.invincible = 90;
      if (player.lives <= 0) {
        highScore = max(highScore, score);
        state = State.OVER;
      }
    }
  }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 0.02;
    if (p.life <= 0) particles.splice(i, 1);
  }

  score++;
}

function drawGame() {
  // Draw asteroids
  for (const a of asteroids) {
    push();
    translate(a.x, a.y);
    rotate(a.rot);
    fill(120, 120, 140);
    stroke(80, 80, 100);
    strokeWeight(1);
    beginShape();
    for (let i = 0; i < 7; i++) {
      const angle = map(i, 0, 7, 0, TWO_PI);
      const r = a.size / 2 * (0.7 + 0.3 * sin(i * 2.5));
      vertex(cos(angle) * r, sin(angle) * r);
    }
    endShape(CLOSE);
    pop();
  }

  // Draw particles
  noStroke();
  for (const p of particles) {
    fill(red(p.col), green(p.col), blue(p.col), p.life * 255);
    ellipse(p.x, p.y, p.size * p.life);
  }

  // Draw player
  if (state === State.PLAY) {
    if (player.invincible <= 0 || frameCount % 6 < 3) {
      push();
      translate(player.x, player.y);
      fill(99, 102, 241);
      noStroke();
      triangle(0, -player.size, -player.size * 0.6, player.size * 0.6, player.size * 0.6, player.size * 0.6);
      fill(129, 140, 248);
      triangle(0, -player.size * 0.5, -player.size * 0.3, player.size * 0.3, player.size * 0.3, player.size * 0.3);
      pop();
    }
  }
}

function drawHUD() {
  fill(255);
  noStroke();
  textAlign(LEFT, TOP);
  textSize(20);
  textStyle(BOLD);
  text('Score: ' + score, 20, 20);
  textStyle(NORMAL);
  textSize(14);
  fill(200);
  for (let i = 0; i < player.lives; i++) {
    fill(239, 68, 68);
    ellipse(20 + i * 22, 55, 14);
  }
}

function drawGameOver() {
  fill(0, 0, 0, 150);
  rect(0, 0, width, height);
  fill(239, 68, 68);
  textAlign(CENTER, CENTER);
  textSize(min(width * 0.07, 48));
  textStyle(BOLD);
  text('GAME OVER', width / 2, height / 2 - 40);
  fill(255);
  textSize(22);
  textStyle(NORMAL);
  text('Score: ' + score, width / 2, height / 2 + 10);
  fill(180);
  textSize(16);
  text('Press SPACE to play again', width / 2, height / 2 + 50);
}

function spawnParticles(x, y, col, count) {
  for (let i = 0; i < count; i++) {
    const angle = random(TWO_PI);
    const speed = random(1, 5);
    particles.push({
      x, y, vx: cos(angle) * speed, vy: sin(angle) * speed,
      size: random(4, 10), col, life: 1.0,
    });
  }
}

function keyPressed() {
  if (state === State.MENU && (key === ' ' || key === 'Enter')) {
    state = State.PLAY;
    resetGame();
  } else if (state === State.OVER && (key === ' ' || key === 'Enter')) {
    state = State.PLAY;
    resetGame();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
```

### Example 2: 3D Scene Viewer (Three.js)

**`.useful.yaml`:**
```yaml
name: "3D Playground"
description: "Interactive 3D scene with orbit controls"
icon: "box"
version: "1.0.0"
entry: "index.html"
runtime: "static"
```

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Playground</title>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.170/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.170/examples/jsm/"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script type="module" src="scene.js"></script>
</body>
</html>
```

**`scene.js`:**
```javascript
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
let bgColor = 0x0f0f1a;

if (window.useful) {
  window.useful.app.getTheme().then(t => {
    bgColor = t === 'light' ? 0xf0f0f5 : 0x0f0f1a;
    scene.background = new THREE.Color(bgColor);
    scene.fog = new THREE.Fog(bgColor, 30, 100);
  }).catch(() => {});
}

scene.background = new THREE.Color(bgColor);
scene.fog = new THREE.Fog(bgColor, 30, 100);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
camera.position.set(8, 6, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0x404060, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(10, 20, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const shapes = [];
const colors = [0x6366f1, 0x22c55e, 0xf59e0b, 0xef4444, 0x06b6d4];

for (let i = 0; i < 12; i++) {
  const geos = [
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.SphereGeometry(0.6, 32, 32),
    new THREE.ConeGeometry(0.5, 1.2, 6),
    new THREE.TorusGeometry(0.5, 0.2, 16, 32),
    new THREE.OctahedronGeometry(0.6),
  ];
  const geo = geos[Math.floor(Math.random() * geos.length)];
  const mat = new THREE.MeshStandardMaterial({
    color: colors[Math.floor(Math.random() * colors.length)],
    roughness: 0.3, metalness: 0.5,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    (Math.random() - 0.5) * 16,
    0.5 + Math.random() * 3,
    (Math.random() - 0.5) * 16
  );
  mesh.castShadow = true;
  mesh.userData = {
    baseY: mesh.position.y,
    phase: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.02,
  };
  scene.add(mesh);
  shapes.push(mesh);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  for (const s of shapes) {
    s.position.y = s.userData.baseY + Math.sin(t + s.userData.phase) * 0.4;
    s.rotation.y += s.userData.rotSpeed;
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
```
