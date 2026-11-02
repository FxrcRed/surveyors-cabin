// 后台线程建点选加速结构（MeshBVH），主线程同时接着种树、预热（2026-11-02 mobile-perf：手机上原来在主线程卡 2.3s）
// worker 里没有 importmap：bvh 模块里的 `from 'three'` 换成主页面解析好的绝对网址再载入（本地版、发布版 CDN 都适用）
let lib = null;
onmessage = async ({ data }) => {
  if (data.init) {
    lib = fetch(data.bvhURL).then((r) => r.text()).then((src) => Promise.all([
      import(URL.createObjectURL(new Blob([src.replace(/from\s*['"]three['"]/g, `from '${data.threeURL}'`)], { type: 'text/javascript' }))),
      import(data.threeURL)]));
    return;
  }
  try {
    const [{ MeshBVH }, { BufferGeometry, BufferAttribute }] = await lib;
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(data.position, 3)); g.setIndex(new BufferAttribute(data.index, 1));
    const s = MeshBVH.serialize(new MeshBVH(g), { cloneBuffers: false }); // 建的时候会重排 index，主线程 deserialize 时换上
    postMessage({ id: data.id, s }, [...s.roots, s.index.buffer]);
  } catch (e) { postMessage({ id: data.id, err: String(e) }); } // 主线程收到 err 就自己建
};
