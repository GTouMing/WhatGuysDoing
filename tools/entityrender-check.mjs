// entityrender-check.mjs — M3a per-part 模板/实例矩阵回归（无 DOM）。
import fs from 'node:fs';
import {
  buildEntityPartTemplates, buildEntityPartInstances, entityWorldMatrix,
} from '../common/src/main/resources/assets/what_guys_doing/web/entityrender.js';
import { buildEntityMesh } from '../common/src/main/resources/assets/what_guys_doing/web/entitymesh.js';

const bundle = JSON.parse(fs.readFileSync('common/src/main/resources/assets/what_guys_doing/entitybundle.json', 'utf8'));
let failed = 0;
const expect = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

const uvRectFor = () => [0, 0, 1, 1];
const spriteFor = () => 0;
const typeKeys = new Map([[128, 'minecraft:pig']]);
const entity = { netId: 1, typeId: 128, x: 10, y: 64, z: 20, yaw: 0 };
const templates = buildEntityPartTemplates(bundle, typeKeys, uvRectFor);
console.log('=== 1. part 模板 ===');
expect('pig 有一个类型模板', templates.size === 1);
const template = templates.get('minecraft:pig|0');
expect('模板模型是 pig', !!template && template.modelKey === 'pig', template && template.modelKey);
expect('pig 6 个 part', !!template && template.parts.length === 6, String(template && template.parts.length));
expect('pig 42 个 quad', !!template && template.quadCount === 42, String(template && template.quadCount));
const partQuad = template && template.parts.reduce((n, p) => n + p.quadCount, 0);
expect('part quad 总数 42', partQuad === 42, String(partQuad));

console.log('\n=== 2. 实例矩阵 ===');
const instances = buildEntityPartInstances(templates, [entity], typeKeys);
expect('每 part 一个实例桶', instances.size === 6, String(instances.size));
let instanceTotal = 0;
for (const v of instances.values()) instanceTotal += v.count;
expect('实例总数 6', instanceTotal === 6, String(instanceTotal));
const m = entityWorldMatrix(entity);
expect('矩阵平移是实体位置', m[12] === 10 && m[13] === 64 && m[14] === 20);
expect('矩阵含 1/16 缩放', Math.abs(Math.abs(m[0]) - 1 / 16) < 1e-6, String(m[0]));
{
  const swim = entityWorldMatrix({ ...entity, flags: 1 << 2 });
  expect('swim 世界矩阵放平模型',
    Math.abs(swim[5]) < 1e-6 && Math.abs(m[5] - 1 / 16) < 1e-6);
  const sleep = entityWorldMatrix({ ...entity, flags: 1 << 12 });
  expect('sleep 世界矩阵放平模型', Math.abs(sleep[5]) < 1e-6);
}
{
  const baby = { ...entity, flags: 1 << 13 };
  const babyInst = buildEntityPartInstances(templates, [baby], typeKeys, 0);
  const normalMatrix = instances.get('minecraft:pig|0\t0')?.matrices;
  const babyMatrix = babyInst.get('minecraft:pig|0\t0')?.matrices;
  expect('baby 世界矩阵缩放 0.5',
    !!normalMatrix && !!babyMatrix && Math.abs(babyMatrix[0] - normalMatrix[0] * 0.5) < 1e-5);
}

// M3b：带头/腿动画时，对应 part 的实例矩阵必须不同于纯实体世界矩阵。
{
  const animated = { ...entity, netId: 2, limbSwing: 255, swingProgress: 200, headYaw: 45, pitch: 20 };
  const animInstances = buildEntityPartInstances(templates, [animated], typeKeys, 1.0);
  const world = entityWorldMatrix(animated);
  const legIndex = template.parts.findIndex(p => p.role === 'leg');
  const headIndex = template.parts.findIndex(p => p.role === 'head');
  const leg = legIndex >= 0 ? animInstances.get(`minecraft:pig|0\t${legIndex}`) : null;
  const head = headIndex >= 0 ? animInstances.get(`minecraft:pig|0\t${headIndex}`) : null;
  const differs = mat => !!mat && mat.matrices.some((v, i) => Math.abs(v - world[i]) > 1e-5);
  expect('有腿 part', legIndex >= 0);
  expect('有头 part', headIndex >= 0);
  expect('limbSwing 改了腿 part 矩阵', differs(leg));
  expect('headYaw/pitch 改了头 part 矩阵', differs(head));
}

