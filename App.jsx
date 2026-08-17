import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Plus, Trash2, X, Move, Eye, Upload, ChevronUp, ChevronDown, Menu, Box } from 'lucide-react';

/* ---------------------------------------------------------------
   Tokens
--------------------------------------------------------------- */
const COLORS = {
  bg: '#F7F3EC',
  panel: '#FFFEFB',
  panelSoft: '#FBF7EF',
  ink: '#2B2620',
  inkSoft: '#8A8172',
  line: '#E1D8C4',
  teal: '#1F6F6B',
  tealDeep: '#154F4C',
  tealSoft: '#DCEAE8',
  mustard: '#E3A83B',
  mustardDeep: '#B9821F',
  mustardSoft: '#FBEBC9',
  danger: '#B54834',
};

const PRODUCT_COLORS = ['#1F6F6B', '#3E8E89', '#2C5F8A', '#4A7C9E', '#3B6B5E'];
const DECORATION_COLORS = ['#E3A83B', '#D9BE7A', '#C9A15A', '#B5885B', '#CE9A4A'];

const SHAPES = [
  { id: 'box', label: '方盒' },
  { id: 'cone', label: '錐形' },
  { id: 'cylinder', label: '圓柱' },
  { id: 'sphere', label: '球形' },
  { id: 'billboard', label: '上傳圖片' },
  { id: 'model', label: '上傳 3D 模型 (GLB)' },
];
const SHAPE_HEIGHT = { box: 0.8, cone: 0.9, cylinder: 0.8, sphere: 0.7, billboard: 0.8, model: 0 };
const SHAPE_RADIUS = { box: 0.34, cone: 0.32, cylinder: 0.28, sphere: 0.3, billboard: 0.3, model: 0.32 };
const MODEL_TARGET_SIZE = 0.9; // normalized height (m) a loaded GLB is scaled to fit
const VIEW_LABELS = { top: '俯視', front: '正視', half: '半俯視', side: '側視' };

let uid = 100;
const nextId = () => `o${uid++}`;

/* dispose geometry/material(s) on a Mesh, or every Mesh inside a Group (e.g. a loaded GLB scene) */
function disposeItemObject(obj) {
  if (!obj) return;
  obj.traverse((c) => {
    if (c.isMesh) {
      if (c.geometry) c.geometry.dispose();
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else if (c.material) c.material.dispose();
    }
  });
}

function makeGeometry(shape) {
  switch (shape) {
    case 'box': return new THREE.BoxGeometry(0.55, 0.8, 0.55);
    case 'cone': return new THREE.ConeGeometry(0.38, 0.9, 24);
    case 'cylinder': return new THREE.CylinderGeometry(0.32, 0.32, 0.8, 24);
    case 'sphere': return new THREE.SphereGeometry(0.35, 24, 24);
    default: return new THREE.BoxGeometry(0.55, 0.8, 0.55);
  }
}

function makeBillboardGeometry(aspect) {
  const h = 0.8;
  const w = h * (aspect || 0.75);
  return new THREE.PlaneGeometry(w, h);
}

