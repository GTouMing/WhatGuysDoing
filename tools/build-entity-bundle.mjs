// build-entity-bundle-geo.mjs — 从 Blockbench Bedrock .geo.json 烘焙运行时 entitybundle。
//
// 数据源：assets/what_guys_doing/blockbench/<id>.geo.json + <id>.meta.json
// 输出：assets/what_guys_doing/entitybundle.json（运行时格式仍是 generated-wgd-2，
//       浏览器渲染管线不用重写，但模型源是 Blockbench 的 .geo.json）。
//
// 关键约定（用显式四边形逐顶点/逐面反推）：
//   - Bedrock/Blockbench 的 bone rotation 与运行时矩阵符号相反，三轴取反；
//   - Euler 顺序与 dumper 的 ModelPart 一致：Rz·Ry·Rx；
//   - per-face UV 的角序：侧面翻 U，顶面翻 V，底面不翻。
//
//   node tools/build-entity-bundle-geo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { faceQuad } from '../common/src/main/resources/assets/what_guys_doing/web/baker.js';

const ROOT = path.join('common', 'src', 'main', 'resources', 'assets', 'what_guys_doing');
const GEO_DIR = path.join(ROOT, 'blockbench');
const STATES_DIR = path.join(ROOT, 'entitystates');
const OUT = path.join(ROOT, 'entitybundle.json');

