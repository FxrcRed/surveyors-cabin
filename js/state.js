// 几个文件共用的变量（2026-10-30 拆模块时加）：别的文件写 shared.名字，读写都直通声明它的那个文件里的原变量
// 声明处用 share 挂上来：share({ 名字: () => 名字 })；别处要改它的给 setter：share({ 名字: [() => 名字, (v) => { 名字 = v; }] })
export const shared = {};
export function share(o) {
  for (const k in o) { const [get, set] = [].concat(o[k]); Object.defineProperty(shared, k, { get, set, enumerable: true, configurable: true }); }
}