function makeStripeTexture(colorA, colorB, stripes = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const stripeW = canvas.width / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    ctx.fillRect(i * stripeW, 0, stripeW, canvas.height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function initialItems() {
  return [
    { id: nextId(), type: 'decoration', shape: 'cone', color: DECORATION_COLORS[0], name: '裝飾小樹', x: -1.3, z: -0.6, rotY: 0, scale: 1 },
    { id: nextId(), type: 'decoration', shape: 'box', color: DECORATION_COLORS[2], name: '木箱擺飾', x: 1.4, z: -0.9, rotY: 0.3, scale: 1 },
    { id: nextId(), type: 'product', shape: 'cylinder', color: PRODUCT_COLORS[0], name: '手作杯墊', price: 280, x: -0.6, z: 0.35, rotY: 0, scale: 1 },
    { id: nextId(), type: 'product', shape: 'sphere', color: PRODUCT_COLORS[1], name: 'Q版角色吊飾', price: 450, x: 0.7, z: 0.4, rotY: 0, scale: 1 },
  ];
}

function marginFor(w, d) {
  return Math.max(0.08, Math.min(0.32, w * 0.15, d * 0.15));
}

const THETA_LIMIT = Math.PI / 2;       // ±90° = 180° total horizontal swing
const PHI_MIN = 0.45;                  // ~26° from straight up — don't let the camera dip near the floor
const PHI_MAX = 1.48;                  // ~85° from straight up — don't let the camera flatten to eye-level
const ORBIT_DAMPING = 0.18;

/* preset camera position/lookAt for a named view, given stall dims {w,d,h} */
function getCameraPreset(view, dims) {
  const { w, d, h } = dims;
  const span = Math.max(w, d, h, 1);
  if (view === 'top') {
    return {
      pos: new THREE.Vector3(0, span * 1.5 + 3, d * 0.25 + 0.6),
      look: new THREE.Vector3(0, 0, 0),
    };
  }
  if (view === 'front') {
    return {
      pos: new THREE.Vector3(0, 0.75, d / 2 + span * 0.65 + 0.9),
      look: new THREE.Vector3(0, 0.28, 0),
    };
  }
  if (view === 'side') {
    return {
      pos: new THREE.Vector3(w / 2 + span * 0.65 + 0.9, 0.75, 0),
      look: new THREE.Vector3(0, 0.28, 0),
    };
  }
  // half bird's-eye
  return {
    pos: new THREE.Vector3(w * 0.55 + 1.0, span * 0.6 + 1.1, d * 0.6 + 1.2),
    look: new THREE.Vector3(0, 0.2, 0),
  };
}

function sphericalFromPreset(preset) {
  const dx = preset.pos.x - preset.look.x;
  const dy = preset.pos.y - preset.look.y;
  const dz = preset.pos.z - preset.look.z;
  const radius = Math.max(0.5, Math.sqrt(dx * dx + dy * dy + dz * dz));
  const theta = Math.atan2(dx, dz);
  const phi = Math.acos(THREE.MathUtils.clamp(dy / radius, -1, 1));
  return { theta, phi, radius, look: preset.look.clone() };
}

function cartesianFromSpherical(theta, phi, radius, look) {
  return new THREE.Vector3(
    look.x + radius * Math.sin(phi) * Math.sin(theta),
    look.y + radius * Math.cos(phi),
    look.z + radius * Math.sin(phi) * Math.cos(theta)
  );
}

/* ---------------------------------------------------------------
   Product mockup modal — independent scene, free rotate + zoom
--------------------------------------------------------------- */
function ProductModal({ item, onClose }) {
  const mountRef = useRef(null);
  const [infoOpen, setInfoOpen] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.panelSoft);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 50);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight('#ffffff', '#8a8172', 1.0));
    const dir = new THREE.DirectionalLight('#ffffff', 1.2);
    dir.position.set(3, 5, 4);
    dir.castShadow = true;
    scene.add(dir);

    let mesh;
    let geo = null, mat = null;
    if (item.shape === 'model' && item.modelData) {
      mesh = new THREE.Group();
      new GLTFLoader().load(
        item.modelData,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((c) => { if (c.isMesh) { c.castShadow = true; } });
          const box = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z, 0.001);
          const targetSize = 1.6;
          root.scale.setScalar(targetSize / maxDim);
          const box2 = new THREE.Box3().setFromObject(root);
          root.position.y -= (box2.min.y + box2.max.y) / 2;
          root.position.x -= (box2.min.x + box2.max.x) / 2;
          root.position.z -= (box2.min.z + box2.max.z) / 2;
          mesh.add(root);
        },
        undefined,
        (err) => console.error('模型載入失敗', err)
      );
    } else if (item.shape === 'billboard' && item.image) {
      const h = 1.6;
      const w = h * (item.aspect || 0.75);
      geo = new THREE.PlaneGeometry(w, h);
      const tex = new THREE.TextureLoader().load(item.image);
      mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, roughness: 0.8, alphaTest: 0.4 });
      mesh = new THREE.Mesh(geo, mat);
    } else {
      geo = makeGeometry(item.shape);
      mat = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.55, metalness: 0.08 });
      mesh = new THREE.Mesh(geo, mat);
    }
    mesh.castShadow = true;
    scene.add(mesh);

    const shadowGeo = new THREE.CircleGeometry(1.6, 32);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.18 });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -(SHAPE_HEIGHT[item.shape] || 0.8) / 2;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    let radius = 2.6, theta = Math.PI / 4, phi = Math.PI / 2.5;
    function updateCam() {
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(0, 0, 0);
    }
    updateCam();

    let dragging = false, lastX = 0, lastY = 0;
    const onDown = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      theta -= dx * 0.008;
      phi = Math.max(0.35, Math.min(Math.PI - 0.35, phi - dy * 0.008));
      updateCam();
    };
    const onUp = () => { dragging = false; };
    const onWheel = (e) => {
      e.preventDefault();
      radius = Math.max(1.4, Math.min(5, radius + e.deltaY * 0.002));
      updateCam();
    };

    const el = renderer.domElement;
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    let raf;
    const loop = () => {
      mesh.rotation.y += 0.0018;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    const ro = new ResizeObserver(() => {
      const w2 = mount.clientWidth, h2 = mount.clientHeight;
      if (w2 === 0 || h2 === 0) return;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      disposeItemObject(mesh);
      shadowGeo.dispose(); shadowMat.dispose();
      renderer.dispose();
      if (mount.contains(el)) mount.removeChild(el);
    };
  }, [item]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalInfoBar}>
          <button onClick={() => setInfoOpen((o) => !o)} style={styles.infoToggleRow}>
            {infoOpen ? <ChevronUp size={16} color={COLORS.inkSoft} /> : <ChevronDown size={16} color={COLORS.inkSoft} />}
            <span style={styles.modalTitle}>{item.name}</span>
            <span style={styles.infoToggleHint}>{infoOpen ? '收合資訊' : '展開資訊'}</span>
          </button>
          <button onClick={onClose} style={styles.iconBtn} aria-label="關閉預覽">
            <X size={18} color={COLORS.ink} />
          </button>
        </div>
        {infoOpen && item.price != null && <div style={styles.modalPrice}>NT$ {item.price}</div>}
        <div ref={mountRef} style={styles.modalViewport} />
        {infoOpen && <div style={styles.modalHint}>拖曳旋轉．滾輪縮放</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   UV unwrap modal — upload a separate texture per box face
--------------------------------------------------------------- */
const FACE_LABELS = { top: '上', bottom: '下', front: '前', back: '後', left: '左', right: '右' };

function UVModal({ faces, onSetFace, onClearFace, onClose }) {
  const inputRef = useRef(null);
  const pendingFaceRef = useRef(null);

  function triggerUpload(face) {
    pendingFaceRef.current = face;
    inputRef.current?.click();
  }
  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onSetFace(pendingFaceRef.current, reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function FaceCell({ face, area }) {
    const img = faces[face];
    return (
      <div
        style={{ ...styles.uvCell, gridArea: area, backgroundImage: img ? `url(${img})` : undefined }}
        onClick={() => triggerUpload(face)}
      >
        {!img && <span style={styles.uvCellLabel}>{FACE_LABELS[face]}</span>}
        {img && (
          <button onClick={(e) => { e.stopPropagation(); onClearFace(face); }} style={styles.uvClearBtn} aria-label="清除">
            <X size={11} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.uvModalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div style={styles.modalTitle}>攤位平台 UV 展開</div>
          <button onClick={onClose} style={styles.iconBtn} aria-label="關閉">
            <X size={18} color={COLORS.ink} />
          </button>
        </div>
        <div style={styles.uvHint}>點格子上傳該面的貼圖，六個面可以分開貼不同圖片</div>
        <div style={styles.uvGrid}>
          <FaceCell face="top" area="top" />
          <FaceCell face="left" area="left" />
          <FaceCell face="front" area="front" />
          <FaceCell face="right" area="right" />
          <FaceCell face="back" area="back" />
          <FaceCell face="bottom" area="bottom" />
        </div>
        <input ref={inputRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Main app
--------------------------------------------------------------- */
const STORAGE_KEY = 'stall-editor-state-v2';

export default function StallEditor() {
  const [items, setItems] = useState(initialItems);
  const [stallW, setStallW] = useState(4);
  const [stallD, setStallD] = useState(2.6);
  const [stallH, setStallH] = useState(2.2);
  const [mode, setMode] = useState('edit');
  const [editView, setEditView] = useState('top');
  const [browseView, setBrowseView] = useState('front');
  const [selectedId, setSelectedId] = useState(null);
  const [modalItem, setModalItem] = useState(null);
  const [addShape, setAddShape] = useState('box');
  const [allowOverlap, setAllowOverlap] = useState(false);
  const [platformHeight, setPlatformHeight] = useState(0.15);
  const [platformFaces, setPlatformFaces] = useState({ top: null, bottom: null, front: null, back: null, left: null, right: null });
  const [showUVModal, setShowUVModal] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 640 : true));

  const fileInputRef = useRef(null);
  const billboardInputRef = useRef(null);
  const modelInputRef = useRef(null);
  const quickFacesInputRef = useRef(null);
  const pendingTypeRef = useRef('decoration');

  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const itemsGroupRef = useRef(null);
  const meshMapRef = useRef(new Map());
  const gridRef = useRef(null);
  const ringRef = useRef(null);
  const sceneryRef = useRef({ ground: null, backdrop: null, canopy: null });

  const camStateRef = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3() });
  const orbitStateRef = useRef({ theta: 0, phi: 1, radius: 5, look: new THREE.Vector3() });
  const tweenRef = useRef(null);
  const cameraModeRef = useRef('edit');

  const itemsRef = useRef(items);
  const modeRef = useRef(mode);
  const selectedRef = useRef(selectedId);
  const dimsRef = useRef({ w: stallW, d: stallD, h: stallH });
  const dragRef = useRef({ id: null });
  const hoveredIdRef = useRef(null);
  const orbitPointerRef = useRef({ active: false, moved: false, lastX: 0, lastY: 0 });
  const allowOverlapRef = useRef(allowOverlap);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { dimsRef.current = { w: stallW, d: stallD, h: stallH }; }, [stallW, stallD, stallH]);
  useEffect(() => { allowOverlapRef.current = allowOverlap; }, [allowOverlap]);

  function clampSpherical(sph) {
    return {
      theta: THREE.MathUtils.clamp(sph.theta, -THETA_LIMIT, THETA_LIMIT),
      phi: THREE.MathUtils.clamp(sph.phi, PHI_MIN, PHI_MAX),
      radius: sph.radius,
      look: sph.look,
    };
  }

  function flyToEditView(view) {
    const target = getCameraPreset(view, dimsRef.current);
    tweenRef.current = {
      kind: 'cartesian',
      startPos: camStateRef.current.pos.clone(),
      startLook: camStateRef.current.look.clone(),
      targetPos: target.pos.clone(),
      targetLook: target.look.clone(),
      startTime: performance.now(),
      duration: 700,
    };
  }

  function flyToBrowseView(view) {
    const preset = getCameraPreset(view, dimsRef.current);
    const sph = clampSpherical(sphericalFromPreset(preset));
    tweenRef.current = {
      kind: 'orbit',
      startTheta: orbitStateRef.current.theta,
      startPhi: orbitStateRef.current.phi,
      startRadius: orbitStateRef.current.radius,
      startLook: orbitStateRef.current.look.clone(),
      targetTheta: sph.theta,
      targetPhi: sph.phi,
      targetRadius: sph.radius,
      targetLook: sph.look.clone(),
      startTime: performance.now(),
      duration: 700,
    };
  }

  function reframeBrowseKeepAngle() {
    const preset = getCameraPreset(browseView, dimsRef.current);
    const sph = clampSpherical(sphericalFromPreset(preset));
    tweenRef.current = {
      kind: 'orbit',
      startTheta: orbitStateRef.current.theta,
      startPhi: orbitStateRef.current.phi,
      startRadius: orbitStateRef.current.radius,
      startLook: orbitStateRef.current.look.clone(),
      targetTheta: orbitStateRef.current.theta,
      targetPhi: orbitStateRef.current.phi,
      targetRadius: sph.radius,
      targetLook: sph.look.clone(),
      startTime: performance.now(),
      duration: 500,
    };
  }

  /* ---- load any previously saved layout (browser localStorage) ---- */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.items) && data.items.length) {
          uid = data.nextUid || uid;
          setItems(data.items);
        }
        if (typeof data.stallW === 'number') setStallW(data.stallW);
        if (typeof data.stallD === 'number') setStallD(data.stallD);
        if (typeof data.stallH === 'number') setStallH(data.stallH);
        if (typeof data.allowOverlap === 'boolean') setAllowOverlap(data.allowOverlap);
        if (typeof data.platformHeight === 'number') setPlatformHeight(data.platformHeight);
        if (data.platformFaces && typeof data.platformFaces === 'object') setPlatformFaces((prev) => ({ ...prev, ...data.platformFaces }));
      }
    } catch (err) {
      // no saved state yet, or storage unavailable
    } finally {
      setLoaded(true);
    }
  }, []);

  /* ---- auto-save on change (debounced, browser localStorage) ---- */
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ items, stallW, stallD, stallH, allowOverlap, platformHeight, platformFaces, nextUid: uid })
        );
        setSaveNote('已自動儲存');
        setTimeout(() => setSaveNote(''), 1500);
      } catch (err) {
        setSaveNote('儲存失敗（可能是模型/圖片太大，超過瀏覽器儲存上限）');
      }
    }, 500);
    return () => clearTimeout(t);
  }, [items, stallW, stallD, stallH, allowOverlap, platformHeight, platformFaces, loaded]);

  function exportJSON() {
    const stripType = ({ type, ...rest }) => rest;
    const payload = {
      stall: { width: stallW, depth: stallD, height: stallH },
      decorations: items.filter((it) => it.type === 'decoration').map(stripType),
      products: items.filter((it) => it.type === 'product').map(stripType),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stall-layout.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importJSON(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const decorations = (data.decorations || []).map((d) => ({ ...d, type: 'decoration' }));
        const products = (data.products || []).map((p) => ({ ...p, type: 'product' }));
        const merged = [...decorations, ...products];
        if (merged.length) setItems(merged);
        if (data.stall?.width) setStallW(data.stall.width);
        if (data.stall?.depth) setStallD(data.stall.depth);
        if (data.stall?.height) setStallH(data.stall.height);
      } catch (err) {
        setSaveNote('匯入失敗，請確認檔案格式');
        setTimeout(() => setSaveNote(''), 2000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  /* ---- mount: build scene once ---- */
  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.HemisphereLight('#ffffff', '#c9bda0', 0.85));
    const dir = new THREE.DirectionalLight('#fff7e8', 1.15);
    dir.position.set(4, 7, 3);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -8; dir.shadow.camera.right = 8;
    dir.shadow.camera.top = 8; dir.shadow.camera.bottom = -8;
    scene.add(dir);

    const itemsGroup = new THREE.Group();
    scene.add(itemsGroup);
    itemsGroupRef.current = itemsGroup;

    const grid = new THREE.GridHelper(14, 28, COLORS.teal, COLORS.line);
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    scene.add(grid);
    gridRef.current = grid;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: COLORS.teal, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    ringRef.current = ring;

    buildScenery(scene, sceneryRef, dimsRef.current, { height: platformHeight, faces: platformFaces });

    const topPreset = getCameraPreset('top', dimsRef.current);
    camStateRef.current = { pos: topPreset.pos.clone(), look: topPreset.look.clone() };
    const frontPreset = getCameraPreset('front', dimsRef.current);
    const frontSph = sphericalFromPreset(frontPreset);
    orbitStateRef.current = {
      theta: THREE.MathUtils.clamp(frontSph.theta, -THETA_LIMIT, THETA_LIMIT),
      phi: THREE.MathUtils.clamp(frontSph.phi, PHI_MIN, PHI_MAX),
      radius: frontSph.radius,
      look: frontSph.look,
      targetTheta: THREE.MathUtils.clamp(frontSph.theta, -THETA_LIMIT, THETA_LIMIT),
      targetPhi: THREE.MathUtils.clamp(frontSph.phi, PHI_MIN, PHI_MAX),
      targetRadius: frontSph.radius,
    };
    cameraModeRef.current = 'edit';
    camera.position.copy(camStateRef.current.pos);
    camera.lookAt(camStateRef.current.look);

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pointer = new THREE.Vector2();

    function toNDC(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function setEmissive(obj, hex) {
      if (!obj) return;
      obj.traverse((c) => {
        if (c.isMesh && c.material && c.material.emissive) c.material.emissive.setHex(hex);
      });
    }

    function pickItem(e) {
      toNDC(e);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(itemsGroup.children, true);
      if (!hits.length) return null;
      let obj = hits[0].object;
      while (obj && !obj.userData?.id && obj.parent) obj = obj.parent;
      return obj && obj.userData?.id ? obj : null;
    }

    function updateHover(e, isEdit) {
      const hit = pickItem(e);
      const eligible = hit && (isEdit || hit.userData.type === 'product');
      const newId = eligible ? hit.userData.id : null;
      if (newId !== hoveredIdRef.current) {
        if (hoveredIdRef.current) {
          setEmissive(meshMapRef.current.get(hoveredIdRef.current), 0x000000);
        }
        if (newId) {
          setEmissive(meshMapRef.current.get(newId), 0x2f7a72);
        }
        hoveredIdRef.current = newId;
      }
      renderer.domElement.style.cursor = newId ? 'pointer' : (isEdit ? 'default' : 'grab');
    }

    function onPointerDown(e) {
      if (modeRef.current === 'edit') {
        const hit = pickItem(e);
        if (hit) {
          window.dispatchEvent(new CustomEvent('stall-select', { detail: hit.userData.id }));
          dragRef.current.id = hit.userData.id;
        } else {
          window.dispatchEvent(new CustomEvent('stall-select', { detail: null }));
        }
      } else {
        orbitPointerRef.current = { active: true, moved: false, lastX: e.clientX, lastY: e.clientY };
      }
    }

    function onPointerMove(e) {
      if (modeRef.current === 'edit') {
        if (dragRef.current.id) {
          toNDC(e);
          raycaster.setFromCamera(pointer, camera);
          const target = new THREE.Vector3();
          if (!raycaster.ray.intersectPlane(groundPlane, target)) return;
          const { w, d } = dimsRef.current;
          const margin = marginFor(w, d);
          const clampedX = Math.max(-w / 2 + margin, Math.min(w / 2 - margin, target.x));
          const clampedZ = Math.max(-d / 2 + margin, Math.min(d / 2 - margin, target.z));

          const draggedItem = itemsRef.current.find((it) => it.id === dragRef.current.id);
          let blocked = false;
          if (draggedItem && !allowOverlapRef.current) {
            const r1 = (SHAPE_RADIUS[draggedItem.shape] || 0.3) * (draggedItem.scale || 1);
            for (const other of itemsRef.current) {
              if (other.id === draggedItem.id) continue;
              const om = meshMapRef.current.get(other.id);
              if (!om) continue;
              const r2 = (SHAPE_RADIUS[other.shape] || 0.3) * (other.scale || 1);
              const dx = clampedX - om.position.x, dz = clampedZ - om.position.z;
              if (Math.sqrt(dx * dx + dz * dz) < r1 + r2) { blocked = true; break; }
            }
          }
          if (blocked) return;

          const mesh = meshMapRef.current.get(dragRef.current.id);
          if (mesh) {
            mesh.position.x = clampedX;
            mesh.position.z = clampedZ;
            if (ring.visible && ring.userData.id === dragRef.current.id) {
              ring.position.set(clampedX, 0.015, clampedZ);
            }
          }
          return;
        }
        updateHover(e, true);
        return;
      }

      const op = orbitPointerRef.current;
      if (op.active) {
        const dx = e.clientX - op.lastX, dy = e.clientY - op.lastY;
        if (!op.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          op.moved = true;
          tweenRef.current = null;
        }
        if (op.moved) {
          const s = orbitStateRef.current;
          s.targetTheta = THREE.MathUtils.clamp(s.targetTheta - dx * 0.006, -THETA_LIMIT, THETA_LIMIT);
          s.targetPhi = THREE.MathUtils.clamp(s.targetPhi - dy * 0.006, PHI_MIN, PHI_MAX);
          op.lastX = e.clientX; op.lastY = e.clientY;
          return;
        }
        op.lastX = e.clientX; op.lastY = e.clientY;
      }
      if (!op.moved) updateHover(e, false);
    }

    function onPointerUp(e) {
      if (modeRef.current === 'edit') {
        if (dragRef.current.id) {
          const id = dragRef.current.id;
          const mesh = meshMapRef.current.get(id);
          if (mesh) {
            window.dispatchEvent(new CustomEvent('stall-commit', { detail: { id, x: mesh.position.x, z: mesh.position.z } }));
          }
          dragRef.current.id = null;
        }
        return;
      }
      const op = orbitPointerRef.current;
      if (op.active && !op.moved) {
        const hit = pickItem(e);
        if (hit && hit.userData.type === 'product') {
          window.dispatchEvent(new CustomEvent('stall-open-product', { detail: hit.userData.id }));
        }
      }
      orbitPointerRef.current = { active: false, moved: false, lastX: 0, lastY: 0 };
    }

    function onWheel(e) {
      e.preventDefault();
      const span = Math.max(dimsRef.current.w, dimsRef.current.d, dimsRef.current.h, 1);
      if (modeRef.current === 'edit') {
        tweenRef.current = null;
        const cs = camStateRef.current;
        const dir = new THREE.Vector3().subVectors(cs.pos, cs.look);
        const dist = Math.max(0.1, dir.length());
        const factor = Math.exp(e.deltaY * 0.0015);
        const minDist = Math.max(0.6, span * 0.12);
        const maxDist = span * 4.5;
        const newDist = Math.max(minDist, Math.min(maxDist, dist * factor));
        dir.setLength(newDist);
        cs.pos.copy(cs.look).add(dir);
        return;
      }
      if (modeRef.current !== 'browse') return;
      tweenRef.current = null;
      orbitStateRef.current.targetRadius = Math.max(
        1.0, Math.min(span * 2.5, orbitStateRef.current.targetRadius + e.deltaY * 0.003)
      );
    }

    const el = renderer.domElement;
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    let raf;
    const loop = (now) => {
      const s = orbitStateRef.current;
      if (tweenRef.current) {
        const tw = tweenRef.current;
        const t = Math.min(1, (now - tw.startTime) / tw.duration);
        const ease = 1 - Math.pow(1 - t, 3);
        if (tw.kind === 'cartesian') {
          camStateRef.current.pos.lerpVectors(tw.startPos, tw.targetPos, ease);
          camStateRef.current.look.lerpVectors(tw.startLook, tw.targetLook, ease);
        } else {
          s.theta = THREE.MathUtils.lerp(tw.startTheta, tw.targetTheta, ease);
          s.phi = THREE.MathUtils.lerp(tw.startPhi, tw.targetPhi, ease);
          s.radius = THREE.MathUtils.lerp(tw.startRadius, tw.targetRadius, ease);
          s.look.lerpVectors(tw.startLook, tw.targetLook, ease);
        }
        if (t >= 1) {
          tweenRef.current = null;
          s.targetTheta = s.theta;
          s.targetPhi = s.phi;
          s.targetRadius = s.radius;
        }
      } else if (cameraModeRef.current === 'browse') {
        s.theta += (s.targetTheta - s.theta) * ORBIT_DAMPING;
        s.phi += (s.targetPhi - s.phi) * ORBIT_DAMPING;
        s.radius += (s.targetRadius - s.radius) * ORBIT_DAMPING;
      }
      if (cameraModeRef.current === 'edit') {
        camera.position.copy(camStateRef.current.pos);
        camera.lookAt(camStateRef.current.look);
      } else {
        const p = cartesianFromSpherical(s.theta, s.phi, s.radius, s.look);
        camera.position.copy(p);
        camera.lookAt(s.look);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      const w2 = mount.clientWidth, h2 = mount.clientHeight;
      if (w2 === 0 || h2 === 0) return;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      meshMapRef.current.forEach((m) => disposeItemObject(m));
      meshMapRef.current.clear();
      disposeScenery(sceneryRef.current);
      renderer.dispose();
      if (mount.contains(el)) mount.removeChild(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- bridge scene events into React state ---- */
  useEffect(() => {
    const onSelect = (e) => setSelectedId(e.detail);
    const onOpenProduct = (e) => {
      const found = itemsRef.current.find((it) => it.id === e.detail);
      if (found) setModalItem(found);
    };
    const onCommit = (e) => {
      const { id, x, z } = e.detail;
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, x, z } : it)));
    };
    window.addEventListener('stall-select', onSelect);
    window.addEventListener('stall-open-product', onOpenProduct);
    window.addEventListener('stall-commit', onCommit);
    return () => {
      window.removeEventListener('stall-select', onSelect);
      window.removeEventListener('stall-open-product', onOpenProduct);
      window.removeEventListener('stall-commit', onCommit);
    };
  }, []);

  /* ---- sync meshes whenever items change ---- */
  useEffect(() => {
    const group = itemsGroupRef.current;
    if (!group) return;
    const map = meshMapRef.current;
    const seen = new Set();

    items.forEach((it) => {
      seen.add(it.id);
      let mesh = map.get(it.id);
      if (!mesh) {
        if (it.shape === 'model' && it.modelData) {
          const holder = new THREE.Group();
          holder.userData = { id: it.id, type: it.type };
          group.add(holder);
          map.set(it.id, holder);
          new GLTFLoader().load(
            it.modelData,
            (gltf) => {
              const root = gltf.scene;
              root.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
              const box = new THREE.Box3().setFromObject(root);
              const size = new THREE.Vector3();
              box.getSize(size);
              const maxDim = Math.max(size.x, size.y, size.z, 0.001);
              root.scale.setScalar(MODEL_TARGET_SIZE / maxDim);
              const box2 = new THREE.Box3().setFromObject(root);
              root.position.y -= box2.min.y; // sit the model base on the local ground
              root.position.x -= (box2.min.x + box2.max.x) / 2;
              root.position.z -= (box2.min.z + box2.max.z) / 2;
              holder.add(root);
            },
            undefined,
            (err) => console.error('模型載入失敗', it.name, err)
          );
          mesh = holder;
        } else {
          let geo, mat;
          if (it.shape === 'billboard' && it.image) {
            geo = makeBillboardGeometry(it.aspect);
            const tex = new THREE.TextureLoader().load(it.image);
            mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, roughness: 0.8, alphaTest: 0.4 });
          } else {
            geo = makeGeometry(it.shape);
            mat = new THREE.MeshStandardMaterial({ color: it.color, roughness: 0.6, metalness: 0.05 });
          }
          mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData = { id: it.id, type: it.type };
          group.add(mesh);
          map.set(it.id, mesh);
        }
      }
      const isDragging = dragRef.current.id === it.id;
      if (!isDragging) {
        mesh.position.x = it.x;
        mesh.position.z = it.z;
      }
      mesh.position.y = (SHAPE_HEIGHT[it.shape] || 0.8) / 2 + (it.lift || 0);
      mesh.rotation.set(it.rotX || 0, it.rotY, it.rotZ || 0);
      mesh.scale.setScalar(it.scale);
    });

    map.forEach((mesh, id) => {
      if (!seen.has(id)) {
        group.remove(mesh);
        disposeItemObject(mesh);
        map.delete(id);
      }
    });
  }, [items]);

  /* ---- selection ring ---- */
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    const item = items.find((it) => it.id === selectedId);
    if (mode === 'edit' && item) {
      ring.visible = true;
      ring.position.set(item.x, 0.015, item.z);
      ring.userData.id = item.id;
    } else {
      ring.visible = false;
    }
  }, [selectedId, items, mode]);

  /* ---- mode / view -> camera + grid ---- */
  useEffect(() => {
    cameraModeRef.current = mode;
    if (mode === 'edit') {
      flyToEditView(editView);
      if (gridRef.current) gridRef.current.visible = true;
    } else {
      setSelectedId(null);
      flyToBrowseView(browseView);
      if (gridRef.current) gridRef.current.visible = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editView, browseView]);

  /* ---- stall size -> scenery + clamp items + reframe camera ---- */
  useEffect(() => {
    if (!sceneRef.current) return;
    buildScenery(sceneRef.current, sceneryRef, { w: stallW, d: stallD }, { height: platformHeight, faces: platformFaces });
    const margin = marginFor(stallW, stallD);
    setItems((prev) => prev.map((it) => ({
      ...it,
      x: Math.max(-stallW / 2 + margin, Math.min(stallW / 2 - margin, it.x)),
      z: Math.max(-stallD / 2 + margin, Math.min(stallD / 2 - margin, it.z)),
    })));
    if (mode === 'edit') flyToEditView(editView);
    else reframeBrowseKeepAngle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stallW, stallD, stallH, platformHeight, platformFaces]);

  /* ---- actions ---- */
  function addObject(type) {
    if (addShape === 'billboard') {
      pendingTypeRef.current = type;
      billboardInputRef.current?.click();
      return;
    }
    if (addShape === 'model') {
      pendingTypeRef.current = type;
      modelInputRef.current?.click();
      return;
    }
    const palette = type === 'product' ? PRODUCT_COLORS : DECORATION_COLORS;
    const color = palette[Math.floor(Math.random() * palette.length)];
    const count = items.filter((it) => it.type === type).length + 1;
    const base = {
      id: nextId(),
      type,
      shape: addShape,
      color,
      name: type === 'product' ? `商品 ${count}` : `擺設 ${count}`,
      x: (Math.random() - 0.5) * (stallW - 1),
      z: (Math.random() - 0.5) * (stallD - 1),
      rotY: 0,
      scale: 1,
    };
    if (type === 'product') base.price = 0;
    setItems((prev) => [...prev, base]);
    setSelectedId(base.id);
  }

  function onModelFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // data: URI — GLTFLoader.load() can fetch this directly
      const type = pendingTypeRef.current;
      const count = items.filter((it) => it.type === type).length + 1;
      const base = {
        id: nextId(),
        type,
        shape: 'model',
        modelData: dataUrl,
        modelName: file.name,
        color: type === 'product' ? PRODUCT_COLORS[0] : DECORATION_COLORS[0],
        name: type === 'product' ? `商品 ${count}` : `擺設 ${count}`,
        x: (Math.random() - 0.5) * (stallW - 1),
        z: (Math.random() - 0.5) * (stallD - 1),
        rotY: 0,
        scale: 1,
      };
      if (type === 'product') base.price = 0;
      setItems((prev) => [...prev, base]);
      setSelectedId(base.id);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function onBillboardFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        const aspect = img.width / img.height;
        const type = pendingTypeRef.current;
        const count = items.filter((it) => it.type === type).length + 1;
        const base = {
          id: nextId(),
          type,
          shape: 'billboard',
          image: dataUrl,
          aspect,
          color: type === 'product' ? PRODUCT_COLORS[0] : DECORATION_COLORS[0],
          name: type === 'product' ? `商品 ${count}` : `擺設 ${count}`,
          x: (Math.random() - 0.5) * (stallW - 1),
          z: (Math.random() - 0.5) * (stallD - 1),
          rotY: 0,
          scale: 1,
        };
        if (type === 'product') base.price = 0;
        setItems((prev) => [...prev, base]);
        setSelectedId(base.id);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function onQuickFacesFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      setPlatformFaces({ top: url, bottom: url, front: url, back: url, left: url, right: url });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function removeObject(id) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function updateSelected(patch) {
    setItems((prev) => prev.map((it) => (it.id === selectedId ? { ...it, ...patch } : it)));
  }

  const selectedItem = items.find((it) => it.id === selectedId) || null;

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Work+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; font-family: 'Work Sans', sans-serif; }
        input[type=range] { accent-color: ${COLORS.teal}; }
        input[type=checkbox] { accent-color: ${COLORS.teal}; }
        button { font-family: 'Work Sans', sans-serif; cursor: pointer; }
      `}</style>

      <header style={styles.header}>
        <div>
          <div style={styles.brandEyebrow}>MARKET STALL BUILDER</div>
          <h1 style={styles.brandTitle}>攤位 3D 編輯器</h1>
        </div>
        <div style={styles.modeSwitch}>
          <button
            onClick={() => setMode('edit')}
            style={{ ...styles.modeBtn, ...(mode === 'edit' ? styles.modeBtnActive : {}) }}
          >
            <Move size={15} style={{ marginRight: 6 }} /> 編輯擺放
          </button>
          <button
            onClick={() => setMode('browse')}
            style={{ ...styles.modeBtn, ...(mode === 'browse' ? styles.modeBtnActive : {}) }}
          >
            <Eye size={15} style={{ marginRight: 6 }} /> 瀏覽攤位
          </button>
        </div>
      </header>

      <div style={styles.toolbar}>
        {mode === 'edit' ? (
          <>
            <div style={styles.toolGroup}>
              <label style={styles.toolLabel}>寬 (m)</label>
              <input type="number" min={0.5} max={8} step={0.5} value={stallW}
                onChange={(e) => setStallW(Number(e.target.value))} style={styles.numInput} />
            </div>
            <div style={styles.toolGroup}>
              <label style={styles.toolLabel}>深 (m)</label>
              <input type="number" min={0.5} max={8} step={0.5} value={stallD}
                onChange={(e) => setStallD(Number(e.target.value))} style={styles.numInput} />
            </div>
            <div style={styles.toolGroup}>
              <label style={styles.toolLabel}>高 (m)</label>
              <input type="number" min={0.5} max={8} step={0.5} value={stallH}
                onChange={(e) => setStallH(Number(e.target.value))} style={styles.numInput} />
            </div>
            <label style={styles.overlapToggle}>
              <input type="checkbox" checked={allowOverlap} onChange={(e) => setAllowOverlap(e.target.checked)} />
              允許物體重疊
            </label>
            <div style={styles.toolGroup}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['top', 'front', 'half', 'side'].map((v) => (
                  <button key={v} onClick={() => setEditView(v)}
                    style={{ ...styles.viewBtn, ...(editView === v ? styles.viewBtnActive : {}) }}>
                    {VIEW_LABELS[v]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={styles.viewBtn} onClick={exportJSON}>匯出 JSON</button>
              <button style={styles.viewBtn} onClick={() => fileInputRef.current?.click()}>匯入 JSON</button>
              <input ref={fileInputRef} type="file" accept="application/json" onChange={importJSON} style={{ display: 'none' }} />
            </div>
            <div style={styles.toolHint}>{saveNote || '拖曳物件可調整位置．滑鼠移到物件上會有反光提示'}</div>
          </>
        ) : (
          <div style={styles.toolGroup}>
            <label style={styles.toolLabel}>快速視角</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setBrowseView('front')}
                style={{ ...styles.viewBtn, ...(browseView === 'front' ? styles.viewBtnActive : {}) }}>正面角</button>
              <button onClick={() => setBrowseView('half')}
                style={{ ...styles.viewBtn, ...(browseView === 'half' ? styles.viewBtnActive : {}) }}>半俯視角</button>
            </div>
            <div style={styles.toolHint}>拖曳畫面可自由環繞查看．滾輪縮放．點擊商品開啟 3D 預覽</div>
          </div>
        )}
      </div>

      <div style={styles.body}>
        <div style={styles.viewportWrap}>
          <div ref={mountRef} style={styles.viewport} />
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            style={styles.sidebarToggleBtn}
            aria-label={sidebarOpen ? '收合面板' : '展開面板'}
          >
            {sidebarOpen ? <X size={16} color={COLORS.ink} /> : <Menu size={16} color={COLORS.ink} />}
          </button>
        </div>

        {sidebarOpen && (
        <aside style={styles.sidebar}>
          {mode === 'edit' ? (
            <>
              <section style={styles.panelSection}>
                <div style={styles.sectionTitle}>攤位平台</div>
                <label style={styles.fieldLabel}>平台高度（厚度）</label>
                <input type="range" min={0.05} max={1.5} step={0.05} value={platformHeight}
                  onChange={(e) => setPlatformHeight(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button style={styles.viewBtn} onClick={() => setShowUVModal(true)}>
                    展開 UV 編輯貼圖
                  </button>
                  <button style={styles.viewBtn} onClick={() => quickFacesInputRef.current?.click()}>
                    <Upload size={13} style={{ marginRight: 4 }} />同一張圖套全部面
                  </button>
                  <button style={styles.viewBtn} onClick={() => setPlatformFaces({ top: null, bottom: null, front: null, back: null, left: null, right: null })}>
                    清除全部貼圖
                  </button>
                </div>
                <input ref={quickFacesInputRef} type="file" accept="image/*" onChange={onQuickFacesFile} style={{ display: 'none' }} />
              </section>

              <section style={styles.panelSection}>
                <div style={styles.sectionTitle}>新增物件</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {SHAPES.map((s) => (
                    <button key={s.id} onClick={() => setAddShape(s.id)}
                      style={{ ...styles.shapeChip, ...(addShape === s.id ? styles.shapeChipActive : {}) }}>
                      {s.id === 'billboard' && <Upload size={11} style={{ marginRight: 4 }} />}
                      {s.id === 'model' && <Box size={11} style={{ marginRight: 4 }} />}
                      {s.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={styles.addBtnDecoration} onClick={() => addObject('decoration')}>
                    <Plus size={14} style={{ marginRight: 4 }} /> 擺設
                  </button>
                  <button style={styles.addBtnProduct} onClick={() => addObject('product')}>
                    <Plus size={14} style={{ marginRight: 4 }} /> 商品
                  </button>
                </div>
                <input ref={billboardInputRef} type="file" accept="image/*" onChange={onBillboardFile} style={{ display: 'none' }} />
                <input ref={modelInputRef} type="file" accept=".glb,.gltf" onChange={onModelFile} style={{ display: 'none' }} />
              </section>

              <section style={styles.panelSection}>
                <div style={styles.sectionTitle}>物件列表</div>
                <div style={styles.list}>
                  {items.length === 0 && <div style={styles.emptyText}>目前攤位上沒有物件</div>}
                  {items.map((it) => (
                    <div key={it.id} onClick={() => setSelectedId(it.id)}
                      style={{ ...styles.listItem, ...(selectedId === it.id ? styles.listItemActive : {}) }}>
                      <span style={{ ...styles.swatch, background: it.color }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.listItemName}>{it.name}</div>
                        <div style={styles.listItemMeta}>
                          {it.type === 'product' ? `商品．NT$${it.price ?? 0}` : '擺設'}
                        </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); removeObject(it.id); }}
                        style={styles.trashBtn} aria-label="刪除">
                        <Trash2 size={13} color={COLORS.inkSoft} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {selectedItem && (
                <section style={styles.panelSection}>
                  <div style={styles.sectionTitle}>編輯所選：{selectedItem.type === 'product' ? '商品' : '擺設'}</div>
                  <label style={styles.fieldLabel}>名稱</label>
                  <input style={styles.textInput} value={selectedItem.name}
                    onChange={(e) => updateSelected({ name: e.target.value })} />
                  {selectedItem.type === 'product' && (
                    <>
                      <label style={styles.fieldLabel}>價格 (NT$)</label>
                      <input type="number" min={0} style={styles.textInput} value={selectedItem.price ?? 0}
                        onChange={(e) => updateSelected({ price: Number(e.target.value) })} />
                    </>
                  )}
                  <label style={styles.fieldLabel}>旋轉．水平（Y 軸）</label>
                  <input type="range" min={0} max={6.283} step={0.05} value={selectedItem.rotY}
                    onChange={(e) => updateSelected({ rotY: Number(e.target.value) })} style={{ width: '100%' }} />
                  <label style={styles.fieldLabel}>旋轉．前後翻（X 軸）</label>
                  <input type="range" min={0} max={6.283} step={0.05} value={selectedItem.rotX || 0}
                    onChange={(e) => updateSelected({ rotX: Number(e.target.value) })} style={{ width: '100%' }} />
                  <label style={styles.fieldLabel}>旋轉．側翻（Z 軸）</label>
                  <input type="range" min={0} max={6.283} step={0.05} value={selectedItem.rotZ || 0}
                    onChange={(e) => updateSelected({ rotZ: Number(e.target.value) })} style={{ width: '100%' }} />
                  <label style={styles.fieldLabel}>大小</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="range" min={0.1} max={4} step={0.05} value={selectedItem.scale}
                      onChange={(e) => updateSelected({ scale: Number(e.target.value) })} style={{ flex: 1 }} />
                    <input type="number" min={0.05} max={30} step={0.05} value={selectedItem.scale}
                      onChange={(e) => updateSelected({ scale: Number(e.target.value) })} style={{ ...styles.numInput, width: 58 }} />
                  </div>
                  <label style={styles.fieldLabel}>垂直高度（Z 軸．離地浮起）</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="range" min={-1} max={10} step={0.05} value={selectedItem.lift || 0}
                      onChange={(e) => updateSelected({ lift: Number(e.target.value) })} style={{ flex: 1 }} />
                    <input type="number" step={0.05} value={selectedItem.lift || 0}
                      onChange={(e) => updateSelected({ lift: Number(e.target.value) })} style={{ ...styles.numInput, width: 58 }} />
                  </div>
                </section>
              )}
            </>
          ) : (
            <section style={styles.panelSection}>
              <div style={styles.sectionTitle}>攤位商品</div>
              <div style={styles.list}>
                {items.map((it) => (
                  <div key={it.id} onClick={() => it.type === 'product' && setModalItem(it)}
                    style={{ ...styles.listItem, cursor: it.type === 'product' ? 'pointer' : 'default', opacity: it.type === 'product' ? 1 : 0.55 }}>
                    <span style={{ ...styles.swatch, background: it.color }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.listItemName}>{it.name}</div>
                      <div style={styles.listItemMeta}>
                        {it.type === 'product' ? `NT$${it.price ?? 0}．點擊預覽` : '擺設（不可互動）'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
        )}
      </div>

      {modalItem && <ProductModal item={modalItem} onClose={() => setModalItem(null)} />}
      {showUVModal && (
        <UVModal
          faces={platformFaces}
          onSetFace={(face, url) => setPlatformFaces((prev) => ({ ...prev, [face]: url }))}
          onClearFace={(face) => setPlatformFaces((prev) => ({ ...prev, [face]: null }))}
          onClose={() => setShowUVModal(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Scenery: ground platform (with per-face UV materials)
--------------------------------------------------------------- */
function disposeScenery(refObj) {
  const m = refObj.ground;
  if (m) {
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat) => { if (mat.map) mat.map.dispose(); mat.dispose(); });
    if (m.parent) m.parent.remove(m);
  }
}

function buildScenery(scene, sceneryRef, dims, platform) {
  disposeScenery(sceneryRef.current);
  const { w, d } = dims;
  const height = (platform && platform.height) || 0.15;
  const faces = (platform && platform.faces) || {};
  const loader = new THREE.TextureLoader();

  function faceMaterial(key) {
    if (faces[key]) {
      const tex = loader.load(faces[key]);
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    }
    return new THREE.MeshStandardMaterial({ color: '#D9C9A8', roughness: 0.85 });
  }

  // BoxGeometry material array order: +x(right), -x(left), +y(top), -y(bottom), +z(front), -z(back)
  const materials = [
    faceMaterial('right'), faceMaterial('left'), faceMaterial('top'),
    faceMaterial('bottom'), faceMaterial('front'), faceMaterial('back'),
  ];

  const groundGeo = new THREE.BoxGeometry(w, height, d);
  const ground = new THREE.Mesh(groundGeo, materials);
  ground.position.y = -height / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  sceneryRef.current = { ground };
}

/* ---------------------------------------------------------------
   Styles
--------------------------------------------------------------- */
const styles = {
  app: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: COLORS.bg, color: COLORS.ink, borderRadius: 16, overflow: 'hidden',
    border: `1px solid ${COLORS.line}`,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '18px 22px 14px', borderBottom: `1px solid ${COLORS.line}`,
  },
  brandEyebrow: { fontSize: 11, letterSpacing: '0.14em', color: COLORS.mustardDeep, fontWeight: 600 },
  brandTitle: { fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 700, margin: '2px 0 0', color: COLORS.ink },
  modeSwitch: { display: 'flex', gap: 8, background: COLORS.panelSoft, padding: 4, borderRadius: 999, border: `1px solid ${COLORS.line}` },
  modeBtn: {
    display: 'flex', alignItems: 'center', border: 'none', background: 'transparent',
    padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 500, color: COLORS.inkSoft,
  },
  modeBtnActive: { background: COLORS.teal, color: '#fff' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '12px 22px', flexWrap: 'wrap',
    borderBottom: `1px solid ${COLORS.line}`, background: COLORS.panelSoft, minHeight: 56,
  },
  toolGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  toolLabel: { fontSize: 12, color: COLORS.inkSoft, fontWeight: 500 },
  toolHint: { fontSize: 12, color: COLORS.inkSoft, marginLeft: 'auto' },
  overlapToggle: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COLORS.inkSoft },
  numInput: {
    width: 56, padding: '6px 8px', borderRadius: 8, border: `1px solid ${COLORS.line}`,
    background: '#fff', fontSize: 13, color: COLORS.ink,
  },
  viewBtn: {
    border: `1px solid ${COLORS.line}`, background: '#fff', borderRadius: 8, padding: '6px 12px',
    fontSize: 13, color: COLORS.inkSoft,
  },
  viewBtnActive: { background: COLORS.mustard, borderColor: COLORS.mustard, color: '#fff' },
  body: { flex: 1, display: 'flex', minHeight: 0 },
  viewportWrap: { flex: 1, position: 'relative', minWidth: 0 },
  viewport: { position: 'absolute', inset: 0 },
  sidebarToggleBtn: {
    position: 'absolute', top: 12, right: 12, zIndex: 5,
    border: `1px solid ${COLORS.line}`, background: COLORS.panel, borderRadius: 999,
    padding: 9, boxShadow: '0 6px 16px rgba(43,38,32,0.18)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },
  sidebar: {
    width: 300, maxWidth: '78vw', borderLeft: `1px solid ${COLORS.line}`, background: COLORS.panel,
    overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18, flexShrink: 0,
  },
  panelSection: {},
  sectionTitle: { fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, letterSpacing: '0.04em', marginBottom: 10, textTransform: 'uppercase' },
  shapeChip: {
    display: 'flex', alignItems: 'center', border: `1px solid ${COLORS.line}`, background: '#fff',
    borderRadius: 999, padding: '5px 11px', fontSize: 12, color: COLORS.inkSoft,
  },
  shapeChipActive: { background: COLORS.tealSoft, borderColor: COLORS.teal, color: COLORS.tealDeep },
  addBtnDecoration: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none',
    background: COLORS.mustardSoft, color: COLORS.mustardDeep, borderRadius: 10, padding: '9px 0', fontSize: 13, fontWeight: 600,
  },
  addBtnProduct: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none',
    background: COLORS.tealSoft, color: COLORS.tealDeep, borderRadius: 10, padding: '9px 0', fontSize: 13, fontWeight: 600,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' },
  emptyText: { fontSize: 12, color: COLORS.inkSoft, padding: '8px 2px' },
  listItem: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
    border: `1px solid ${COLORS.line}`, background: '#fff', cursor: 'pointer',
  },
  listItemActive: { borderColor: COLORS.teal, background: COLORS.tealSoft },
  swatch: { width: 14, height: 14, borderRadius: 4, flexShrink: 0 },
  listItemName: { fontSize: 13, fontWeight: 500, color: COLORS.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  listItemMeta: { fontSize: 11, color: COLORS.inkSoft },
  trashBtn: { border: 'none', background: 'transparent', padding: 4, borderRadius: 6, flexShrink: 0 },
  fieldLabel: { display: 'block', fontSize: 11, color: COLORS.inkSoft, margin: '10px 0 4px' },
  textInput: {
    width: '100%', padding: '7px 9px', borderRadius: 8, border: `1px solid ${COLORS.line}`,
    background: '#fff', fontSize: 13, color: COLORS.ink,
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(43,38,32,0.45)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 12,
  },
  modalCard: {
    background: COLORS.panel, borderRadius: 18, padding: 12, width: 420, maxWidth: '100%',
    height: '78vh', maxHeight: 560, minHeight: 320,
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 24px 60px rgba(43,38,32,0.25)',
  },
  modalInfoBar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexShrink: 0 },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  infoToggleRow: {
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
    border: `1px solid ${COLORS.line}`, background: '#fff', borderRadius: 10,
    padding: '8px 12px', textAlign: 'left',
  },
  infoToggleHint: { fontSize: 11, color: COLORS.inkSoft, marginLeft: 'auto', flexShrink: 0 },
  modalTitle: {
    fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: COLORS.ink,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1,
  },
  modalPrice: { fontSize: 13, color: COLORS.inkSoft, margin: '6px 2px 8px', flexShrink: 0 },
  iconBtn: { border: 'none', background: COLORS.panelSoft, borderRadius: 8, padding: 6, flexShrink: 0 },
  modalViewport: { flex: 1, minHeight: 0, width: '100%', borderRadius: 12, overflow: 'hidden', cursor: 'grab' },
  modalHint: { fontSize: 11, color: COLORS.inkSoft, textAlign: 'center', marginTop: 8, flexShrink: 0 },
  uvModalCard: {
    background: COLORS.panel, borderRadius: 18, padding: 18, width: 440, maxWidth: '100%',
    boxShadow: '0 24px 60px rgba(43,38,32,0.25)',
  },
  uvHint: { fontSize: 12, color: COLORS.inkSoft, marginBottom: 14 },
  uvGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 76px)',
    gridTemplateRows: 'repeat(3, 76px)',
    gridTemplateAreas: `". top . ." "left front right back" ". bottom . ."`,
    gap: 6,
    justifyContent: 'center',
    margin: '0 auto',
  },
  uvCell: {
    border: `1px solid ${COLORS.line}`, borderRadius: 8, backgroundSize: 'cover', backgroundPosition: 'center',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    position: 'relative', background: COLORS.panelSoft,
  },
  uvCellLabel: { fontSize: 12, color: COLORS.inkSoft },
  uvClearBtn: {
    position: 'absolute', top: 3, right: 3, border: 'none', background: 'rgba(255,255,255,0.9)',
    borderRadius: 6, padding: 2, lineHeight: 0,
  },
};
