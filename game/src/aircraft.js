import * as THREE from 'three';

function wingGeometry(side, top, bottom) {
  const v = [
    [0, 0, -2.4], [0, 0, 5.4], [side * 15.5, 0, 1.9], [side * 15.5, 0, 4.4],
  ];
  const positions = [];
  for (const p of v) positions.push(p[0], p[1] + top, p[2]);
  for (const p of v) positions.push(p[0], p[1] + bottom, p[2]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildAircraft() {
  const plane = new THREE.Group();
  plane.name = 'Halcyon aircraft';

  const cream = new THREE.MeshStandardMaterial({ color: 0xfff2dc, roughness: 0.46, metalness: 0.16, flatShading: true });
  const coral = new THREE.MeshStandardMaterial({ color: 0xe87866, roughness: 0.52, metalness: 0.12, flatShading: true });
  const teal = new THREE.MeshStandardMaterial({ color: 0x2e6f72, roughness: 0.5, metalness: 0.18, flatShading: true });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9bd9da, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.68 });
  const warm = new THREE.MeshBasicMaterial({ color: 0xffc98f });

  const noseGeo = new THREE.ConeGeometry(2.9, 14, 8);
  noseGeo.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, cream);
  nose.position.z = -5.2;
  nose.castShadow = true;
  plane.add(nose);

  const bodyGeo = new THREE.CylinderGeometry(2.7, 2.15, 13, 8);
  bodyGeo.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, cream);
  body.position.z = 4.4;
  body.castShadow = true;
  plane.add(body);

  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeometry(side, 0.34, -0.34), coral);
    wing.castShadow = true;
    plane.add(wing);
    const tip = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.5, 2.7),
      cream,
    );
    tip.position.set(side * 14.8, 0, 3.1);
    plane.add(tip);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.44, 3.1), teal);
    tail.position.set(side * 3.1, 0.55, 9.1);
    tail.rotation.y = side * 0.16;
    plane.add(tail);
  }

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.4, 4.8), coral);
  fin.position.set(0, 3.0, 9.0);
  fin.castShadow = true;
  plane.add(fin);

  const canopyGeo = new THREE.SphereGeometry(2.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  canopy.scale.set(1, 0.78, 2.1);
  canopy.position.set(0, 2.15, -1.8);
  plane.add(canopy);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.26, 14.5), teal);
  stripe.position.set(0, 2.55, 2.2);
  plane.add(stripe);

  const spinner = new THREE.Mesh(new THREE.ConeGeometry(1.3, 3.4, 8), teal);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -12.7;
  plane.add(spinner);
  const prop = new THREE.Mesh(
    new THREE.PlaneGeometry(11.2, 1.05),
    new THREE.MeshBasicMaterial({ color: 0xfff0d2, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }),
  );
  prop.position.z = -12.9;
  plane.add(prop);

  const navGeo = new THREE.SphereGeometry(0.55, 6, 5);
  const leftLight = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0xff8f7c }));
  leftLight.position.set(-15.2, 0.35, 3.1);
  const rightLight = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0x9ff0d0 }));
  rightLight.position.set(15.2, 0.35, 3.1);
  plane.add(leftLight, rightLight);

  const tipL = new THREE.Object3D();
  tipL.position.set(-14.8, 0.1, 3.1);
  const tipR = new THREE.Object3D();
  tipR.position.set(14.8, 0.1, 3.1);
  plane.add(tipL, tipR);

  const tailGlow = new THREE.Mesh(new THREE.CircleGeometry(1.15, 12), warm);
  tailGlow.position.set(0, -0.1, 11.3);
  plane.add(tailGlow);

  return { plane, wingTips: [tipL, tipR], prop };
}
