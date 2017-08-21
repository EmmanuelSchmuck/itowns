import * as THREE from 'three';
import { UNIT } from '../../Core/Geographic/Coordinates';

const pt = new THREE.Vector2();

function drawPolygon(ctx, vertices, origin, dimension, properties) {
    if (vertices.length === 0) {
        return;
    }

    const scale = ctx.canvas.width / dimension.x;
    ctx.beginPath();
    pt.subVectors(vertices[0], origin).multiplyScalar(scale);
    ctx.moveTo(pt.x, pt.y);
    vertices.shift();

    for (const vertice of vertices) {
        pt.subVectors(vertice, origin).multiplyScalar(scale);
        ctx.lineTo(pt.x, pt.y);
    }

    if (properties.fill) {
        ctx.closePath();
        ctx.fillStyle = properties.fill;
        ctx.globalAlpha = properties['fill-opacity'];
        ctx.fill();
    }

    if (properties.stroke) {
        ctx.strokeStyle = properties.stroke;
        ctx.lineWidth = properties['stroke-width'];
        ctx.globalAlpha = properties['stroke-opacity'];
        ctx.stroke();
    }
}

function drawPoint(ctx, vertices, origin, dimension) {
    if (vertices.length === 0) {
        return;
    }

    const scale = ctx.canvas.width / dimension.x;

    pt.subVectors(vertices[0], origin).multiplyScalar(scale);

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'red';
    ctx.stroke();
}

export default {
    getTextureFromGeoson(collections, extent, sizeTexture) {
        const origin = new THREE.Vector2(extent.west(UNIT.DEGREE), extent.south(UNIT.DEGREE));
        const dimension = extent.dimensions(UNIT.DEGREE);
        const c = document.createElement('canvas');

        c.width = sizeTexture;
        c.height = sizeTexture;
        const ctx = c.getContext('2d');

        for (const features of collections.children) {
            /* eslint-disable guard-for-in */
            for (const id in features.featureVertices) {
                const polygon = features.featureVertices[id];
                const properties = collections.features[id].properties.properties;
                const vertices = features.vertices.slice(polygon.offset, polygon.offset + polygon.count);
                if (features.type === 'point') {
                    drawPoint(ctx, vertices, origin, dimension);
                } else {
                    drawPolygon(ctx, vertices, origin, dimension, properties);
                }
            }
        }
        /* eslint-enable guard-for-in */
        const texture = new THREE.Texture(c);
        texture.flipY = false;
        texture.needsUpdate = true;
        texture.name = 'featureRaster';
        return texture;
    },
};