const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => {
  const r = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      for (let k = 0; k < 4; k++) r[row * 4 + col] += a[row * 4 + k] * b[k * 4 + col];
    }
  }
  return r;
};
const translate = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const rotateX = a => [1, 0, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, 0, Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
const rotateY = a => [Math.cos(a), 0, Math.sin(a), 0, 0, 1, 0, 0, -Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
const rotateZ = a => [Math.cos(a), -Math.sin(a), 0, 0, Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const transform = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
];

const D2R = Math.PI / 180;

function boneMatrix(bone) {
  const [px, py, pz] = bone.pivot || [0, 0, 0];
  const rotation = Array.isArray(bone.rotation) && bone.rotation.length === 3
    ? bone.rotation
    : [0, 0, 0];
  const [rx, ry, rz] = rotation.map(v => -v * D2R);
  const r = mul(mul(rotateZ(rz), rotateY(ry)), rotateX(rx));
  return mul(mul(translate(px, py, pz), r), translate(-px, -py, -pz));
}

function bakeGeometry(geo, texture, textureRef) {
  const geometry = geo['minecraft:geometry'][0];
  const W = geometry.description.texture_width;
  const H = geometry.description.texture_height;
  const bones = geometry.bones || [];
  const byName = new Map(bones.map(b => [b.name, b]));
  const worldCache = new Map();
  const worldOf = (bone, seen = new Set()) => {
    if (!bone) return I();
    if (worldCache.has(bone.name)) return worldCache.get(bone.name);
    if (seen.has(bone.name)) return I();
    seen.add(bone.name);
    const parent = bone.parent ? byName.get(bone.parent) : null;
    const world = mul(worldOf(parent, seen), boneMatrix(bone));
    worldCache.set(bone.name, world);
    return world;
  };

  const parts = [];
  const pivots = {};
  for (const bone of bones) {
    if (bone.pivot) pivots[bone.name] = bone.pivot;
    if (!Array.isArray(bone.cubes) || !bone.cubes.length) continue;
    const world = worldOf(bone);
    const cubes = [];
    bone.cubes.forEach((cube, index) => {
      const origin = cube.origin || [0, 0, 0];
      const size = cube.size || [0, 0, 0];
      const to = [origin[0] + size[0], origin[1] + size[1], origin[2] + size[2]];
      const element = { from: origin, to };
      const quads = [];
      for (const [face, uv] of Object.entries(cube.uv || {})) {
        if (!uv || !Array.isArray(uv.uv) || !Array.isArray(uv.uv_size)) continue;
        const [u, v] = uv.uv;
        const [w, h] = uv.uv_size;
        if (!(w > 0 && h > 0)) continue;
        const rect = [
          u * 16 / W, v * 16 / H,
          (u + w) * 16 / W, (v + h) * 16 / H,
        ];
        const quad = faceQuad(element, face, { uv: rect, texture }, texture, 0, false);
        const flipU = face === 'north' || face === 'south' || face === 'east' || face === 'west';
        const flipV = face === 'up';
        const positions = [];
        const uvs = [];
        for (const vert of quad.verts) {
          const p = transform(world, vert);
          positions.push(p);
          let uu = vert[3];
          let vv = vert[4];
          if (flipU) uu = rect[0] + rect[2] - uu;
          if (flipV) vv = rect[1] + rect[3] - vv;
          uvs.push([uu / 16, vv / 16]);
        }
        quads.push({ face, texture, positions, uvs });
      }
      if (quads.length) cubes.push({ index, quads });
    });
    if (cubes.length) parts.push({ name: bone.name, cubes });
  }
  return { parts, texture_size: [W, H], pivots };
}

const geoFiles = new Map();
for (const file of fs.readdirSync(GEO_DIR).filter(f => f.endsWith('.geo.json'))) {
  geoFiles.set(file.replace('.geo.json', ''), JSON.parse(fs.readFileSync(path.join(GEO_DIR, file), 'utf8')));
}
const metaFiles = fs.readdirSync(GEO_DIR).filter(f => f.endsWith('.meta.json'));

function layerOverlay(name) {
  if (name === 'SheepFurLayer') return { tint: 'sheep', condition: 'not_sheared' };
  if (name === 'WolfCollarLayer') return { tint: 'wolf_collar', condition: 'tame' };
  if (name === 'CatCollarLayer') return { tint: 'cat_collar', condition: 'tame' };
  return { tint: null, condition: null };
}

// 与 WorldSampler.CAT_VARIANTS 保持同序；variantBits 12..15 是本体纹理索引。
const CAT_VARIANTS = [
  'tabby', 'black', 'red', 'siamese', 'british_shorthair',
  'calico', 'persian', 'ragdoll', 'white', 'jellie', 'all_black',
];
// 与 WorldSampler.WOLF_VARIANTS 同序；每个变体 3 张：wild/tame/angry。
const WOLF_VARIANTS = [
  'pale', 'ashen', 'black', 'chestnut', 'rusty',
  'snowy', 'spotted', 'striped', 'woods',
];
// 与 WorldSampler.HORSE_VARIANTS 同序（Horse.Variant ordinal）。
const HORSE_VARIANTS = [
  'white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown',
];
// 与 WorldSampler.PARROT_VARIANTS 同序（Parrot.Variant ordinal）。
const PARROT_VARIANTS = ['red_blue', 'blue', 'green', 'yellow_blue', 'gray'];
// Horse.getMarkings() ordinal 1..4 对应的 overlay 纹理。
const HORSE_MARKINGS = [
  'horse_markings_white',
  'horse_markings_whitefield',
  'horse_markings_whitedots',
  'horse_markings_blackdots',
];
// 条件装备层：condition → 纹理。horse variantBits 24=鞍，25..27=铠甲材质。
const HORSE_EQUIPMENT = [
  ['horse_saddle', 'entity/equipment/horse_saddle/saddle'],
  ['horse_armor_1', 'entity/equipment/horse_body/leather'],
  ['horse_armor_2', 'entity/equipment/horse_body/copper'],
  ['horse_armor_3', 'entity/equipment/horse_body/iron'],
  ['horse_armor_4', 'entity/equipment/horse_body/gold'],
  ['horse_armor_5', 'entity/equipment/horse_body/diamond'],
  ['horse_armor_6', 'entity/equipment/horse_body/netherite'],
];
// 与 WorldSampler 的人形护甲材质 id 保持一致。turtle_scute 只有头盔。
const ARMOR_MATERIALS = [
  [1, 'leather'], [2, 'chainmail'], [3, 'iron'], [4, 'gold'],
  [5, 'diamond'], [6, 'netherite'], [7, 'turtle_scute'],
];

function armorSlotCondition(name, material) {
  if (name === 'head') return `armor_head_${material}`;
  if (name === 'body' || name === 'right_arm' || name === 'left_arm') return `armor_chest_${material}`;
  if (name === 'right_leg' || name === 'left_leg') return `armor_feet_${material}`;
  return null;
}

function armorLeggingsCondition(name, material) {
  if (name === 'body' || name === 'right_leg' || name === 'left_leg') return `armor_legs_${material}`;
  return null;
}

function armorOverlayTint(name) {
  if (name === 'head') return 'leather_head';
  if (name === 'body' || name === 'right_arm' || name === 'left_arm') return 'leather_chest';
  return 'leather_feet';
}

function armorLeggingsOverlayTint() {
  return 'leather_legs';
}
const SADDLE_OVERLAYS = {
  camel: 'entity/equipment/camel_saddle/saddle',
  donkey: 'entity/equipment/donkey_saddle/saddle',
  mule: 'entity/equipment/donkey_saddle/saddle',
};
const VILLAGER_TYPES = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga'];
const VILLAGER_PROFESSIONS = [
  'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher',
  'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith',
];
const VILLAGER_LEVELS = ['stone', 'iron', 'gold', 'emerald', 'diamond'];
const FOX_VARIANTS = [
  'entity/fox/fox', 'entity/fox/snow_fox',
  'entity/fox/fox_sleep', 'entity/fox/snow_fox_sleep',
];
const MOOSHROOM_VARIANTS = ['entity/cow/red_mooshroom', 'entity/cow/brown_mooshroom'];
const RABBIT_VARIANTS = [
  'brown', 'white', 'black', 'gold', 'salt', 'white_splotched', 'caerbannog', 'toast',
];
const LLAMA_VARIANTS = ['creamy', 'white', 'brown', 'gray'];
const LLAMA_SWAGS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
  'trader_llama',
];
const AXOLOTL_VARIANTS = ['lucy', 'wild', 'gold', 'cyan', 'blue'];
const PANDA_VARIANTS = [
  'panda', 'lazy_panda', 'worried_panda', 'playful_panda',
  'brown_panda', 'weak_panda', 'aggressive_panda',
];
const SHULKER_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
];
const FROG_VARIANTS = ['temperate_frog', 'warm_frog', 'cold_frog'];