console.log('\n=== 3. 羊皮毛色 tint ===');
{
  const sheepKeys = new Map([[129, 'minecraft:sheep']]);
  const sheepTemplates = buildEntityPartTemplates(bundle, sheepKeys, uvRectFor);
  const sheepTemplate = sheepTemplates.get('minecraft:sheep|0');
  const tintedIndex = sheepTemplate ? sheepTemplate.parts.findIndex(p => p.tint === 'sheep') : -1;
  expect('sheep 模板存在', !!sheepTemplate);
  expect('sheep 有 fur tint part', tintedIndex >= 0, String(tintedIndex));
  if (tintedIndex >= 0) {
    const red = { typeId: 129, netId: 9, x: 0, y: 64, z: 0, yaw: 0, variantBits: 14 };
    const inst = buildEntityPartInstances(sheepTemplates, [red], sheepKeys, 0);
    const bucket = inst.get(`minecraft:sheep|0\t${tintedIndex}`);
    expect('fur 实例有颜色', !!bucket && bucket.colors.length === 4);
    if (bucket) {
      // DyeColor 14 = red：0.541,0.129,0.129
      expect('red fur 颜色正确', Math.abs(bucket.colors[0] - 0.541) < 1e-3
        && Math.abs(bucket.colors[1] - 0.129) < 1e-3,
      `${bucket.colors[0]},${bucket.colors[1]},${bucket.colors[2]}`);
    }
  }
}

console.log('\n=== 4. 项圈条件与颜色 ===');
{
  const cases = [
    ['minecraft:wolf', 130, 'wolf_collar', 4, 14],
    ['minecraft:cat', 131, 'cat_collar', 8, 14],
  ];
  for (const [typeKey, typeId, tint, shift, dye] of cases) {
    const keys = new Map([[typeId, typeKey]]);
    const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
    const wildKey = `${typeKey}|0`;
    const tameKey = typeKey === 'minecraft:wolf' ? 'minecraft:wolf|1' : `${typeKey}|0`;
    const tpl = tpls.get(wildKey);
    const idx = tpl ? tpl.parts.findIndex(p => p.tint === tint) : -1;
    expect(`${typeKey} 有 collar part`, idx >= 0, String(idx));
    if (idx < 0) continue;
    const base = { typeId, netId: 7, x: 0, y: 64, z: 0, yaw: 0 };
    const wild = buildEntityPartInstances(tpls, [{ ...base, flags: 0 }], keys, 0);
    expect(`${typeKey} wild 不画 collar`, !wild.has(`${wildKey}\t${idx}`));
    const tame = buildEntityPartInstances(tpls, [{ ...base, flags: 1 << 8, variantBits: dye << shift }], keys, 0);
    const bucket = tame.get(`${tameKey}\t${idx}`);
    expect(`${typeKey} tame 画 collar`, !!bucket);
    if (bucket) {
      expect(`${typeKey} collar 是红色`, Math.abs(bucket.colors[0] - 0.541) < 1e-3
        && Math.abs(bucket.colors[1] - 0.129) < 1e-3);
    }
  }
}

console.log('\n=== 5. 猫本体纹理变体 ===');
{
  const catKeys = new Map([[131, 'minecraft:cat']]);
  const catTemplates = buildEntityPartTemplates(bundle, catKeys, uvRectFor);
  const variantKeys = [...catTemplates.keys()].filter(k => k.startsWith('minecraft:cat|'));
  expect('cat 有 11 个本体变体', variantKeys.length === 11, String(variantKeys.length));
  expect('cat variant 4 模板存在', catTemplates.has('minecraft:cat|4'));
  const cat = { typeId: 131, netId: 8, x: 0, y: 64, z: 0, yaw: 0, variantBits: 4 << 12 };
  const inst = buildEntityPartInstances(catTemplates, [cat], catKeys, 0);
  expect('cat 使用 variant 4 的 part', inst.has('minecraft:cat|4\t0'));
}

