/**
 * Class: Vector_Provider
 * Description: Provides textures from a vector data
 */


import * as THREE from 'three';
import togeojson from 'togeojson';
import Extent from '../../Geographic/Extent';
import GeoJSON2Texture from '../../../Renderer/ThreeExtended/GeoJSON2Texture';
import GeoJSON2Three from '../../../Renderer/ThreeExtended/GeoJSON2Three';

function Vector_Provider() {
}

Vector_Provider.prototype.url = function url(bbox, layer) {
    const box = bbox.as(layer.projection);
    const w = box.west();
    const s = box.south();
    const e = box.east();
    const n = box.north();

    const bboxInUnit = layer.axisOrder === 'swne' ?
        `${s},${w},${n},${e}` :
        `${w},${s},${e},${n}`;

    return layer.customUrl.replace('%bbox', bboxInUnit);
};

Vector_Provider.prototype.preprocessDataLayer = function preprocessDataLayer(layer) {
    if (!layer.file) {
        throw new Error('layer.file is required.');
    }
    if (!layer.extent) {
        throw new Error('layer.extent is required');
    }
    if (!layer.projection) {
        throw new Error('layer.projection is required');
    }

    if (!(layer.extent instanceof Extent)) {
        layer.extent = new Extent(layer.projection, layer.extent);
    }

    if (!layer.options.zoom) {
        layer.options.zoom = { min: 0, max: 21 };
    }

    layer.format = layer.options.mimetype || 'vector/kml';
    layer.style = layer.style || '';

    if (layer.options.mimetype === 'vector/kml') {
        layer.geojson = GeoJSON2Three.parse('EPSG:4326', togeojson.kml(layer.file), layer.extent, false);
    }
};

Vector_Provider.prototype.tileInsideLimit = function tileInsideLimit(tile, layer) {
    return tile.level >= layer.options.zoom.min && tile.level <= layer.options.zoom.max && layer.extent.intersect(tile.extent);
};

Vector_Provider.prototype.getColorTexture = function getColorTexture(tile, layer) {
    if (!this.tileInsideLimit(tile, layer)) {
        return Promise.reject(`Tile '${tile}' is outside layer bbox ${layer.extent}`);
    }
    if (tile.material === null) {
        return Promise.resolve();
    }

    if (layer.type == 'color') {
        const coords = tile.extent.as(layer.projection);
        const pitch = new THREE.Vector3(0, 0, 1);
        const result = { pitch };
        result.texture = GeoJSON2Texture.getTextureFromGeoson(layer.geojson, tile.extent, 256);
        result.texture.extent = tile.extent;
        result.texture.coords = coords;
        result.texture.coords.zoom = tile.level;
        return Promise.resolve(result);
    } else {
        return Promise.resolve();
    }
};

Vector_Provider.prototype.executeCommand = function executeCommand(command) {
    const tile = command.requester;

    const layer = command.layer;
    const supportedFormats = {
        'vector/kml': this.getColorTexture.bind(this),
    };

    const func = supportedFormats[layer.format];

    if (func) {
        return func(tile, layer);
    } else {
        return Promise.reject(new Error(`Unsupported mimetype ${layer.format}`));
    }
};

export default Vector_Provider;
