import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

// Keep in sync with the exact @mediapipe/tasks-vision version in package.json.
const TASKS_VISION_VERSION = '1.1.1'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`
const MODEL_URL =
  (import.meta.env.VITE_POSE_MODEL_URL as string | undefined) ??
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

let landmarkerPromise: Promise<PoseLandmarker> | null = null

async function create(delegate: 'GPU' | 'CPU') {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  })
}

/** Loads the pose model once. Runs fully on-device; video never leaves the browser. */
export function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = create('GPU').catch(() => create('CPU'))
    landmarkerPromise.catch(() => {
      landmarkerPromise = null
    })
  }
  return landmarkerPromise
}
