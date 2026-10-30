// Probe: what does a tap on the sphere's silhouette map to, in page pixels?
// Mirrors SurfaceScene's geometry: sphere r 0.95 at [1.8,1.5,0], rotation.y -PI/2,
// plane 3.4 x 2.55 at [-1.8,1.5,0] z 0, camera [0,1.5,7.2] fov 52, viewport 390x688.
import * as THREE from "three";

const W = 390;
const H = 688;

const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 100);
camera.position.set(0, 1.5, 7.2);
camera.lookAt(0, 1.5, 0);
camera.updateMatrixWorld();
camera.updateProjectionMatrix();

const scene = new THREE.Scene();

const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.95, 48, 32),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
);
sphere.position.set(1.8, 1.5, 0);
sphere.rotation.y = -Math.PI / 2;
scene.add(sphere);

const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(3.4, 2.55),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
);
plane.position.set(-1.8, 1.5, 0);
scene.add(plane);

const TEX_W = 640;
const TEX_H = 320;
const PLANE_W = 512;
const PLANE_H = 512;

const raycaster = new THREE.Raycaster();

function probe(ndcX, ndcY) {
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const hits = raycaster.intersectObjects([sphere, plane], false);
  return hits[0] ?? null;
}

// Where does the sphere sit on screen?
const box = new THREE.Box3().setFromObject(sphere);
const corners = [
  [box.min.x, box.min.y, box.max.z],
  [box.max.x, box.max.y, box.max.z],
];
for (const [x, y, z] of corners) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  console.log(
    `sphere corner world(${x.toFixed(2)},${y.toFixed(2)}) -> screen x ${(((v.x + 1) / 2) * W).toFixed(0)} y ${(((-v.y + 1) / 2) * H).toFixed(0)}`,
  );
}

console.log("\n--- vertical scan through the sphere's screen centre ---");
// Find the sphere's screen centre x.
const centre = new THREE.Vector3(1.8, 1.5, 0.95).project(camera);
const cx = centre.x;
console.log(`scan at ndcX ${cx.toFixed(3)}`);

const rows = [];
for (let i = 0; i <= 40; i += 1) {
  const ndcY = 1 - (i / 40) * 2;
  const hit = probe(cx, ndcY);
  if (!hit || !hit.uv) continue;
  const isSphere = hit.object === sphere;
  const pageY = (1 - hit.uv.y) * (isSphere ? TEX_H : PLANE_H);
  const pageX = hit.uv.x * (isSphere ? TEX_W : PLANE_W);
  const screenY = ((-ndcY + 1) / 2) * H;
  rows.push({ screenY, obj: isSphere ? "sphere" : "plane", pageX, pageY, uvY: hit.uv.y });
}

for (const r of rows) {
  console.log(
    `screen y ${r.screenY.toFixed(0).padStart(3)}  ${r.obj.padEnd(6)}  uv.y ${r.uvY.toFixed(3)}  page px ${r.pageX.toFixed(0).padStart(3)}, ${r.pageY.toFixed(0).padStart(3)}`,
  );
}

// The distribution of page rows across the sphere's visible front.
const sphereRows = rows.filter((r) => r.obj === "sphere");
if (sphereRows.length > 1) {
  const top = sphereRows[0];
  const bottom = sphereRows[sphereRows.length - 1];
  console.log(
    `\nvisible page rows on the front: ${top.pageY.toFixed(0)} .. ${bottom.pageY.toFixed(0)} of ${TEX_H}`,
  );
  const mid = sphereRows[Math.floor(sphereRows.length / 2)];
  console.log(`screen midpoint of the sphere maps to page row ${mid.pageY.toFixed(0)}`);
  // Where is page row 240 (the button at offset 0) on screen?
  const near = sphereRows.reduce((best, r) =>
    Math.abs(r.pageY - 240) < Math.abs(best.pageY - 240) ? r : best,
  );
  console.log(`page row 240 is hit at screen y ${near.screenY.toFixed(0)} (of ${H})`);
  const near160 = sphereRows.reduce((best, r) =>
    Math.abs(r.pageY - 160) < Math.abs(best.pageY - 160) ? r : best,
  );
  console.log(`page row 160 is hit at screen y ${near160.screenY.toFixed(0)} (of ${H})`);
}
