var util = require('util');
var math = require('./math');

const MODE_TRIANGLES = 'triangles';
const helperVec = [0, 0, 0];

module.exports = class ColladaGeometry {

  constructor (root, attributes, attribCount, skinning, config = {}) {
    this.root = root;
    this.colladaSkinning = skinning;
    this.geometriesData = this.root.library_geometries;
    this.attributes = attributes;
    this.attribCount = attribCount;
    this.config = config;

    this.byteSize = 0;
    this.geometryData = [];
    this.geometry = this.prepareGeometries();
    this.regenerateGeometries(this.geometry);
    this.geometryOrder = this.getGeometryBinaryObjectOrder(this.geometry);
  }

  prepareForExport () {
    this.json = [];
    this.geometryData = [];
    this.byteSize = 0;

    for (let i = 0; i < this.geometryOrder.length; i++) {
      let geomID = this.geometryOrder[i];
      let geomName = geomID; // may be changed in future
      let geom = this.geometry[geomID];
      let targetData = geom.targetData;

      let attribList = [];

      for (let i = 0; i < this.attributes.length; i++) {
        let attribName = this.attributes[i];

        if (this.config.includeAttribs[attribName] && geom.geomData[attribName]) {
          attribList.push(attribName);
        }
      }

      this.json.push({
        name: geomName,
        indexCount: targetData.indexCount,
        vertexCount: targetData.vertexCount,
        attributes: attribList,
        caps: geom.caps
      });

      let data = {
        indices: targetData.indices,
        vertices: this.getTargetFloatArray(geom)
      };

      this.byteSize += data.indices.length * 2 + data.vertices.length * 4;

      this.geometryData.push(data);
    }
  }

  getJSON () {
    return this.json;
  }

  prepareGeometries () {
    let result = null;

    let geomData = this.geometriesData[0].geometry;
    if (geomData && geomData.length) {
      result = {};
      // Loop through all geometries
      for (let i = 0; i < geomData.length; i++) {
        let geom = geomData[i];
        let geomID = geom.$.id;
        let geomName = geom.$.name;
        result[geomID] = {
          id: geomID,
          name: geomName,
          caps: {},
          geomData: this.getGeometryData(geom)
        };
      }
    }

    return result;
  }

  // Appending geometry data from mesh entity
  // - mesh
  // - - source (array of vertex data such as positions, normals, uv)
  // - - vertices (list of attrubute bingings to the source)
  // - - triangles (similar binding list but contains indexes and offset for each source.
  //                May also have reference to the vertices data set)
  getGeometryData (geomData) {
    let result = {};

    let meshData = geomData.mesh[0];
    let meshSource = meshData.source;
    let vertices = meshData.vertices[0];

    if (!meshData.triangles) {
      throw new Error('Only triangles mesh supported');
    }

    let triangles = meshData.triangles[0];
    let stride = triangles.input.length;

    if (meshData.vertices.length > 1) {
      throw new Error('Multiple mesh.vertices not supported');
    }

    let sources = {};

    function appendInputSource (input, defaultOffset = 0) {
      for (let i = 0; i < input.length; i++) {
        let inputData = input[i].$;
        let semantic = inputData.semantic;

        let offset = inputData.offset;
        if (offset === undefined) {
          offset = defaultOffset;
        }

        if (semantic === 'VERTEX') {
          appendInputSource(vertices.input, offset);
          continue;
        };

        let source = inputData.source.slice(1); // skip leading #
        if (inputData.set !== undefined) {
          semantic += inputData.set;
        }

        sources[semantic] = {
          source: source,
          offset: parseInt(offset)
        };
      }
    }

    appendInputSource(triangles.input);

    for (let semantic in sources)  {
      let source = sources[semantic];
      let arrayID = source.source;
      let offset = source.offset;

      result[semantic] = {
        data: this.getGeometryArray(arrayID, meshSource),
        offset: offset
      }
    }

    let indices = triangles.p[0].split(" ");
    for (let i = 0; i < indices.length; i++) {
      indices[i] = parseInt(indices[i]);
    }

    result.indices = indices;
    result.stride = stride;
    result.triangleCount = parseInt(triangles.$.count);
    result.renderMode = MODE_TRIANGLES;

    return result;
  }

  getGeometryArray (arrayID, meshSource) {
    for (let i = 0; i < meshSource.length; i++) {
      let sourceData = meshSource[i];
      let id = sourceData.$.id;
      if (id !== arrayID) continue;

      let arrayString = sourceData.float_array[0]._;

      // Remove line breaks
      arrayString = arrayString.replace(/\n/g, " ");
      let array = arrayString.split(" ");

      // We need array of float
      for (let j = 0; j < array.length; j++) {
        array[j] = parseFloat(array[j]);
      }
      return array;
    }

    return [];
  }

  getGeometryBinaryObjectOrder (geometryData) {
    let result = [];

    for (let id in geometryData) {
      result.push(id);
    }

    return result;
  }

  regenerateGeometries (geometryData) {
    for (let id in geometryData) {
      let geom = geometryData[id];
      geom.targetData = this.regenerateMesh(geom.geomData, geom.id);
    }
  }

  // Mesh needs to use a single set of indices for all the vertex data
  regenerateMesh (meshData, geomID) {
    let indices = [];
    let vertices = [];
    let hasSkinning = !!this.colladaSkinning.controllersGeomID[geomID];

    let indexCount = meshData.indices.length / meshData.stride;

    let stride = meshData.stride;
    let currentIndex = 0;

    for (let i = 0; i < indexCount; i++) {
      let vertex = {}; // each vertex should be unique instance
      let index = i * stride;

      this.assignVertexAttribs(meshData, meshData.indices, index, vertex);

      if (hasSkinning) {
        this.assignWeights(vertex, meshData, index, geomID); // If it's a skinned mesh, weights will be added
      }

      // Searching for the vertex with similar attributes
      let vertexIndex = this.findVertexIndex(vertices, vertex);

      if (vertexIndex === -1) { // Not found - create new vertex
        vertexIndex = currentIndex++;
        vertices.push(vertex);
      }

      indices.push(vertexIndex);
    }

    indices = new Uint16Array(indices);

    if (hasSkinning) {
      meshData['WEIGHT'] = true; // Adding WEIGHT key to the geomData to write it into the file
    }

    let result = {
      vertices,
      indices,
      indexCount: indices.length,
      vertexCount: vertices.length
    };

    this.postProcessMesh(result, meshData, geomID);

    return result;
  }

  postProcessMesh (mesh, meshData, geomID) {
    let vertices = mesh.vertices;

    // Flip UV.y
    for (let i = 0; i < vertices.length; i++) {
      let texcoord = vertices[i]['TEXCOORD0'];
      if (texcoord) {
        texcoord[1] = 1 - texcoord[1];
      }

      texcoord = vertices[i]['TEXCOORD1'];
      if (texcoord) {
        texcoord[1] = 1 - texcoord[1];
      }
    }

    // Premultiply with bind shape matrix (for skinned meshes)
    let controller = this.colladaSkinning.controllersGeomID[geomID];
    if (controller) {
      for (let i = 0; i < vertices.length; i++) {
        let position = vertices[i]['POSITION'];
        math.vec3TransformMat4(position, position, controller.bindShapeMatrix);
      }
    }
  }

  findVertexIndex (vertices, vertex) {
    for (let i = 0; i < vertices.length; i++) {
      let currentVertex = vertices[i];

      let found = true;

      for (let attribName in vertex) {
        if (!math.compare(vertex[attribName], currentVertex[attribName])) {
          found = false;
          break;
        }
      }

      if (found) {
        return i;
      }
    }

    return -1;
  }

  getTargetFloatArray (geom) {
    // Getting stride
    let stride = 0;
    let targetData = geom.targetData;
    let vertices = targetData.vertices;
    let result = [];

    for (let n = 0; n < this.attributes.length; n++) {
      let attrib = this.attributes[n];

      if (!this.config.includeAttribs[attrib]) continue;
      let count = this.attribCount[attrib];

      if (this.config.includeAttribs[attrib] && geom.geomData[attrib]) {
        for (let i = 0; i < vertices.length; i++) {
          let vertex = vertices[i];
          if (!vertex[attrib]) break;

          for (let k = 0; k < count; k++) {
            result.push(vertex[attrib][k]);
          }
        }
      }
    }

    return result;
  }

  assignVertexAttribs (meshData, indices, firstIndex, result) {
    for (let i = 0; i < this.attributes.length; i++) {
      let attribName = this.attributes[i];

      if (meshData[attribName]) {
        let data = [];
        let index = indices[firstIndex + meshData[attribName].offset];
        let count = this.attribCount[attribName];

        for (let j = 0; j < count; j++) {
          data.push(meshData[attribName].data[index * count + j]);
        }
        result[attribName] = data;
      }
    }
  }

  assignWeights (vertex, meshData, index, geomID) {
    let controller = this.colladaSkinning.controllersGeomID[geomID];
    if (!controller) {
      return;
    }

    let weightIndex = meshData.indices[index + meshData['POSITION'].offset];

    let weights = controller.vertexWeights[weightIndex];
    if (!weights) {
      throw new Error('Weights not found for vertex');
    }

    vertex['WEIGHT'] = weights;
  }

}
