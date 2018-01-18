
var util = require('util');
var math = require('./math');

const EXPORT_MATRIX = false;

module.exports = class ColladaAnimation {

  constructor (root, opts = {}) {
    this.root = root;
    this.libraryAnimations = this.root.library_animations;
    this.exportMatrix = EXPORT_MATRIX;

    this.animations = {}; // Maps objectID -> animation
    this.skinning = null;

    this.byteSize = 0;

    if (this.libraryAnimations) {
      this.addAnimation(this.libraryAnimations[0].animation);
    }

    this.animationOrder = Object.keys(this.animations);
  }

  get hasAnimation () {
    return this.animationOrder.length > 0;
  }

  getJSON (idToName) {
    let animation = {};

    if (this.skinning) {
      animation.skinning = this.skinning;
    }

    animation.objects = this.animationOrder.reduce((result, objectName) => {
      let animationData = this.getAnimationForObject(objectName);
      animationData.name = idToName[objectName] || objectName;
      result.push(animationData);

      return result;
    }, []);

    return animation;
  }

  addSkinningData (name, data) {
    if (!this.skinning) {
      this.skinning = {};
    }

    this.skinning[name] = data;
  }

  addAnimation (animationList) {
    if (!animationList || !animationList.length) {
      return;
    }

    for (let i = 0; i < animationList.length; i++) {
      let animationData = animationList[i];
      let animationID = animationData.$.id;
      let samplers = this.getSamplers(animationData);
      let sources = this.getSources(animationData);
      let channels = this.getChannels(animationData);

      if (channels.length > 0) {
        // console.log('channels', util.inspect(channels, false, null));
        // console.log('samplers', util.inspect(samplers, false, null));
        // console.log('sources', util.inspect(sources, false, null));

        if (channels.length > 1) {
          throw new Error('Only 1 channel per animation is supported. ' + util.inspect(channels, false, null));
        }

        let channel = channels[0];
        let sampler = samplers[channel.source];
        let transforms = sources[sampler.outputSource];
        let time = sources[sampler.inputSource];
        let duration = time.array[time.array.length - 1];
        let fps = Math.round(time.array.length / duration);

        let animation = {
          duration, fps
        };

        this.addPosRotScale(transforms.array, animation, animationID);

        let animTarget = channel.target;

        if (this.animations[animTarget]) {
          throw new Error('Animation target already exists: ' + animTarget);
        }

        this.animations[animTarget] = animation;
      }

      if (animationData.animation) {
        this.addAnimation(animationData.animation);
      }
    }
  }

  hasAnimation (objectID) {
    return !!this.animations[objectID];
  }

  getAnimationData (objectName) {
    return this.animations[objectName].data;
  }

  getAnimationForObject (objectID) {
    let animation = this.animations[objectID];
    if (!animation) {
      return undefined;
    }

    return {
      duration: animation.duration,
      fps: animation.fps,
      frameCount: animation.frameCount,
      isMatrix: animation.isMatrix,
      hasPosition: animation.hasPosition,
      hasRotation: animation.hasRotation,
      hasScale: animation.hasScale
    }
  }

  addPosRotScale (matrixArray, animation, animationID) {
    let position = [];
    let rotation = [];
    let scale = [];
    let scaleList = []
    let matrices = [];
    let matrixList = [];

    let isMatrix = this.exportMatrix;

    if (matrixArray.length % 16 !== 0) {
      throw new Error('Matrix list has invalid size: ' + matrixArray.length);
    }

    let count = Math.floor(matrixArray.length / 16);

    for (let i = 0; i < count; i++) {
      let matrix = matrixArray.slice(i * 16, (i + 1) * 16);
      math.mat4transpose(matrix);

      matrixList.push(matrix);
      Array.prototype.push.apply(matrices, matrix);
      let pos = math.getMat4Translation(matrix);
      let s = math.getMat4Scaling(matrix);
      math.normalizeAxes(matrix);
      let rot = math.getMat4Rotation(matrix);
      scaleList.push(s);

      Array.prototype.push.apply(position, pos);
      Array.prototype.push.apply(rotation, rot);
      Array.prototype.push.apply(scale, s);
    }

    let firstScale = scaleList[0];
    let hasOtherScale = false;
    for (let i = 0; i < scaleList.length; i++) {
      if (!math.compare(firstScale, scaleList[i])) {
        hasOtherScale = true;
        break;
      }
    }

    let resultList = [];

    if (!isMatrix) {
      Array.prototype.push.apply(resultList, position);
      Array.prototype.push.apply(resultList, rotation);
      if (hasOtherScale) {
        Array.prototype.push.apply(resultList, scale);
      }
    } else {
      resultList = matrices;
    }

    this.byteSize += resultList.length * 4;
    animation.hasPosition = true && !isMatrix;
    animation.hasRotation = true && !isMatrix;
    animation.frameCount = count;
    animation.hasScale = hasOtherScale && !isMatrix;
    animation.isMatrix = isMatrix;
    animation.data = resultList;
  }

  getChannels (animation) {
    let result = [];

    if (animation.channel) {
      result = animation.channel.map(function (channel) {
        let source = channel.$.source.slice(1);
        let target = channel.$.target;
        let targetItems = target.split('/');
        if (targetItems.length !== 2) {
          throw new Error('Unsupported animation channel target' + target);
        }

        return {
          source,
          target: targetItems[0] // id of the animated object
        }
      });
    }

    return result;
  }

  getSources (animation) {
    let result = {};

    if (animation.source) {
      animation.source.reduce(function (prev, sourceData) {
        let id = sourceData.$.id;
        let source = {};
        if (sourceData.float_array) {
          let arrayString = sourceData.float_array[0]._;

          // Remove line breaks
          arrayString = arrayString.replace(/\n/g, " ");
          let array = arrayString.split(" ");

          // We need array of float
          for (let j = 0; j < array.length; j++) {
            array[j] = parseFloat(array[j]);
          }

          source.array = array;
        }

        result[id] = source;
      }, result);
    }

    return result;
  }

  getSamplers (animation) {
    let result = {};

    if (animation.sampler) {
      animation.sampler.reduce(function (prev, samplerData) {
        let id = samplerData.$.id;
        let sampler = {};

        let input = samplerData.input;
        for (let i = 0; i < input.length; i++) {
          let inputData = input[i];
          let semantic = inputData.$.semantic;
          if (semantic === 'OUTPUT') {
            sampler.outputSource = inputData.$.source.slice(1);
          }
          if (semantic === 'INPUT') {
            sampler.inputSource = inputData.$.source.slice(1);
          }
          // Skip INTERPOLATION, support LINEAR only
        }

        result[id] = sampler;
      }, result);
    }

    return result;
  }

}