function wolfTexture(variant, state) {
  const base = variant === 'pale'
    ? `minecraft:textures/entity/wolf/wolf${state ? '_' + state : ''}.png`
    : `minecraft:textures/entity/wolf/wolf_${variant}${state ? '_' + state : ''}.png`;
  return base;
}

function variantTexturesFor(idPath) {
  if (idPath === 'cat') {
    return CAT_VARIANTS.map(name => `minecraft:textures/entity/cat/${name}.png`);
  }
  if (idPath === 'wolf') {
    const out = [];
    for (const name of WOLF_VARIANTS) {
      out.push(wolfTexture(name, ''), wolfTexture(name, 'tame'), wolfTexture(name, 'angry'));
    }
    return out;
  }
  if (idPath === 'horse') {
    return HORSE_VARIANTS.map(name => `minecraft:textures/entity/horse/horse_${name}.png`);
  }
  if (idPath === 'parrot') {
    return PARROT_VARIANTS.map(name => `minecraft:textures/entity/parrot/parrot_${name}.png`);
  }
  if (idPath === 'fox') {
    return FOX_VARIANTS.map(path => `minecraft:textures/${path}.png`);
  }
  if (idPath === 'mooshroom') {
    return MOOSHROOM_VARIANTS.map(path => `minecraft:textures/${path}.png`);
  }
  if (idPath === 'rabbit') {
    return RABBIT_VARIANTS.map(name => `minecraft:textures/entity/rabbit/${name}.png`);
  }
  if (idPath === 'llama') {
    return LLAMA_VARIANTS.map(name => `minecraft:textures/entity/llama/${name}.png`);
  }
  if (idPath === 'axolotl') {
    return AXOLOTL_VARIANTS.map(name => `minecraft:textures/entity/axolotl/axolotl_${name}.png`);
  }
  if (idPath === 'panda') {
    return PANDA_VARIANTS.map(name => `minecraft:textures/entity/panda/${name}.png`);
  }
  if (idPath === 'shulker') {
    return SHULKER_COLORS.map(name => `minecraft:textures/entity/shulker/shulker_${name}.png`);
  }
  if (idPath === 'frog') {
    return FROG_VARIANTS.map(name => `minecraft:textures/entity/frog/${name}.png`);
  }
  if (idPath === 'tropical_fish') {
    return ['a', 'b'].map(shape => `minecraft:textures/entity/fish/tropical_${shape}.png`);
  }
  return null;
}

