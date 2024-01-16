import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import Stats from 'three/addons/libs/stats.module.js';

const WIDTH = 10;
const PARTICLES = WIDTH * WIDTH;
const RADIUS = 2;

const GRAVITY = 900;
const SMOOTHING_RADIUS = 100;

const BOUNDS = Math.min(window.innerHeight, innerWidth) - 2 * RADIUS, BOUNDS_HALF = BOUNDS / 2;

class ParticleGeometry extends THREE.BufferGeometry {
    constructor() {
        super();

        const pointsPerParticle = 6
        const points =  PARTICLES * pointsPerParticle;
        const vertices = new THREE.BufferAttribute( new Float32Array( points * 3 ), 3 );
        const references = new THREE.BufferAttribute( new Float32Array( points * 2 ), 2 );
        const uvs = new THREE.BufferAttribute( new Float32Array( points * 2 ), 2 );

        this.setAttribute( 'position', vertices );
        this.setAttribute( 'reference', references );
        this.setAttribute( 'uv', uvs );
        // this.setIndex( [0, 2, 1, 0, 3, 2] );
        
        let v = 0, u = 0;

        function verts_push() {
            for ( let i = 0; i < arguments.length; i ++ ) {
                vertices.array[ v ++ ] = arguments[ i ];
            }
        }

        // for ( let f = 0; f < PARTICLES; f ++ ) {
        //     verts_push(
        //         - RADIUS,   RADIUS, 0, 
        //           RADIUS,   RADIUS, 0, 
        //           RADIUS, - RADIUS, 0, 
        //         - RADIUS, - RADIUS, 0,
        //     );
        // }
        // for ( let f = 0; f < PARTICLES; f ++ ) {
        //     uvs_push(
        //         0.0, 0.0, 
        //         1.0, 0.0, 
        //         1.0, 1.0, 
        //         0.0, 1.0, 
        //     );
        // }

        for ( let f = 0; f < PARTICLES; f ++ ) {
            verts_push(
                - RADIUS, - RADIUS, 0, 
                  RADIUS, - RADIUS, 0, 
                  RADIUS,   RADIUS, 0,

                  RADIUS,   RADIUS, 0, 
                - RADIUS,   RADIUS, 0, 
                - RADIUS, - RADIUS, 0,
            );
        }

        function uvs_push() {
            for ( let i = 0; i < arguments.length; i ++ ) {
                uvs.array[ u ++ ] = arguments[ i ];
            }
        }

        for ( let f = 0; f < PARTICLES; f ++ ) {
            uvs_push(
                0.0, 1.0, 
                1.0, 1.0, 
                1.0, 0.0, 

                1.0, 0.0,
                0.0, 0.0,
                0.0, 1.0, 
            );
        }

        for (let i = 0; i < points; i++) {
            const particleIndex = ~ ~ (i / pointsPerParticle);
            const x = (particleIndex % WIDTH) / WIDTH;
            const y = ~ ~ (particleIndex / WIDTH) / WIDTH;

            references.array[ 2 * i    ] = x;
            references.array[ 2 * i + 1] = y;
        }
    }
}

let container, stats;
let camera, scene, renderer;

let windowHalfX = window.innerWidth / 2;
let windowHalfY = window.innerHeight / 2;
console.log(windowHalfX, windowHalfY);
let gpuCompute;
let positionVariable, velocityVariable;
let positionUniforms, velocityUniforms;
let particleUniforms;

let backgroundUniforms;

let last = performance.now();

init();
animate();

function init() {
    container = document.createElement( 'div' );
    document.body.appendChild( container );

    camera = new THREE.OrthographicCamera(
        -windowHalfX, windowHalfX, 
        windowHalfY, -windowHalfY,
        0.5, 1.5);

    camera.position.z = 1;
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    scene = new THREE.Scene();
    scene.background = new THREE.Color( 0x000000 );

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    container.appendChild( renderer.domElement );

    stats = new Stats();
	container.appendChild( stats.dom );
    
    initComputeRenderer();
    initBackground();
    initParticles();
}

