var util = require('util');
var math = require('./math');

const TYPE_JOINT = 'JOINT';
const EXPORT_MATRIX = false;

module.exports = class ColladaHierarchy {

  constructor (root, material, geometry, skinning, animation, opts = {}) {
    this.opts = opts;
    this.colladaGeometry = geometry;
    this.colladaMaterial = material;
    this.colladaSkinning = skinning;
    this.colladaAnimation = animation;
    this.geometry = this.colladaGeometry.geometry;
    this.root = root;
    this.visualScenesData = this.root.library_visual_scenes;
    let scene = this.visualScenesData[0].visual_scene[0];

    this.idToNameMap = {};
    this.hierarchy = {};
    this.objectsWithSkinning = [];
    this.jointHierarchies = {};
    this.buildObjectHierarchy(this.hierarchy, scene);

    this.appendJointsToAnimation();

    // console.info('Obj sk', this.objectsWithSkinning);
    // console.info('Jnts', this.jointHierarchies);
  }

  buildObjectHierarchy (object, data) {
    let type = data.$.type;
    if (type === TYPE_JOINT) {
      this.addJoint(data);
      return false;
    }

    object.id = data.$.id;
    object.name = data.$.name;
    object.transform = this.getObjectTransform(data);
    object.geometry = this.getObjectGeometryID(data);
    let materialID = this.opts.includeMaterial && this.getObjectMaterialID(data);
    object.material = this.colladaMaterial.getMaterial(materialID);

    let skinningController = data.instance_controller && data.instance_controller[0];
    if (skinningController) {
      let controllerID = skinningController.$.url.slice(1); // skip first # character
      let controllerData = this.colladaSkinning.controllers[controllerID];

      object.isSkinnedMesh = true;
      this.geometry[object.geometry].caps.skinning = true;
      this.objectsWithSkinning.push({ controllerData, object });
    }

    this.idToNameMap[object.id] = object.name;

    // Adding bump to caps
    if (object.material && object.material.bump && object.geometry) {
      this.geometry[object.geometry].caps.bump = true;
    }

    let dataChildren = data.node;
    if (dataChildren) {
      object.children = [];
      for (let i = 0; i < dataChildren.length; i++) {
        let childData = dataChildren[i];
        let child = {};
        if (this.buildObjectHierarchy(child, childData)) {
          object.children.push(child);
        }
      }
    }

    return true;
  }

  addJoint (data) {
    let joint = {};
    this.buildJointHierarchy(joint, data);
    let key = joint.name;

    if (this.jointHierarchies[key]) {
      throw new Error('Joint ID already exists: ' + key);
    }

    this.jointHierarchies[key] = joint;
  }

  buildJointHierarchy (joint, data) {
    let type = data.$.type;
    if (type !== TYPE_JOINT) {
      throw new Error('Joint child has invalid type: ' + type);
    }

    joint.id = data.$.id;
    joint.name = data.$.name;
    joint.transform = this.getObjectTransform(data);

    this.idToNameMap[joint.id] = joint.name;

    let jointChildren = data.node;
    if (jointChildren) {
      joint.children = [];
      for (let i = 0; i < jointChildren.length; i++) {
        let childData = jointChildren[i];
        let childJoint = {};
        joint.children.push(childJoint);
        this.buildJointHierarchy(childJoint, childData);
      }
    }
  }

  appendJointsToAnimation () {
    this.setupControllersFirstJoint();

    for (let i = 0; i < this.objectsWithSkinning.length; i++) {
      let { object, controllerData } = this.objectsWithSkinning[i];
      let skinningData = {
        jointNames: controllerData.jointNames,
        bindPoses: controllerData.bindPoses,
        joints: this.jointHierarchies[controllerData.firstJointName]
      };

      this.colladaAnimation.addSkinningData(object.name, skinningData);
    }
  }

  setupControllersFirstJoint () {
    for (let i = 0; i < this.objectsWithSkinning.length; i++) {
      let { controllerData } = this.objectsWithSkinning[i];
      for (let key in this.jointHierarchies) {
        if (controllerData.jointNames.indexOf(key) !== -1) {
          controllerData.firstJointName = key;
          break;
        }
      }
    }
  }

  getObjectTransform (data) {
    let matrix = data.matrix;
    if (!matrix) {
      return null;
    }

    return math.getMatrix4(matrix[0]._);
  }

  getObjectGeometryID (data) {
    let result = null;

    let geometry = data.instance_geometry;
    let controller = data.instance_controller;

    if (geometry) {
      result = geometry[0].$.url.slice(1); // skip first # character
    }

    if (controller) {
      let controllerID = controller[0].$.url.slice(1); // skip first # character
      let controllerData = this.colladaSkinning.controllers[controllerID];
      result = controllerData.geometry;
    }

    return result;
  }

  getObjectSkinningControllerID (data) {
    let controller = data.instance_controller;
    if (!controller) {
      return null;
    }

    return controller[0].$.url.slice(1); // skip first # character
  }

  getObjectMaterialID (data) {
    let geometry = data.instance_geometry || data.instance_controller;
    if (!geometry) {
      return null;
    }

    let result = null;

    try {
      let instanceMaterial = geometry[0].bind_material[0].technique_common[0].instance_material[0];
      result = instanceMaterial.$.target.slice(1);
    } catch (e) {
      // no material
    }

    return result;
  }

}