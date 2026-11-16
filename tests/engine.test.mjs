import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";

const engine = fs.readFileSync(new URL("../assets/engine.js", import.meta.url), "utf8");
const lattice = JSON.parse(fs.readFileSync(new URL("../assets/lattice.json", import.meta.url)));

function canvas() {
  const commands = [];
  const context = { scale() {}, beginPath() {}, fillRect(...args) { commands.push(["ground", ...args, this.fillStyle]); },
    arc(...args) { commands.push(["dot", ...args, this.fillStyle]); }, fill() {} };
  return { commands, getContext() { return context; } };
}

test("dust renders periodically, and independent previews do not overwrite each other", () => {
  const scope = { window: {} };
  vm.createContext(scope); vm.runInContext(engine, scope);
  const c = canvas();
  const scene = { size: [512,512], loop: 8, seed: 11, lattice,
    figure: {map: Array(10).fill("##########").join("\n"), scale: 1},
    layers: [{type:"figure", shimmer:0, lightBand:false}, {type:"dust",region:[0,9,0,9],density:1}],
    wind: {dir:[-1,-0.3],turb:0.9} };
  const first = scope.window.createDotScene(scene, c, true);
  function frame(t) { c.commands.length = 0; first.render(t); return JSON.stringify(c.commands); }
  const start = frame(0);
  assert.equal(start, frame(8));
  assert.notEqual(start, frame(2));
  const another = scope.window.createDotScene({...scene,loop:4}, canvas(), true);
  assert.equal(another.loop,4);
  assert.equal(first.loop,8);
  assert.equal(frame(0),start);
});

test("CLI pages still expose render(t) and loop metadata", () => {
  const c = canvas();
  const scope = { window: {MANUAL:true,SCENE:{size:[512,512],loop:6,lattice,figure:{map:"#"},layers:[{type:"figure"}]}},
    document:{getElementById(){return c;}} };
  vm.createContext(scope); vm.runInContext(engine,scope);
  assert.equal(scope.window.LOOP,6);
  scope.window.render(0);
  assert.ok(c.commands.length>1);
});

test("an empty painted mask leaves the figure still; selected cells animate", () => {
  const scope = { window: {} }; vm.createContext(scope); vm.runInContext(engine, scope);
  const scene = { size: [512,512], loop: 8, seed: 11, lattice,
    figure: { map: Array(10).fill("##########").join("\n"), scale: 1 },
    layers: [{type:"figure",shimmer:0,lightBand:false}, {type:"dust",region:[0,9,0,9],density:1,
      mask:{bits:"0".repeat(4096),columns:10,rows:10}}] };
  function frames(s) {
    const c=canvas(), renderer=scope.window.createDotScene(s,c,true);
    renderer.render(0); const a=JSON.stringify(c.commands); c.commands.length=0;
    renderer.render(2); return [a,JSON.stringify(c.commands)];
  }
  const still=frames(scene); assert.equal(still[0],still[1]);
  scene.layers[1].mask.bits="1".repeat(4096);
  const moving=frames(scene); assert.notEqual(moving[0],moving[1]);
});

test('custom dust colors reach moving particles without tinting the figure', () => {
  const scope = { window: {} }; vm.createContext(scope); vm.runInContext(engine, scope);
  const c = canvas();
  const scene = { size:[512,512],loop:8,lattice,colors:{bg:'#000000',bright:'#ffffff',dim:'#777777'},
    figure:{map:Array(10).fill('##########').join('\n'),scale:1},
    layers:[{type:'figure',shimmer:0,lightBand:false},{type:'dust',region:[0,9,0,9],density:1,red:0,color:'#00ff00'}] };
  scope.window.createDotScene(scene,c,true).render(2);
  assert.ok(c.commands.some(command => /^rgb\(0,[1-9][0-9]*,0\)$/.test(command.at(-1))));
  assert.ok(c.commands.some(command => command.at(-1) === 'rgb(255,255,255)'));
});