console.log('\n=== 6. 狼本体纹理变体 ===');
{
  const wolfKeys = new Map([[130, 'minecraft:wolf']]);
  const wolfTemplates = buildEntityPartTemplates(bundle, wolfKeys, uvRectFor);
  const keys = [...wolfTemplates.keys()].filter(k => k.startsWith('minecraft:wolf|'));
  expect('wolf 有 27 个纹理模板', keys.length === 27, String(keys.length));
  expect('wolf variant 4 wild 模板存在', wolfTemplates.has('minecraft:wolf|12'));
  const base = { typeId: 130, netId: 10, x: 0, y: 64, z: 0, yaw: 0, variantBits: 4 << 16 };
  const wild = buildEntityPartInstances(wolfTemplates, [{ ...base, flags: 0 }], wolfKeys, 0);
  expect('wolf wild 用 |12', wild.has('minecraft:wolf|12\t0'));
  const tame = buildEntityPartInstances(wolfTemplates, [{ ...base, flags: 1 << 8 }], wolfKeys, 0);
  expect('wolf tame 用 |13', tame.has('minecraft:wolf|13\t0'));
  const angry = buildEntityPartInstances(wolfTemplates, [{ ...base, flags: (1 << 8) | (1 << 10) }], wolfKeys, 0);
  expect('wolf angry 用 |14', angry.has('minecraft:wolf|14\t0'));
}

console.log('\n=== 7. 马本体颜色变体 ===');
{
  const horseKeys = new Map([[132, 'minecraft:horse']]);
  const horseTemplates = buildEntityPartTemplates(bundle, horseKeys, uvRectFor);
  const keys = [...horseTemplates.keys()].filter(k => k.startsWith('minecraft:horse|'));
  expect('horse 有 7 个颜色模板', keys.length === 7, String(keys.length));
  expect('horse chestnut 模板存在', horseTemplates.has('minecraft:horse|2'));
  const horse = { typeId: 132, netId: 11, x: 0, y: 64, z: 0, yaw: 0, variantBits: 2 << 20 };
  const inst = buildEntityPartInstances(horseTemplates, [horse], horseKeys, 0);
  expect('horse 使用 chestnut 模板', inst.has('minecraft:horse|2\t0'));
  // markings overlay：base horse 颜色模板 = chestnut，markings=1 (white)
  const chestnut = horseTemplates.get('minecraft:horse|2');
  const markingIndex = chestnut ? chestnut.parts.findIndex(p => p.condition === 'horse_marking_1') : -1;
  expect('horse 有 white markings part', markingIndex >= 0, String(markingIndex));
  if (markingIndex >= 0) {
    const marked = { ...horse, variantBits: (2 << 20) | (1 << 28) };
    const markedInst = buildEntityPartInstances(horseTemplates, [marked], horseKeys, 0);
    expect('markings=1 画 marking 层', markedInst.has(`minecraft:horse|2\t${markingIndex}`));
    const plainInst = buildEntityPartInstances(horseTemplates, [horse], horseKeys, 0);
    expect('markings=0 不画 marking 层', !plainInst.has(`minecraft:horse|2\t${markingIndex}`));
  }
  // 鞍 + 铁马铠
  const saddleIndex = chestnut ? chestnut.parts.findIndex(p => p.condition === 'horse_saddle') : -1;
  const ironIndex = chestnut ? chestnut.parts.findIndex(p => p.condition === 'horse_armor_3') : -1;
  expect('horse 有 saddle 条件层', saddleIndex >= 0, String(saddleIndex));
  expect('horse 有 iron armor 条件层', ironIndex >= 0, String(ironIndex));
  if (saddleIndex >= 0 && ironIndex >= 0) {
    const equipped = { ...horse, variantBits: (2 << 20) | (1 << 24) | (3 << 25) };
    const equippedInst = buildEntityPartInstances(horseTemplates, [equipped], horseKeys, 0);
    expect('saddle 被画出', equippedInst.has(`minecraft:horse|2\t${saddleIndex}`));
    expect('iron armor 被画出', equippedInst.has(`minecraft:horse|2\t${ironIndex}`));
    const naked = buildEntityPartInstances(horseTemplates, [horse], horseKeys, 0);
    expect('无鞍不画 saddle', !naked.has(`minecraft:horse|2\t${saddleIndex}`));
    expect('无铠不画 iron armor', !naked.has(`minecraft:horse|2\t${ironIndex}`));
  }
}

console.log('\n=== 8. 骆驼/驴/骡的鞍 ===');
{
  for (const [typeKey, typeId] of [['minecraft:camel', 134], ['minecraft:donkey', 135], ['minecraft:mule', 136]]) {
    const keys = new Map([[typeId, typeKey]]);
    const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
    const tpl = tpls.get(`${typeKey}|0`);
    const idx = tpl ? tpl.parts.findIndex(p => p.condition === 'saddled') : -1;
    expect(`${typeKey} 有 saddle 条件层`, idx >= 0, String(idx));
    if (idx < 0) continue;
    const bare = { typeId, netId: 13, x: 0, y: 64, z: 0, yaw: 0, flags: 0 };
    const saddled = { ...bare, flags: 1 << 11 };
    expect(`${typeKey} 无鞍不画`, !buildEntityPartInstances(tpls, [bare], keys, 0)
      .has(`${typeKey}|0\t${idx}`));
    expect(`${typeKey} 有鞍画`, buildEntityPartInstances(tpls, [saddled], keys, 0)
      .has(`${typeKey}|0\t${idx}`));
  }
}

