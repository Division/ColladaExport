var util = require('util');
var math = require('./math');

const SOURCE_JOINT = 'JOINT';
const SOURCE_INV_BIND_MATRIX = 'INV_BIND_MATRIX';
const SOURCE_WEIGHT = 'WEIGHT';
const MAX_JOINTS_PER_VERTEX = 3;

module.exports = class ColladaSkinning {

  constructor (root, opts = {}) {
    this.root = root;
    this.libraryControllers = this.root.library_controllers;

    this.jointsPerVertex = MAX_JOINTS_PER_VERTEX;

    this.controllers = {};
    this.controllersGeomID = {};

    if (this.libraryControllers) {
      let controllers = this.libraryControllers[0].controller || [];
      for (let i = 0; i < controllers.length; i++) {
        this.addController(controllers[i]);
      }
    }
  }

  addController (controller) {
    let id = controller.$.id;
    let skin = controller.skin && controller.skin[0];

    let controllerData = { id };

    if (!skin) {
      console.error('Skin not found for controller: ' + id);
      return;
    }

    let geometryID = skin.$.source.slice(1);
    controllerData.bindShapeMatrix = math.getMatrix4(skin.bind_shape_matrix[0]);

    let sourceMap = this.getSourceMap(skin.source);
    let inputsTotal = skin.joints[0].input.concat(skin.vertex_weights[0].input);
    let weights = null;

    // Getting joints and bind poses
    for (let i = 0; i < inputsTotal.length; i++) {
      let input = inputsTotal[i];
      let semantic = input.$.semantic;
      let source = input.$.source.slice(1);
      let sourceData = sourceMap[source];

      if (semantic === SOURCE_JOINT && !controllerData.jointNames) {
        let joints = sourceData.Name_array[0]._.split(' ');
        controllerData.jointNames = joints;
      }

      if (semantic === SOURCE_INV_BIND_MATRIX && !controllerData.bindPoses) {
        let bindPoses = math.getMatrix4Array(sourceData.float_array[0]._);
        controllerData.bindPoses = bindPoses;
      }

      if (semantic === SOURCE_WEIGHT) {
        weights = math.getFloatArray(sourceData.float_array[0]._);
      }
    }

    let vcount = skin.vertex_weights[0].vcount[0].split(' ').map(function (number) {
      return parseInt(number);
    });

    let vertexJoints = skin.vertex_weights[0].v[0].split(' ').map(function (number) {
      return parseInt(number);
    });

    controllerData.vertexWeights = this.getNormalizedWeights(vcount, vertexJoints, weights);
    controllerData.geometry = geometryID;

    this.controllers[id] = controllerData;
    this.controllersGeomID[geometryID] = controllerData;
  }

  getNormalizedWeights (vcount, vertexJoints, allWeights) {
    let vertexWeights = [];

    let currentIndex = 0;
    for (let i = 0; i < vcount.length; i++) {
      let count = vcount[i];
      let weights = [];
      for (let j = 0; j < count; j++) {
        let weightData = {};
        let weightValue = allWeights[vertexJoints[currentIndex + 1]]; // weight value
        weightData.jointIndex = vertexJoints[currentIndex]; // joint index
        weightData.weight = weightValue;
        currentIndex += 2;
        weights.push(weightData);
      }

      let normalizedWeights = this.normalizeWeights(weights);
      vertexWeights.push(this.getWeightArray(normalizedWeights));
    }

    return vertexWeights;
  }

  normalizeWeights (weights) {
    let oddCount = weights.length - this.jointsPerVertex;
    let result = weights;

    if (oddCount > 0) { // if weights count is more than max allowed - use maxumum weights
      weights.sort(function (a, b) {
        return a.weight - b.weight;
      });
      result = weights.slice(oddCount);
    }

    let len = result.reduce(function(summ, w) {
      return summ + w.weight;
    }, 0);

    for (let i = 0; i < result.length; i++) {
      result[i].weight /= len;
    }

    while(result.length < this.jointsPerVertex) { // Make all weight attributes length the same size
      result.push({ jointIndex: 0, weight: 0 });
    }

    return result;
  }

  getWeightArray (srcArray) {
    return srcArray.reduce(function (result, w) {
      result.push(w.jointIndex, w.weight);
      return result;
    }, []);
  }

  getSourceMap (sourceList) {
    return sourceList.reduce(function(result, source) {
      result[source.$.id] = source;
      return result;
    }, {});
  }

}