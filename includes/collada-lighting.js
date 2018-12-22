module.exports = class ColladaLighting {

  constructor (root, opts = {}) {
    this.fileDir = opts.directory;
    this.root = root;
    this.libraryLights = this.root.library_lights;

    this.lights = {};

    if (this.libraryLights) {
      this.addLights(this.libraryLights[0].light);
    }
  }

  addLights (lightList) {
    if (!lightList) {
      return;
    }

    for (let i = 0; i < lightList.length; i++) {
      let lightData = lightList[i];
      let id = lightData.$.id;
      let techniqueCommon = lightData.technique_common[0];
      let point = techniqueCommon.point && techniqueCommon.point[0];
      let spot = techniqueCommon.spot && techniqueCommon.spot[0];

      var light = point || spot;
      if (!light) { continue; }

      var data = {
        id, color: light.color[0].split(' ').map((val) => parseInt(val))
      }

      if (point) {
        data.type = 'point';
      }

      if (spot) {
        data.type = 'spot';
        data.coneAngle = parseFloat(spot.falloff_angle[0])
      }

      this.lights[id] = data;
    }
  }

  getJSON () {
    let result = [];

    for (var key in this.lights) {
      result.push(this.lights[key]);
    }

    if (!result.length) {
      return undefined;
    } else {
      return result;
    }
  }

}