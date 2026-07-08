import * as THREE from 'three'

export interface ThreeSceneHandle {
  renderer: THREE.WebGLRenderer
  addMeshes(count: number): void
  /** dispose=true releases GPU resources; false removes without disposing to demo leak detection */
  clear(dispose: boolean): void
  stop(): void
}

/**
 * Inset three.js scene the perf pane monitors: unique geometries + textures
 * per batch so the memory counters move, plus static points/lines so every
 * render counter is non-zero.
 */
export function startThreeScene(canvas: HTMLCanvasElement): ThreeSceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0b10)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 1.5, 9)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const key = new THREE.DirectionalLight(0xffffff, 2.5)
  key.position.set(3, 5, 4)
  scene.add(key)

  const starGeo = new THREE.BufferGeometry()
  const positions = new Float32Array(2000 * 3)
  for (let i = 0; i < positions.length; i++) positions[i] = (Math.random() - 0.5) * 14
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.03, color: 0x38bdf8 })))

  const grid = new THREE.GridHelper(14, 14, 0x334155, 0x1e293b)
  grid.position.y = -2.5
  scene.add(grid)

  const meshes = new THREE.Group()
  scene.add(meshes)

  const addMeshes = (count: number) => {
    const texture = makeTexture()
    for (let i = 0; i < count; i++) {
      const geometry = new THREE.TorusKnotGeometry(0.3, 0.1, 64, 16)
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        color: new THREE.Color().setHSL(Math.random(), 0.7, 0.65),
        roughness: 0.3,
        metalness: 0.5,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 5,
      )
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0)
      meshes.add(mesh)
    }
  }

  const clear = (dispose: boolean) => {
    for (const child of [...meshes.children]) {
      meshes.remove(child)
      if (!dispose || !(child instanceof THREE.Mesh)) continue
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      mesh.geometry.dispose()
      mesh.material.map?.dispose()
      mesh.material.dispose()
    }
  }

  addMeshes(30)

  const resize = () => {
    const { clientWidth, clientHeight } = canvas
    if (clientWidth === 0) return
    renderer.setSize(clientWidth, clientHeight, false)
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  let raf = 0
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const t = now / 1000
    meshes.rotation.y = t * 0.3
    for (const [i, child] of meshes.children.entries()) {
      child.rotation.x = t * 0.8 + i
      child.rotation.y = t * 0.5 + i * 0.7
    }
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(frame)

  return {
    renderer,
    addMeshes,
    clear,
    stop() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      clear(true)
      starGeo.dispose()
      renderer.dispose()
    },
  }
}

function makeTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 64, 64)
  gradient.addColorStop(0, `hsl(${Math.random() * 360}, 80%, 60%)`)
  gradient.addColorStop(1, `hsl(${Math.random() * 360}, 80%, 30%)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