console.log('\n=== 9. 村民 type/profession/level ===');
{
  const villagerKeys = new Map([[137, 'minecraft:villager']]);
  const tpls = buildEntityPartTemplates(bundle, villagerKeys, uvRectFor);
  const tpl = tpls.get('minecraft:villager|0');
  const typeIndex = tpl ? tpl.parts.findIndex(p => p.condition === 'villager_type_3') : -1;
  const profIndex = tpl ? tpl.parts.findIndex(p => p.condition === 'villager_profession_5') : -1;
  const levelIndex = tpl ? tpl.parts.findIndex(p => p.condition === 'villager_level_3') : -1;
  expect('villager 有 plains type 层', typeIndex >= 0, String(typeIndex));
  expect('villager 有 farmer profession 层', profIndex >= 0, String(profIndex));
  expect('villager 有 gold level 层', levelIndex >= 0, String(levelIndex));
  if (typeIndex >= 0 && profIndex >= 0 && levelIndex >= 0) {
    // plains=3, farmer=5, level=3
    const v = { typeId: 137, netId: 14, x: 0, y: 64, z: 0, yaw: 0, variantBits: 3 << 5 | 5 | 3 << 8 };
    const inst = buildEntityPartInstances(tpls, [v], villagerKeys, 0);
    expect('villager 画 plains', inst.has(`minecraft:villager|0\t${typeIndex}`));
    expect('villager 画 farmer', inst.has(`minecraft:villager|0\t${profIndex}`));
    expect('villager 画 gold level', inst.has(`minecraft:villager|0\t${levelIndex}`));
  }
}

console.log('\n=== 10. 僵尸村民 type/profession/level ===');
{
  const keys = new Map([[138, 'minecraft:zombie_villager']]);
  const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
  const tpl = tpls.get('minecraft:zombie_villager|0');
  const typeIndex = tpl ? tpl.parts.findIndex(p => p.condition === 'villager_type_3') : -1;
  const profIndex = tpl ? tpl.parts.findIndex(p => p.condition === 'villager_profession_5') : -1;
  expect('zombie_villager 有 plains type 层', typeIndex >= 0, String(typeIndex));
  expect('zombie_villager 有 farmer profession 层', profIndex >= 0, String(profIndex));
  if (typeIndex >= 0 && profIndex >= 0) {
    const v = { typeId: 138, netId: 15, x: 0, y: 64, z: 0, yaw: 0, variantBits: 3 << 5 | 5 | 3 << 8 };
    const inst = buildEntityPartInstances(tpls, [v], keys, 0);
    expect('zombie_villager 画 plains', inst.has(`minecraft:zombie_villager|0\t${typeIndex}`));
    expect('zombie_villager 画 farmer', inst.has(`minecraft:zombie_villager|0\t${profIndex}`));
  }
}

console.log('\n=== 11. 狐狸/哞菇颜色变体 ===');
{
  for (const [typeKey, typeId, count] of [['minecraft:fox', 140, 4], ['minecraft:mooshroom', 141, 2]]) {
    const keys = new Map([[typeId, typeKey]]);
    const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
    const variants = [...tpls.keys()].filter(k => k.startsWith(`${typeKey}|`));
    expect(`${typeKey} 有 ${count} 个纹理模板`, variants.length === count, String(variants.length));
    const entity = { typeId, netId: 18, x: 0, y: 64, z: 0, yaw: 0, variantBits: 1 };
    const inst = buildEntityPartInstances(tpls, [entity], keys, 0);
    expect(`${typeKey} 使用 variant 1`, inst.has(`${typeKey}|1\t0`));
  }
  {
    const keys = new Map([[140, 'minecraft:fox']]);
    const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
    const sleep = { typeId: 140, netId: 24, x: 0, y: 64, z: 0, yaw: 0, variantBits: 1, flags: 1 << 12 };
    const inst = buildEntityPartInstances(tpls, [sleep], keys, 0);
    expect('fox sleep 使用 snow sleep 模板', inst.has('minecraft:fox|3\t0'));
  }
}

