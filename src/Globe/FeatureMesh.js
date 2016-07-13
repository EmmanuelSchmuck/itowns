/**
 * Generated On: 2016-05-27
 * Class: FeatureMesh
 * Description: Tuile correspondant à un layer à poser au dessus des tuiles de terrains.
 */

define('Globe/FeatureMesh', [
	'Renderer/NodeMesh',
	'Scene/BoundingBox',
	//'Renderer/VaryingColorMaterial',
	'Renderer/FeatureMaterial',
	'THREE'
], function(NodeMesh, BoundingBox, FeatureMaterial, THREE) {

	function FeatureMesh(params, builder) {

		NodeMesh.call(this);

		this.material = new FeatureMaterial();

		this.builder = builder;

		this.center = this.builder.Center(params);
        this.OBBParam = this.builder.OBB(params);

		this.bboxId = params.id;
		this.bbox 	= params.bbox;

		this.box3D 	= new THREE.Box3(new THREE.Vector3(params.bbox.minCarto.longitude, params.bbox.minCarto.latitude, params.bbox.minCarto.altitude),
									new THREE.Vector3(params.bbox.maxCarto.longitude, params.bbox.maxCarto.latitude, params.bbox.maxCarto.altitude));
		this.centerSphere = new THREE.Vector3();
		this.level 	= params.level;
		this.geometricError = ((params.bbox[3] - params.bbox[0]) + (params.bbox[4] - params.bbox[1])) / 100;

		this.updateGeometry = true;
		this.cullable = true;
	}

	FeatureMesh.prototype = Object.create(NodeMesh.prototype);
	FeatureMesh.prototype.constructor = FeatureMesh;

	FeatureMesh.prototype.OBB = function() {
        return this.OBBParam;
    };

	FeatureMesh.prototype.enablePickingRender = function(enable) {
        this.material.enablePickingRender(enable);
    };

	FeatureMesh.prototype.setGeometry = function(geometry) {

		this.geometry = geometry;
		this.updateGeometry = false;
		//Rotate mesh

	}

	FeatureMesh.prototype.getStatus = function() {

		var status = [];
		if(this.updateGeometry)
			status.push("geometry");
		return status;
	}

	FeatureMesh.prototype.ready = function() {
		return !this.updateGeometry;
	}

	FeatureMesh.prototype.setMatrixRTC = function(rtc) {
		this.material.setMatrixRTC(rtc);
	}

	FeatureMesh.prototype.setFog = function(fog) {
		this.material.setFogDistance(fog);
	}

	FeatureMesh.prototype.setWireframed = function() {
		this.material.wireframe = true;
		this.material.wireframeLineWidth = 20;
		this.material.linewidth = 20;
	}

	return FeatureMesh;
});
