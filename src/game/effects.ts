import * as THREE from 'three';

const MAX = 400;
const GRAVITY = 18;

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

/** Little cube particles for slime splats and hit sparks; one instanced mesh. */
const RING_TIME = 0.55;

export class Effects {
  readonly mesh: THREE.InstancedMesh;
  /** Add this to the scene too (for ring effects). */
  readonly rings = new THREE.Group();
  private readonly ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
  private readonly activeRings: { mesh: THREE.Mesh; age: number; radius: number }[] = [];
  private readonly particles: Particle[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private next = 0;

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, flatShading: true }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.particles.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 0 });
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, new THREE.Color());
    }
  }

  /** An expanding glowing ring on the floor (e.g. the crab's Magic Burst). */
  ring(x: number, z: number, color: THREE.Color | number, radius: number): void {
    const mesh = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.position.set(x, 0.08, z);
    this.rings.add(mesh);
    this.activeRings.push({ mesh, age: 0, radius });
  }

  burst(x: number, y: number, z: number, color: THREE.Color, count: number, power = 6, size = 0.18): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const p = this.particles[i];
      p.pos.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random();
      const r = Math.random() * power;
      p.vel.set(Math.cos(a) * r, up * power * 0.8, Math.sin(a) * r);
      p.maxLife = p.life = 0.5 + Math.random() * 0.5;
      p.size = size * (0.6 + Math.random() * 0.8);
      this.mesh.setColorAt(i, color);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.particles) p.life = 0;
    for (const r of this.activeRings) this.rings.remove(r.mesh);
    this.activeRings.length = 0;
  }

  update(dt: number): void {
    for (let i = this.activeRings.length - 1; i >= 0; i--) {
      const r = this.activeRings[i];
      r.age += dt;
      const k = r.age / RING_TIME;
      if (k >= 1) {
        this.rings.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.activeRings.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - k) ** 3;
      r.mesh.scale.setScalar(0.3 + ease * r.radius);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
    this.particles.forEach((p, i) => {
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        return;
      }
      p.life -= dt;
      p.vel.y -= GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < p.size / 2) {
        p.pos.y = p.size / 2;
        p.vel.multiplyScalar(0.4);
        p.vel.y = Math.abs(p.vel.y) * 0.3;
      }
      const k = Math.max(0, p.life / p.maxLife);
      this.q.setFromAxisAngle(this.s.set(1, 1, 0).normalize(), p.life * 8);
      this.mesh.setMatrixAt(i, this.m.compose(p.pos, this.q, this.s.setScalar(p.size * k)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
