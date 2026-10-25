// 微信语音是 SILK 格式，浏览器不能直接播放：点播放时才加载 silk-wasm，在浏览器里解码成 wav。
// （silk-wasm 是 Emscripten 构建，不能跑在 Workers 上，所以放在前端做。）
const SAMPLE_RATE = 24_000;
const cache = new Map<string, Promise<string>>();

function wav(pcm: Uint8Array, rate: number): Blob {
  const header = new DataView(new ArrayBuffer(44));
  const text = (o: number, s: string) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // 单声道
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm as BlobPart], { type: "audio/wav" });
}

/** 下载 SILK 并解码，返回可播放的 blob URL（同一条语音只解码一次） */
export function silkToWavUrl(url: string): Promise<string> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const [{ decode }, res] = await Promise.all([import("silk-wasm"), fetch(url, { credentials: "same-origin" })]);
      if (!res.ok) throw new Error(`下载失败（${res.status}）`);
      const { data } = await decode(new Uint8Array(await res.arrayBuffer()), SAMPLE_RATE);
      return URL.createObjectURL(wav(data, SAMPLE_RATE));
    })();
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}
