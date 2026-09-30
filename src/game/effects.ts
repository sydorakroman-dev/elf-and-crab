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
export class Effects {
  readonly mesh: THREE.InstancedMesh;
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
  }

  update(dt: number): void {
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
