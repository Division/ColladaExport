// Converts collada format into internal game engine format
// Format description:
// * 2 bytes - length of the JSON utf-8 string that represents the file header
// * length bytes of the JSON file header
// * binary mesh data as described in the JSON header

var util = require('util');
var fs = require('fs');
var xml2js = require('xml2js');
var path = require('path');
var math = require('./includes/math');

var ColladaGeometry = require('./includes/collada-geometry');
var ColladaMaterial = require('./includes/collada-material');
var ColladaAnimation = require('./includes/collada-animation');
var ColladaSkinning = require('./includes/collada-skinning');
var ColladaHierarchy = require('./includes/collada-hierarchy');
var ColladaLighting = require('./includes/collada-lighting');

const MODEL_EXTENSION = '.mdl';
const SKIP_BINARY = '-skip-binary';
const SUB_ANIM = '-sub-anim';

const PARAMS = {
  [SKIP_BINARY]: true,
  [SUB_ANIM]: true
};

var args = process.argv.splice(process.execArgv.length + 2);
var dataFile = args[0];
var otherArgsMap = args.slice(1).reduce((result, val ) => (result[val] = true, result), {});
var data = fs.readFileSync(dataFile, 'utf8');
var fileDir = path.dirname(dataFile);
var fileExtension = path.extname(dataFile);
var baseName = path.basename(dataFile, fileExtension);
var targetFile = path.join(fileDir, baseName + MODEL_EXTENSION);

for (var key in otherArgsMap) {
  if (!PARAMS[key]) {
    throw new Error('Unknown param: ' + key + '. Allowed params: ' + Object.keys(PARAMS).join(', '));
  }
}

console.info(dataFile, targetFile, otherArgsMap);

class ColladaConvert {

    constructor (data, opts = {}) {
      this.fileDir = opts.directory;

      // Setup
      this.attributes = ['POSITION', 'NORMAL', 'TEXCOORD0', 'TEXCOORD1', 'WEIGHT'];
      this.attribCount = { 'POSITION': 3, 'NORMAL': 3, 'TEXCOORD0': 2, 'TEXCOORD1': 2, 'WEIGHT': 6 };

      this.config = { includeAttribs: {}, includeBinary: !opts[SKIP_BINARY], isSubAnimation: opts[SUB_ANIM] };

      this.includeAttribs = {};
      for (let i = 0; i < this.attributes.length; i++) {
        this.config.includeAttribs[this.attributes[i]] = true;
      }
      this.config.includeGeometry = this.config.includeBinary && !this.config.isSubAnimation;
      this.config.includeAnimation = this.config.includeBinary;
      this.config.includeHierarchy = !this.config.isSubAnimation;
      this.config.includeMaterial = !this.config.isSubAnimation;

      if (opts.includeGeometry === false) this.config.includeGeometry = false;
      if (opts.includeAnimation === false) this.config.includeAnimation = false;
      if (opts.includeHierarchy === false) this.config.includeHierarchy = false;
      if (opts.includeMaterial === false) this.config.includeMaterial = false;
      if (opts.includeNormals === false) this.config.includeAttribs['NORMAL'] = false;
      if (opts.includeUV === false) {
        this.config.includeAttribs['TEXCOORD0'] = false;
        this.config.includeAttribs['TEXCOORD1'] = false;
      }

      Object.assign(opts, this.config);

      this.root = data.COLLADA;
      this.geometriesData = this.root.library_geometries;
      this.visualScenesData = this.root.library_visual_scenes;

      // Material, animation
      this.colladaMaterial = new ColladaMaterial(this.root, opts);
      this.colladaAnimation = new ColladaAnimation(this.root, opts);
      this.colladaSkinning = new ColladaSkinning(this.root, opts);
      this.colladaLighting = new ColladaLighting(this.root, opts);
      this.colladaGeometry = new ColladaGeometry(this.root, this.attributes, this.attribCount, this.colladaSkinning, this.config);
      this.colladaHierarchy = new ColladaHierarchy(
        this.root,
        this.colladaMaterial,
        this.colladaGeometry,
        this.colladaSkinning,
        this.colladaAnimation,
        this.colladaLighting,
        opts
      );
      this.idToNameMap = this.colladaHierarchy.idToNameMap;

      // console.log(util.inspect(geometryData, false, null))
    }

    //------------------------------------------------------------------------
    // Writing data
    //------------------------------------------------------------------------

    writeData (outputFile) {
      let writeStream = fs.createWriteStream(outputFile);

      let jsonData = {};

      if (this.config.includeGeometry) {
        this.colladaGeometry.prepareForExport();
        jsonData.geometry = this.colladaGeometry.getJSON();
      }

      jsonData.lights = this.colladaLighting.getJSON();

      if (this.config.includeHierarchy) {
        jsonData.hierarchy = this.colladaHierarchy.hierarchy;
      }

      let animationData = [];
      if (this.config.includeAnimation && this.colladaAnimation.hasAnimation) {
        jsonData.animation = this.colladaAnimation.getJSON(this.idToNameMap);
        for (let i = 0; i < this.colladaAnimation.animationOrder.length; i++) {
          let animName = this.colladaAnimation.animationOrder[i];
          let dataArray = this.colladaAnimation.getAnimationData(animName);
          animationData.push(dataArray);
        }
      }

      // console.log('data', util.inspect(jsonData, false, null));

      let jsonString = JSON.stringify(jsonData);
      let jsonLength = Buffer.byteLength(jsonString);
      let bufferSize = 4 + jsonLength;
      if (this.config.includeBinary) {
        bufferSize += this.colladaGeometry.byteSize + this.colladaAnimation.byteSize
      }

      let buffer = new Buffer(bufferSize);
      let currentOffset = 0;

      buffer.writeUInt32BE(jsonLength, currentOffset);
      currentOffset += 4;

      buffer.write(jsonString, currentOffset, jsonLength);
      currentOffset += jsonLength;

      if (this.config.includeBinary) {
        // Writing geometry
        let geometryData = this.colladaGeometry.geometryData;
        for (let i = 0; i < geometryData.length; i++) {
          currentOffset += this.writeUIntArray(buffer, currentOffset, geometryData[i].indices);
          currentOffset += this.writeFloatArray(buffer, currentOffset, geometryData[i].vertices);
        }

        // Writing animations
        for (let i = 0; i < animationData.length; i++) {
          currentOffset += this.writeFloatArray(buffer, currentOffset, animationData[i]);
        }
      }
      writeStream.write(buffer);
      writeStream.end();
    }

    writeFloatArray(buffer, start, array) {
      for (let i = 0; i < array.length; i++) {
        buffer.writeFloatBE(array[i], start + i * 4);
      }

      return array.length * 4;
    }

    writeUIntArray(buffer, start, array) {
      for (let i = 0; i < array.length; i++) {
        buffer.writeUInt16BE(array[i], start + i * 2);
      }

      return array.length * 2;
    }
  }

let parser = new xml2js.Parser({
  trim: true
});

parser.parseString(data, function (err, result) {
  new ColladaConvert(result, Object.assign({
    directory: fileDir,
  }, otherArgsMap)).writeData(targetFile);
});