console.log('\n=== 12. 兔子颜色变体 ===');
{
  const keys = new Map([[142, 'minecraft:rabbit']]);
  const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
  const variants = [...tpls.keys()].filter(k => k.startsWith('minecraft:rabbit|'));
  expect('rabbit 有 8 个颜色模板', variants.length === 8, String(variants.length));
  const rabbit = { typeId: 142, netId: 19, x: 0, y: 64, z: 0, yaw: 0, variantBits: 6 };
  const inst = buildEntityPartInstances(tpls, [rabbit], keys, 0);
  expect('rabbit 使用 killer 模板', inst.has('minecraft:rabbit|6\t0'));
  const toast = { typeId: 142, netId: 20, x: 0, y: 64, z: 0, yaw: 0, variantBits: 7 };
  const toastInst = buildEntityPartInstances(tpls, [toast], keys, 0);
  expect('rabbit 使用 Toast 模板', toastInst.has('minecraft:rabbit|7\t0'));
}

console.log('\n=== 13. 羊驼/美西螈颜色变体 ===');
{
  for (const [typeKey, typeId, count, pick] of [
    ['minecraft:llama', 143, 4, 3],
    ['minecraft:axolotl', 144, 5, 2],
  ]) {
    const keys = new Map([[typeId, typeKey]]);
    const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
    const variants = [...tpls.keys()].filter(k => k.startsWith(`${typeKey}|`));
    expect(`${typeKey} 有 ${count} 个模板`, variants.length === count, String(variants.length));
    const entity = { typeId, netId: 20, x: 0, y: 64, z: 0, yaw: 0, variantBits: pick };
    const inst = buildEntityPartInstances(tpls, [entity], keys, 0);
    expect(`${typeKey} 使用 variant ${pick}`, inst.has(`${typeKey}|${pick}\t0`));
  }
  {
    const keys = new Map([[143, 'minecraft:llama']]);
    const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
    const tpl = tpls.get('minecraft:llama|3');
    const entity = { typeId: 143, netId: 25, x: 0, y: 64, z: 0, yaw: 0, variantBits: 3 | (15 << 4) };
    const inst = buildEntityPartInstances(tpls, [entity], keys, 0);
    const swagPart = tpl.parts.findIndex(part => part.condition === 'llama_swag_15');
    expect('llama swag 条件层存在', swagPart >= 0);
    expect('llama 红色地毯层被绘制', swagPart >= 0 && inst.has(`minecraft:llama|3\t${swagPart}`));
  }
}

console.log('\n=== 14. 熊猫基因纹理变体 ===');
{
  const keys = new Map([[145, 'minecraft:panda']]);
  const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
  const variants = [...tpls.keys()].filter(k => k.startsWith('minecraft:panda|'));
  expect('panda 有 7 个模板', variants.length === 7, String(variants.length));
  const panda = { typeId: 145, netId: 21, x: 0, y: 64, z: 0, yaw: 0, variantBits: 6 };
  const inst = buildEntityPartInstances(tpls, [panda], keys, 0);
  expect('panda 使用 aggressive 模板', inst.has('minecraft:panda|6\t0'));
}

console.log('\n=== 15. 潜影贝/青蛙变体 ===');
{
  for (const [typeKey, typeId, count, pick] of [
    ['minecraft:shulker', 146, 16, 15],
    ['minecraft:frog', 147, 3, 2],
  ]) {
    const keys = new Map([[typeId, typeKey]]);
    const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
    const variants = [...tpls.keys()].filter(k => k.startsWith(`${typeKey}|`));
    expect(`${typeKey} 有 ${count} 个模板`, variants.length === count, String(variants.length));
    const entity = { typeId, netId: 22, x: 0, y: 64, z: 0, yaw: 0, variantBits: pick };
    const inst = buildEntityPartInstances(tpls, [entity], keys, 0);
    expect(`${typeKey} 使用 variant ${pick}`, inst.has(`${typeKey}|${pick}\t0`));
  }
}