const models = {};
for (const file of metaFiles) {
  const meta = JSON.parse(fs.readFileSync(path.join(GEO_DIR, file), 'utf8'));
  const idPath = String(meta.id || '').replace(/^minecraft:/, '');
  if (!idPath) continue;
  const baseGeo = geoFiles.get(idPath);
  if (!baseGeo) {
    console.warn(`missing base geo for ${meta.id}`);
    continue;
  }
  const base = bakeGeometry(baseGeo, meta.base.texture, '#0');
  const pivots = { ...base.pivots };
  if (idPath === 'tropical_fish') {
    for (const part of base.parts) part.tint = 'tropical_base';
  }
  const layers = [];
  for (const layer of meta.layers || []) {
    const layerGeo = geoFiles.get(`${idPath}_${layer.name}`);
    if (!layerGeo) continue;
    const baked = bakeGeometry(layerGeo, layer.texture, layer.texture);
    Object.assign(pivots, baked.pivots);
    if (baked.parts.length) {
      const overlay = layerOverlay(layer.name);
      layers.push({
        name: layer.name,
        texture: layer.texture,
        texture_size: baked.texture_size,
        tint: overlay.tint,
        condition: overlay.condition,
        parts: baked.parts,
      });
    }
  }
  // Horse markings 是 base horse geometry + marking texture 的条件 overlay。
  if (idPath === 'horse') {
    HORSE_MARKINGS.forEach((file, i) => {
      const texture = `minecraft:textures/entity/horse/${file}.png`;
      const baked = bakeGeometry(baseGeo, texture, texture);
      Object.assign(pivots, baked.pivots);
      layers.push({
        name: `HorseMarkings_${i + 1}`,
        texture,
        texture_size: baked.texture_size,
        tint: null,
        condition: `horse_marking_${i + 1}`,
        parts: baked.parts,
      });
    });
    HORSE_EQUIPMENT.forEach(([condition, path]) => {
      const texture = `minecraft:textures/${path}.png`;
      const baked = bakeGeometry(baseGeo, texture, texture);
      Object.assign(pivots, baked.pivots);
      layers.push({
        name: condition,
        texture,
        texture_size: baked.texture_size,
        tint: null,
        condition,
        parts: baked.parts,
      });
    });
  }
  if (SADDLE_OVERLAYS[idPath]) {
    const texture = `minecraft:textures/${SADDLE_OVERLAYS[idPath]}.png`;
    const baked = bakeGeometry(baseGeo, texture, texture);
    Object.assign(pivots, baked.pivots);
    layers.push({
      name: 'Saddle',
      texture,
      texture_size: baked.texture_size,
      tint: null,
      condition: 'saddled',
      parts: baked.parts,
    });
  }
  if (idPath === 'tropical_fish') {
    for (const shape of [0, 1]) {
      for (let pattern = 0; pattern < 6; pattern++) {
        const texture = `minecraft:textures/entity/fish/tropical_${shape === 0 ? 'a' : 'b'}_pattern_${pattern + 1}.png`;
        const baked = bakeGeometry(baseGeo, texture, texture);
        Object.assign(pivots, baked.pivots);
        layers.push({
          name: `TropicalPattern_${shape}_${pattern}`,
          texture,
          texture_size: baked.texture_size,
          tint: 'tropical_pattern',
          condition: `tropical_pattern_${shape}_${pattern}`,
          parts: baked.parts,
        });
      }
    }
  }
  if (idPath === 'llama') {
    LLAMA_SWAGS.forEach((name, i) => {
      const texture = `minecraft:textures/entity/equipment/llama_body/${name}.png`;
      const baked = bakeGeometry(baseGeo, texture, texture);
      Object.assign(pivots, baked.pivots);
      layers.push({
        name: `LlamaSwag_${i + 1}`,
        texture,
        texture_size: baked.texture_size,
        tint: null,
        condition: `llama_swag_${i + 1}`,
        parts: baked.parts,
      });
    });
  }
  if (idPath === 'villager' || idPath === 'zombie_villager') {
    const addOverlay = (name, path, condition) => {
      const texture = `minecraft:textures/${path}.png`;
      const baked = bakeGeometry(baseGeo, texture, texture);
      Object.assign(pivots, baked.pivots);
      layers.push({ name, texture, texture_size: baked.texture_size, tint: null, condition, parts: baked.parts });
    };
    VILLAGER_TYPES.forEach((type, i) => addOverlay(`Type_${type}`, `entity/${idPath}/type/${type}`, `villager_type_${i + 1}`));
    VILLAGER_PROFESSIONS.forEach((prof, i) => addOverlay(`Profession_${prof}`, `entity/${idPath}/profession/${prof}`, `villager_profession_${i + 1}`));
    VILLAGER_LEVELS.forEach((level, i) => addOverlay(`Level_${level}`, `entity/${idPath}/profession_level/${level}`, `villager_level_${i + 1}`));
  }
  if (idPath === 'player' || idPath === 'player_slim') {
    const armorKey = idPath === 'player' ? 'player_armor' : 'player_slim_armor';
    const armorGeo = geoFiles.get(armorKey);
    const leggingsGeo = geoFiles.get(`${armorKey}_leggings`) || armorGeo;
    if (armorGeo) {
      for (const [material, name] of ARMOR_MATERIALS) {        const humanoidTexture = `minecraft:textures/entity/equipment/humanoid/${name}.png`;
        const humanoid = bakeGeometry(armorGeo, humanoidTexture, humanoidTexture);
        Object.assign(pivots, humanoid.pivots);
        const humanoidParts = humanoid.parts
          .map(part => ({ ...part, condition: armorSlotCondition(part.name, material) }))
          .filter(part => part.condition && (name !== 'turtle_scute' || part.name === 'head'));
        if (humanoidParts.length) {
          layers.push({
            name: `ArmorHumanoid_${name}`,
            texture: humanoidTexture,
            texture_size: humanoid.texture_size,
            tint: null,
            condition: null,
            parts: humanoidParts,
          });
        }
        if (name === 'leather') {
          const overlayTexture = 'minecraft:textures/entity/equipment/humanoid/leather_overlay.png';
          const overlay = bakeGeometry(armorGeo, overlayTexture, overlayTexture);
          layers.push({
            name: 'ArmorHumanoid_leather_overlay',
            texture: overlayTexture,
            texture_size: overlay.texture_size,
            tint: null,
            condition: null,
            parts: overlay.parts
              .map(part => ({
                ...part,
                condition: armorSlotCondition(part.name, material),
                tint: armorOverlayTint(part.name),
              }))
              .filter(part => part.condition),
          });
        }
        if (name === 'turtle_scute') continue;
        const leggingsTexture = `minecraft:textures/entity/equipment/humanoid_leggings/${name}.png`;
        const leggings = bakeGeometry(leggingsGeo, leggingsTexture, leggingsTexture);
        Object.assign(pivots, leggings.pivots);
        const leggingsParts = leggings.parts
          .map(part => ({ ...part, condition: armorLeggingsCondition(part.name, material) }))
          .filter(part => part.condition);
        if (leggingsParts.length) {
          layers.push({
            name: `ArmorLeggings_${name}`,
            texture: leggingsTexture,
            texture_size: leggings.texture_size,
            tint: null,
            condition: null,
            parts: leggingsParts,
          });
        }
        if (name === 'leather') {
          const overlayTexture = 'minecraft:textures/entity/equipment/humanoid_leggings/leather_overlay.png';
          const overlay = bakeGeometry(leggingsGeo, overlayTexture, overlayTexture);
          layers.push({
            name: 'ArmorLeggings_leather_overlay',
            texture: overlayTexture,
            texture_size: overlay.texture_size,
            tint: null,
            condition: null,
            parts: overlay.parts
              .map(part => ({
                ...part,
                condition: armorLeggingsCondition(part.name, material),
                tint: armorLeggingsOverlayTint(part.name),
              }))
              .filter(part => part.condition),
          });
        }
      }
    }
    const elytraGeo = geoFiles.get('player_elytra');
    if (elytraGeo) {
      const texture = 'minecraft:textures/entity/equipment/wings/elytra.png';
      const baked = bakeGeometry(elytraGeo, texture, texture);
      Object.assign(pivots, baked.pivots);
      layers.push({
        name: 'Elytra',
        texture,
        texture_size: baked.texture_size,
        tint: null,
        condition: 'armor_chest_8',
        parts: baked.parts,
      });
    }
  }
  models[idPath] = {
    format_version: 'generated-wgd-2',
    texture_size: base.texture_size,
    textures: { 0: meta.base.texture },
    variantTextures: variantTexturesFor(idPath),
    parts: base.parts,
    pivots,
    layers,
  };
}

const states = {};
for (const file of fs.readdirSync(STATES_DIR).filter(f => f.endsWith('.json'))) {
  states[file.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(STATES_DIR, file), 'utf8'));
}

const bundle = {
  version: 4,
  source: 'bedrock-geo (Blockbench)',
  generatedFrom: { models: Object.keys(models).length, states: Object.keys(states).length },
  models,
  states,
};

fs.writeFileSync(OUT, JSON.stringify(bundle));
console.log(`models ${Object.keys(models).length}, states ${Object.keys(states).length}`);
console.log(`-> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
