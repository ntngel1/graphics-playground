// Стили интерфейса «Бесконечного зума» (вставляются при монтировании, снимаются при выгрузке).
export const UI_CSS = `
.zm-ui { font: 13px/1.35 system-ui, -apple-system, sans-serif; color: #3a2a1a; }
.zm-ui button { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
body:has(.zm-ui) .gp-hints { top: auto; bottom: max(8px, env(safe-area-inset-bottom)); }
.zm-card {
  position: fixed; left: 50%; top: max(10px, env(safe-area-inset-top)); transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; padding: 8px 16px 8px 14px; border-radius: 14px;
  background: #fff8ecee; box-shadow: 0 2px 10px #5a3a1a33; white-space: nowrap; pointer-events: none;
}
.zm-card small { color: #8a6a4a; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; }
.zm-card b { font-size: 17px; font-weight: 650; }
.zm-card i { width: 14px; height: 14px; border-radius: 50%; box-shadow: inset 0 -2px 0 #0003; }
.zm-card::after { content: attr(data-done); min-width: 18px; padding: 1px 6px; border-radius: 9px; background: #e9d9c0; color: #6a4a2a; font-size: 12px; text-align: center; }
.zm-card[data-done="0"]::after { display: none; }
.zm-crumbs {
  position: fixed; left: 12px; top: calc(max(10px, env(safe-area-inset-top)) + 52px); max-width: calc(100vw - 24px);
  display: flex; flex-wrap: wrap; align-items: center; gap: 2px 5px; padding: 5px 10px; border-radius: 10px;
  background: #fff8ecbb; font-size: 12px; pointer-events: none;
}
.zm-crumbs span:last-of-type { font-weight: 650; }
.zm-crumbs i { font-style: normal; color: #a08060; }
.zm-crumbs::after { content: '×' attr(data-mag); margin-left: 8px; color: #8a6a4a; font: 11px ui-monospace, Menlo, monospace; }
.zm-side { position: fixed; right: 12px; top: calc(max(10px, env(safe-area-inset-top)) + 52px); display: flex; flex-direction: column; gap: 6px; }
.zm-side button { padding: 7px 12px; border: 0; border-radius: 10px; background: #fff8ecdd; color: #3a2a1a; box-shadow: 0 1px 6px #5a3a1a22; }
.zm-side button.on { background: #ffcf7a; }
.zm-warm {
  position: fixed; left: 50%; top: calc(max(10px, env(safe-area-inset-top)) + 50px); transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; padding: 5px 12px; border-radius: 10px; background: #fff8ecdd; pointer-events: none;
}
.zm-warm[hidden] { display: none; }
.zm-bar { width: 90px; height: 7px; border-radius: 4px; background: #e6dccd; overflow: hidden; }
.zm-bar i { display: block; height: 100%; transition: width 0.4s, background 0.4s; }
.zm-bump {
  position: fixed; left: 0; top: 0; margin: -38px 0 0 -46px; width: 92px; text-align: center; pointer-events: none;
  font-size: 11px; color: #fff; text-shadow: 0 1px 3px #000a; opacity: 0; transition: opacity 0.25s;
}
.zm-bump.on { opacity: 1; }
.zm-help { position: fixed; left: 50%; bottom: calc(max(8px, env(safe-area-inset-bottom)) + 26px); transform: translateX(-50%); width: max-content; max-width: calc(100vw - 24px);
  padding: 4px 10px; border-radius: 8px; background: #fff8ec99; font-size: 11.5px; color: #5a4430; text-align: center; pointer-events: none; }
.zm-found { position: fixed; left: 0; right: 0; bottom: calc(max(8px, env(safe-area-inset-bottom)) + 64px); display: grid; place-items: center; pointer-events: none; }
.zm-found[hidden] { display: none; }
.zm-found > div {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 28px; border-radius: 18px;
  background: #fff8ecf2; box-shadow: 0 6px 30px #5a3a1a44; pointer-events: auto; animation: zm-pop 0.45s cubic-bezier(.2,1.6,.4,1);
}
.zm-found b { font-size: 28px; }
.zm-found span { color: #6a4a2a; }
.zm-found button { margin-top: 6px; padding: 9px 24px; border: 0; border-radius: 999px; background: #ffb347; color: #3a2a1a; font-size: 15px; font-weight: 600; }
@keyframes zm-pop { from { transform: scale(0.6); opacity: 0; } }
.zm-conf { position: fixed; top: 55vh; width: 9px; height: 13px; border-radius: 2px; pointer-events: none; animation: zm-fall 2.4s cubic-bezier(.15,.6,.4,1) forwards; }
@keyframes zm-fall { 0% { transform: translate(0, 0) rotate(0); opacity: 1; } 15% { transform: translate(calc(var(--dx) * 0.3), -18vh) rotate(calc(var(--r) * 0.2)); } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 0; } }
@media (max-width: 640px) {
  .zm-card { padding: 6px 12px; } .zm-card b { font-size: 15px; }
  .zm-side { top: auto; bottom: calc(max(8px, env(safe-area-inset-bottom)) + 70px); }
  .zm-help { font-size: 10.5px; bottom: calc(max(8px, env(safe-area-inset-bottom)) + 28px); }
}
`
