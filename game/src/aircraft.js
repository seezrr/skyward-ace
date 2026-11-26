import * as THREE from 'three';

function panelGeometry(top, bottom, vertices, indices) {
  const positions = [];
  for (const v of vertices) {
    positions.push(v[0], v[1] + top, v[2]);
  }
  for (const v of vertices) {
    positions.push(v[0], v[1] + bottom, v[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeWing(side, material) {
  // A swept trapezoid with a real thickness, not a placeholder box.
  const v = [
    [0, 0, -2], [0, 0, 6.2], [side * 16.5, 0, 2.6], [side * 16.5, 0, 5.4],
  ];
  const top = [0, 1, 2, 0, 2, 3];
  const bottom = [4, 6, 5, 4, 7, 6];
  const edges = [
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];
  const geo = panelGeometry(0.42, -0.42, v, [...top, ...bottom, ...edges]);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

export function buildAircraft() {
  const plane = new THREE.Group();
  plane.name = 'Skyward Ace aircraft';

  const shellMat = new THREE.MeshStandardMaterial({ color: 0xe8f2f3, metalness: 0.35, roughness: 0.42, flatShading: true });
  const navyMat = new THREE.MeshStandardMaterial({ color: 0x163a52, metalness: 0.4, roughness: 0.46, flatShading: true });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xff9d45, emissive: 0x5a2707, metalness: 0.3, roughness: 0.5, flatShading: true });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x8fd8ec, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.62 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb161 });

  const noseGeo = new THREE.ConeGeometry(3.15, 17, 8);
  noseGeo.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, shellMat);
  nose.position.z = -4.5;
  nose.castShadow = true;
  plane.add(nose);

  const bodyGeo = new THREE.CylinderGeometry(3.0, 2.3, 13, 8);
  bodyGeo.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, shellMat);
  body.position.z = 5.5;
  body.castShadow = true;
  plane.add(body);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 16), accentMat);
  stripe.position.set(0, 2.85, 1.5);
  plane.add(stripe);

  plane.add(makeWing(1, navyMat));
  plane.add(makeWing(-1, navyMat));

  const tailGeo = new THREE.BoxGeometry(11, 0.5, 3.6);
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(tailGeo, navyMat);
    tail.position.set(side * 3.4, 0.55, 9.4);
    tail.rotation.y = side * 0.18;
    tail.castShadow = true;
    plane.add(tail);
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.55, 5.8, 5.2), accentMat);
  fin.position.set(0, 3.2, 9.2);
  fin.castShadow = true;
  plane.add(fin);

  const canopyGeo = new THREE.SphereGeometry(2.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const canopy = new THREE.Mesh(canopyGeo, glassMat);
  canopy.scale.set(1, 0.82, 2.25);
  canopy.position.set(0, 2.3, -1.3);
  plane.add(canopy);

  const nozzles = [];
  for (const side of [-1, 1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 3.2, 8), navyMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(side * 1.65, -0.2, 12.2);
    plane.add(nozzle);
    const fire = new THREE.Mesh(new THREE.CircleGeometry(1.15, 10), glowMat);
    fire.position.set(side * 1.65, -0.2, 13.85);
    plane.add(fire);
    nozzles.push(fire);
  }

  const navGeo = new THREE.SphereGeometry(0.62, 6, 5);
  const redLight = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0xff4e50 }));
  redLight.position.set(-16.2, 0.4, 3.8);
  const greenLight = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0x5bff9b }));
  greenLight.position.set(16.2, 0.4, 3.8);
  plane.add(redLight, greenLight);

  const tipL = new THREE.Object3D();
  tipL.position.set(-16.2, 0.2, 4.0);
  const tipR = new THREE.Object3D();
  tipR.position.set(16.2, 0.2, 4.0);
  plane.add(tipL, tipR);

  const cockpitFrame = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x142836, roughness: 0.72, metalness: 0.3 });
  const addBar = (w, h, d, x, y, z) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    bar.position.set(x, y, z);
    cockpitFrame.add(bar);
  };
  addBar(0.55, 5.6, 0.7, -4.3, 2.3, -5.2);
  addBar(0.55, 5.6, 0.7, 4.3, 2.3, -5.2);
  addBar(9.4, 0.55, 0.7, 0, 5.0, -5.2);
  addBar(10.5, 2.4, 3.4, 0, -0.9, -4.2);
  cockpitFrame.visible = false;
  plane.add(cockpitFrame);

  return { plane, wingTips: [tipL, tipR], nozzles, cockpitFrame };
}
