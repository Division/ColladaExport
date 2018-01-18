var util = require('util');

const RELATIVE_DIR = 'resources';
const SHADER_TYPES = ['blinn', 'lambert', 'phong', 'constant'];

var path = require('path');

module.exports = class ColladaMaterial {

  constructor (root, opts = {}) {
    this.fileDir = opts.directory;
    this.root = root;
    this.libraryMaterials = this.root.library_materials;
    this.libraryImages = this.root.library_images;
    this.libraryEffects = this.root.library_effects;

    this.images = null;
    this.materials = null;
    this.effects = null;

    if (this.libraryEffects) {
      this.addEffects(this.libraryEffects[0].effect);
    }

    if (this.libraryImages) {
      this.addImages(this.libraryImages[0].image);
    }

    if (this.libraryMaterials) {
      this.addMaterials(this.libraryMaterials[0].material);
    }
  }

  addEffects (effectList) {
    this.effects = {};
    for (let i = 0; i < effectList.length; i++) {
      let effectData = effectList[i];
      let id = effectData.$.id;
      let profileCommon = effectData.profile_COMMON;

      // console.log('tec', util.inspect(technique, false, null));

      if (!profileCommon) {
        throw new Error('Only profile_COMMON is supported for effects. Effect ID: ' + id);
      }

      let technique = profileCommon[0].technique;

      let shader = null;
      let shaderType = null;
      for (let j = 0; j < SHADER_TYPES.length; j++) {
        shaderType = SHADER_TYPES[j];
        shader = technique[0][shaderType];
        if (shader) { break };
      }

      if (!shader) {
        throw new Error('Shader not found. Effect ID: ' + id);
      }

      shader = shader[0];

      let effect = { shaderType };
      this.addEffectsParams(effect, profileCommon[0]);
      this.addMaterialTextures(effect, shader, 'diffuse');
      this.addBump(effect, technique[0].extra);

      this.effects[id] = effect;
    }
  }

  addMaterialTextures (effect, shader, effectName) {
    try {

      let data = shader[effectName][0];
      let texture = data.texture[0].$.texture;
      let texcoord = data.texture[0].$.texcoord;

      if (effect.samplers[texture]) {
        texture = effect.samplers[texture];
      }

      if (effect.surfaces[texture]) {
        texture = effect.surfaces[texture];
      }

      effect[effectName] = [
        { texture, texcoord }
      ];
    } catch (e) {
      console.info('Texture effect not found: ', effectName);
      // no diffuse
    }
  }

  addEffectsParams (effect, data) {
    let newparam = data.newparam;
    if (newparam) {
      effect.surfaces = {};
      effect.samplers = {};
      for (let i = 0; i < newparam.length; i++) {
        let param = newparam[i];
        let id = param.$.sid;

        if (param.surface) {
          effect.surfaces[id] = param.surface[0].init_from[0];
        } else if (param.sampler2D) {
          effect.samplers[id] = param.sampler2D[0].source[0];
        }
      }
    }
  }

  addBump (effect, techniqueExtra) {
    if (!techniqueExtra) {
      return;
    }

    try {
      let technique = techniqueExtra[0].technique;
      for (let i = 0; i < technique.length; i++) {
        this.addMaterialTextures(effect, technique[i], 'bump');
      }
    } catch (e) {

      throw e;
      // No bump
    }
  }

  addMaterials (materialList) {
    this.materials = {};
    for (let i = 0; i < materialList.length; i++) {
      let materialData = materialList[i];
      let id = materialData.$.id;
      let instance_effect = materialData.instance_effect[0].$.url.slice(1);

      let effect = this.effects[instance_effect];
      if (!effect) {
        throw new Error('Material effect not found: ' + instance_effect);
      }

      let material = {};
      if (effect.diffuse) {
        material.diffuse = effect.diffuse.map((effect) => {
          return {
            texture: this.images[effect.texture],
            texcoord: effect.texcoord
          };
        });
      }

      if (effect.bump) {
        material.bump = effect.bump.map((effect) => {
          return {
            texture: this.images[effect.texture],
            texcoord: effect.texcoord
          };
        });
      }

      this.materials[id] = material;
    }
  }

  addImages (imageList) {
    this.images = {};
    for (let i = 0; i < imageList.length; i++) {
      let imageData = imageList[i];
      let id = imageData.$.id;
      this.images[id] = this.getRelativeImageName(imageData.init_from[0]);
    }
  }

  getRelativeImageName (name) {
    let absolutePath = path.resolve(this.fileDir, name);
    let index = absolutePath.indexOf(RELATIVE_DIR);
    let result = absolutePath;
    if (index !== -1) { // Relative path that includes RELATIVE_DIR
      // e.g. resources/models/character/character.jpg
      result = absolutePath.substring(index);
    }
    return result;
  }

  getMaterial (materialID) {
    return this.materials[materialID] || null;
  }

}