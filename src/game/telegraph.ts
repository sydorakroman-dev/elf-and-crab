import * as THREE from 'three';

/** [x, z, radius, progress 0→1] — where an attack is about to land. */
export type TelegraphTuple = [number, number, number, number];

/**
 * Red warning rings on the floor that fill in as attacks approach impact (boss slams, the bear's
 * pound, a boar about to charge). Driven by a list of tuples (hero sim and familiar view alike).
 */
export class TelegraphRings {
  readonly group = new THREE.Group();
  private readonly rings: { root: THREE.Group; rim: THREE.Mesh; fill: THREE.Mesh }[] = [];
  private readonly rimGeo = new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2);
  private readonly fillGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);

  sync(list: readonly TelegraphTuple[], time: number): void {
    while (this.rings.length < list.length) {
      const mat = (opacity: number) =>
        new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
      const root = new THREE.Group();
      const rim = new THREE.Mesh(this.rimGeo, mat(0.9));
      const fill = new THREE.Mesh(this.fillGeo, mat(0.25));
      rim.position.y = 0.07;
      fill.position.y = 0.06;
      root.add(rim, fill);
      this.group.add(root);
      this.rings.push({ root, rim, fill });
    }
    this.rings.forEach((r, i) => {
      const t = list[i];
      r.root.visible = !!t;
      if (!t) return;
      const [x, z, radius, p] = t;
      r.root.position.set(x, 0, z);
      r.rim.scale.setScalar(radius);
      r.fill.scale.setScalar(Math.max(0.01, radius * p));
      (r.rim.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(time * 20 + i) * 0.3;
    });
  }
}