console.log('\n=== 16. 热带鱼 shape/pattern/颜色 ===');
{
  const keys = new Map([[148, 'minecraft:tropical_fish']]);
  const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
  const variants = [...tpls.keys()].filter(k => k.startsWith('minecraft:tropical_fish|'));
  expect('tropical_fish 有 2 个 shape 模板', variants.length === 2, String(variants.length));
  const fish = {
    typeId: 148, netId: 23, x: 0, y: 64, z: 0, yaw: 0,
    variantBits: (1 << 12) | (4 << 8) | (2 << 4) | 5,
  };
  const inst = buildEntityPartInstances(tpls, [fish], keys, 0);
  let base = false;
  let pattern = false;
  for (const [key, bucket] of inst) {
    const [tkey, piRaw] = key.split('\t');
    if (tkey !== 'minecraft:tropical_fish|1' || bucket.count === 0) continue;
    const part = tpls.get(tkey).parts[Number(piRaw)];
    if (part.tint === 'tropical_base') base = true;
    if (part.tint === 'tropical_pattern') pattern = true;
  }
  expect('tropical_fish 使用 shape 1 基础层', base);
  expect('tropical_fish 使用 pattern 5 条件层', pattern);
}

console.log('\n=== 17. 默认 Steve 玩家模型 ===');
{
  const keys = new Map([[139, 'minecraft:player']]);
  const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
  const tpl = tpls.get('minecraft:player|0');
  expect('player 模板存在', !!tpl);
  const baseParts = tpl ? tpl.parts.filter(p => !p.condition) : [];
  expect('player 6 个 part', baseParts.length === 6, String(baseParts.length));
  const roles = baseParts.map(p => p.role).filter(Boolean);
  expect('player 有 head/arm/leg 角色', roles.includes('head')
    && roles.filter(r => r === 'arm').length === 2
    && roles.filter(r => r === 'leg').length === 2, roles.join(','));
  if (tpl) {
    const p = { typeId: 139, netId: 16, x: 0, y: 64, z: 0, yaw: 0 };
    const inst = buildEntityPartInstances(tpls, [p], keys, 0);
    expect('player 生成 6 个实例桶', inst.size === 6, String(inst.size));
    const crouchInst = buildEntityPartInstances(tpls, [{ ...p, flags: 1 }], keys, 0);
    let crouchChanged = 0;
    for (let pi = 0; pi < tpl.parts.length; pi++) {
      const part = tpl.parts[pi];
      if (!part.role || !['body', 'head', 'arm', 'leg'].includes(part.role)) continue;
      const a = inst.get(`minecraft:player|0\t${pi}`)?.matrices;
      const b = crouchInst.get(`minecraft:player|0\t${pi}`)?.matrices;
      if (a && b && a.some((v, i) => Math.abs(v - b[i]) > 1e-5)) crouchChanged++;
    }
    expect('crouch 改变 body/head/arm/leg 矩阵', crouchChanged >= 4, String(crouchChanged));
    const armored = { ...p, equipment: 3 | (3 << 4) };
    const armoredInst = buildEntityPartInstances(tpls, [armored], keys, 0);
    expect('iron 头盔/胸甲增加实例桶', armoredInst.size > 6, String(armoredInst.size));
    const leather = {
      ...p,
      equipment: 1 | (1 << 4) | (1 << 8) | (1 << 12),
      leatherColors: [
        0x1000000 | 0xFF0000,
        0x1000000 | 0x00FF00,
        0x1000000 | 0x0000FF,
        0x1000000 | 0xFFFF00,
      ],
    };
    const leatherInst = buildEntityPartInstances(tpls, [leather], keys, 0);
    const seenTints = new Map();
    for (const [key, bucket] of leatherInst) {
      const pi = Number(key.split('\t')[1]);
      const part = tpl.parts[pi];
      if (part && part.tint && part.tint.startsWith('leather_') && bucket.count > 0) {
        seenTints.set(part.tint, Array.from(bucket.colors.slice(0, 4)));
      }
    }
    expect('leather head overlay 用 head 颜色', seenTints.get('leather_head')?.[0] > 0.9);
    expect('leather chest overlay 用 chest 颜色', seenTints.get('leather_chest')?.[1] > 0.9);
    expect('leather legs overlay 用 legs 颜色', seenTints.get('leather_legs')?.[2] > 0.9);
    expect('leather feet overlay 用 feet 颜色',
      seenTints.get('leather_feet')?.[0] > 0.9 && seenTints.get('leather_feet')?.[1] > 0.9);
    const elytra = { ...p, equipment: 8 << 4 };
    const elytraInst = buildEntityPartInstances(tpls, [elytra], keys, 0);
    expect('elytra 胸甲层增加实例桶', elytraInst.size > 6, String(elytraInst.size));
    const wingPart = tpl.parts.findIndex(part => part.role === 'wing');
    if (wingPart >= 0) {
      const wingKey = `${tpl.key}\t${wingPart}`;
      const normal = elytraInst.get(wingKey)?.matrices.slice(0, 16) || [];
      const glideInst = buildEntityPartInstances(tpls, [{ ...elytra, flags: 1 << 5 }], keys, 0);
      const glide = glideInst.get(wingKey)?.matrices.slice(0, 16) || [];
      expect('elytra 滑翔时翅膀矩阵变化',
        normal.length === 16 && glide.length === 16 && normal.some((v, i) => Math.abs(v - glide[i]) > 1e-5));
    }
  }
  // per-UUID skin 走 player|1.. 变体
  const skin = { path: 'wgd:skins/0123456789abcdef0123456789abcdef.png', model: 'wide', cape: 'wgd:capes/0123456789abcdef0123456789abcdef.png' };
  const skinTpls = buildEntityPartTemplates(bundle, keys, uvRectFor, { playerSkins: [skin] });
  expect('player skin 变体模板存在', skinTpls.has('minecraft:player|1'));
  expect('player cape 层存在', !!skinTpls.get('minecraft:player|1')?.parts.some(p => p.name === 'cape'));
  {
    const capeTpl = skinTpls.get('minecraft:player|1');
    const capePart = capeTpl ? capeTpl.parts.findIndex(p => p.name === 'cape') : -1;
    if (capePart >= 0) {
      const capeKey = `minecraft:player|1\t${capePart}`;
      const baseInst = buildEntityPartInstances(
        skinTpls,
        [{ typeId: 139, netId: 18, x: 0, y: 64, z: 0, yaw: 0, uuid: '0123456789abcdef0123456789abcdef' }],
        keys, 0, { skinIndexOf: () => 1 },
      );
      const moveInst = buildEntityPartInstances(
        skinTpls,
        [{ typeId: 139, netId: 18, x: 0, y: 64, z: 0, yaw: 0, limbSwing: 255, uuid: '0123456789abcdef0123456789abcdef' }],
        keys, 0, { skinIndexOf: () => 1 },
      );
      const a = baseInst.get(capeKey)?.matrices.slice(0, 16) || [];
      const b = moveInst.get(capeKey)?.matrices.slice(0, 16) || [];
      expect('cape 走路时矩阵摆动', a.length === 16 && b.length === 16 && a.some((v, i) => Math.abs(v - b[i]) > 1e-5));
    }
  }
  const slim = { path: 'wgd:skins/0123456789abcdef0123456789abcdef.png', model: 'slim' };
  const slimTpls = buildEntityPartTemplates(bundle, keys, uvRectFor, { playerSkins: [slim] });
  expect('player slim 变体模板存在', slimTpls.has('minecraft:player|1'));
  const slimArm = slimTpls.get('minecraft:player|1')?.parts.find(p => p.name === 'right_arm');
  if (slimArm) {
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < slimArm.vertices.length; i += 5) {
      minX = Math.min(minX, slimArm.vertices[i]);
      maxX = Math.max(maxX, slimArm.vertices[i]);
    }
    expect('slim 右臂宽度为 3', Math.abs((maxX - minX) - 3) < 0.01, String(maxX - minX));
  }
  const skinInst = buildEntityPartInstances(
    skinTpls,
    [{ typeId: 139, netId: 17, x: 0, y: 64, z: 0, yaw: 0, uuid: '0123456789abcdef0123456789abcdef' }],    keys,
    0,
    { skinIndexOf: () => 1 },
  );
  expect('player 使用 skin 变体', skinInst.has('minecraft:player|1\t0'));
}

