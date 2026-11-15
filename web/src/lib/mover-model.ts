/** In-browser inference of the Blink mover CNN with onnxruntime-web (WASM, single thread).
 *  Input preprocessing must match ml/train.py: asinh(x / 3). */
import { decodeF32 } from "./image";

type Ort = typeof import("onnxruntime-web");
let ortP: Promise<Ort> | null = null;
let sessP: Promise<import("onnxruntime-web").InferenceSession> | null = null;

async function session() {
  if (!ortP) {
    ortP = import("onnxruntime-web").then((ort) => {
      ort.env.wasm.wasmPaths = "/ort/";
      ort.env.wasm.numThreads = 1;
      return ort;
    });
  }
  const ort = await ortP;
  if (!sessP) sessP = ort.InferenceSession.create("/models/mover.onnx", { executionProviders: ["wasm"] });
  return { ort, sess: await sessP };
}

/** Score base64 float32 stamps (each 6×21×21). Returns P(real mover) per stamp. */
export async function scoreStamps(stamps: string[]): Promise<number[]> {
  if (!stamps.length) return [];
  const { ort, sess } = await session();
  const per = 6 * 21 * 21;
  const buf = new Float32Array(stamps.length * per);
  stamps.forEach((s, k) => {
    const a = decodeF32(s);
    for (let i = 0; i < per; i++) buf[k * per + i] = Math.asinh(a[i] / 3);
  });
  const out = await sess.run({ stamps: new ort.Tensor("float32", buf, [stamps.length, 6, 21, 21]) });
  const logits = out[sess.outputNames[0]].data as Float32Array;
  return Array.from(logits, (l) => 1 / (1 + Math.exp(-l)));
}