function initComputeRenderer() {
    gpuCompute = new GPUComputationRenderer( WIDTH, WIDTH, renderer );

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();
    
    fillPositionTexture( dtPosition );
    fillVelocityTexture( dtVelocity );

    velocityVariable = gpuCompute.addVariable( 'textureVelocity', document.getElementById( 'fragmentVelocity' ).textContent, dtVelocity );
    positionVariable = gpuCompute.addVariable( 'texturePosition', document.getElementById( 'fragmentPosition' ).textContent, dtPosition );
    

    gpuCompute.setVariableDependencies( positionVariable, [positionVariable, velocityVariable] );
    gpuCompute.setVariableDependencies( velocityVariable, [positionVariable, velocityVariable] );

    positionUniforms = positionVariable.material.uniforms;
    positionUniforms[ 'deltaTime' ] = { value: 1 };
    positionUniforms[ 'boundaries' ] = { value: BOUNDS_HALF };
    positionUniforms[ 'gravity' ] = { value: - GRAVITY };
    positionUniforms[ 'smoothingRadius' ] = { value: SMOOTHING_RADIUS };
    positionUniforms[ 'textureWidth' ] = { value: WIDTH };

    velocityUniforms = velocityVariable.material.uniforms;
    velocityUniforms[ 'deltaTime' ] = { value: 1 };
    velocityUniforms[ 'boundaries' ] = { value: BOUNDS_HALF };
    velocityUniforms[ 'gravity' ] = { value: - GRAVITY };
    velocityUniforms[ 'dumpingFactor' ] = { value: 0.9 };

    const error = gpuCompute.init();

    if ( error !== null ) {

        console.error( error );

    }
}

function fillPositionTexture( texture ) {
    const theArray = texture.image.data;

    for ( let k = 0; k < theArray.length; k += 4 ) {
        theArray[ k + 0 ] = ( (Math.random() * 2 - 1) * BOUNDS_HALF );
        theArray[ k + 1 ] = ( (Math.random() * 2 - 1) * BOUNDS_HALF );
        theArray[ k + 2 ] = 0;
        theArray[ k + 3 ] = 1;
    }
}

function fillVelocityTexture( texture ) {
    const theArray = texture.image.data;

    for ( let k = 0; k < theArray.length; k += 4 ) {
        theArray[ k + 0 ] = 0;
        theArray[ k + 1 ] = 0;
        theArray[ k + 2 ] = 0;
        theArray[ k + 3 ] = 1;
    }
}

function initParticles() {
    const geometry = new ParticleGeometry();

    particleUniforms = {
        'texturePosition': {value: null}
    };

    const material = new THREE.ShaderMaterial({
        uniforms: particleUniforms,
        vertexShader: document.getElementById( 'vertexShader' ).textContent,
        fragmentShader: document.getElementById( 'fragmentShader' ).textContent,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor
    })

    const particles = new THREE.Mesh( geometry, material );
    scene.add( particles );
}

function initBackground() {
    const geometry = new THREE.PlaneGeometry( windowHalfX * 2, windowHalfY * 2 );

    backgroundUniforms = {
        'texturePosition': {value: null},
        'textureWidth': {value: WIDTH},
        'smoothingRadius': {value: SMOOTHING_RADIUS},
        'halfResolution': { value: [ windowHalfX, windowHalfY] }
    }

    const material = new THREE.ShaderMaterial({
        uniforms: backgroundUniforms,
        fragmentShader: document.getElementById( 'fragmentBackground' ).textContent
    })

    const background = new THREE.Mesh( geometry, material );
    scene.add( background ); 
}

function animate() {
    requestAnimationFrame( animate );
    render();
    stats.update();
} 

function render() {
    const now = performance.now();
    const deltaTime = ( now - last ) / 1e3;
    last = now;

    positionUniforms[ 'deltaTime' ].value = deltaTime;
    velocityUniforms[ 'deltaTime' ].value = deltaTime;

    gpuCompute.compute();

    particleUniforms[ 'texturePosition' ].value = gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
    backgroundUniforms[ 'texturePosition' ].value = gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
    
    renderer.render( scene, camera );
}