console.log('\n=== 12. 鹦鹉颜色变体 ===');
{
  const parrotKeys = new Map([[133, 'minecraft:parrot']]);
  const parrotTemplates = buildEntityPartTemplates(bundle, parrotKeys, uvRectFor);
  const keys = [...parrotTemplates.keys()].filter(k => k.startsWith('minecraft:parrot|'));
  expect('parrot 有 5 个颜色模板', keys.length === 5, String(keys.length));
  expect('parrot green 模板存在', parrotTemplates.has('minecraft:parrot|2'));
  const parrot = { typeId: 133, netId: 12, x: 0, y: 64, z: 0, yaw: 0, variantBits: 2 << 24 };
  const inst = buildEntityPartInstances(parrotTemplates, [parrot], parrotKeys, 0);
  expect('parrot 使用 green 模板', inst.has('minecraft:parrot|2\t0'));
}

console.log('\n=== 9. 与 entitymesh 世界包围盒一致 ===');
const mesh = buildEntityMesh(bundle, [entity], typeKeys, uvRectFor, spriteFor);let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < mesh.vertexCount; i++) {
  const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
  minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
}
let tMinX = Infinity, tMaxX = -Infinity, tMinY = Infinity, tMaxY = -Infinity, tMinZ = Infinity, tMaxZ = -Infinity;
for (const bucket of instances.values()) {
  const bm = bucket.matrices;
  for (let i = 0; i < bucket.count; i++) {
    const o = i * 16;
    for (const part of template.parts) {
      for (let vi = 0; vi < part.vertices.length; vi += 5) {
        const x = part.vertices[vi], y = part.vertices[vi + 1], z = part.vertices[vi + 2];
        const wx = bm[o] * x + bm[o + 4] * y + bm[o + 8] * z + bm[o + 12];
        const wy = bm[o + 1] * x + bm[o + 5] * y + bm[o + 9] * z + bm[o + 13];
        const wz = bm[o + 2] * x + bm[o + 6] * y + bm[o + 10] * z + bm[o + 14];
        tMinX = Math.min(tMinX, wx); tMaxX = Math.max(tMaxX, wx);
        tMinY = Math.min(tMinY, wy); tMaxY = Math.max(tMaxY, wy);
        tMinZ = Math.min(tMinZ, wz); tMaxZ = Math.max(tMaxZ, wz);
      }
    }
  }
}
const same = (a, b) => Math.abs(a - b) < 1e-5;
expect('包围盒 x 一致', same(minX, tMinX) && same(maxX, tMaxX), `${minX}/${maxX} vs ${tMinX}/${tMaxX}`);
expect('包围盒 y 一致', same(minY, tMinY) && same(maxY, tMaxY), `${minY}/${maxY} vs ${tMinY}/${tMaxY}`);
expect('包围盒 z 一致', same(minZ, tMinZ) && same(maxZ, tMaxZ), `${minZ}/${maxZ} vs ${tMinZ}/${tMaxZ}`);

console.log('\n=== 11. 坐下姿态 ===');
{
  const keys = new Map([[130, 'minecraft:cat']]);
  const tpls = buildEntityPartTemplates(bundle, keys, uvRectFor);
  const tpl = tpls.get('minecraft:cat|0');
  const bodyIndex = tpl ? tpl.parts.findIndex(part => part.role === 'body') : -1;
  const legIndex = tpl ? tpl.parts.findIndex(part => part.role === 'leg') : -1;
  const normal = buildEntityPartInstances(tpls, [{ typeId: 130, netId: 30, x: 0, y: 64, z: 0, yaw: 0 }], keys, 0);
  const sitting = buildEntityPartInstances(tpls, [{ typeId: 130, netId: 30, x: 0, y: 64, z: 0, yaw: 0, flags: 1 << 14 }], keys, 0);
  const differs = (index) => {
    if (index < 0) return false;
    const a = normal.get(`minecraft:cat|0\t${index}`)?.matrices;
    const b = sitting.get(`minecraft:cat|0\t${index}`)?.matrices;
    return !!a && !!b && a.some((v, i) => Math.abs(v - b[i]) > 1e-5);
  };
  expect('cat 有 body part', bodyIndex >= 0);
  expect('cat 坐下改变 body 矩阵', differs(bodyIndex));
  expect('cat 坐下改变 leg 矩阵', differs(legIndex));
}

console.log('\n=== 12. entitymesh baby 缩放 ===');
{
  const babyMesh = buildEntityMesh(bundle, [{ ...entity, flags: 1 << 13 }], typeKeys, uvRectFor, spriteFor);
  let babyMinY = Infinity, babyMaxY = -Infinity;
  for (let i = 0; i < babyMesh.vertexCount; i++) {
    babyMinY = Math.min(babyMinY, babyMesh.positions[i * 3 + 1]);
    babyMaxY = Math.max(babyMaxY, babyMesh.positions[i * 3 + 1]);
  }
  const normalH = maxY - minY;
  const babyH = babyMaxY - babyMinY;
  expect('entitymesh baby 高度减半', Math.abs(babyH - normalH * 0.5) < 1e-4,
    `${babyH.toFixed(4)} vs ${normalH.toFixed(4)}`);
}

console.log('\n=== 结果 ===');
if (failed) {
  console.log(`FAILED：${failed} 项`);
  process.exitCode = 1;
} else {
  console.log('ALL PASSED：part 模板、实例矩阵与 entitymesh 一致');
}
